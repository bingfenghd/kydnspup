import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { harness } from './helpers.mjs';
const payload = { type: 'ping', target: 'example.com', ipVersion: '4', nodeIds: ['test-sh'] };

test('async submission survives browser disconnect, polls and replays without redispatch', async t => {
  const h = await harness(); t.after(() => h.close()); await h.setup(); h.control.delay = 250;
  const id = randomUUID(), headers = { 'X-Request-ID': id, Prefer: 'respond-async' };
  const first = await h.request('/api/probes', payload, 'POST', headers);
  assert.equal(first.status, 202); assert.equal(first.data.id, id);
  assert.equal((await h.request(`/api/probes/${id}`)).data.status, 'running');
  assert.equal((await h.request('/api/probes', payload, 'POST', headers)).status, 202);
  assert.equal((await h.request('/api/probes', { ...payload, target: 'other.example' }, 'POST', headers)).status, 409);
  await new Promise(r => setTimeout(r, 300));
  const job = (await h.request(`/api/probes/${id}`)).data;
  assert.equal(job.status, 'completed'); assert.equal(job.result.results.length, 1); assert.equal(job.summary.ok, 1);
  assert.equal(h.control.probes.length, 1); assert.equal((await h.request('/api/admin/stats')).data.today, 1);
  assert.equal((await h.request(`/api/probes/${randomUUID()}`)).status, 404);
});

test('job recovery is visitor-bound and unknown upstream outcome never automatically retries', async t => {
  const h = await harness({ trustLocalProxy: true }); t.after(() => h.close()); await h.setup(); await h.request('/api/catalog');
  h.control.error = { status: 502, code: 'invalid_upstream' };
  const id = randomUUID();
  await h.request('/api/probes', payload, 'POST', { 'X-Request-ID': id, Prefer: 'respond-async' });
  await new Promise(r => setTimeout(r, 50));
  assert.equal((await h.request(`/api/probes/${id}`, undefined, 'GET', { 'X-Real-IP': '8.8.8.8' })).status, 404);
  const job = (await h.request(`/api/probes/${id}`)).data;
  assert.equal(job.status, 'unknown'); assert.equal(job.resultAvailable, false); assert.equal(job.error.code, 'invalid_upstream');
  await h.request(`/api/probes/${id}`); assert.equal(h.control.probes.length, 1);
});
