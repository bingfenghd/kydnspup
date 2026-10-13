import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { createApp } from '../server/app.mjs';
import { signedHeaders } from '../server/upstream.mjs';
import { root, listen, fixtureNodes } from './helpers.mjs';

const remoteID = 'req_1234567890abcdef12345678';
const payload = { type: 'ping', target: 'example.com', ipVersion: '4', nodeIds: ['test-sh'] };
async function fixture(t, capability = true) {
  mkdirSync(resolve(root, '.tmp'), { recursive: true });
  const directory = mkdtempSync(resolve(root, '.tmp/platform-jobs-'));
  const control = { posts: [], queries: [], capability, state: 'running', queryError: null, loseCreateResponse: false, queryGate: null, queryAborted: false };
  function result(body = payload) {
    const data = { type: body.type, target: body.target, requestId: remoteID, status: ['queued', 'running'].includes(control.state) ? 'completed' : control.state };
    const row = { node_id: 'test-sh', status: 'ok', latency_ms: 12 };
    if (body.type === 'dns') data.rows = [{ nodeId: 'test-sh', status: 'ok', results: ['1.1.1.1'], elapsedMs: 12 }];
    else if (['traceroute', 'mtr'].includes(body.type)) data.traces = [{ nodeId: 'test-sh', available: true, status: 'partial', trace: { status: 'partial', complete: false, sequence: 20, hops: [{ ip: '1.1.1.1', averageMs: 12 }], raw: 'fixture-private-raw' } }];
    else data.results = [{ ...row, ...(body.type === 'http' ? { http_status: 200, head: 'fixture-private-header' } : {}) }];
    return data;
  }
  function job() {
    const terminal = !['queued', 'running'].includes(control.state);
    return { requestId: remoteID, status: control.state, completedNodes: terminal ? 1 : 0, totalNodes: 1, ...(terminal ? { result: result(control.posts.at(-1)?.body) } : {}) };
  }
  const fetcher = async (url, options) => {
    const path = new URL(url).pathname;
    let data, status = 200;
    if (path === '/v1/account') data = { enabled: true, maxNodes: 2, maxCount: 4, monthlyLimit: 100, ...(control.capability !== undefined ? { capabilities: { asyncProbesV1: control.capability } } : {}) };
    else if (path === '/v1/nodes') data = fixtureNodes;
    else if (path === '/v1/tools') data = ['ping', 'tcping', 'http', 'dns', 'traceroute', 'mtr'].map(id => ({ id, enabled: true, available: true }));
    else if (path === '/v1/probes') {
      const body = JSON.parse(options.body); control.posts.push({ body, headers: options.headers });
      if (control.loseCreateResponse) throw new Error('fixture response lost after acceptance');
      if (options.headers.Prefer === 'respond-async') { status = 202; data = job(); } else data = result(body);
    } else if (path === `/v1/probes/${remoteID}`) {
      control.queries.push({ path, headers: options.headers, method: options.method });
      if (control.queryGate) await Promise.race([control.queryGate, new Promise((_, reject) => options.signal.addEventListener('abort', () => { control.queryAborted = true; reject(new Error('query aborted')); }, { once: true }))]);
      if (control.queryError) return new Response(JSON.stringify({ error: { code: control.queryError.code, message: 'raw-secret-never-export' } }), { status: control.queryError.status, headers: control.queryError.retryAfter ? { 'Retry-After': String(control.queryError.retryAfter) } : {} });
      data = job();
    } else throw new Error(`Unexpected fixture request ${path}`);
    return new Response(JSON.stringify({ data }), { status, headers: { 'Content-Type': 'application/json' } });
  };
  let app, origin, cookie = '';
  async function start() { app = createApp({ root, dataDir: directory, upstreamOptions: { fetcher } }); origin = await listen(app.server); }
  await start();
  t.after(async () => { await app.close(); rmSync(directory, { recursive: true, force: true }); });
  async function request(path, data, method = data === undefined ? 'GET' : 'POST', headers = {}) {
    const response = await fetch(origin + path, { method, headers: { Origin: origin, 'Content-Type': 'application/json', 'X-KY-Request': '1', Cookie: cookie, ...headers }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    if (response.headers.has('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    return { status: response.status, data: await response.json() };
  }
  await request('/api/admin/setup', { password: 'platform-fixture-password' });
  const credentials = { apiKey: 'fixture-key', apiSecret: 'fixture-secret', sourceMode: 'domain', sourceDomain: 'fixture.example' };
  await request('/api/admin/credentials', credentials, 'PUT');
  const call = id => app.store.db.prepare('SELECT * FROM calls WHERE id=?').get(id);
  async function submitted(id, body = payload) {
    const response = await request('/api/probes', body, 'POST', { 'X-Request-ID': id, Prefer: 'respond-async' });
    assert.equal(response.status, 202);
    for (let i = 0; i < 100 && call(id)?.status === 'running' && !call(id).upstream_job; i++) await new Promise(resolve => setTimeout(resolve, 5));
    return call(id);
  }
  return { control, request, credentials, call, submitted, store: () => app.store, restart: async () => { await app.close(); await start(); } };
}

test('explicit capability negotiates durable jobs and freshly signed GETs without repeated POST', async t => {
  const h = await fixture(t), id = randomUUID();
  const saved = await h.submitted(id);
  assert.equal(h.control.posts.length, 1);
  assert.equal(h.control.posts[0].headers['Idempotency-Key'], id);
  assert.equal(h.control.posts[0].headers.Prefer, 'respond-async');
  const remote = JSON.parse(saved.upstream_job);
  assert.equal(remote.requestId, remoteID); assert.match(remote.credentialVersion, /^[a-f0-9]{64}$/);
  for (const privateValue of ['fixture-key', 'fixture-secret', 'example.com']) assert.ok(!saved.upstream_job.includes(privateValue));
  const running = await h.request(`/api/probes/${id}`);
  assert.equal(running.data.status, 'running'); assert.equal(running.data.resultAvailable, false);
  h.control.state = 'completed';
  // A prior running query starts the platform poll cooldown, including background queries.
  const deadline = Date.now() + 5000;
  let response;
  do {
    response = await h.request(`/api/probes/${id}`);
    assert.equal(response.status, 200);
    if (response.data.resultAvailable) break;
    assert.equal(response.data.status, 'running');
    await new Promise(resolve => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  assert.equal(response.data.resultAvailable, true); assert.equal(response.data.result.status, 'completed');
  assert.equal(response.data.completedNodes, 1); assert.equal(response.data.totalNodes, 1);
  const query = h.control.queries[0];
  const expected = signedHeaders(h.credentials, query.path, '', 'GET', Number(query.headers['X-API-Timestamp']), query.headers['X-API-Nonce']);
  assert.equal(query.headers['X-API-Signature'], expected['X-API-Signature']);
  assert.notEqual(query.headers['X-API-Nonce'], h.control.posts[0].headers['X-API-Nonce']);
  assert.equal(query.headers['Idempotency-Key'], undefined); assert.equal(query.method, 'GET');
  await h.request('/api/probes', payload, 'POST', { 'X-Request-ID': id, Prefer: 'respond-async' });
  assert.equal(h.control.posts.length, 1); assert.equal((await h.request('/api/admin/stats')).data.today, 1);
});

test('missing or non-boolean capability keeps the original synchronous upstream contract', async t => {
  for (const capability of [undefined, false, 'true']) {
    const h = await fixture(t, capability);
    h.control.capability = capability;
    const id = randomUUID(); await h.submitted(id);
    assert.equal(h.call(id).upstream_job, null);
    assert.equal(h.control.posts[0].headers.Prefer, undefined); assert.equal(h.control.posts[0].headers['Idempotency-Key'], undefined);
    assert.equal((await h.request(`/api/probes/${id}`)).data.resultAvailable, true); assert.equal(h.control.queries.length, 0);
  }
});

test('saved upstream IDs recover running and completed jobs across local restarts using GET only', async t => {
  const h = await fixture(t), id = randomUUID(); await h.submitted(id);
  h.control.state = 'completed'; await h.restart();
  let job = (await h.request(`/api/probes/${id}`)).data;
  assert.equal(job.status, 'completed'); assert.equal(job.resultAvailable, true);
  await h.restart(); job = (await h.request(`/api/probes/${id}`)).data;
  assert.equal(job.resultAvailable, true); assert.equal(job.result.requestId, remoteID);
  assert.equal(h.control.posts.length, 1); assert.equal((await h.request('/api/admin/stats')).data.today, 1);
  assert.ok(h.control.queries.length >= 2);
});

test('unknown creation response has no recoverable ID and never falls back or resubmits', async t => {
  const h = await fixture(t), id = randomUUID(); h.control.loseCreateResponse = true;
  await h.submitted(id);
  assert.equal(h.call(id).status, 'unknown'); assert.equal(h.call(id).upstream_job, null);
  await h.request(`/api/probes/${id}`); await h.restart();
  await h.request('/api/probes', payload, 'POST', { 'X-Request-ID': id, Prefer: 'respond-async' });
  assert.equal(h.control.posts.length, 1); assert.equal(h.control.queries.length, 0);
});

test('query authorization, expiry and capability outages never trigger a replacement detection', async t => {
  for (const status of [401, 403, 410, 503]) {
    const h = await fixture(t), id = randomUUID(); await h.submitted(id);
    h.control.queryError = { status, code: status === 410 ? 'result_expired' : status === 503 ? 'service_unavailable' : 'unauthorized' };
    const response = await h.request(`/api/probes/${id}`);
    assert.equal(response.data.resultAvailable, false);
    assert.equal(response.data.status, status === 503 ? 'running' : 'failed');
    assert.ok(!JSON.stringify(response.data).includes('raw-secret'));
    const queries = h.control.queries.length;
    await h.request('/api/probes', payload, 'POST', { 'X-Request-ID': id, Prefer: 'respond-async' });
    assert.equal(h.control.posts.length, 1);
    if (status === 410) assert.equal(h.control.queries.length, queries);
  }
});

test('local timeout frees concurrency but retains upstream lookup; changed credentials cannot query old jobs', async t => {
  const h = await fixture(t), id = randomUUID(); await h.submitted(id);
  h.store().db.prepare('UPDATE calls SET created=? WHERE id=?').run(new Date(Date.now() - 100000).toISOString(), id);
  assert.equal((await h.request(`/api/probes/${id}`)).data.status, 'unknown');
  assert.equal((await h.request('/api/admin/stats')).data.active, 0);
  await h.request('/api/admin/credentials', { ...h.credentials, apiKey: 'other-key', apiSecret: 'other-secret' }, 'PUT');
  const queries = h.control.queries.length;
  const response = await h.request(`/api/probes/${id}`);
  assert.equal(response.data.error.code, 'credentials_changed'); assert.equal(h.control.queries.length, queries);
  assert.equal(h.control.posts.length, 1);
});

test('all six tools and terminal partial unknown/failed results keep their original data', async t => {
  for (const type of ['ping', 'tcping', 'http', 'dns', 'traceroute', 'mtr']) {
    const h = await fixture(t), id = randomUUID();
    await h.submitted(id, { ...payload, type, port: 443, method: 'GET', record: 'AAAA' });
    h.control.state = type === 'traceroute' ? 'unknown' : type === 'mtr' ? 'failed' : 'completed';
    const job = (await h.request(`/api/probes/${id}`)).data;
    assert.equal(job.resultAvailable, true); assert.equal(job.result.type, type); assert.equal(job.result.status, h.control.state);
    if (['mtr', 'traceroute'].includes(type)) { assert.equal(job.result.traces[0].trace.complete, false); assert.equal(job.result.traces[0].trace.sequence, 20); assert.equal(job.result.diagnostics.partial, 1); }
    assert.equal(h.control.posts.length, 1);
  }
});

test('concurrent local queries are merged and recorded running jobs enforce the local concurrency limit', async t => {
  const h = await fixture(t), id = randomUUID();
  const settings = (await h.request('/api/admin/settings')).data.settings;
  await h.request('/api/admin/settings', { ...settings, concurrency: 1 }, 'PUT');
  await h.submitted(id);
  const rejected = await h.request('/api/probes', payload, 'POST', { 'X-Request-ID': randomUUID(), Prefer: 'respond-async' });
  assert.equal(rejected.status, 429); assert.equal(h.control.posts.length, 1);
  let release; h.control.queryGate = new Promise(resolve => { release = resolve; });
  const requests = [h.request(`/api/probes/${id}`), h.request(`/api/probes/${id}`), h.request(`/api/probes/${id}`)];
  for (let i = 0; !h.control.queries.length && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 5));
  h.control.state = 'completed'; release();
  for (const response of await Promise.all(requests)) assert.equal(response.data.resultAvailable, true);
  assert.equal(h.control.queries.length, 1); assert.equal((await h.request('/api/admin/stats')).data.active, 0);
});

test('shutdown aborts local polling without cancelling the platform job and restart can retrieve it', async t => {
  const h = await fixture(t), id = randomUUID(); await h.submitted(id);
  h.control.queryGate = new Promise(() => {});
  const reading = h.request(`/api/probes/${id}`);
  for (let i = 0; !h.control.queries.length && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 5));
  h.control.queryGate = null; h.control.state = 'completed';
  await h.restart(); await reading;
  assert.equal(h.control.queryAborted, true, 'shutdown should abort the in-flight local GET');
  assert.equal((await h.request(`/api/probes/${id}`)).data.resultAvailable, true);
  assert.equal(h.control.posts.length, 1);
});

test('legacy synchronous requests and interrupted records retain their original behavior', async t => {
  const h = await fixture(t), id = randomUUID();
  const response = await h.request('/api/probes', payload, 'POST', { 'X-Request-ID': id });
  assert.equal(response.status, 200); assert.equal(response.data.status, 'completed');
  assert.equal(h.control.posts[0].headers.Prefer, undefined);
  h.store().db.prepare("UPDATE calls SET status='running' WHERE id=?").run(id);
  await h.restart();
  const job = (await h.request(`/api/probes/${id}`)).data;
  assert.equal(job.status, 'unknown'); assert.equal(job.resultAvailable, false);
  assert.equal(h.control.posts.length, 1); assert.equal(h.control.queries.length, 0);
});

test('timed-out task recovery respects Retry-After across replay and restart without another charge', async t => {
  const h = await fixture(t), id = randomUUID(); await h.submitted(id);
  h.store().db.prepare('UPDATE calls SET created=? WHERE id=?').run(new Date(Date.now() - 100000).toISOString(), id);
  h.control.queryError = { status: 429, code: 'rate_limited', retryAfter: 60 };
  const limited = (await h.request(`/api/probes/${id}`)).data;
  assert.equal(limited.status, 'unknown'); assert.equal(limited.error.code, 'rate_limited');
  assert.equal(h.control.queries.length, 1);
  const pollAt = JSON.parse(h.call(id).upstream_job).nextPollAt;
  assert.ok(pollAt > Date.now() + 55000);
  await h.request(`/api/probes/${id}`);
  await h.request('/api/probes', payload, 'POST', { 'X-Request-ID': id, Prefer: 'respond-async' });
  await h.restart();
  await h.request(`/api/probes/${id}`);
  assert.equal(h.control.queries.length, 1, 'recovery must not bypass the platform query cooldown');
  const remote = JSON.parse(h.call(id).upstream_job); remote.nextPollAt = 0;
  h.store().db.prepare('UPDATE calls SET upstream_job=? WHERE id=?').run(JSON.stringify(remote), id);
  h.control.queryError = null; h.control.state = 'completed';
  const recovered = (await h.request(`/api/probes/${id}`)).data;
  assert.equal(recovered.resultAvailable, true); assert.equal(recovered.result.requestId, remoteID);
  assert.equal(h.control.posts.length, 1); assert.equal((await h.request('/api/admin/stats')).data.today, 1);
});
