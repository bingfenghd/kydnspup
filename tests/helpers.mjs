import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { createApp } from '../server/app.mjs';
export const root = resolve(import.meta.dirname, '..');
export const fixtureNodes = [
  { id: 'test-sh', name: '上海电信测试节点', region: '上海', city: '上海', isp: '电信', status: 'online' },
  { id: 'test-gz', name: '广州联通测试节点', region: '广东', city: '广州', isp: '联通', status: 'online' },
  { id: 'test-bj', name: '北京移动测试节点', region: '北京', city: '北京', isp: '移动', status: 'online' }
];
export async function listen(server, port = 0) { await new Promise(r => server.listen(port, '127.0.0.1', r)); return `http://127.0.0.1:${server.address().port}`; }
export async function harness({ port = 0, ...options } = {}) {
  mkdirSync(resolve(root, '.tmp'), { recursive: true });
  const directory = mkdtempSync(resolve(root, '.tmp/test-'));
  const control = { probes: [], reads: [], delay: 0, error: null, toolDisabled: '', status: 'completed', nodes: fixtureNodes };
  const fixture = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const payload = raw ? JSON.parse(raw) : null;
    if (payload) control.probes.push({ payload, headers: req.headers, raw }); else control.reads.push(req.url);
    res.setHeader('Content-Type', 'application/json');
    if (control.error) { res.statusCode = control.error.status; return res.end(JSON.stringify({ error: { code: control.error.code, message: 'untrusted upstream error fake-key fake-secret' } })); }
    let data;
    if (req.url === '/v1/account') data = { name: '测试专用账户', plan: 'fixture', enabled: true, monthlyLimit: 5000, monthlyUsed: control.probes.length, maxNodes: 2, maxCount: 4, apiSecret: 'fake-secret', apiKey: 'fake-key' };
    else if (req.url === '/v1/nodes') data = control.nodes;
    else if (req.url === '/v1/tools') data = ['ping','tcping','http','dns','traceroute','mtr'].map(id => ({ id, enabled: control.toolDisabled !== id, available: true }));
    else if (req.url === '/v1/probes') {
      if (control.delay) await new Promise(r => setTimeout(r, control.delay));
      data = { type: payload.type, target: payload.target, requestId: 'fixture-request-' + control.probes.length, status: control.status, usage: { monthlyLimit: 5000, monthlyUsed: control.probes.length } };
      const selected = fixtureNodes.filter(n => payload.nodeIds.includes(n.id));
      if (payload.type === 'dns') data.rows = selected.map(n => ({ nodeId: n.id, node: n.name, region: n.region, isp: n.isp, status: 'ok', results: ['93.184.216.34'], dns: '1.1.1.1', elapsedMs: 21 }));
      else if (['mtr','traceroute'].includes(payload.type)) data.traces = selected.map(n => ({ nodeId: n.id, node: n.name, region: n.region, isp: n.isp, status: 'ok', available: true, trace: { status: 'ok', hops: [{ hop: 1, ip: '1.1.1.1', geo: '测试位置', as: 'AS TEST', loss: '0%', averageMs: 12, sent: 100 }], raw: 'TEST FIXTURE ONLY' } }));
      else data.results = selected.map((n, i) => ({ node_id: n.id, location: n.name, region: n.region, isp: n.isp, ip: '93.184.216.34', status: 'ok', min_latency: 10 + i * 6, avg_latency: 15 + i * 6, max_latency: 19 + i * 6, loss_rate: 0, sent_count: payload.count || 4, received_count: payload.count || 4, latency_ms: 15 + i * 6, ...(payload.type === 'http' ? { http_status: 200, total_time: 121 + i * 12, dns_time: 12, connect_time: 35, download_time: 17, redirect_count: 1, head: 'HTTP/2 200\r\nContent-Type: text/html\r\nServer: fixture-only' } : {}) }));
    } else { res.statusCode = 404; return res.end('{}'); }
    res.end(JSON.stringify({ data }));
  });
  const upstreamOrigin = await listen(fixture);
  const app = createApp({ root, dataDir: directory, upstreamOptions: { origin: upstreamOrigin }, ...options });
  const origin = await listen(app.server, port); let cookie = '';
  async function request(path, value, method = value === undefined ? 'GET' : 'POST', headers = {}) {
    const response = await fetch(origin + path, { method, headers: { Origin: origin, 'Content-Type': 'application/json', 'X-KY-Request': '1', ...(cookie ? { Cookie: cookie } : {}), ...headers }, ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
    if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    return { status: response.status, data: await response.json(), headers: response.headers };
  }
  async function setup() {
    await request('/api/admin/setup', { password: 'local-fixture-password' });
    await request('/api/admin/credentials', { apiKey: 'fake-key', apiSecret: 'fake-secret', sourceMode: 'ip', sourceDomain: '' }, 'PUT');
  }
  return { origin, app, control, directory, request, setup, close: async () => { await app.close(); fixture.closeIdleConnections(); await new Promise(r => fixture.close(r)); rmSync(directory, { recursive: true, force: true }); } };
}
