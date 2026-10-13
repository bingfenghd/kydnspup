import { createServer } from 'node:http';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { isIP } from 'node:net';
import { AppError, fail, TOOL_IDS, validateSettings, text, integer } from './config.mjs';
import { createStore, passwordHash, verifyPassword, dayKey } from './store.mjs';
import { createUpstream, validateCredentials } from './upstream.mjs';
import { summarizeProbe } from '../shared/probe-diagnostics.ts';
import { nodeCapabilities, nodeSupports } from '../shared/node-capabilities.ts';

const hash = value => createHash('sha256').update(value).digest('hex');
const escapeHTML = value => String(value).replace(/[&<>"']/g, x => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[x]));
const safeAccount = data => Object.fromEntries(['name', 'plan', 'enabled', 'expiresAt', 'monthlyLimit', 'monthlyUsed', 'totalUsage', 'maxNodes', 'maxCount', 'rateLimitPerMinute'].filter(k => data[k] !== undefined).map(k => [k, data[k]]));
const stripTargetQuery = target => { try { const u = new URL(target); return u.origin + u.pathname; } catch { return target; } };

export function createApp({ dataDir, root, upstreamOptions, localSetup = true, setupToken = '', publicOrigin = '', secureCookie = false, trustLocalProxy = false } = {}) {
  const store = createStore(dataDir), upstream = createUpstream(store, upstreamOptions);
  const rate = new Map(), replay = new Map(), jobs = new Set(), queries = new Map(); let catalog = null, catalogPromise = null, middleware, closing = false;
  const stopQueries = new AbortController();
  const cache = { savedAt: 0 };
  const db = store.db;
  const timer = setInterval(() => {
    const now = Date.now(); for (const [key, value] of rate) if (value.until < now) rate.delete(key);
    for (const [key, value] of replay) if (value.until < now) replay.delete(key);
    db.prepare('DELETE FROM sessions WHERE expires < ?').run(now);
    db.prepare("DELETE FROM calls WHERE created < ?").run(new Date(now - 7 * 86400000).toISOString());
    db.prepare('DELETE FROM daily WHERE day < ?').run(new Date(now - 35 * 86400000).toISOString().slice(0, 10));
  }, 60000); timer.unref();
  const credentialVersion = () => hash(JSON.stringify(store.credentials()));
  const activeCount = () => db.prepare("SELECT COUNT(*) AS count FROM calls WHERE status='running'").get().count;
  const getCall = id => db.prepare('SELECT * FROM calls WHERE id=?').get(id);
  function invalidate() { catalog = null; catalogPromise = null; cache.savedAt = 0; }
  function throttle(key, limit, window = 60000) {
    const now = Date.now(), old = rate.get(key), item = old && old.until > now ? old : { count: 0, until: now + window };
    if (item.count >= limit) throw new AppError(429, 'rate_limited', '请求过于频繁，请稍后再试');
    if (rate.size > 10000 && !rate.has(key)) throw new AppError(503, 'busy', '当前访问较多，请稍后再试');
    item.count++; rate.set(key, item);
  }
  function send(res, status, data) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); }
  async function body(req) {
    if (!req.headers['content-type']?.startsWith('application/json')) fail('需要 JSON 请求', 'invalid_content_type', 415);
    let size = 0; const parts = [];
    for await (const part of req) { size += part.length; if (size > 32768) fail('请求内容过大', 'too_large', 413); parts.push(part); }
    try { const value = JSON.parse(Buffer.concat(parts).toString()); if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error(); return value; }
    catch { fail('JSON 格式不正确'); }
  }
  function requireOrigin(req) {
    const origin = req.headers.origin;
    let expected = publicOrigin;
    if (!expected) {
      const host = req.headers.host || '';
      let parsed; try { parsed = new URL('http://' + host); } catch { fail('来源不正确', 'forbidden', 403); }
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)) fail('请设置 KY_PUBLIC_ORIGIN', 'forbidden', 403);
      expected = parsed.origin;
    }
    if (origin !== expected || req.headers['x-ky-request'] !== '1') fail('请求来源校验失败，请刷新本站页面', 'forbidden', 403);
  }
  function token(req) { return /(?:^|;\s*)ky_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1] || ''; }
  function authenticated(req) { const t = token(req); return t && db.prepare('SELECT token FROM sessions WHERE token=? AND expires>?').get(hash(t), Date.now()); }
  function requireAdmin(req) { if (!authenticated(req)) throw new AppError(401, 'login_required', '请先登录站长管理端'); }
  function session(res) {
    const t = randomBytes(32).toString('hex'); db.prepare('INSERT INTO sessions VALUES(?,?)').run(hash(t), Date.now() + 12 * 3600000);
    res.setHeader('Set-Cookie', `ky_session=${t}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200${secureCookie ? '; Secure' : ''}`);
  }
  async function getCatalog(force = false) {
    if (!force && catalog && cache.savedAt > Date.now() - 30000) return catalog;
    if (catalogPromise) return catalogPromise;
    const revision = credentialVersion();
    const pending = (async () => {
      const [account, nodes, tools] = await Promise.all([upstream.request('/v1/account'), upstream.request('/v1/nodes'), upstream.request('/v1/tools')]);
      if (revision !== credentialVersion()) throw new AppError(409, 'credentials_changed', '凭据已变更，请重新核验连接');
      if (!account || !Array.isArray(nodes) || !Array.isArray(tools)) throw new AppError(502, 'invalid_upstream', '节点服务返回的数据结构不正确');
      catalog = { account: safeAccount(account), asyncProbes: account.capabilities?.asyncProbesV1 === true, nodes: nodes.map(n => ({ id: String(n.id), name: String(n.name || ''), region: String(n.region || ''), city: String(n.city || ''), isp: String(n.isp || ''), status: String(n.status || ''), capabilities: nodeCapabilities(n.capabilities), ...(typeof n.lastSeenAt === 'string' && Number.isFinite(Date.parse(n.lastSeenAt)) ? { lastSeenAt: new Date(n.lastSeenAt).toISOString() } : {}) })), tools: tools.filter(t => TOOL_IDS.includes(t.id)).map(t => ({ id: t.id, enabled: t.enabled === true && t.available !== false })) };
      cache.savedAt = Date.now(); return catalog;
    })();
    catalogPromise = pending;
    try { return await pending; } finally { if (catalogPromise === pending) catalogPromise = null; }
  }
  function credentialsView() { const c = store.credentials(); return { configured: !!c, keyHint: c ? `•••• ${c.apiKey.slice(-4)}` : '', sourceMode: c?.sourceMode || 'ip', sourceDomain: c?.sourceDomain || '' }; }
  const recentCalls = () => db.prepare('SELECT id,created,tool,target,nodes,status,request_id,message,error_code,summary FROM calls ORDER BY created DESC LIMIT 100').all().map(c => ({ ...c, summary: c.summary ? JSON.parse(c.summary) : null }));
  function diagnostics() {
    const connection = store.get('connectionCheck'), configured = !!store.credentials();
    const checks = [
      { id: 'runtime', status: 'ok', message: '应用与数据库可访问' },
      { id: 'origin', status: publicOrigin.startsWith('https:') ? 'ok' : 'warning', message: publicOrigin.startsWith('https:') ? '已配置 HTTPS 对外地址' : '当前未配置 HTTPS 对外地址，公网部署前请按部署文档配置' },
      { id: 'credentials', status: configured ? 'ok' : 'warning', message: configured ? '客户凭据已加密保存' : '尚未保存 DNSPup 客户凭据' },
      { id: 'connection', status: connection ? connection.ok ? 'ok' : 'error' : 'warning', message: connection ? connection.ok ? '上次连接核验通过；这不是实时可用性保证' : `上次连接核验未通过（${connection.errorCode}），请重新测试连接` : '尚未执行连接核验' },
      { id: 'nodes', status: connection?.nodes > 0 ? 'ok' : 'warning', message: connection?.nodes > 0 ? `上次核验取得 ${connection.nodes} 个授权节点` : '尚未确认可用授权节点' },
      { id: 'firstProbe', status: store.get('firstProbeAt') ? 'ok' : 'warning', message: store.get('firstProbeAt') ? '已取得至少一次有效检测结果' : '请前往前台选择目标，手动完成首次检测；会按套餐计量' }
    ];
    return { version: '0.1.0', checkedAt: new Date().toISOString(), checks, onboarding: { credentialsSaved: configured, connectionCheckedAt: connection?.checkedAt || null, connectionOk: connection?.ok ?? null, firstProbeAt: store.get('firstProbeAt') }, calls: recentCalls().map(c => ({ id: c.id, created: c.created, tool: c.tool, status: c.status, requestId: c.request_id, errorCode: c.error_code, summary: c.summary })) };
  }
  function jobView(call) {
    const cached = replay.get(call.id), available = !!cached && cached.until > Date.now();
    const remote = call.upstream_job ? JSON.parse(call.upstream_job) : null;
    return { id: call.id, status: call.status, requestId: call.request_id || '', summary: call.summary ? JSON.parse(call.summary) : null,
      ...(remote ? { upstreamStatus: remote.status, completedNodes: remote.completedNodes, totalNodes: remote.totalNodes } : {}),
      resultAvailable: available, ...(available ? { result: cached.value, expiresAt: new Date(cached.until).toISOString() } : {}),
      ...(call.status === 'running' || available ? {} : { error: { code: call.error_code || 'result_expired', message: call.message || '结果缓存已过期或服务已重启；原请求不会重新执行，请勿自动重试' } }) };
  }
  function saveResult(call, result, revision, remoteStatus) {
    if (!result || ![...['completed', 'partial', 'timeout'], ...(remoteStatus ? ['failed', 'unknown'] : [])].includes(result.status) || !Array.isArray(result.results || result.rows || result.traces)) throw new AppError(502, 'invalid_upstream', '检测结果格式异常');
    const { usage, ...value } = result;
    if (remoteStatus) value.status = remoteStatus;
    value.diagnostics = summarizeProbe({ ...value, type: call.tool }, call.nodes);
    value.requestId = /^(?:req_[a-zA-Z0-9_-]{1,100}|fixture-request-\d+)$/.test(result.requestId || '') ? result.requestId : '';
    db.prepare('UPDATE calls SET status=?,request_id=?,summary=?,message=NULL,error_code=NULL WHERE id=?').run(value.status, value.requestId, JSON.stringify(value.diagnostics), call.id);
    if (value.diagnostics.measured > 0 && revision === credentialVersion() && !store.get('firstProbeAt')) store.set('firstProbeAt', new Date().toISOString());
    if (Buffer.byteLength(JSON.stringify(value)) <= 4 * 1024 * 1024 + 4096) {
      if (replay.size >= 20) replay.delete(replay.keys().next().value);
      replay.set(call.id, { value, until: Date.now() + 10 * 60000 });
    }
    if (revision === credentialVersion() && catalog && usage && typeof usage === 'object') Object.assign(catalog.account, safeAccount(usage));
    return value;
  }
  function saveFailure(id, error, status) {
    const failure = error instanceof AppError ? error : new AppError(500, 'internal_error', '执行异常，状态未知，请勿重复提交');
    db.prepare('UPDATE calls SET status=?,message=?,error_code=? WHERE id=?').run(status || (failure.status >= 500 ? 'unknown' : 'failed'), failure.message, failure.code, id);
    return failure;
  }
  function saveRemote(call, response, revision, previous) {
    const job = response.data, states = ['queued', 'running', 'completed', 'partial', 'timeout', 'failed', 'unknown'];
    if (![200, 202].includes(response.status) || !job || !/^req_[a-f0-9]{24}$/i.test(job.requestId || '') || previous && previous.requestId !== job.requestId || !states.includes(job.status) || !Number.isInteger(job.completedNodes) || !Number.isInteger(job.totalNodes) || job.completedNodes < 0 || job.completedNodes > job.totalNodes || job.totalNodes < 1 || job.totalNodes > call.nodes) throw new AppError(502, 'invalid_upstream', '平台任务状态格式异常，原检测不会重新提交');
    const remote = { requestId: job.requestId, credentialVersion: revision, status: job.status, completedNodes: job.completedNodes, totalNodes: job.totalNodes, nextPollAt: Date.now() + Math.max(response.retryAfter * 1000, previous ? Math.max(2000, activeCount() * 400) : 0) };
    // Persist the accepted ID before any result parsing or further network request.
    db.prepare('UPDATE calls SET upstream_job=?,request_id=? WHERE id=?').run(JSON.stringify(remote), job.requestId, call.id);
    if (job.result && !['queued', 'running'].includes(job.status)) return saveResult(call, { ...job.result, requestId: job.requestId }, revision, job.status);
    if (!['queued', 'running'].includes(job.status)) saveFailure(call.id, new AppError(502, job.status === 'unknown' ? 'execution_state_unknown' : 'result_unavailable', '平台任务已结束但没有可返回的结果，请保留请求编号排查，勿重复提交'), job.status);
    else if (Date.now() - Date.parse(call.created) >= (call.tool === 'mtr' ? 240000 : 90000)) saveFailure(call.id, new AppError(504, 'upstream_pending', '平台任务尚未取得终态，请用原任务编号找回结果，勿重复提交'), 'unknown');
    else db.prepare("UPDATE calls SET status='running',message=NULL,error_code=NULL WHERE id=?").run(call.id);
  }
  async function queryJob(call) {
    if (!call.upstream_job || closing || replay.get(call.id)?.until > Date.now()) return call;
    if (queries.has(call.id)) return queries.get(call.id);
    const remote = JSON.parse(call.upstream_job);
    if (remote.expired) return call;
    if (remote.credentialVersion !== credentialVersion()) { saveFailure(call.id, new AppError(409, 'credentials_changed', '当前凭据与原任务不同，无法读取原检测结果'), 'unknown'); return getCall(call.id); }
    if ((call.status === 'running' || call.error_code) && remote.nextPollAt > Date.now()) return call;
    const pending = (async () => {
      try {
        const response = await upstream.request(`/v1/probes/${remote.requestId}`, undefined, 20000, { responseMeta: true, signal: stopQueries.signal });
        if (remote.credentialVersion !== credentialVersion()) throw new AppError(409, 'credentials_changed', '当前凭据与原任务不同，无法读取原检测结果');
        saveRemote(call, response, remote.credentialVersion, remote);
      } catch (error) {
        if (!closing) {
          remote.nextPollAt = Date.now() + Math.max(2000, activeCount() * 400, (error.retryAfter || 0) * 1000);
          if (error.status === 410) remote.expired = true;
          db.prepare('UPDATE calls SET upstream_job=? WHERE id=?').run(JSON.stringify(remote), call.id);
          const transient = error.status >= 500 || error.status === 429;
          const waiting = call.status === 'running' && Date.now() - Date.parse(call.created) < (call.tool === 'mtr' ? 240000 : 90000);
          saveFailure(call.id, error, transient && waiting ? 'running' : transient || error.code === 'credentials_changed' ? 'unknown' : 'failed');
        }
      }
      return getCall(call.id);
    })();
    queries.set(call.id, pending);
    try { return await pending; } finally { queries.delete(call.id); }
  }
  function refreshRemoteJobs() {
    if (closing) return;
    for (const call of db.prepare("SELECT * FROM calls WHERE status='running' AND upstream_job IS NOT NULL").all()) void queryJob(call).catch(() => {});
  }
  const queryTimer = setInterval(refreshRemoteJobs, 1000); queryTimer.unref();
  queueMicrotask(refreshRemoteJobs);
  function publicSettings() {
    const { name, tagline, description, logoUrl, siteUrl, contact, footer, seoTitle, tools, defaultNodeIds, maxNodes, ads, headerAds = [], toolAds = [], toolBottomAds = [], contentAds = [], mobileHeaderAds = [], mobileMenuAds = [], mobileSummaryAds = [], mobileResultAds = [], links } = store.settings();
    return { name, tagline, description, logoUrl, siteUrl, contact, footer, seoTitle, tools, defaultNodeIds, maxNodes, ads, headerAds, toolAds, toolBottomAds, contentAds, mobileHeaderAds, mobileMenuAds, mobileSummaryAds, mobileResultAds, links, connected: !!store.credentials() };
  }
  function normalizeProbe(input, settings, catalog) {
    const type = input.type;
    if (!settings.tools.includes(type) || !catalog.tools.some(t => t.id === type && t.enabled)) fail('当前站点未开通此工具', 'tool_not_allowed', 403);
    let target = text(input.target, 2048).normalize('NFKC').replace(/。/g, '.');
    if (!target || /[\s\u0000-\u001f]/.test(target)) fail('请输入有效的公网 IP、域名或网址');
    let host = target;
    if (type === 'http') {
      if (!/^https?:\/\//i.test(target)) target = 'https://' + target;
      let url; try { url = new URL(target); } catch { fail('网址格式不正确'); }
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) fail('网址格式不正确');
      host = url.hostname.replace(/^\[|\]$/g, '');
    } else if (target.includes('/') || target.includes('@')) fail('此工具请输入域名或 IP，不包含网址路径');
    const ipv4 = isIP(host) === 4 ? host.split('.').map(Number) : null;
    if ((!isIP(host) && (!host.includes('.') || /(?:^|\.)(?:localhost|local|internal)$/i.test(host))) || host === '::1' || host === '::' || /^(?:fc|fd|fe[89ab])/i.test(host) && isIP(host) === 6 || ipv4 && (ipv4[0] === 0 || ipv4[0] === 10 || ipv4[0] === 127 || ipv4[0] >= 224 || ipv4[0] === 192 && ipv4[1] === 168 || ipv4[0] === 172 && ipv4[1] >= 16 && ipv4[1] <= 31 || ipv4[0] === 169 && ipv4[1] === 254)) fail('仅支持公网检测目标');
    if (!['4', '6'].includes(input.ipVersion)) fail('请选择 IPv4 或 IPv6');
    const maxNodes = Math.min(settings.maxNodes, catalog.account.maxNodes || 100);
    if (!Array.isArray(input.nodeIds) || !input.nodeIds.length || input.nodeIds.length > maxNodes || new Set(input.nodeIds).size !== input.nodeIds.length || input.nodeIds.some(id => !catalog.nodes.some(n => n.id === id))) fail(`请选择 1 至 ${maxNodes} 个授权节点`);
    if (input.nodeIds.some(id => !nodeSupports(catalog.nodes.find(n => n.id === id), type, input.ipVersion))) fail('所选节点不支持该工具或 IP 协议，请刷新节点后重新选择', 'invalid_nodes');
    const result = { type, target, ipVersion: input.ipVersion, nodeIds: input.nodeIds };
    if (['ping', 'tcping', 'http'].includes(type)) result.count = integer(input.count ?? Math.min(4, catalog.account.maxCount || 4), 1, Math.min(100, catalog.account.maxCount || 100));
    if (input.server && input.server !== '运营商DNS') {
      const server = text(input.server, 100), parts = /^\[([^\]]+)\](?::(\d+))?$/.exec(server) || /^(\d+\.\d+\.\d+\.\d+):(\d+)$/.exec(server);
      const host = parts ? parts[1] : server;
      const v4 = isIP(host) === 4 ? host.split('.').map(Number) : null;
      if (!isIP(host) || host === '::' || host === '::1' || /^(?:fc|fd|fe[89ab]|ff|::ffff:)/i.test(host) && isIP(host) === 6 || v4 && (v4[0] === 0 || v4[0] === 10 || v4[0] === 127 || v4[0] >= 224 || v4[0] === 192 && v4[1] === 168 || v4[0] === 172 && v4[1] >= 16 && v4[1] <= 31 || v4[0] === 169 && v4[1] === 254)) fail('请输入有效的公网 DNS 服务器地址');
      if (parts?.[2]) integer(Number(parts[2]), 1, 65535);
      result.server = server;
    }
    if (type === 'tcping') result.port = integer(input.port, 1, 65535);
    if (type === 'http') { if (!['GET', 'HEAD'].includes(input.method)) fail('HTTP 方法不正确'); result.method = input.method; }
    if (type === 'dns') { if (!['A', 'AAAA', 'CNAME', 'MX', 'NS', 'TXT', 'PTR', 'SRV'].includes(input.record)) fail('DNS 记录类型不正确'); result.record = input.record; }
    if (['traceroute', 'mtr'].includes(type)) result.mode = type;
    return result;
  }
  async function handle(req, res) {
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: http:; connect-src 'self' ws:; font-src 'self'; base-uri 'self'; frame-ancestors 'none'");
    let pathname; try { pathname = new URL(req.url, 'http://localhost').pathname; } catch { return send(res, 400, { error: { code: 'invalid_request', message: '地址不正确' } }); }
    try {
      if (pathname.startsWith('/api/')) {
        const peer = req.socket.remoteAddress || 'unknown';
        const realIP = trustLocalProxy && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer) && isIP(req.headers['x-real-ip'] || '') ? req.headers['x-real-ip'] : peer;
        const visitor = createHmac('sha256', store.key).update(realIP).digest('hex');
        if (req.method !== 'GET') requireOrigin(req);
        if (req.method === 'GET' && pathname === '/api/health') return send(res, 200, { ok: true, version: '0.1.0' });
        if (req.method === 'GET' && pathname === '/api/site') return send(res, 200, publicSettings());
        if (req.method === 'GET' && pathname === '/api/catalog') {
          throttle('catalog:' + visitor, 60);
          const c = await getCatalog(), s = store.settings();
          return send(res, 200, { nodes: c.nodes, tools: c.tools.filter(t => s.tools.includes(t.id)), maxNodes: Math.min(s.maxNodes, c.account.maxNodes || 100), maxCount: Math.min(100, c.account.maxCount || 100), requestsPerMinute: Math.min(s.requestsPerMinute, c.account.rateLimitPerMinute || s.requestsPerMinute) });
        }
        if (req.method === 'GET' && pathname === '/api/admin/session') return send(res, 200, { initialized: !!store.get('password'), authenticated: !!authenticated(req), localSetup });
        if (req.method === 'POST' && ['/api/admin/setup', '/api/admin/login'].includes(pathname)) {
          throttle('login:' + visitor, 8, 15 * 60000);
          const input = await body(req), password = text(input.password, 128);
          if (pathname.endsWith('/setup')) {
            if (store.get('password')) fail('管理员已创建，请登录', 'already_initialized', 409);
            if (!localSetup && (!setupToken || input.setupToken !== setupToken)) fail('需要服务器配置的初始化令牌', 'setup_forbidden', 403);
            if (password.length < 12) fail('管理员密码至少需要 12 个字符');
            store.set('password', passwordHash(password));
          } else if (!verifyPassword(password, store.get('password'))) fail('密码不正确', 'invalid_credentials', 401);
          session(res); return send(res, 200, { ok: true });
        }
        if (pathname.startsWith('/api/admin/')) {
          requireAdmin(req);
          if (req.method === 'POST' && pathname === '/api/admin/logout') { db.prepare('DELETE FROM sessions WHERE token=?').run(hash(token(req))); res.setHeader('Set-Cookie', 'ky_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0'); return send(res, 200, { ok: true }); }
          if (req.method === 'GET' && pathname === '/api/admin/settings') return send(res, 200, { settings: store.settings(), api: credentialsView() });
          if (req.method === 'PUT' && pathname === '/api/admin/settings') { const settings = validateSettings(await body(req)); store.set('settings', settings); return send(res, 200, { settings }); }
          if (req.method === 'PUT' && pathname === '/api/admin/credentials') { const c = validateCredentials(await body(req), store.credentials()); if (JSON.stringify(c) !== JSON.stringify(store.credentials())) { store.set('connectionCheck', null); store.set('firstProbeAt', null); } store.saveCredentials(c); invalidate(); return send(res, 200, credentialsView()); }
          if (req.method === 'DELETE' && pathname === '/api/admin/credentials') { store.saveCredentials(null); store.set('connectionCheck', null); store.set('firstProbeAt', null); invalidate(); return send(res, 200, credentialsView()); }
          if (req.method === 'GET' && pathname === '/api/admin/diagnostics') return send(res, 200, diagnostics());
          if (req.method === 'POST' && pathname === '/api/admin/check') {
            const revision = credentialVersion();
            try { const c = await getCatalog(true); if (revision !== credentialVersion()) fail('凭据已变更，请重新核验连接', 'credentials_changed', 409); store.set('connectionCheck', { ok: true, checkedAt: new Date().toISOString(), nodes: c.nodes.length }); return send(res, 200, { account: c.account, nodes: c.nodes.length, tools: c.tools.filter(t => t.enabled).map(t => t.id) }); }
            catch (error) { if (revision === credentialVersion()) store.set('connectionCheck', { ok: false, checkedAt: new Date().toISOString(), errorCode: error instanceof AppError ? error.code : 'internal_error' }); throw error; }
          }
          if (req.method === 'GET' && pathname === '/api/admin/account') return send(res, 200, (await getCatalog()).account);
          if (req.method === 'POST' && pathname === '/api/admin/password') {
            throttle('password:' + visitor, 8, 15 * 60000); const input = await body(req);
            if (!verifyPassword(text(input.currentPassword, 128), store.get('password'))) fail('原密码不正确');
            const next = text(input.password, 128); if (next.length < 12) fail('新密码至少 12 个字符');
            store.set('password', passwordHash(next)); db.exec('DELETE FROM sessions'); session(res); return send(res, 200, { ok: true });
          }
          if (req.method === 'GET' && pathname === '/api/admin/stats') {
            const today = dayKey();
            return send(res, 200, { today: db.prepare('SELECT attempts FROM daily WHERE day=?').get(today)?.attempts || 0, active: activeCount(), daily: db.prepare('SELECT day, attempts FROM daily ORDER BY day DESC LIMIT 7').all().reverse(), tools: db.prepare('SELECT tool, COUNT(*) AS count FROM calls GROUP BY tool').all(), calls: recentCalls() });
          }
          if (req.method === 'GET' && pathname === '/api/admin/export') return send(res, 200, { format: 'kydnspup-settings-v1', settings: store.settings() });
          if (req.method === 'POST' && pathname === '/api/admin/import') { const input = await body(req); if (input.format !== 'kydnspup-settings-v1') fail('备份格式不正确'); const s = validateSettings(input.settings); store.set('settings', s); return send(res, 200, { settings: s }); }
        }
        if (req.method === 'GET' && /^\/api\/probes\/[a-z0-9-]{16,80}$/i.test(pathname)) {
          throttle('poll:' + visitor, 180);
          const call = db.prepare('SELECT * FROM calls WHERE id=? AND visitor=?').get(pathname.split('/').at(-1), visitor);
          if (!call) fail('请求记录不存在或当前访问来源已变化', 'not_found', 404);
          return send(res, 200, jobView(await queryJob(call)));
        }
        if (req.method === 'POST' && pathname === '/api/probes') {
          const input = await body(req), id = req.headers['x-request-id'];
          if (typeof id !== 'string' || !/^[a-z0-9-]{16,80}$/i.test(id)) fail('缺少有效请求编号');
          const payloadHash = hash(JSON.stringify(input)), previous = db.prepare('SELECT * FROM calls WHERE id=?').get(id);
          if (previous) {
            if (previous.visitor !== visitor || previous.payload !== payloadHash) fail('请求编号冲突', 'request_conflict', 409);
            if (req.headers.prefer === 'respond-async') { const current = await queryJob(previous); return send(res, current.status === 'running' ? 202 : 200, jobView(current)); }
            const cached = replay.get(id);
            if (cached && cached.until > Date.now()) return send(res, 200, cached.value);
            fail('此请求已提交，请查看原请求结果；不要重复提交', 'already_submitted', 409);
          }
          const settings = store.settings(); throttle('probe:' + visitor, settings.requestsPerMinute);
          const c = await getCatalog(), payload = normalizeProbe(input, settings, c), day = dayKey();
          // Catalog refresh is asynchronous: another identical request may have reserved this ID while we waited.
          if (db.prepare('SELECT id FROM calls WHERE id=?').get(id)) fail('此请求已提交，请等待原请求结果', 'already_submitted', 409);
          if (activeCount() >= settings.concurrency) fail('本站检测任务较多，请稍后重试', 'busy', 429);
          const used = db.prepare('SELECT attempts FROM daily WHERE day=?').get(day)?.attempts || 0;
          if (used >= settings.dailyLimit) fail('本站今日提交上限已达到，请明日再试', 'daily_limit', 429);
          db.prepare('INSERT INTO daily(day,attempts) VALUES(?,1) ON CONFLICT(day) DO UPDATE SET attempts=attempts+1').run(day);
          db.prepare('INSERT INTO calls(id,visitor,payload,created,day,tool,target,nodes,status) VALUES(?,?,?,?,?,?,?,?,?)').run(id, visitor, payloadHash, new Date().toISOString(), day, payload.type, stripTargetQuery(payload.target), payload.nodeIds.length, 'running');
          const credentialRevision = credentialVersion(), call = getCall(id);
          const task = (async () => { try {
            if (c.asyncProbes && req.headers.prefer === 'respond-async') {
              const response = await upstream.request('/v1/probes', payload, 20000, { responseMeta: true, idempotencyKey: id });
              return { value: saveRemote(call, response, credentialRevision), remote: true };
            }
            const result = await upstream.request('/v1/probes', payload, payload.type === 'mtr' ? 240000 : 90000);
            return { value: saveResult(call, result, credentialRevision) };
          } catch (error) {
            return { error: saveFailure(id, error) };
          }
          })();
          jobs.add(task); void task.finally(() => jobs.delete(task));
          if (req.headers.prefer === 'respond-async') return send(res, 202, { id, status: 'running', resultAvailable: false });
          const outcome = await task;
          if (outcome.error) throw outcome.error;
          if (outcome.remote && !outcome.value) { const current = getCall(id); return send(res, current.status === 'running' ? 202 : 200, jobView(current)); }
          return send(res, 200, outcome.value);
        }
        return send(res, 404, { error: { code: 'not_found', message: '接口不存在' } });
      }
      if (!['GET', 'HEAD'].includes(req.method)) return send(res, 405, { error: { message: '不支持此方法' } });
      const settings = store.settings();
      if (pathname === '/robots.txt') { res.setHeader('Content-Type', 'text/plain'); return res.end(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\n${settings.siteUrl ? `Sitemap: ${settings.siteUrl.replace(/\/$/, '')}/sitemap.xml\n` : ''}`); }
      if (pathname === '/sitemap.xml') {
        res.setHeader('Content-Type', 'application/xml');
        return res.end(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${settings.siteUrl ? ['/', '/help', '/privacy', ...settings.tools.map(t => '/' + t + '/'), ...settings.tools.filter(t => t !== 'dns').map(t => '/' + t + '_ipv6/')].map(p => `<url><loc>${escapeHTML(settings.siteUrl.replace(/\/$/, '') + p)}</loc></url>`).join('') : ''}</urlset>`);
      }
      if (middleware) return middleware(req, res, () => send(res, 404, { error: { message: '页面不存在' } }));
      const dist = resolve(root, 'dist'); let file = resolve(dist, '.' + decodeURIComponent(pathname));
      if (!file.startsWith(dist + sep)) file = resolve(dist, 'index.html');
      try { if (!(await stat(file)).isFile()) throw new Error(); }
      catch { if (extname(pathname)) return send(res, 404, { error: { message: '文件不存在' } }); file = resolve(dist, 'index.html'); }
      const content = await readFile(file);
      res.setHeader('Content-Type', ({ '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' })[extname(file)] || 'application/octet-stream');
      if (extname(file) === '.html') {
        res.setHeader('Cache-Control', 'no-cache');
        const html = content.toString().replace(/<title>[^<]*<\/title>/, `<title>${escapeHTML(settings.seoTitle)}</title>`).replace(/name="description" content="[^"]*"/, `name="description" content="${escapeHTML(settings.description)}"`);
        return res.end(req.method === 'HEAD' ? '' : html);
      }
      res.setHeader('Cache-Control', 'public,max-age=31536000,immutable'); res.end(req.method === 'HEAD' ? '' : content);
    } catch (error) { if (!res.headersSent) send(res, error instanceof AppError ? error.status : 500, { error: { code: error.code || 'internal_error', message: error instanceof AppError ? error.message : '服务处理失败，请稍后再试' } }); else res.end(); }
  }
  const server = createServer(handle); server.requestTimeout = 300000;
  return { server, store, setMiddleware: value => { middleware = value; }, close: async () => { closing = true; clearInterval(timer); clearInterval(queryTimer); stopQueries.abort(); server.closeIdleConnections(); await new Promise(resolveClose => server.close(resolveClose)); await Promise.allSettled(jobs); await Promise.allSettled(queries.values()); store.close(); } };
}
