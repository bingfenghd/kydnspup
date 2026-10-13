import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { harness } from './helpers.mjs';
import { summarizeProbe, traceDestination, probeNodeStatus } from '../shared/probe-diagnostics.ts';

test('task completion does not hide partial traces or imply destination reached', () => {
  const result = { type: 'mtr', target: '1.1.1.1', status: 'completed', traces: [
    { status: 'ok', available: true, trace: { status: 'partial', complete: true, hops: [{ ip: '8.8.8.8', averageMs: 12 }] } },
    { status: 'timeout', available: true, trace: { hops: [] } }
  ] };
  assert.equal(probeNodeStatus(result.traces[0], 'mtr'), 'partial');
  assert.deepEqual(summarizeProbe(result, 3), { expected: 3, returned: 2, ok: 0, partial: 1, timeout: 1, unavailable: 0, failed: 0, missing: 1, measured: 1, reached: 0, unreached: 2, unknownDestination: 0 });
  assert.equal(traceDestination({ trace: { complete: true, hops: [{ ip: '1.1.1.1', averageMs: 0 }] } }, 'example.com'), 'unknown');
  assert.equal(traceDestination({ trace: { targetIp: '2606:4700:4700::1111', hops: [{ ip: '2606:4700:4700:0:0:0:0:1111', averageMs: 12 }] } }), 'reached');
});

test('diagnostics require login, do not call upstream and export only safe metadata', async t => {
  const h = await harness(); t.after(() => h.close());
  assert.equal((await h.request('/api/admin/diagnostics')).status, 401);
  await h.setup();
  let d = (await h.request('/api/admin/diagnostics')).data;
  assert.equal(d.onboarding.credentialsSaved, true); assert.equal(d.onboarding.connectionOk, null);
  assert.equal(h.control.reads.length, 0);
  await h.request('/api/admin/check', {});
  d = (await h.request('/api/admin/diagnostics')).data;
  assert.equal(d.onboarding.connectionOk, true); assert.ok(d.onboarding.connectionCheckedAt);
  const id = randomUUID();
  await h.request('/api/probes', { type: 'http', target: 'https://example.com/private?token=hidden', method: 'GET', ipVersion: '4', nodeIds: ['test-sh'] }, 'POST', { 'X-Request-ID': id });
  d = (await h.request('/api/admin/diagnostics')).data;
  assert.ok(d.onboarding.firstProbeAt); assert.equal(d.calls[0].id, id); assert.equal(d.calls[0].summary.measured, 1);
  for (const secret of ['fake-key', 'fake-secret', 'example.com', '/private', 'test-sh', '93.184', 'local-fixture-password']) assert.ok(!JSON.stringify(d).includes(secret), secret);
  assert.equal(h.control.reads.length, 3);
  await h.request('/api/admin/credentials', { apiKey: 'different-key', apiSecret: 'different-secret', sourceMode: 'ip' }, 'PUT');
  d = (await h.request('/api/admin/diagnostics')).data;
  assert.equal(d.onboarding.connectionOk, null); assert.equal(d.onboarding.firstProbeAt, null);
});

test('failed connection records stable sanitized error and never marks onboarding ready', async t => {
  const h = await harness(); t.after(() => h.close()); await h.setup();
  h.control.error = { status: 401, code: 'unauthorized' };
  assert.equal((await h.request('/api/admin/check', {})).status, 401);
  const d = (await h.request('/api/admin/diagnostics')).data;
  assert.equal(d.onboarding.connectionOk, false); assert.ok(d.checks.some(c => c.status === 'error'));
  assert.ok(!JSON.stringify(d).includes('fake-secret'));
});
