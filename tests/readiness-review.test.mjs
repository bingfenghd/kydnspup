import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { harness, fixtureNodes } from './helpers.mjs';

function upstreamFixture({ beforeRead = async () => {}, largeResult = false } = {}) {
  let probes = 0;
  const fetcher = async (url, options) => {
    const path = new URL(url).pathname;
    if (options.method === 'GET') await beforeRead(options.headers['X-API-Key']);
    let data;
    if (path === '/v1/account') data = { name: options.headers['X-API-Key'], plan: 'fixture', enabled: true, maxNodes: 2, maxCount: 4, monthlyLimit: 100 };
    else if (path === '/v1/nodes') data = fixtureNodes;
    else if (path === '/v1/tools') data = ['ping', 'http'].map(id => ({ id, enabled: true, available: true }));
    else if (path === '/v1/probes') {
      probes++;
      const payload = JSON.parse(options.body);
      data = { ...payload, status: 'completed', requestId: 'req_1234567890abcdef12345678', results: [{ node_id: 'test-sh', status: 'ok', latency_ms: 12, http_status: 200, head: largeResult ? 'HTTP/2 200\r\nX-Fixture: ' + 'x'.repeat(550000) : '' }] };
    } else throw new Error(`Unexpected fixture request: ${path}`);
    return new Response(JSON.stringify({ data }), { headers: { 'Content-Type': 'application/json' } });
  };
  return { fetcher, probeCount: () => probes };
}

for (const remove of [false, true]) test(`in-flight connection checks cannot restore stale state after credentials are ${remove ? 'cleared' : 'replaced'}`, async t => {
  let release, began;
  const gate = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { began = resolve; });
  const fixture = upstreamFixture({ beforeRead: async key => { if (key === 'fake-key') { began(); await gate; } } });
  const h = await harness({ upstreamOptions: { fetcher: fixture.fetcher } }); t.after(() => h.close()); await h.setup();
  const checking = h.request('/api/admin/check', {});
  await started;
  if (remove) await h.request('/api/admin/credentials', undefined, 'DELETE');
  else await h.request('/api/admin/credentials', { apiKey: 'new-key', apiSecret: 'new-secret', sourceMode: 'ip' }, 'PUT');
  release(); await checking;
  const diagnostics = (await h.request('/api/admin/diagnostics')).data;
  assert.equal(diagnostics.onboarding.credentialsSaved, !remove);
  assert.equal(diagnostics.onboarding.connectionOk, null, 'old checks must not mark current credentials as verified');
  assert.equal(diagnostics.onboarding.connectionCheckedAt, null);
  const account = await h.request('/api/admin/account');
  if (remove) assert.equal(account.status, 503, 'old catalog must not survive credential removal');
  else assert.equal(account.data.name, 'new-key', 'new catalog must use current credentials');
});

test('async jobs retain valid results larger than the former 500KB replay limit without redispatch', async t => {
  const fixture = upstreamFixture({ largeResult: true });
  const h = await harness({ upstreamOptions: { fetcher: fixture.fetcher } }); t.after(() => h.close()); await h.setup();
  const id = randomUUID(), headers = { 'X-Request-ID': id, Prefer: 'respond-async' };
  const payload = { type: 'http', target: 'https://example.com', method: 'GET', ipVersion: '4', nodeIds: ['test-sh'] };
  assert.equal((await h.request('/api/probes', payload, 'POST', headers)).status, 202);
  let job;
  for (let i = 0; i < 20; i++) {
    job = (await h.request(`/api/probes/${id}`)).data;
    if (job.status !== 'running') break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(job.status, 'completed');
  assert.equal(job.resultAvailable, true, 'a valid newly completed result must remain retrievable');
  assert.ok(job.result.results[0].head.length > 500000);
  assert.equal((await h.request('/api/probes', payload, 'POST', headers)).data.resultAvailable, true);
  assert.equal(fixture.probeCount(), 1);
});
