import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeRound, probeNodeStatus } from '../src/probe-results.ts';
const round = row => ({ requestId: 'test', type: 'ping', target: 'example.com', status: 'completed', results: [{ node_id: 'one', ...row }] });
test('continuous results accumulate real samples, loss and weighted latency', () => {
  let value = mergeRound(undefined, round({ status: 'ok', latency_ms: 10, sent_count: 1, received_count: 1 }));
  value = mergeRound(value, round({ status: 'timeout', sent_count: 1, received_count: 0 }));
  value = mergeRound(value, round({ status: 'ok', latency_ms: 30, sent_count: 1, received_count: 1 }));
  const row = value.results[0];
  assert.equal(row.sent_count, 3); assert.equal(row.received_count, 2); assert.equal(row.loss_rate, 33.33);
  assert.equal(row.avg_latency, 20); assert.equal(row.min_latency, 10); assert.equal(row.max_latency, 30);
  assert.deepEqual(row.samples, [10, null, 30]);
});
test('unavailable nodes are not counted as sent packets; quality history is bounded', () => {
  let value = mergeRound(undefined, round({ status: 'unavailable' }));
  assert.equal(value.results[0].sent_count, 0); assert.equal(value.results[0].loss_rate, undefined);
  for (let i = 0; i < 70; i++) value = mergeRound(value, round({ status: 'slow', latency_ms: 200 }));
  assert.equal(value.results[0].sent_count, 70); assert.equal(value.results[0].avg_latency, 200); assert.equal(value.results[0].samples.length, 60);
});

const traceHops = [{ hop: 10, ip: '1.1.1.1', averageMs: 223, status: 'slow' }];
test('real traceroute rows with blank status and measured hops are normal', () => {
  const row = { status: '', available: true, trace: { hops: traceHops } };
  assert.equal(probeNodeStatus(row, 'traceroute'), 'ok');
  assert.equal([row].filter(row => probeNodeStatus(row, 'traceroute') !== 'ok').length, 0);
});
test('partial MTR results retain their status even when available', () => {
  const row = { status: 'partial', available: true, trace: { status: 'partial', hops: traceHops } };
  assert.equal(probeNodeStatus(row, 'mtr'), 'partial');
  assert.equal([row].filter(row => probeNodeStatus(row, 'mtr') !== 'ok').length, 1);
  assert.equal(probeNodeStatus({ ...row, status: '' }, 'mtr'), 'partial');
  assert.equal(probeNodeStatus({ ...row, trace: { status: 'partial', hops: [] } }, 'mtr'), 'partial');
});
test('trace error statuses take priority over available measurements', () => {
  for (const tool of ['traceroute', 'mtr']) for (const status of ['timeout', 'unavailable', 'failed']) {
    assert.equal(probeNodeStatus({ status, available: true, trace: { hops: traceHops } }, tool), status);
    assert.equal(probeNodeStatus({ status: '', available: true, trace: { status, hops: traceHops } }, tool), status);
  }
});
test('available trace rows without measured hops are not normal', () => {
  for (const hops of [[], [{ ip: '*', averageMs: 0 }], [{ ip: '--', averageMs: 0 }], [{ ip: '1.1.1.1' }]]) {
    assert.equal(probeNodeStatus({ status: '', available: true, trace: { hops } }, 'traceroute'), 'failed');
  }
  assert.equal(probeNodeStatus({ status: '', available: false, trace: { hops: traceHops } }, 'mtr'), 'failed');
  assert.equal(probeNodeStatus({ status: 'ok', available: true, trace: { hops: [] } }, 'mtr'), 'failed');
});
test('other tool status and HTTP response semantics are preserved', () => {
  for (const tool of ['ping', 'tcping', 'http', 'dns']) {
    for (const status of ['ok', 'success', 'slow']) assert.equal(probeNodeStatus({ status }, tool), 'ok');
    for (const status of ['timeout', 'unavailable', 'failed']) assert.equal(probeNodeStatus({ status }, tool), status);
    assert.equal(probeNodeStatus({ status: 'partial' }, tool), 'failed');
    assert.equal(probeNodeStatus({ status: '', available: true, trace: { hops: traceHops } }, tool), 'failed');
  }
  assert.equal(probeNodeStatus({ status: 'failed', http_status: 503 }, 'http'), 'ok');
});
