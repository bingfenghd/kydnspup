import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { harness } from './helpers.mjs';
import { nodeCapabilities, nodeSupports } from '../shared/node-capabilities.ts';
test('absent metadata remains unknown; explicit unsupported combinations are rejected before dispatch', async t => {
  const h = await harness(); t.after(() => h.close()); await h.setup();
  h.control.nodes = h.control.nodes.map((n, i) => i ? n : { ...n, capabilities: { ipVersions: ['4'], tools: ['ping'] }, secret: 'private-metadata' });
  const nodes = (await h.request('/api/catalog')).data.nodes;
  assert.equal(nodes[1].capabilities, undefined); assert.deepEqual(nodes[0].capabilities, { ipVersions: ['4'], tools: ['ping'] }); assert.equal(nodes[0].secret, undefined);
  for (const [type, ipVersion, nodeId, expected] of [['ping', '6', 'test-sh', 400], ['dns', '4', 'test-sh', 400], ['ping', '6', 'test-gz', 200]]) {
    const r = await h.request('/api/probes', { type, ipVersion, nodeIds: [nodeId], target: 'example.com', record: 'AAAA' }, 'POST', { 'X-Request-ID': randomUUID() });
    assert.equal(r.status, expected);
  }
  assert.equal(h.control.probes.length, 1);
});
test('capability parsing preserves independent unknown fields and honors explicit empty support', () => {
  assert.equal(nodeCapabilities(null), undefined); assert.equal(nodeCapabilities({ ipVersions: 6 }), undefined);
  assert.deepEqual(nodeCapabilities({ tools: ['ping'], apiKey: 'secret' }), { tools: ['ping'] });
  assert.equal(nodeSupports({ capabilities: { tools: ['ping'] } }, 'ping', '6'), true);
  assert.equal(nodeSupports({ capabilities: { ipVersions: [] } }, 'ping', '4'), false);
  assert.equal(nodeSupports({ status: 'offline' }, 'ping', '4'), false);
});
