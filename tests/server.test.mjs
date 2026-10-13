import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHmac, createHash, randomUUID } from 'node:crypto';
import { harness } from './helpers.mjs';
import { signedHeaders } from '../server/upstream.mjs';
import { createStore } from '../server/store.mjs';

async function fixture(t, options) { const h = await harness(options); t.after(() => h.close()); return h; }
const probe = (type = 'ping') => ({ type, target: 'example.com', ipVersion: '4', nodeIds: ['test-sh'], ...(type === 'tcping' ? { port: 443 } : {}), ...(type === 'http' ? { method: 'GET' } : {}), ...(type === 'dns' ? { record: 'A' } : {}) });
const submit = (h, value, id = randomUUID()) => h.request('/api/probes', value, 'POST', { 'X-Request-ID': id });

test('unconfigured site has no fake nodes, secret leaks or admin access', async t => {
  const h = await fixture(t);
  assert.equal((await h.request('/api/site')).data.connected, false);
  assert.equal((await h.request('/api/catalog')).data.error.code, 'not_configured');
  assert.equal((await h.request('/api/admin/settings')).status, 401);
  assert.equal((await h.request('/api/admin/setup', { password: 'short' })).status, 400);
  assert.equal((await h.request('/api/admin/setup', { password: 'valid-long-password' }, 'POST', { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await h.request('/api/admin/setup', { password: 'valid-long-password' })).status, 200);
  assert.equal((await h.request('/api/admin/setup', { password: 'valid-long-password' })).status, 409);
});
test('remote initialization requires bootstrap token', async t => {
  const h = await fixture(t, { localSetup: false, setupToken: 'test-token' });
  assert.equal((await h.request('/api/admin/setup', { password: 'valid-long-password' })).status, 403);
  assert.equal((await h.request('/api/admin/setup', { password: 'valid-long-password', setupToken: 'wrong-token' })).status, 403);
  assert.equal((await h.request('/api/admin/session')).data.initialized, false);
  assert.equal((await h.request('/api/admin/setup', { password: 'valid-long-password', setupToken: 'test-token' })).status, 200);
  assert.equal((await h.request('/api/admin/setup', { password: 'another-long-password', setupToken: 'test-token' })).status, 409);
  await h.request('/api/admin/logout', {});
  assert.equal((await h.request('/api/admin/login', { password: 'test-token' })).status, 401);
  assert.equal((await h.request('/api/admin/login', { password: 'valid-long-password' })).status, 200);
  for (const path of ['/api/site', '/api/admin/session', '/api/admin/export']) assert.ok(!JSON.stringify((await h.request(path)).data).includes('test-token'), path);
});
test('settings persist, unsafe URLs fail, exports exclude credentials and passwords', async t => {
  const h = await fixture(t); await h.setup();
  const settings = (await h.request('/api/admin/settings')).data.settings;
  assert.equal((await h.request('/api/admin/settings', { ...settings, logoUrl: 'javascript:alert(1)' }, 'PUT')).status, 400);
  assert.equal((await h.request('/api/admin/settings', { ...settings, tools: [] }, 'PUT')).status, 400);
  assert.equal((await h.request('/api/admin/settings', { ...settings, name: '我的测速站', dailyLimit: 12 }, 'PUT')).status, 200);
  assert.equal((await h.request('/api/site')).data.name, '我的测速站');
  const saved = createStore(h.directory); assert.equal(saved.settings().dailyLimit, 12); saved.close();
  for (const path of ['/api/site', '/api/admin/settings', '/api/admin/export', '/api/admin/account']) {
    const data = JSON.stringify((await h.request(path)).data);
    assert.ok(!data.includes('fake-secret'), path); assert.ok(!data.includes('local-fixture-password'), path);
  }
  assert.ok(!readFileSync(h.directory + '/site.sqlite').includes(Buffer.from('fake-secret')));
});
test('six probe types cross the actual HTTP adapter and preserve distinct result structures', async t => {
  const h = await fixture(t); await h.setup();
  const settings = (await h.request('/api/admin/settings')).data.settings;
  await h.request('/api/admin/settings', { ...settings, requestsPerMinute: 60 }, 'PUT');
  for (const type of ['ping','tcping','http','dns','traceroute','mtr']) {
    const result = await submit(h, probe(type)); assert.equal(result.status, 200, JSON.stringify(result.data));
    const key = type === 'dns' ? 'rows' : ['traceroute','mtr'].includes(type) ? 'traces' : 'results';
    assert.equal(result.data[key].length, 1, type); assert.equal(result.data.usage, undefined);
    const call = h.control.probes.at(-1); assert.equal(call.headers['x-api-key'], 'fake-key'); assert.equal(call.payload.type, type);
    if (type === 'mtr') { assert.equal(call.payload.mode, 'mtr'); assert.equal(call.payload.count, undefined); }
  }
});
test('successive probes reuse the catalog and update usage without extra rate-limited reads', async t => {
  const h = await fixture(t); await h.setup();
  await h.request('/api/catalog');
  assert.equal(h.control.reads.length, 3);
  for (let i = 1; i <= 2; i++) {
    assert.equal((await submit(h, probe())).status, 200);
    assert.equal((await h.request('/api/admin/account')).data.monthlyUsed, i);
    assert.equal(h.control.reads.length, 3);
  }
});
test('unselected, duplicate, unauthorized and oversized node selections never dispatch', async t => {
  const h = await fixture(t); await h.setup();
  for (const nodeIds of [[], ['foreign'], ['test-sh','test-sh'], ['test-sh','test-gz','test-bj']]) assert.equal((await submit(h, { ...probe(), nodeIds })).status, 400);
  assert.equal(h.control.probes.length, 0);
});
test('tool authorization, private targets and invalid TCP options fail before dispatch', async t => {
  const h = await fixture(t); await h.setup(); h.control.toolDisabled = 'mtr';
  assert.equal((await submit(h, probe('mtr'))).status, 403);
  assert.equal((await submit(h, { ...probe(), target: '127.0.0.1' })).status, 400);
  assert.equal((await submit(h, { ...probe('tcping'), port: 70000 })).status, 400);
  assert.equal(h.control.probes.length, 0);
});
test('duplicate submissions return prior result and never bill or dispatch twice', async t => {
  const h = await fixture(t); await h.setup(); const id = randomUUID();
  const first = await submit(h, probe(), id), second = await submit(h, probe(), id);
  assert.deepEqual(second.data, first.data); assert.equal(h.control.probes.length, 1);
  assert.equal((await submit(h, { ...probe(), target: 'other.example' }, id)).status, 409);
  assert.equal((await h.request('/api/admin/stats')).data.today, 1);
});
test('daily limits, concurrency and visitor rates prevent extra upstream calls', async t => {
  const h = await fixture(t); await h.setup(); let settings = (await h.request('/api/admin/settings')).data.settings;
  await h.request('/api/admin/settings', { ...settings, dailyLimit: 1, concurrency: 1 }, 'PUT');
  h.control.delay = 200;
  const first = submit(h, probe());
  await new Promise(r => setTimeout(r, 40));
  assert.equal((await submit(h, probe())).status, 429);
  assert.equal((await first).status, 200);
  assert.equal((await submit(h, probe())).data.error.code, 'daily_limit');
  assert.equal(h.control.probes.length, 1);
});
test('simultaneous duplicate requests reserve a single submission after catalog refresh', async t => {
  const h = await fixture(t); await h.setup(); h.control.delay = 150; const id = randomUUID();
  const responses = await Promise.all([submit(h, probe(), id), submit(h, probe(), id)]);
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
  assert.equal(h.control.probes.length, 1);
  assert.equal((await h.request('/api/admin/stats')).data.today, 1);
});
test('upstream errors are redacted, URL query is absent from persistent call records', async t => {
  const h = await fixture(t); await h.setup(); await h.request('/api/catalog');
  h.control.error = { status: 429, code: 'quota_exceeded' };
  const error = await submit(h, { ...probe('http'), target: 'https://example.com/?secret=private' });
  assert.equal(error.status, 429); assert.ok(!JSON.stringify(error).includes('fake-secret'));
  const calls = (await h.request('/api/admin/stats')).data.calls;
  assert.equal(calls[0].target, 'https://example.com/'); assert.equal(calls[0].status, 'failed');
  assert.ok(!readFileSync(h.directory + '/site.sqlite-wal').includes(Buffer.from('secret=private')));
});
test('password changes invalidate old sessions and preserve configuration', async t => {
  const h = await fixture(t); await h.setup();
  const login = await h.request('/api/admin/login', { password: 'local-fixture-password' });
  const oldCookie = login.headers.get('set-cookie').split(';')[0];
  assert.equal((await h.request('/api/admin/password', { currentPassword: 'wrong', password: 'new-long-password' })).status, 400);
  assert.equal((await h.request('/api/admin/password', { currentPassword: 'local-fixture-password', password: 'new-long-password' })).status, 200);
  const denied = await fetch(h.origin + '/api/admin/settings', { headers: { Cookie: oldCookie } }); assert.equal(denied.status, 401);
  assert.equal((await h.request('/api/admin/login', { password: 'local-fixture-password' })).status, 401);
  assert.equal((await h.request('/api/admin/login', { password: 'new-long-password' })).status, 200);
});
test('source-domain signing matches the copied Go contract including nul and exact body', () => {
  const credentials = { apiKey: 'fake-key', apiSecret: 'fake-secret', sourceMode: 'domain', sourceDomain: 'api.example.com' };
  const body = '{"type":"ping","target":"example.com"}', now = 1788268800, nonce = '0123456789abcdef0123456789abcdef';
  const digest = createHash('sha256').update('fake-secret').digest('hex');
  const key = createHmac('sha256', digest).update(Buffer.concat([Buffer.from('dnspup-customer-api-signing/v1'), Buffer.from([0])])).digest();
  const message = `dnspup-customer-api-v1\nPOST\n/v1/probes\n\n${now}\n${nonce}\napi.example.com\n${createHash('sha256').update(body).digest('hex')}`;
  assert.equal(signedHeaders(credentials, '/v1/probes', body, 'POST', now, nonce)['X-API-Signature'], createHmac('sha256', key).update(message).digest('hex'));
});

test('source rate limit cannot be bypassed with an untrusted forwarded IP', async t => {
  const h = await fixture(t); await h.setup();
  const settings = (await h.request('/api/admin/settings')).data.settings;
  await h.request('/api/admin/settings', { ...settings, requestsPerMinute: 1 }, 'PUT');
  assert.equal((await submit(h, probe())).status, 200);
  const result = await h.request('/api/probes', probe(), 'POST', { 'X-Request-ID': randomUUID(), 'X-Forwarded-For': '8.8.8.8', 'X-Real-IP': '1.1.1.1' });
  assert.equal(result.data.error.code, 'rate_limited');
  assert.equal(h.control.probes.length, 1);
});

test('partial and timeout outcomes stay distinct and are recorded without automatic retries', async t => {
  const h = await fixture(t); await h.setup();
  for (const status of ['partial', 'timeout']) {
    h.control.status = status;
    const result = await submit(h, probe());
    assert.equal(result.status, 200); assert.equal(result.data.status, status);
    assert.equal((await h.request('/api/admin/stats')).data.calls[0].status, status);
  }
  assert.equal(h.control.probes.length, 2);
});

test('custom DNS and sample counts reach the customer API for all supported tools', async t => {
  const h = await fixture(t); await h.setup();
  const settings = (await h.request('/api/admin/settings')).data.settings;
  await h.request('/api/admin/settings', { ...settings, requestsPerMinute: 60 }, 'PUT');
  assert.equal((await h.request('/api/catalog')).data.maxCount, 4);
  for (const type of ['ping','tcping','http','dns','traceroute','mtr']) {
    const result = await submit(h, { ...probe(type), server: '8.8.8.8:5353', ...(['ping','tcping','http'].includes(type) ? { count: 1 } : {}) });
    assert.equal(result.status, 200);
    assert.equal(h.control.probes.at(-1).payload.server, '8.8.8.8:5353');
    if (['ping','tcping','http'].includes(type)) assert.equal(h.control.probes.at(-1).payload.count, 1);
  }
  assert.equal((await submit(h, { ...probe('dns'), server: '[2606:4700:4700::1111]:53' })).status, 200);
});
test('invalid DNS servers and out-of-plan sample counts never dispatch', async t => {
  const h = await fixture(t); await h.setup();
  const settings = (await h.request('/api/admin/settings')).data.settings;
  await h.request('/api/admin/settings', { ...settings, requestsPerMinute: 60 }, 'PUT');
  for (const server of ['localhost', '127.0.0.1', '10.0.0.1', '192.168.1.1', '::1', '[::ffff:127.0.0.1]:53', '8.8.8.8:0', '8.8.8.8:65536', 'https://8.8.8.8/dns-query']) assert.equal((await submit(h, { ...probe(), server })).status, 400, server);
  for (const count of [0, -1, 1.5, 5, 1000]) assert.equal((await submit(h, { ...probe(), count })).status, 400);
  assert.equal(h.control.probes.length, 0);
});

test('original header and tool ad placements persist and remain safe for public rendering', async t => {
  const h = await fixture(t); await h.setup();
  const settings = (await h.request('/api/admin/settings')).data.settings;
  const ad = { enabled: true, title: '测试广告', image: 'https://example.com/banner.png', url: 'https://example.com/' };
  const saved = await h.request('/api/admin/settings', { ...settings, headerAds: [ad, ad], toolAds: Array.from({length:6},()=>ad) }, 'PUT');
  assert.equal(saved.status, 200);
  const site = (await h.request('/api/site')).data;
  assert.equal(site.headerAds.length, 2); assert.equal(site.toolAds.length, 6);
  assert.equal((await h.request('/api/admin/export')).data.settings.toolAds.length, 6);
  assert.equal((await h.request('/api/admin/settings', { ...settings, headerAds: [{...ad, url:'javascript:alert(1)'}] }, 'PUT')).status, 400);
  assert.equal((await h.request('/api/admin/settings', { ...settings, toolAds: Array.from({length:7},()=>ad) }, 'PUT')).status, 400);
  const { headerAds, toolAds, ...oldSettings } = settings;
  assert.equal((await h.request('/api/admin/settings',oldSettings,'PUT')).status, 200);
  assert.deepEqual((await h.request('/api/site')).data.headerAds, []);
});

test('lower tool ad grid survives settings export and import while old backups remain compatible', async t => {
  const h = await fixture(t); await h.setup();
  const settings = (await h.request('/api/admin/settings')).data.settings;
  assert.deepEqual((await h.request('/api/site')).data.toolBottomAds, []);
  const toolBottomAds = Array.from({ length: 6 }, (_, i) => ({ enabled: true, title: `下方广告 ${i + 1}`, image: `https://example.com/banner-${i}.png`, url: `https://example.com/${i}` }));
  assert.equal((await h.request('/api/admin/settings', { ...settings, toolBottomAds }, 'PUT')).status, 200);
  assert.deepEqual((await h.request('/api/site')).data.toolBottomAds, toolBottomAds);
  const backup = (await h.request('/api/admin/export')).data;
  assert.deepEqual(backup.settings.toolBottomAds, toolBottomAds);
  assert.equal((await h.request('/api/admin/settings', { ...settings, toolBottomAds: [] }, 'PUT')).status, 200);
  assert.equal((await h.request('/api/admin/import', backup)).status, 200);
  assert.deepEqual((await h.request('/api/admin/settings')).data.settings.toolBottomAds, toolBottomAds);
  assert.deepEqual((await h.request('/api/site')).data.toolBottomAds, toolBottomAds);
  const { toolBottomAds: omitted, ...oldSettings } = settings;
  assert.equal((await h.request('/api/admin/import', { format: backup.format, settings: oldSettings })).status, 200);
  assert.deepEqual((await h.request('/api/site')).data.toolBottomAds, []);
});

test('lower tool ad grid rejects extra slots and unsafe image or destination URLs before saving', async t => {
  const h = await fixture(t); await h.setup();
  const settings = (await h.request('/api/admin/settings')).data.settings;
  const ad = { enabled: true, title: '下方广告', image: 'https://example.com/banner.png', url: 'https://example.com/' };
  const invalid = [Array.from({ length: 7 }, () => ad), [{ ...ad, url: 'javascript:alert(1)' }], [{ ...ad, image: 'data:image/svg+xml,<svg/>' }], [{ ...ad, image: 'https://user:password@example.com/banner.png' }]];
  for (const toolBottomAds of invalid) {
    assert.equal((await h.request('/api/admin/settings', { ...settings, toolBottomAds }, 'PUT')).status, 400);
    assert.equal((await h.request('/api/admin/import', { format: 'kydnspup-settings-v1', settings: { ...settings, toolBottomAds } })).status, 400);
  }
  assert.deepEqual((await h.request('/api/site')).data.toolBottomAds, []);
});

for (const [placement, max] of [['contentAds', 2], ['mobileHeaderAds', 1], ['mobileMenuAds', 2], ['mobileSummaryAds', 2], ['mobileResultAds', 2]]) test(`${placement} supports safe backup round trips and enforces its slot limit`, async t => {
  const h = await fixture(t); await h.setup();
  const settings = (await h.request('/api/admin/settings')).data.settings;
  assert.deepEqual((await h.request('/api/site')).data[placement], []);
  const ads = Array.from({ length: max }, (_, i) => ({ enabled: true, title: `广告 ${i + 1}`, image: `https://example.com/banner-${i}.png`, url: `https://example.com/${i}` }));
  assert.equal((await h.request('/api/admin/settings', { ...settings, [placement]: ads }, 'PUT')).status, 200);
  assert.deepEqual((await h.request('/api/site')).data[placement], ads);
  const backup = (await h.request('/api/admin/export')).data;
  assert.deepEqual(backup.settings[placement], ads);
  const oldSettings = { ...settings }; delete oldSettings[placement];
  assert.equal((await h.request('/api/admin/import', { ...backup, settings: oldSettings })).status, 200);
  assert.deepEqual((await h.request('/api/site')).data[placement], []);
  assert.equal((await h.request('/api/admin/import', backup)).status, 200);
  assert.deepEqual((await h.request('/api/site')).data[placement], ads);
  for (const invalid of [[...ads, ads[0]], [{ ...ads[0], url: 'javascript:alert(1)' }], [{ ...ads[0], image: 'data:image/svg+xml,<svg/>' }]]) {
    const value = { ...settings, [placement]: invalid };
    assert.equal((await h.request('/api/admin/settings', value, 'PUT')).status, 400);
    assert.equal((await h.request('/api/admin/import', { ...backup, settings: value })).status, 400);
  }
  assert.deepEqual((await h.request('/api/site')).data[placement], ads);
});
