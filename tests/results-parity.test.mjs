import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

test('six-tool result layouts preserve original columns and real missing values', async t => {
  await mkdir(resolve('.tmp'), { recursive: true });
  const directory = await mkdtemp(resolve('.tmp/results-parity-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const compiled = await build({ entryPoints: ['src/Results.tsx'], bundle: true, packages: 'external', platform: 'node', format: 'esm', write: false, plugins: [{ name: 'map-outside-table-test', setup(builder) { builder.onLoad({ filter: /[/\\]ChinaProbeMap\.tsx$/ }, () => ({ contents: 'export default function ChinaProbeMap({ option }) { globalThis.__resultsMapOption = option; return null; }', loader: 'js' })); } }] });
  t.after(() => { delete globalThis.__resultsMapOption; });
  const file = resolve(directory, 'Results.mjs');
  await writeFile(file, compiled.outputFiles[0].contents);
  const { default: Results } = await import(pathToFileURL(file).href);
  const props = { busy: false, elapsed: 0, t: key => key, logo: '/logo.png', onTool: () => {}, expected: 1, nodes: [] };
  const row = { node_id: 'test-node', nodeId: 'test-node', region: '广东', location: '广东广州', isp: '电信', ip: '203.0.113.1', status: 'ok', avg_latency: 24, min_latency: 20, max_latency: 30 };
  const render = (tool, values, extra = {}) => renderToStaticMarkup(createElement(Results, { ...props, tool, result: { requestId: 'fixture-request', type: tool, target: 'example.com', status: 'completed', ...values }, ...extra }));
  const headers = html => [...html.matchAll(/<th(?:\s[^>]*)?>(.*?)<\/th>/gs)].map(match => match[1].replace(/<[^>]*>/g, ''));

  const single = render('ping', { results: [row] });
  assert.match(single, /single-probe-results-table/);
  assert.deepEqual(headers(single).slice(-4), ['检测点', '响应IP', 'IP位置', '响应时间']);
  const continuous = render('tcping', { results: [{ ...row, cumulative: true, sent_count: 3, received_count: 2, samples: [24, null, 30] }] });
  assert.deepEqual(headers(continuous).slice(-10), ['检测点', '响应IP:端口', 'IP位置', '丢包', '发包', '最新', '最快', '最慢', '平均', '网络质量']);
  assert.match(continuous, /data-latency="timeout" data-sample-index="1"/);
  assert.match(continuous, /第 2 次 · 超时/);
  const laterSamples = render('ping', { results: [{ ...row, cumulative: true, sent_count: 80, samples: [24, null, 30] }] });
  assert.match(laterSamples, /第 78 次 · 24ms/);
  const waiting = render('ping', { results: [] }, { probeMode: 'continuous', busy: true });
  assert.match(waiting, /continuous-probe-results-table/);

  const http = render('http', { results: [{ ...row, http_status: 200, head: 'HTTP/2 200\ncontent-type: text/plain', total_time: 350 }] });
  assert.deepEqual(headers(http).slice(-11), ['检测点', '响应IP', 'IP位置', '状态', '协议', '总耗时', '解析', '连接', '下载', '重定向', 'Head']);
  assert.match(http, /HTTP\/2<\/td>/);
  assert.match(http, /0\.350s/);
  assert.match(http, /class="http-head-toggle"[^>]*aria-expanded="false"[^>]*aria-controls="http-head-test-node"/);
  assert.doesNotMatch(http, /content-type: text\/plain/);

  const dns = render('dns', { rows: [{ ...row, target: 'example.com', record: 'TXT', results: ['one', 'two', 'three', 'four', 'five', 'six'], elapsedMs: 0, dns: '192.0.2.53' }] });
  assert.match(dns, /dns-region-summary/);
  assert.deepEqual(headers(dns).slice(-8), ['检测点', '目标', '类型', '解析结果 [ 默认显示5条 ]', '记录数', '详情', '耗时', 'DNS']);
  assert.match(dns, /class="dns-detail-button"[^>]*aria-expanded="false"[^>]*aria-controls="dns-detail-test-node"/);
  assert.match(dns, /0ms/);
  assert.doesNotMatch(dns, />six</);

  const trace = render('mtr', { traces: [{ ...row, available: true, trace: { status: 'partial', complete: false, targetIp: '203.0.113.9', hops: [{ hop: 1, ip: '192.0.2.1', loss: '0%', sent: 5, latestMs: 2, fastestMs: 1, slowestMs: 3, averageMs: 2 }, { hop: 2, ip: '*', status: 'timeout', loss: '100%', sent: 5, latestMs: 0, fastestMs: 0, slowestMs: 0, averageMs: 0 }] } }] });
  assert.deepEqual(headers(trace), ['跳数', 'IP', 'PTR', '地理位置 / 仅供参考', '注册地', 'Origin ASN', '丢包率', '发包', '最新(ms)', '最快(ms)', '最慢(ms)', '平均(ms)']);
  assert.match(trace, /partial/);
  assert.match(trace, /trace-partial-notice/);
  assert.doesNotMatch(trace, /href="\/bgp-asn/);
  assert.doesNotMatch(trace, /<1/);
  assert.match(single, /aria-expanded="true" aria-controls="ping-resolve-panel"/);
  for (const carrier of ['telecom', 'unicom', 'chinaMobile', 'multiline', 'overseasLines']) assert.match(single, new RegExp(`>${carrier}<`));
  const summaryAd = createElement('aside', { 'data-summary-ad': true }, 'configured summary banner');
  for (const tool of ['ping', 'tcping', 'http', 'dns']) {
    const advertised = render(tool, {}, { summaryAd });
    assert.ok(advertised.indexOf('map-summary-grid') < advertised.indexOf('data-summary-ad'));
    assert.ok(advertised.indexOf('data-summary-ad') < advertised.indexOf('resolve-stats-title'), `${tool} places the configured banner after the summary and before resolution statistics`);
    assert.doesNotMatch(render(tool, {}), /data-summary-ad/);
  }
  for (const tool of ['traceroute', 'mtr']) {
    const advertised = render(tool, {}, { summaryAd });
    assert.ok(advertised.indexOf('</table>') < advertised.indexOf('data-summary-ad'), `${tool} places the summary banner after the hop table`);
    assert.equal([...advertised.matchAll(/data-summary-ad/g)].length, 1);
  }

  const many = render('ping', { results: Array.from({ length: 12 }, (_, index) => ({ ...row, node_id: `preview-${index}`, nodeId: `preview-${index}`, isp: index === 11 ? '移动' : '电信' })) }, { t: key => ({ telecom: '中国电信', region: '区域/运营商', allNodes: '全部节点' }[key] || key) });
  const previewRows = [...many.matchAll(/<tr id="result-preview-(\d+)"([^>]*)>/g)];
  assert.equal(previewRows.length, 12, 'desktop retains every real result row');
  assert.equal(previewRows.filter(match => !match[2].includes('data-mobile-overflow')).length, 10);
  assert.ok(!previewRows.find(match => match[1] === '11')[2].includes('data-mobile-overflow'), 'mobile preview retains a representative carrier row');
  assert.match(many, /class="mobile-more-toggle" data-mobile-fold="ping-results" aria-expanded="false"/);
  assert.match(many, /class="mobile-more-toggle" data-mobile-fold="region-summary" aria-expanded="false"/);
  assert.match(many, /class="desktop-public-label">中国电信<\/span><span class="mobile-public-label">电信<\/span>/);
  assert.match(many, /class="desktop-public-label">区域\/运营商<\/span><span class="mobile-public-label">运营商<\/span>/);
  const summary = many.match(/<table data-mobile-expanded="false">([\s\S]*?)<\/table>/)?.[1];
  assert.equal([...summary.matchAll(/data-mobile-overflow=""/g)].length, 8, 'only the first five of thirteen summary rows are visible on mobile');

  const ordered = render('ping', { results: ['移动', '联通', '电信'].map((isp, index) => ({ ...row, isp, node_id: `ordered-${index}` })) });
  assert.deepEqual([...ordered.matchAll(/id="result-ordered-(\d+)"/g)].map(match => match[1]), ['2', '1', '0'], 'results keep the source carrier order regardless of response arrival');
  const dnsAddresses = render('dns', { rows: [
    { ...row, record: 'TXT', results: ['203.0.113.88'] },
    { ...row, node_id: 'a', record: 'A', results: ['203.0.113.2', '203.0.113.1', '999.0.0.1'] },
    { ...row, node_id: 'b', record: 'A', results: ['203.0.113.2'] },
    { ...row, node_id: 'aaaa', record: 'AAAA', results: ['2001:db8::1'] },
    { ...row, node_id: 'failed', status: 'bad', record: 'A', results: ['203.0.113.99'] }
  ] });
  const dnsStats = dnsAddresses.match(/id="dns-resolve-panel"[\s\S]*?<\/section>/)[0];
  assert.deepEqual([...dnsStats.matchAll(/class="ip-stat-address"[^>]*>([^<]+)</g)].map(match => match[1]), ['203.0.113.2', '2001:db8::1', '203.0.113.1']);
  assert.match(dnsStats, /50\.00%/);
  assert.doesNotMatch(dnsStats, /203\.0\.113\.(88|99)|999\.0\.0\.1/);
  const manyIPs = render('ping', { results: Array.from({ length: 11 }, (_, index) => ({ ...row, node_id: `ip-${index}`, ip: `203.0.113.${index + 1}` })) });
  const ipStats = manyIPs.match(/id="ping-resolve-panel"[\s\S]*?<\/section>/)[0];
  assert.equal([...ipStats.matchAll(/class="ip-stat-address"/g)].length, 11, 'desktop retains every unique address');
  assert.equal([...ipStats.matchAll(/data-mobile-overflow=""/g)].length, 3, 'mobile initially shows eight Ping address groups');
  assert.match(ipStats, /data-mobile-fold="ping-ips" aria-expanded="false"/);

  // Resolve the lazy map once; capture its real option to check displayed data and responsive settings.
  await new Promise(resolve => setImmediate(resolve));
  await t.test('map uses fastest measured regional response while retaining timeout markers and unavailable regions', () => {
    for (const tool of ['ping', 'tcping', 'http', 'dns']) {
      const values = [0, 24, 300].map(value => ({ ...row, avg_latency: value, total_time: value, elapsedMs: value, http_status: 200 }));
      const rows = [...values, { ...row, status: 'timeout' }, { ...row, status: 'unavailable' }, { ...row, region: '北京', status: 'timeout' }, { ...row, region: '上海', status: 'unavailable' }];
      render(tool, { [tool === 'dns' ? 'rows' : 'results']: rows });
      const map = globalThis.__resultsMapOption.series[0];
      assert.equal(map.data.find(r => r.name === '广东省').value, 0, tool);
      assert.equal(map.data.find(r => r.name === '广东省').partialTimeout, true);
      assert.equal(map.markPoint.data.length, 1);
      assert.equal(map.data.find(r => r.name === '北京市').value, tool === 'http' ? 100000 : 3001);
      assert.equal(map.data.find(r => r.name === '上海市').value, tool === 'http' ? 100001 : 4001);
      render(tool, { [tool === 'dns' ? 'rows' : 'results']: values.slice(1) });
      assert.equal(globalThis.__resultsMapOption.series[0].data[0].value, 24, tool);
    }
  });
  render('ping', { results: [{ ...row, location: '<script>unsafe</script>' }] });
  const tooltip = globalThis.__resultsMapOption.tooltip.formatter({ name: '广东省', data: { rows: [{ ...row, location: '<script>unsafe</script>' }] } });
  assert.match(tooltip, /map-result-tooltip-title">广东</);
  assert.match(tooltip, /map-result-tooltip-isp" style="color:#a3e635">\[电信\]/);
  assert.match(tooltip, /点击地图可筛选该地区结果/);
  assert.match(tooltip, /&lt;script&gt;unsafe&lt;\/script&gt;/);
  assert.doesNotMatch(tooltip, /<script>/);
  const previousDocument = globalThis.document;
  try {
    globalThis.document = { documentElement: { classList: { contains: value => value === 'mobile-responsive-layout' } } };
    render('ping', { results: [row] });
    assert.equal(globalThis.__resultsMapOption.tooltip.triggerOn, 'mousemove');
    assert.equal(globalThis.__resultsMapOption.media[0].query.maxWidth, 330);
    assert.equal(globalThis.__resultsMapOption.media[0].option.geo.layoutSize, '98%');
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});
