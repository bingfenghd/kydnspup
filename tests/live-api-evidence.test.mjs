import test from 'node:test';
import assert from 'node:assert/strict';
import { hasMeasurement } from '../scripts/probe-evidence.mjs';

test('real IPv6 traceroute measurements do not require the optional targetIp field', () => {
  const row = { available: true, trace: { target: '2606:4700:4700::1111', complete: true, hops: [{ ip: '2408:8000:3::641', averageMs: 220 }] } };
  assert.equal(hasMeasurement(row, 'traceroute', '6'), true);
  assert.equal(hasMeasurement({ ...row, trace: { ...row.trace, targetIp: '1.1.1.1' } }, 'traceroute', '6'), false);
});
test('IPv6 acceptance rejects IPv4 fallback, mapped addresses and missing measurements', () => {
  for (const ip of ['1.1.1.1', '::ffff:1.1.1.1', '', '--']) {
    assert.equal(hasMeasurement({ ip, status: 'ok', loss_rate: 0, avg_latency: 1 }, 'ping', '6'), false);
    assert.equal(hasMeasurement({ status: 'ok', results: [ip], elapsedMs: 1 }, 'dns', '6'), false);
    assert.equal(hasMeasurement({ available: true, trace: { targetIp: '2606:4700:4700::1111', hops: [{ip, averageMs: 1}] } }, 'mtr', '6'), false);
  }
  assert.equal(hasMeasurement({ available: true, trace: { hops: [] } }, 'traceroute', '6'), false);
  assert.equal(hasMeasurement({ ip: '2606:4700:4700::1111', status: 'timeout', loss_rate: 100, avg_latency: 0 }, 'tcping', '6'), false);
});
test('measurement evidence stays separate from partial route completion', () => {
  assert.equal(hasMeasurement({ available: true, status: 'partial', trace: { status: 'partial', targetIp: '2606:4700:4700::1111', hops: [{ ip: '2408:8000:3::641', averageMs: 220 }] } }, 'mtr', '6'), true);
  assert.equal(hasMeasurement({ status: 'ok', ip: '1.1.1.1', loss_rate: 0, avg_latency: 12 }, 'ping', '4'), true);
});
