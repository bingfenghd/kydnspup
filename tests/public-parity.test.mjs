import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

async function loadPublic(t) {
  await mkdir(resolve('.tmp'), { recursive: true });
  const directory = await mkdtemp(resolve('.tmp/public-parity-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const compiled = await build({
    entryPoints: ['src/Public.tsx'], bundle: true, packages: 'external', platform: 'node', format: 'esm', write: false,
    plugins: [{ name: 'public-form-test', setup(builder) {
      builder.onResolve({ filter: /\.css$/ }, args => ({ path: args.path, namespace: 'ignore-css' }));
      builder.onLoad({ filter: /.*/, namespace: 'ignore-css' }, () => ({ contents: '', loader: 'js' }));
      builder.onLoad({ filter: /[/\\]Results\.tsx$/ }, () => ({ contents: "import { createElement } from 'react'; export default function Results(props) { return createElement('div', {'data-results-mode':props.probeMode}); }", loader: 'js' }));
    } }]
  });
  const file = resolve(directory, 'Public.mjs');
  await writeFile(file, compiled.outputFiles[0].contents);
  return import(pathToFileURL(file).href);
}

test('Tcping form separates an explicit port while preserving bare IPv6 and the default port', async t => {
  const { splitTcpingTarget: parse } = await loadPublic(t);
  for (const [input, fallback, target, port] of [
    ['example.com', 80, 'example.com', 80],
    ['example.com:443', 80, 'example.com', 443],
    ['8.8.8.8:53', 80, '8.8.8.8', 53],
    ['[2606:4700:4700::1111]:443', 80, '2606:4700:4700::1111', 443],
    ['[2606:4700:4700::1111]', 80, '2606:4700:4700::1111', 80],
    ['2606:4700:4700::1111', 80, '2606:4700:4700::1111', 80],
    ['::ffff:8.8.8.8', 80, '::ffff:8.8.8.8', 80],
    ['example。com：４４３', 80, 'example.com', 443],
    ['example.com', 8443, 'example.com', 8443]
  ]) assert.deepEqual(parse(input, fallback), { target, port }, input);
});

test('Tcping form rejects malformed or out-of-range explicit ports instead of silently using the default', async t => {
  const { splitTcpingTarget: parse } = await loadPublic(t);
  for (const input of ['example.com:0', 'example.com:65536', 'example.com:abc', 'example.com:', 'example.com:1.5', '[2606:4700:4700::1111]:-1', '[2606:4700:4700::1111]:']) {
    assert.throws(() => parse(input), /1 至 65535/, input);
  }
  for (const fallback of [0, 65536, NaN, 1.5]) assert.throws(() => parse('example.com', fallback));
});


function replaceGlobal(t, name, value) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  t.after(() => descriptor ? Object.defineProperty(globalThis, name, descriptor) : delete globalThis[name]);
}

test('continuous shortcuts preselect only Ping or Tcping without displaying a completed round', async t => {
  const { default: Public } = await loadPublic(t);
  replaceGlobal(t, 'navigator', { language: 'zh-CN' });
  replaceGlobal(t, 'matchMedia', () => ({ matches: false }));
  replaceGlobal(t, 'localStorage', { getItem: () => null });
  replaceGlobal(t, 'location', { pathname: '/ping/', search: '?mode=continuous' });
  for (const [pathname, search, mode] of [
    ['/ping/', '?mode=continuous', 'continuous'], ['/tcping_ipv6/', '?mode=continuous', 'continuous'],
    ['/ping/', '', 'single'], ['/http/', '?mode=continuous', 'single'], ['/dns/', '?mode=continuous', 'single']
  ]) {
    Object.assign(location, { pathname, search });
    const html = renderToStaticMarkup(createElement(Public));
    assert.match(html, new RegExp(`data-results-mode="${mode}"`));
    assert.doesNotMatch(html, /0\/10|0 \/ 10|完成.*0.*轮/);
  }
});

test('owner configured banner slots preserve original rows, slot identities, and link behavior', async t => {
  const { BannerAds } = await loadPublic(t);
  const ads = Array.from({ length: 6 }, (_, i) => ({ enabled: true, title: `Station ad ${i + 1}`, image: '', url: i ? '' : 'https://example.com/ad' }));
  const render = (items, placement = 'bottom') => renderToStaticMarkup(createElement(BannerAds, { ads: items, placement, t: () => '广告' }));
  const html = render(ads);
  assert.deepEqual([...html.matchAll(/tool-ad-grid-row columns-(\d)/g)].map(match => +match[1]), [2, 3, 1]);
  assert.deepEqual([...html.matchAll(/data-ad-slot="([^"]+)"/g)].map(match => match[1]), ['bottom-1','bottom-2','bottom-3','bottom-4','bottom-5','bottom-6']);
  assert.equal((html.match(/href=/g) || []).length, 1);
  assert.equal((html.match(/aria-disabled="true"/g) || []).length, 5);
  assert.match(html, /rel="sponsored noopener noreferrer"/);
  const sparse = render(ads.map((ad, index) => ({ ...ad, enabled: [1, 4].includes(index) })), 'top');
  assert.deepEqual([...sparse.matchAll(/data-ad-slot="([^"]+)"/g)].map(match => match[1]), ['top-2','top-5']);
  assert.equal(render(ads.map(ad => ({ ...ad, enabled: false }))), '');
  assert.match(render(ads.slice(0, 2), 'header'), /top-ads top-ads-2/);
});

async function loadScreenshot(t) {
  await mkdir(resolve('.tmp'), { recursive: true });
  const directory = await mkdtemp(resolve('.tmp/public-parity-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const compiled = await build({
    entryPoints: ['src/screenshot.ts'], bundle: true, platform: 'node', format: 'esm', write: false,
    plugins: [{ name: 'screenshot-canvas', setup(builder) {
      builder.onResolve({ filter: /^html2canvas$/ }, () => ({ path: 'canvas', namespace: 'screenshot-canvas' }));
      builder.onLoad({ filter: /.*/, namespace: 'screenshot-canvas' }, () => ({ contents: 'export default async function render(element, options) { return globalThis.__kyScreenshotHarness.render(element, options); }', loader: 'js' }));
    } }]
  });
  const file = resolve(directory, 'screenshot.mjs');
  await writeFile(file, compiled.outputFiles[0].contents);
  return (await import(pathToFileURL(file).href)).screenshot;
}

test('screenshot copies a PNG and masks only requested values in the cloned document', async t => {
  const screenshot = await loadScreenshot(t);
  const targets = [{ tagName: 'INPUT', dataset: { screenshotMask: 'target' }, value: 'private.example' }, { tagName: 'SPAN', dataset: { screenshotMask: 'location' }, textContent: '上海' }];
  const wrapper = { scrollWidth: 1200, style: {} }, column = { style: {} };
  const clone = { querySelectorAll: selector => selector === '[data-screenshot-mask]' ? targets : [wrapper], querySelector: () => column };
  const blob = new Blob(['png'], { type: 'image/png' });
  let copied, downloads = 0;
  replaceGlobal(t, '__kyScreenshotHarness', { render: (_element, options) => { options.onclone(clone); assert.equal(options.width, 1232); return { toBlob: callback => callback(blob) }; } });
  replaceGlobal(t, 'devicePixelRatio', 1);
  replaceGlobal(t, 'ClipboardItem', class { constructor(items) { this.items = items; } });
  replaceGlobal(t, 'navigator', { clipboard: { write: async items => { copied = items; } } });
  replaceGlobal(t, 'document', { createElement: () => ({ click: () => downloads++ }) });
  const element = { scrollWidth: 1000, clientWidth: 1000, querySelectorAll: () => [wrapper] };
  assert.equal(await screenshot(element, true, false, 'copy'), 'copied');
  assert.equal(copied[0].items['image/png'], blob);
  assert.equal(downloads, 0);
  assert.equal(targets[0].value, '••••••');
  assert.equal(targets[1].textContent, '上海');
  assert.equal(wrapper.style.width, '1200px');
  assert.equal(column.style.width, '1232px');
});

test('screenshot clipboard failure falls back to one download with a visible outcome', async t => {
  const screenshot = await loadScreenshot(t);
  const blob = new Blob(['png'], { type: 'image/png' });
  const link = { click: () => downloads++ };
  let downloads = 0, revoked = 0;
  replaceGlobal(t, '__kyScreenshotHarness', { render: () => ({ toBlob: callback => callback(blob) }) });
  replaceGlobal(t, 'devicePixelRatio', 1);
  replaceGlobal(t, 'ClipboardItem', class { constructor(items) { this.items = items; } });
  replaceGlobal(t, 'navigator', { clipboard: { write: async () => { throw new Error('denied'); } } });
  replaceGlobal(t, 'document', { createElement: () => link });
  replaceGlobal(t, 'setTimeout', callback => { callback(); return 0; });
  t.mock.method(URL, 'createObjectURL', value => { assert.equal(value, blob); return 'blob:test'; });
  t.mock.method(URL, 'revokeObjectURL', value => { assert.equal(value, 'blob:test'); revoked++; });
  const element = { scrollWidth: 1000, clientWidth: 1000, querySelectorAll: () => [] };
  assert.equal(await screenshot(element, false, false, 'copy'), 'copy-fallback');
  assert.equal(downloads, 1);
  assert.equal(revoked, 1);
  assert.match(link.download, /^dnspup-\d+\.png$/);
  assert.equal(link.href, 'blob:test');
});

test('mobile ad placements retain original position classes and sparse second-column identity', async t => {
  const { MobileAds } = await loadPublic(t);
  const ads = [1, 2].map(index => ({ enabled: true, title: `Mobile ad ${index}`, image: '', url: index === 2 ? 'https://example.com' : '' }));
  for (const [placement, className, expectedCount] of [['header', 'mobile-header-ad', 1], ['menu', 'mobile-menu-ad', 2], ['tool-summary', 'mobile-tool-summary-ads', 2], ['tool-result', 'mobile-tool-result-ads', 2]]) {
    const html = renderToStaticMarkup(createElement(MobileAds, { ads, placement, t: () => '广告' }));
    assert.match(html, new RegExp(`data-mobile-ad-placement="${placement}"`));
    assert.match(html, new RegExp(className));
    assert.equal((html.match(/data-ad-column=/g) || []).length, expectedCount);
  }
  const secondOnly = renderToStaticMarkup(createElement(MobileAds, { ads: [{ ...ads[0], enabled: false }, ads[1]], placement: 'menu', t: () => '广告' }));
  assert.match(secondOnly, /data-ad-column="2"/);
  assert.doesNotMatch(secondOnly, /data-ad-column="1"/);
  assert.equal(renderToStaticMarkup(createElement(MobileAds, { ads: ads.map(ad => ({ ...ad, enabled: false })), placement: 'tool-summary', t: () => '广告' })), '');
});

test('content and mobile result ads prefer configured arrays including explicit all-disabled arrays, with legacy fallback only when absent', async t => {
  const { Advertising } = await loadPublic(t);
  let mobile = false;
  replaceGlobal(t, 'matchMedia', () => ({ matches: mobile }));
  const legacy = { enabled: true, title: 'Legacy station ad', image: '', url: '' };
  const current = [1, 2].map(index => ({ ...legacy, title: `Configured station ad ${index}` }));
  const render = (configured, home = false) => renderToStaticMarkup(createElement(Advertising, { site: { ads: { desktop: legacy, mobile: legacy }, links: [], contentAds: configured, mobileResultAds: configured }, t: () => '广告', home }));
  for (mobile of [false, true]) {
    for (const absent of [undefined, []]) {
      const html = render(absent);
      assert.match(html, /Legacy station ad/);
      assert.doesNotMatch(html, /Configured station ad/);
    }
    const configured = render(current);
    assert.doesNotMatch(configured, /Legacy station ad/);
    assert.match(configured, /Configured station ad 1/);
    assert.match(configured, /Configured station ad 2/);
    assert.match(configured, mobile ? /mobile-tool-result-ads/ : /tool-content-ad-grid/);
    assert.equal(render(current.map(ad => ({ ...ad, enabled: false }))), '');
    const home = render(current, true);
    assert.match(home, /Legacy station ad/);
    assert.doesNotMatch(home, /Configured station ad/);
  }
});
