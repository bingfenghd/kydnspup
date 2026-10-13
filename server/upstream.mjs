import { createHash, createHmac, randomBytes } from 'node:crypto';
import { domainToASCII } from 'node:url';
import { AppError, fail, text } from './config.mjs';

export const DNSPUP_ORIGIN = 'https://api.dnspup.com';
export function validateCredentials(input, previous) {
  const apiKey = text(input.apiKey, 200) || previous?.apiKey;
  const apiSecret = text(input.apiSecret, 300) || previous?.apiSecret;
  if (!apiKey || !apiSecret || /[\s\r\n]/.test(apiKey + apiSecret)) fail('首次配置需要完整的 API Key 和 API Secret');
  if (!['ip', 'domain'].includes(input.sourceMode)) fail('请选择正确的来源绑定方式');
  const sourceDomain = domainToASCII(text(input.sourceDomain || '', 253)).toLowerCase();
  if (input.sourceMode === 'domain' && (!/^[a-z0-9.-]+$/.test(sourceDomain) || !sourceDomain.includes('.') || sourceDomain.startsWith('.') || sourceDomain.endsWith('.'))) fail('请输入与 DNSPup 授权一致的服务器域名，不包含协议和路径');
  return { apiKey, apiSecret, sourceMode: input.sourceMode, sourceDomain: input.sourceMode === 'domain' ? sourceDomain : '' };
}
export function signedHeaders(credentials, path, body = '', method = 'GET', now = Math.floor(Date.now() / 1000), nonce = randomBytes(16).toString('hex')) {
  const headers = { 'X-API-Key': credentials.apiKey, 'X-API-Secret': credentials.apiSecret, 'Accept': 'application/json', 'Content-Type': 'application/json' };
  if (credentials.sourceMode === 'domain') {
    const secretHash = createHash('sha256').update(credentials.apiSecret).digest('hex');
    const key = createHmac('sha256', secretHash).update('dnspup-customer-api-signing/v1\0').digest();
    const url = new URL(path, DNSPUP_ORIGIN);
    const message = ['dnspup-customer-api-v1', method, url.pathname, url.search.slice(1), String(now), nonce, credentials.sourceDomain, createHash('sha256').update(body).digest('hex')].join('\n');
    Object.assign(headers, { 'X-API-Source-Domain': credentials.sourceDomain, 'X-API-Timestamp': String(now), 'X-API-Nonce': nonce, 'X-API-Signature': createHmac('sha256', key).update(message).digest('hex') });
  }
  return headers;
}
const errorMessages = {
  unauthorized: '节点服务凭据无效、已到期或未匹配来源绑定，请联系站长',
  source_not_allowed: 'API 来源绑定不匹配，请在管理端核对',
  quota_exceeded: '节点服务本月请求额度已用完', rate_limited: '节点服务请求过于频繁，请稍后再试',
  tool_not_allowed: '当前账号未开通此工具', invalid_nodes: '所选节点暂不支持本次检测，请刷新后重新选择',
  invalid_request: '检测参数未通过节点服务校验', target_restricted: '该检测目标暂不允许访问',
  trusted_dns_resolution_failed: '目标公网解析失败，请检查地址后重试',
  invalid_upstream: '节点服务返回格式异常，执行及扣费状态未知，请勿重复提交',
  not_found: '平台任务不存在或当前凭据无权读取，请勿重新提交原检测',
  task_not_found: '平台任务不存在或当前凭据无权读取，请勿重新提交原检测',
  async_unavailable: '平台异步任务服务暂不可用，请稍后查询原任务，不要重新提交',
  result_expired: '平台检测结果已过期，原任务不会重新执行',
  idempotency_conflict: '检测请求编号与原参数冲突，请联系站长排查',
  execution_state_unknown: '平台无法确认检测执行状态，请勿重新提交原检测',
  service_unavailable: '节点服务暂不可用，请稍后再试'
};
export function createUpstream(store, { origin = DNSPUP_ORIGIN, fetcher = fetch } = {}) {
  async function request(path, payload, timeout = 20000, options = {}) {
    const credentials = store.credentials();
    if (!credentials) throw new AppError(503, 'not_configured', '站长尚未连接 DNSPup 节点服务');
    const body = payload === undefined ? '' : JSON.stringify(payload), method = payload === undefined ? 'GET' : 'POST';
    let response;
    const headers = signedHeaders(credentials, path, body, method);
    if (options.idempotencyKey) Object.assign(headers, { Prefer: 'respond-async', 'Idempotency-Key': options.idempotencyKey });
    const signal = options.signal ? AbortSignal.any([AbortSignal.timeout(timeout), options.signal]) : AbortSignal.timeout(timeout);
    try { response = await fetcher(origin + path, { method, headers, ...(body ? { body } : {}), redirect: 'error', signal }); }
    catch { throw new AppError(502, 'upstream_unreachable', payload ? '节点服务未及时返回，执行及扣费状态未知，请勿连续重试' : '暂时无法连接节点服务'); }
    let json;
    try {
      const reader = response.body.getReader(); let length = 0; const chunks = [];
      while (true) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > 4 * 1024 * 1024) { await reader.cancel(); throw new Error('too large'); } chunks.push(value); }
      json = JSON.parse(Buffer.concat(chunks).toString());
    } catch { throw new AppError(502, 'invalid_upstream', '节点服务返回格式异常'); }
    if (!response.ok) {
      const code = Object.hasOwn(errorMessages, json?.error?.code) ? json.error.code : 'upstream_error';
      const error = new AppError(response.status >= 400 && response.status < 500 ? response.status : 502, code, errorMessages[code] || '节点服务拒绝请求，请检查授权、来源绑定和服务状态');
      error.retryAfter = retryAfter(response.headers.get('retry-after')); throw error;
    }
    if (!json || !('data' in json)) throw new AppError(502, 'invalid_upstream', '节点服务返回缺少 data 字段');
    return options.responseMeta ? { data: json.data, status: response.status, retryAfter: retryAfter(response.headers.get('retry-after')) } : json.data;
  }
  return { request };
}
function retryAfter(value) { const seconds = Number(value); return Number.isFinite(seconds) && seconds > 0 ? Math.min(60, Math.ceil(seconds)) : 0; }
