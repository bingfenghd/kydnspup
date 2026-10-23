// Layout and table classes follow itdog/src/main.tsx ResultSummary and ResultGrid.
import { Fragment, lazy, Suspense, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Activity, Copy, Download, Globe2, Layers3, LoaderCircle, Network, Radio, RotateCw, Wrench, X, Zap } from 'lucide-react';
import { downloadJSON } from './api';
import { probeNodeStatus } from './probe-results';
import { summarizeProbe, traceDestination } from '../shared/probe-diagnostics.ts';
import type { ProbeResponse, ProbeProgress, Tool, Node } from './types';
import type { useLanguage, TextKey } from './i18n';
const ChinaProbeMap = lazy(() => import('./legacy/ChinaProbeMap'));
type T = ReturnType<typeof useLanguage>['t'];
type Row = Record<string, any>;
const ok = (r: Row, tool: Tool) => probeNodeStatus(r, tool) === 'ok';
const measured = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;
const ms = (n: unknown) => measured(n) ? `${Math.round(n * 100) / 100}ms` : '--';
const seconds = (n: unknown) => measured(n) ? `${(n / 1000).toFixed(3)}s` : '--';
const latency = (r: Row, tool: Tool) => (r.cumulative ? r.received_count > 0 : ok(r, tool)) ? tool === 'http' ? r.total_time : tool === 'dns' ? r.elapsedMs : r.avg_latency ?? r.latency_ms : undefined;
const locationName = (r: Row) => r.location || r.node || r.nodeId || '--';
const ispClass = (isp: string) => /电信|telecom/i.test(isp) ? 'telecom' : /联通|unicom/i.test(isp) ? 'unicom' : /移动|mobile/i.test(isp) ? 'mobile' : /多线|BGP/i.test(isp) ? 'multiline' : 'overseas';
const provinceMap: Record<string, string> = {
  北京: "北京市",
  上海: "上海市",
  天津: "天津市",
  重庆: "重庆市",
  广东: "广东省",
  广西: "广西壮族自治区",
  海南: "海南省",
  四川: "四川省",
  云南: "云南省",
  西藏: "西藏自治区",
  湖北: "湖北省",
  陕西: "陕西省",
  甘肃: "甘肃省",
  宁夏: "宁夏回族自治区",
  香港: "香港特别行政区",
  澳门: "澳门特别行政区",
  台湾: "台湾省",
  新疆: "新疆维吾尔自治区",
  黑龙江: "黑龙江省",
  吉林: "吉林省",
  福建: "福建省",
  浙江: "浙江省",
  安徽: "安徽省",
  江西: "江西省",
  山东: "山东省",
  河南: "河南省",
  湖南: "湖南省",
  江苏: "江苏省",
  河北: "河北省",
  山西: "山西省",
  贵州: "贵州省",
  青海: "青海省",
  辽宁: "辽宁省",
  内蒙古: "内蒙古自治区"
};
const provinceMapCenters: Record<string, [number, number]> = {
  北京市: [116.41995, 40.18994],
  天津市: [117.347043, 39.288036],
  河北省: [114.502461, 38.045474],
  山西省: [112.304436, 37.618179],
  内蒙古自治区: [114.077429, 44.331087],
  辽宁省: [122.604994, 41.299712],
  吉林省: [126.171208, 43.703954],
  黑龙江省: [127.693027, 48.040465],
  上海市: [121.438737, 31.072559],
  江苏省: [119.486506, 32.983991],
  浙江省: [120.109913, 29.181466],
  安徽省: [117.226884, 31.849254],
  福建省: [118.006468, 26.069925],
  江西省: [115.732975, 27.636112],
  山东省: [118.187759, 36.376092],
  河南省: [113.619717, 33.902648],
  湖北省: [112.271301, 30.987527],
  湖南省: [111.711649, 27.629216],
  广东省: [113.429919, 23.334643],
  广西壮族自治区: [108.7944, 23.833381],
  海南省: [109.754859, 19.189767],
  重庆市: [107.8839, 30.067297],
  四川省: [102.693453, 30.674545],
  贵州省: [106.880455, 26.826368],
  云南省: [101.485106, 25.008643],
  西藏自治区: [88.388277, 31.56375],
  陕西省: [108.887114, 35.263661],
  甘肃省: [103.823557, 36.058039],
  青海省: [96.043533, 35.726403],
  宁夏回族自治区: [106.169866, 37.291332],
  新疆维吾尔自治区: [85.294711, 41.371801],
  台湾省: [120.971485, 23.749452],
  香港特别行政区: [114.134357, 22.377366],
  澳门特别行政区: [113.566988, 22.159307]
};
const province = (region: string) => provinceMap[region] || Object.values(provinceMap).find(name => name === region) || '';
const provinceShortName = (name: string) => Object.entries(provinceMap).find(([, fullName]) => name === fullName)?.[0] || name;

const rowID = (r: Row) => String(r.node_id || r.nodeId || r.node || '');
const rowLocation = (r: Row) => [r.region, r.city, r.location, r.node].filter(Boolean).join(' ');
const nodeLocation = (node: Node) => node.city && !node.region?.includes(node.city) ? `${node.region || ''}${node.city}` : node.region || node.city || node.name;
const rowProvince = (r: Row) => province(r.region) || Object.entries(provinceMap).find(([name]) => rowLocation(r).includes(name))?.[1] || '';
const overseas = (r: Row) => !rowProvince(r) || /香港|澳门|台湾/.test(rowLocation(r));
const lineLabel = (r: Row) => overseas(r) ? '海外' : ({ telecom: '电信', unicom: '联通', mobile: '移动', multiline: '多线', overseas: '' }[ispClass(`${r.isp || ''} ${r.line || ''}`)] || r.isp || r.line || '国内');
const carrierRank = (r: Row) => { const rank = ['电信', '联通', '移动', '多线', '海外'].indexOf(lineLabel(r)); return rank < 0 ? 5 : rank; };
function isAddress(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(value)) return value.split('.').every(part => Number(part) <= 255);
  if (!/^[\da-f:.]+$/i.test(value) || !value.includes(':')) return false;
  try { return new URL(`http://[${value}]`).hostname.startsWith('['); } catch { return false; }
}
const timedOut = (r: Row) => r.status === 'timeout';
const timingClass = (value: unknown, http = false, status = 'ok') => {
  if (status === 'timeout' || status === 'bad') return 'probe-time-timeout';
  if (!measured(value) || ['failed', 'unavailable'].includes(status)) return '';
  const thresholds = http ? [500, 1000, 3000, 10000] : [50, 100, 200, 250];
  return `probe-time-${value <= thresholds[0] ? 'fast' : value <= thresholds[1] ? 'good' : value <= thresholds[2] ? 'fair' : value <= thresholds[3] ? 'slow' : 'critical'}`;
};
const traceTime = (hop: Row, key: string) => {
  const value = hop[key];
  const timeout = !hop.ip || ['*', '--'].includes(hop.ip) || ['bad', 'timeout'].includes(hop.status) || String(hop.loss || '').startsWith('100');
  return timeout || !measured(value) ? key === 'latestMs' ? '*' : '--' : value === 0 ? '<1' : String(value);
};
const traceASN = (hop: Row) => { const asn = String(hop.originAsn || hop.as || '').trim(); return !asn || asn === '--' ? '--' : asn.replace(/^(?:AS)?/i, 'AS'); };
const escapeHTML = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));
function placeToolsMenu(element: HTMLElement) {
  const bounds = element.getBoundingClientRect();
  element.style.setProperty('--probe-menu-left', `${Math.max(8, Math.min(bounds.left, document.documentElement.clientWidth - 128))}px`);
  element.style.setProperty('--probe-menu-top', `${bounds.bottom + 240 <= document.documentElement.clientHeight - 8 ? bounds.bottom - 1 : Math.max(8, bounds.top - 239)}px`);
}
function screenLabel(value: string) {
  const short = value.replace(/^中国/, '').replace(/地区$/, '').replace(/^全部节点$/, '全部').replace(/^全部海外$|^港澳台、海外$/, '海外').replace(/^区域\/运营商$/, '运营商');
  return short === value ? value : <><span className="desktop-public-label">{value}</span><span className="mobile-public-label">{short}</span></>;
}

export default function Results({ result, progress, tool, busy, elapsed, t, logo, onTool, expected, nodes, probeMode, summaryAd }: { result?: ProbeResponse; progress?: ProbeProgress; tool: Tool; busy: boolean; elapsed: number; t: T; logo: string; onTool: (tool: Tool, address: string, options?: { continuous?: boolean; nodeId?: string }) => void; expected: number; nodes: Node[]; probeMode?: 'single' | 'continuous'; summaryAd?: ReactNode }) {
  const [filter, setFilter] = useState(''), [sort, setSort] = useState(false), [copied, setCopied] = useState('');
  const [ipFilter, setIPFilter] = useState(''), [regionFilter, setRegionFilter] = useState(''), [failedOnly, setFailedOnly] = useState(false);
  const [collapsed, setCollapsed] = useState(false), [detailID, setDetailID] = useState(''), [toolsID, setToolsID] = useState('');
  const [resultsExpanded, setResultsExpanded] = useState(false);
  const [timeoutOnly, setTimeoutOnly] = useState(false), [ipsExpanded, setIPsExpanded] = useState(false);
  useEffect(() => { if (!result) { setFilter(''); setIPFilter(''); setRegionFilter(''); setFailedOnly(false); setTimeoutOnly(false); setDetailID(''); } setCopied(''); }, [result]);
  useEffect(() => { setCollapsed(false); setDetailID(''); setToolsID(''); setResultsExpanded(false); setIPsExpanded(false); }, [tool]);
  useEffect(() => { if (!copied) return; const timer = setTimeout(() => setCopied(''), 1800); return () => clearTimeout(timer); }, [copied]);
  const rows = result?.results || result?.rows || result?.traces || [];
  const isTrace = tool === 'traceroute' || tool === 'mtr';
  const diagnostic = result ? result.diagnostics || summarizeProbe(result, expected) : undefined;
  const continuous = probeMode === 'continuous' || rows.some(r => r.cumulative);
  const ipGroups = new Map<string, number>();
  for (const row of rows) {
    if (row.exclude_from_resolution_stats) continue;
    if (tool === 'dns' && (!['A', 'AAAA'].includes(String(row.record || '').toUpperCase()) || !ok(row, tool))) continue;
    const addresses = tool === 'dns' ? row.results || [] : [row.ip];
    for (const ip of new Set<string>(addresses)) if (isAddress(ip)) ipGroups.set(ip, (ipGroups.get(ip) || 0) + 1);
  }
  const ipStats = [...ipGroups].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const ipPreviewLimit = ['ping', 'tcping'].includes(tool) ? 8 : 10;
  const observations = [...ipGroups.values()].reduce((a, b) => a + b, 0);
  const matchesCarrier = (r: Row) => !filter || (filter === 'overseas' ? overseas(r) : !overseas(r) && ispClass(`${r.isp || ''} ${r.line || ''}`) === filter);
  let visible = rows.filter(r => matchesCarrier(r) && (!ipFilter || r.ip === ipFilter || r.results?.includes(ipFilter)) && (!regionFilter || rowProvince(r) === regionFilter) && (!failedOnly || !ok(r, tool)) && (!timeoutOnly || timedOut(r)));
  if (!isTrace) visible.sort((a, b) => carrierRank(a) - carrierRank(b));
  if (sort) visible = [...visible].sort((a, b) => (latency(a, tool) ?? Infinity) - (latency(b, tool) ?? Infinity));
  const previewRows = new Set<Row>();
  for (const carrier of ['电信', '联通', '移动', '多线', '海外']) { const row = visible.find(r => lineLabel(r) === carrier); if (row) previewRows.add(row); }
  for (const row of visible) if (previewRows.size < 10) previewRows.add(row);
  const resultFold = visible.length > 10 && <button type="button" className="mobile-more-toggle" data-mobile-fold={`${tool}-results`} aria-expanded={resultsExpanded} onClick={() => setResultsExpanded(!resultsExpanded)}>{resultsExpanded ? '点击收起更多' : '点击查看更多'}<span className={`mobile-more-chevron ${resultsExpanded ? 'is-expanded' : ''}`} aria-hidden="true" /></button>;
  async function copy(text = JSON.stringify(result, null, 2)) { try { await navigator.clipboard.writeText(text); setCopied('copied'); } catch { setCopied('copyFailed'); } }
  const status = (r: Row) => t(probeNodeStatus(r, tool));
  function jump(row: Row) { setFilter(''); setIPFilter(''); setRegionFilter(''); setFailedOnly(false); setTimeoutOnly(false); setResultsExpanded(true); setTimeout(() => { const target = document.getElementById(`result-${rowID(row)}`); if (target) { target.scrollIntoView({ behavior: 'smooth', block: 'center' }); target.classList.add('result-row-flash'); setTimeout(() => target.classList.remove('result-row-flash'), 1800); } }, 0); }
  const labels = new Map(nodes.map(node => [node.id, nodeLocation(node)]));
  const node = (r: Row) => <><b className={`probe-isp-badge ${ispClass(lineLabel(r))}`}>{lineLabel(r)}</b><span data-screenshot-mask="location">{labels.get(rowID(r)) || locationName(r)}</span>{r.home && <span className="probe-home-badge">家宽</span>}</>;
  const responseIP = (r: Row) => tool === 'tcping' && r.ip && r.port ? `${r.ip.includes(':') ? `[${r.ip}]` : r.ip}:${r.port}` : r.ip || '--';
  const statsID = `${tool}-resolve-panel`;
  const statsKind = tool === 'dns' ? 'dns' : tool === 'http' ? 'http' : 'standard';
  const failureCount = rows.filter(r => !ok(r, tool)).length, timeoutCount = rows.filter(timedOut).length;
  const streamingStatus = busy && rows.length > 0 && <span className="probe-streaming-status receiving" role="status"><i aria-hidden="true" /><span>结果持续返回中，已收到 {rows.length} 个监测点</span></span>;
  const filterButtons = <div className="result-tabbar">
    {([['', 'all'], ['telecom', 'telecom'], ['unicom', 'unicom'], ['mobile', 'chinaMobile'], ['multiline', 'multiline'], ['overseas', 'overseasLines']] as [string, TextKey][]).map(([value, key]) => <button key={key} type="button" className={filter === value && !failedOnly && !timeoutOnly && !ipFilter ? 'active' : ''} aria-pressed={filter === value && !failedOnly && !timeoutOnly && !ipFilter} onClick={() => { setFilter(value); setIPFilter(''); setFailedOnly(false); setTimeoutOnly(false); }}>{screenLabel(t(key))}</button>)}
    {ipFilter && <button type="button" className="active" data-screenshot-mask="target" onClick={() => setIPFilter('')}>{ipFilter} ×</button>}
    {regionFilter && <button type="button" className="active map-region-filter-chip" title={`取消${provinceShortName(regionFilter)}地区筛选`} onClick={() => setRegionFilter('')}>{provinceShortName(regionFilter)} ×</button>}
    <button type="button" className={(tool === 'http' ? failedOnly : timeoutOnly) ? 'active' : ''} aria-pressed={tool === 'http' ? failedOnly : timeoutOnly} onClick={() => { setFilter(''); setIPFilter(''); setFailedOnly(tool === 'http' ? !failedOnly : false); setTimeoutOnly(tool === 'http' ? false : !timeoutOnly); }}>{tool === 'http' ? '访问失败' : '响应超时'}{(tool === 'http' ? failureCount : timeoutCount) > 0 && <b>{tool === 'http' ? failureCount : timeoutCount}</b>}</button>
    {tool !== 'http' && failureCount > timeoutCount && <button type="button" className={failedOnly ? 'active' : ''} aria-pressed={failedOnly} onClick={() => { setFilter(''); setIPFilter(''); setTimeoutOnly(false); setFailedOnly(!failedOnly); }}>{t('failedOnly')}<b>{failureCount}</b></button>}
    <span>当前显示 : {visible.length}/{rows.length}</span>
  </div>;
  const resultFooter = result && <>
    <div className="ky-result-actions"><span className={`ky-result-status ${result.status}`}>{t(result.status === 'unknown' ? 'taskUnknown' : result.status as TextKey)}</span><code data-screenshot-mask="target">{result.target}</code><div>{!isTrace && <button onClick={() => setSort(!sort)}>{t(sort ? 'original' : 'sort')}</button>}<button onClick={() => void copy()}><Copy size={14} />{t((copied || 'copy') as TextKey)}</button><button onClick={() => downloadJSON(`dnspup-${result.type}-${result.requestId}.json`, result)}><Download size={14} />{t('export')}</button></div></div>
    {diagnostic && <div className="ky-result-actions"><small>{t('diagnosticCounts', diagnostic)}{isTrace && <> · {t('destinationCounts', diagnostic)}</>}<br />{t(isTrace ? 'traceCompletionHint' : 'taskCompletionHint')}</small><button type="button" onClick={() => downloadJSON(`dnspup-diagnostic-${result.requestId}.json`, { format: 'kydnspup-probe-diagnostic-v1', requestId: result.requestId, tool, status: result.status, summary: diagnostic })}><Download size={14} />{t('diagnosticExport')}</button></div>}
    <small className="ky-request-id">ID · {result.requestId}</small>
  </>;
  return <>
    {!isTrace && <Summary rows={rows} progress={progress} tool={tool} busy={busy} t={t} logo={logo} selectedRegion={regionFilter} onRegion={value => setRegionFilter(value === regionFilter ? '' : value)} expected={diagnostic?.expected ?? expected} onJump={jump} nodes={nodes} />}
    {!isTrace && summaryAd}
    {busy && <div className="ky-notice" role="status"><LoaderCircle size={15} className="spin" />{t('waitingRun')} · {t('elapsed', { n: elapsed })}</div>}
    {!isTrace && !(continuous && ['ping', 'tcping'].includes(tool)) && <section className={`card results-panel unified-results ${tool === 'dns' ? 'dns' : 'standard'}-stats-panel ${tool === 'http' ? 'http-stats-panel' : ''}`}>
      <div className={`panel-head ${tool === 'dns' ? 'dns' : 'standard'}-stats-head`}><div className="resolve-stats-title"><h2>{tool === 'dns' ? 'DNS解析统计' : t('ipStats')} <b>{ipGroups.size}</b></h2><button type="button" className="resolve-copy-all" disabled={!ipGroups.size} onClick={() => void copy(ipStats.map(([ip]) => ip).join('\n'))}><Copy size={15} />{t('copyIPs')}</button></div><div className="table-actions"><button type="button" aria-expanded={!collapsed} aria-controls={statsID} onClick={() => setCollapsed(!collapsed)}>{collapsed ? '展开' : '收起'}</button></div></div>
      {!collapsed && <div id={statsID} className={`${statsKind}-ip-stats`} data-mobile-expanded={ipsExpanded || ipStats.length <= ipPreviewLimit}>{(ipGroups.size ? ipStats : [['--', 0] as [string, number]]).map(([ip, count], index) => <span className={`${statsKind}-ip-stat-row`} key={ip} data-mobile-overflow={index >= ipPreviewLimit ? '' : undefined}><button type="button" className={`${tool === 'dns' ? 'dns-ip-stat' : 'ip-stat-filter'} ${ipFilter === ip ? 'active' : ''}`} aria-pressed={ipFilter === ip} disabled={!count} onClick={() => { setIPFilter(ipFilter === ip ? '' : ip); setFilter(''); setTimeoutOnly(false); setFailedOnly(false); }}><span className="ip-stat-address" data-screenshot-mask="target">{ip}</span><em>{observations ? (count / observations * 100).toFixed(2) : '0.00'}%</em></button></span>)}</div>}
      {!collapsed && ipStats.length > ipPreviewLimit && <button type="button" className="mobile-more-toggle" data-mobile-fold={`${tool}-ips`} aria-expanded={ipsExpanded} onClick={() => setIPsExpanded(!ipsExpanded)}>{ipsExpanded ? '点击收起更多' : '点击查看更多'}<span className={`mobile-more-chevron ${ipsExpanded ? 'is-expanded' : ''}`} aria-hidden="true" /></button>}
      {copied && <div className="copy-toast copy-toast-inline" role="status">{t(copied as TextKey)}</div>}
    </section>}
    {isTrace ? <section className="card results-panel unified-results trace-table-panel" aria-live="polite">
      {(visible.length ? visible : [{}]).map((r, index) => <Fragment key={rowID(r) || index}>
        {!!rowID(r) && <div className="trace-result-meta"><span>监测点：<span className="trace-meta-value" data-screenshot-mask="location">{labels.get(rowID(r)) || locationName(r)}</span></span><span>目标IP：<span className="trace-meta-value" data-screenshot-mask="target">{r.trace?.targetIp || '--'}</span></span><span>地理位置：<span className="trace-meta-value" data-screenshot-mask="location">{r.trace?.targetGeo || '--'}</span></span><span>{status(r)} · {t(traceDestination(r, result?.target))}</span></div>}
        {probeNodeStatus(r, tool) === 'partial' && <div className="trace-partial-notice" role="status">{r.trace?.message || '当前节点返回了部分路由结果'}</div>}
        <div className="trace-table-wrap"><table><thead><tr><th>跳数</th><th>IP</th><th>PTR</th><th>地理位置 <span className="trace-location-reference">/ 仅供参考</span></th><th>注册地</th><th>Origin ASN</th><th>丢包率</th><th>发包</th><th>最新(ms)</th><th>最快(ms)</th><th>最慢(ms)</th><th>平均(ms)</th></tr></thead><tbody>
          {r.trace?.hops?.length ? r.trace.hops.map((h: Row, i: number) => <tr className="trace-hop-row" key={i}><td>{h.hop ?? i + 1}</td><td className="mono-cell" data-screenshot-mask="target">{h.ip || '--'}</td><td><span className="trace-ptr-value" data-screenshot-mask="target">{h.ptr || h.agentPtr || h.serverPtr || '--'}</span></td><td className="trace-location-cell" data-screenshot-mask="location">{h.facilityLocation || h.geo || '--'}</td><td data-screenshot-mask="location">{h.registeredCountry || '--'}</td><td className="trace-origin-cell"><span className="trace-origin-popover"><span className="trace-origin-value" tabIndex={traceASN(h) === '--' ? undefined : 0} aria-describedby={traceASN(h) === '--' ? undefined : `trace-asn-${index}-${i}`}>{traceASN(h)}</span>{traceASN(h) !== '--' && <span id={`trace-asn-${index}-${i}`} className="trace-origin-tooltip" role="tooltip">AS商：{h.asnOrganization || '暂无资料'}</span>}</span></td><td><span className="trace-loss-value">{h.loss ?? '--'}</span></td><td>{h.sent ?? '--'}</td>{['latestMs', 'fastestMs', 'slowestMs', 'averageMs'].map(key => <td key={key} className={`probe-time-value ${timingClass(h[key], false, h.status)}`}>{traceTime(h, key)}</td>)}</tr>) : <tr><td colSpan={12} className="empty-cell">{r.trace?.message || r.error || (busy ? t('waitingRun') : '请输入域名或 IP 后点击开始测试')}</td></tr>}
        </tbody></table></div>
        {r.trace?.raw && <details className="ky-raw"><summary>{t('raw')}</summary><pre data-screenshot-mask="target location">{r.trace.raw}</pre></details>}
      </Fragment>)}{resultFooter}
    </section> : tool === 'dns' ? <section className="card results-panel unified-results dns-results-panel" aria-live="polite">
      <div className="dns-result-head"><h2>DNS解析结果</h2>{streamingStatus}{filterButtons}</div>
      <table className="batch-result-table" data-mobile-expanded={resultsExpanded || visible.length <= 10}><thead><tr><th>检测点</th><th>目标</th><th>类型</th><th>解析结果 [ 默认显示5条 ]</th><th>记录数</th><th>详情</th><th>耗时</th><th>DNS</th></tr></thead><tbody>
        {!visible.length && <tr><td colSpan={8} className="empty-cell">{t(busy ? 'waitingRun' : rows.length ? 'noMatches' : 'waitingDesc')}</td></tr>}
        {visible.map((r, index) => { const id = rowID(r) || String(index), expanded = detailID === id, answers: string[] = r.results || [], unavailable = r.status === 'unavailable'; return <Fragment key={id}>
          <tr id={`result-${id}`} data-mobile-overflow={previewRows.has(r) ? undefined : ''} className={`dns-result-row ${unavailable ? 'node-unavailable-row' : ''}`}><td>{node(r)}{r.error && <small className="ky-row-error">{r.error}</small>}</td><td data-screenshot-mask="target">{r.target || result?.target || '--'}</td><td>{r.record || '--'}</td><td><span className="dns-result-values" data-screenshot-mask="target">{unavailable ? <span className="probe-node-unavailable">节点不可用</span> : answers.length ? answers.slice(0, 5).map((answer, i) => <span key={i} title={answer}>{answer}</span>) : <span>{ok(r, tool) ? '--' : status(r)}</span>}</span></td><td>{unavailable ? '--' : answers.length}</td><td>{unavailable ? '--' : <button type="button" className="dns-detail-button" aria-expanded={expanded} aria-controls={`dns-detail-${id}`} onClick={() => setDetailID(expanded ? '' : id)}>{expanded ? '收起' : '查看'}</button>}</td><td className={`probe-time-value ${timingClass(latency(r, tool), false, r.status)}`}>{ms(latency(r, tool))}</td><td>{unavailable ? '--' : r.dns || '--'}</td></tr>
          {expanded && !unavailable && <tr id={`dns-detail-${id}`} data-mobile-overflow={previewRows.has(r) ? undefined : ''} className="dns-detail-row"><td colSpan={8}><pre data-screenshot-mask="target">{`协议:${r.protocol || '--'}\n目标:${r.target || result?.target || '--'}\n类型:${r.record || '--'}\n耗时:${ms(latency(r, tool))}\n\n---------- 解析结果 ----------\n\n${answers.join('\n') || '--'}`}</pre></td></tr>}
        </Fragment>; })}
      </tbody></table>{resultFold}{resultFooter}
    </section> : tool === 'http' ? <section className="card results-panel unified-results standard-results-panel http-results http-results-tight" aria-live="polite">
      <div className="standard-result-head http-result-head"><h2>网站测速结果</h2>{streamingStatus}{filterButtons}</div>
      <div className="http-results-table-wrap"><table data-mobile-expanded={resultsExpanded || visible.length <= 10}><thead><tr><th>检测点</th><th>响应IP</th><th>IP位置</th><th>状态</th><th>协议</th><th>总耗时</th><th>解析</th><th>连接</th><th>下载</th><th>重定向</th><th>Head</th></tr></thead><tbody>
        {!visible.length && <tr><td colSpan={11} className="empty-cell">{t(busy ? 'waitingRun' : rows.length ? 'noMatches' : 'waitingDesc')}</td></tr>}
        {visible.map((r, index) => { const id = rowID(r) || String(index), expanded = detailID === id, protocol = r.head?.match(/^\s*(HTTP\/(?:1(?:\.[01])?|2(?:\.0)?|3(?:\.0)?))\b/i)?.[1].toUpperCase().replace(/\.0$/, ''); return <Fragment key={id}>
          <tr id={`result-${id}`} data-mobile-overflow={previewRows.has(r) ? undefined : ''} className={`result-row ${r.status === 'unavailable' ? 'node-unavailable-row' : ''}`}><td className="http-probe-node-cell"><span className="http-probe-node-line">{node(r)}</span>{r.error && <small className="ky-row-error">{r.error}</small>}</td><td className="probe-result-ip" data-screenshot-mask="target">{r.ip || '--'}</td><td data-screenshot-mask="location">{r.ip_geo || r.ipGeo || '--'}</td><td><span className={`http-status ${r.http_status === 200 ? 'plain' : r.http_status ? 'ok' : 'fail'}`}>{r.http_status || status(r)}</span></td><td className="http-protocol">{protocol || '--'}</td>{['total_time', 'dns_time', 'connect_time', 'download_time'].map(key => <td key={key} className={key === 'total_time' ? `http-total-time probe-time-value ${timingClass(r[key], true, r.status)}` : ''}>{seconds(ok(r, tool) ? r[key] : undefined)}</td>)}<td>{r.redirect_count > 0 ? `${r.redirect_count}次 (耗时: ${seconds(r.redirect_time)})` : '--'}</td><td>{r.head && r.status !== 'unavailable' ? <button type="button" className="http-head-toggle" aria-expanded={expanded} aria-controls={`http-head-${id}`} onClick={() => setDetailID(expanded ? '' : id)}>{expanded ? '收起' : '查看'}</button> : '--'}</td></tr>
          {expanded && r.head && <tr id={`http-head-${id}`} data-mobile-overflow={previewRows.has(r) ? undefined : ''} className="http-head-detail-row"><td colSpan={11}><pre data-screenshot-mask="target">{r.head}</pre></td></tr>}
        </Fragment>; })}
      </tbody></table>{resultFold}</div>{resultFooter}
    </section> : <section className="card results-panel unified-results standard-results-panel" aria-live="polite">
      <div className="standard-result-head"><h2>{tool === 'tcping' ? 'Tcping测试结果' : 'Ping测试结果'}</h2>{streamingStatus}{filterButtons}</div>
      <div className="standard-probe-results-table-wrap"><table className={`standard-probe-results-table ${continuous ? 'continuous' : 'single'}-probe-results-table`} data-mobile-expanded={resultsExpanded || visible.length <= 10}><thead><tr><th>检测点</th><th>{tool === 'tcping' ? '响应IP:端口' : '响应IP'}</th><th>IP位置</th>{continuous ? <><th>丢包</th><th>发包</th><th>最新</th><th>最快</th><th>最慢</th><th>平均</th><th>网络质量</th></> : <th>响应时间</th>}</tr></thead><tbody>
        {!visible.length && <tr><td colSpan={continuous ? 10 : 4} className="empty-cell">{t(busy ? 'waitingRun' : rows.length ? 'noMatches' : 'waitingDesc')}</td></tr>}
        {visible.map((r, index) => { const id = rowID(r) || String(index), valid = r.cumulative || ok(r, tool), current = latency(r, tool); return <tr id={`result-${id}`} data-mobile-overflow={previewRows.has(r) ? undefined : ''} className={`result-row ${r.status === 'unavailable' ? 'node-unavailable-row' : ''}`} key={id}>
          <td>{node(r)}</td><td className="probe-result-ip"><span className="ip-cell"><span className="real-ip" data-screenshot-mask="target">{responseIP(r)}</span>{isAddress(r.ip) && <span className={`probe-row-tools quick-menu-enabled ${toolsID === id ? 'is-open' : ''}`} onMouseEnter={event => { placeToolsMenu(event.currentTarget); setToolsID(id); }} onMouseLeave={() => setToolsID(current => current === id ? '' : current)} onFocusCapture={event => { placeToolsMenu(event.currentTarget); setToolsID(id); }} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as HTMLElement | null)) setToolsID(current => current === id ? '' : current); }} onKeyDown={event => { if (event.key === 'Escape') setToolsID(''); }}><button type="button" className="probe-row-tools-trigger" aria-label={`${t('quickTools')} ${locationName(r)}`} aria-expanded={toolsID === id} onClick={event => { placeToolsMenu(event.currentTarget.parentElement!); setToolsID(id); }}><Wrench size={13} /></button>{toolsID === id && <span className="probe-row-tools-menu ky-result-tool-menu" role="menu">{[
            { tool: 'ping', label: 'Ping', icon: Activity, continuous: false }, { tool: 'ping', label: '持续Ping', icon: RotateCw, continuous: true },
            { tool: 'tcping', label: 'Tcping', icon: Radio, continuous: false }, { tool: 'tcping', label: '持续Tcping', icon: RotateCw, continuous: true },
            { tool: 'traceroute', label: t('traceroute'), icon: Network }, { tool: 'mtr', label: t('mtr'), icon: Network },
            { tool: 'http', label: 'HTTP网站测速', icon: Globe2 }, { tool: 'dns', label: t('dns'), icon: Layers3 }
          ].map(entry => <button type="button" role="menuitem" key={entry.label} disabled={busy} onClick={() => { setToolsID(''); onTool(entry.tool as Tool, entry.tool === 'tcping' ? responseIP(r) : r.ip, { continuous: entry.continuous, nodeId: ['traceroute', 'mtr'].includes(entry.tool) ? rowID(r) : undefined }); }}><entry.icon size={12} aria-hidden="true" />{entry.label}</button>)}</span>}</span>}</span></td>
          <td data-screenshot-mask="location">{r.error ? <span className="http-status fail probe-result-location-error">{r.error}</span> : r.ip_geo || r.ipGeo || '--'}</td>
          {continuous ? <><td className="probe-metric-cell">{r.loss_rate == null || !valid ? '--' : `${r.loss_rate}%`}</td><td className="probe-metric-cell">{r.sent_count ?? '--'}</td>{[r.samples?.at(-1) ?? (ok(r, tool) ? r.latency_ms ?? r.avg_latency : undefined), valid ? r.min_latency : undefined, valid ? r.max_latency : undefined, current].map((value, i) => <td key={i} className={`probe-metric-cell probe-time-value ${timingClass(value)}`}>{i === 0 && r.samples?.at(-1) === null ? '超时' : ms(value)}</td>)}<td>{r.samples?.length ? <QualityChart samples={r.samples} sent={r.sent_count} label={t('quality')} /> : '--'}</td></> : <td className={`probe-time-value ${timingClass(current, false, r.status)}`}>{ok(r, tool) ? ms(r.latency_ms ?? current) : <span className={r.status === 'unavailable' ? 'probe-node-unavailable' : ''}>{status(r)}</span>}</td>}
        </tr>; })}
      </tbody></table>{resultFold}</div>{resultFooter}
    </section>}
    {isTrace && summaryAd}
  </>;
}

function QualityChart({ samples, sent, label }: { samples: (number | null)[]; sent?: number; label: string }) {
  const [tooltip, setTooltip] = useState<{ text: string; x: number; y: number } | null>(null);
  const height = 28, width = 180, step = samples.length > 60 ? width / Math.max(samples.length - 1, 1) : 3;
  const points = samples.map((value, index) => `${index * step},${height - (value === null ? 2 : Math.min(height - 2, Math.max(2, value / 300 * (height - 2))))}`).join(' ');
  const firstSample = Math.max(1, (sent || samples.length) - samples.length + 1);
  const sampleLabel = (index: number) => `第 ${firstSample + index} 次 · ${samples[index] === null ? '超时' : ms(samples[index])}`;
  return <><svg className="quality-chart" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={`${label}，最近 ${samples.length} 次测试，最新${samples.at(-1) === null ? '超时' : ms(samples.at(-1))}`} onMouseMove={event => {
    const sampleIndex = Number((event.target as SVGElement).dataset.sampleIndex), bounds = event.currentTarget.getBoundingClientRect();
    const index = Number.isInteger(sampleIndex) ? sampleIndex : Math.floor((event.clientX - bounds.left) / bounds.width * width / step);
    setTooltip(index < 0 || index >= samples.length ? null : { text: sampleLabel(index), x: Math.min(Math.max(8, event.clientX + 10), window.innerWidth - 144), y: event.clientY > 44 ? event.clientY - 36 : event.clientY + 12 });
  }} onMouseOut={event => { if (!event.currentTarget.contains(event.relatedTarget as globalThis.Node | null)) setTooltip(null); }}><path className="quality-area" d={`M0,${height} L${points.replaceAll(' ', ' L')} L${Math.max(0, samples.length - 1) * step},${height} Z`} /><polyline className="quality-line" points={points} />{samples.map((value, i) => <g key={i}>{value === null ? <line className="quality-timeout-spike" x1={i * step} x2={i * step} y1={height - 1} y2={1} /> : value > 100 && <line className={`quality-latency-spike ${value > 250 ? 'critical' : 'slow'}`} x1={i * step} x2={i * step} y1={height - 1} y2={height - Math.min(height - 2, Math.max(2, value / 300 * (height - 2)))} />}<rect className="quality-hit-target" data-latency={value === null ? 'timeout' : value} data-sample-index={i} x={Math.max(0, i * step - step / 2)} y={0} width={Math.max(step, 2)} height={height}><title>{sampleLabel(i)}</title></rect></g>)}</svg>{tooltip && <span className="quality-chart-tooltip" role="tooltip" style={{ left: tooltip.x, top: tooltip.y }}>{tooltip.text}</span>}</>;
}

function Summary({ rows, progress: taskProgress, tool, busy, t, logo, selectedRegion, onRegion, expected, onJump, nodes }: { rows: Row[]; progress?: ProbeProgress; tool: Tool; busy: boolean; t: T; logo: string; selectedRegion: string; onRegion: (region: string) => void; expected: number; onJump: (row: Row) => void; nodes: Node[] }) {
  const [scope, setScope] = useState('china'), [markTimeout, setMarkTimeout] = useState(true), [summaryExpanded, setSummaryExpanded] = useState(false);
  const labels = new Map(nodes.map(node => [node.id, nodeLocation(node)]));
  const completed = taskProgress?.completedNodes ?? rows.length, total = Math.max(taskProgress?.totalNodes ?? expected, completed, 1), progress = Math.round(completed / total * 100);
  const http = tool === 'http';
  const scopedRows = rows.filter(r => scope === 'china' ? rowProvince(r) : !rowProvince(r));
  const specs: [TextKey, RegExp, 'isp' | 'region'][] = scope === 'china' ? [
    ['telecom', /电信|telecom/i, 'isp'], ['unicom', /联通|unicom/i, 'isp'], ['chinaMobile', /移动|mobile/i, 'isp'], ['multiline', /多线|BGP/i, 'isp'],
    ['eastChina', /上海|江苏|浙江|安徽|福建|山东/, 'region'], ['southChina', /广东|广西|海南/, 'region'], ['centralChina', /湖北|湖南|河南|江西/, 'region'],
    ['northChina', /北京|天津|河北|山西|内蒙古/, 'region'], ['southwestChina', /重庆|四川|贵州|云南|西藏/, 'region'], ['northwestChina', /陕西|甘肃|青海|宁夏|新疆/, 'region'], ['northeastChina', /辽宁|吉林|黑龙江/, 'region'], ['hmt', /香港|台湾|澳门/, 'region']
  ] : [['asia', /日本|东京|韩国|首尔|新加坡|马来西亚|泰国|越南|菲律宾|印度|印尼/, 'region'], ['northAmerica', /美国|洛杉矶|硅谷|纽约|加拿大/, 'region'], ['europe', /德国|英国|法国|荷兰|俄罗斯|欧洲/, 'region']];
  const groups = [{ name: scope === 'china' ? t('allNodes') : '全部海外', rows: scopedRows }, ...specs.map(([name, pattern, field]) => ({ name: t(name), rows: scopedRows.filter(r => pattern.test(field === 'region' ? rowLocation(r) : `${r.isp || ''} ${r.line || ''}`)) })), ...(scope === 'overseas' ? [{ name: '其他海外', rows: scopedRows }] : [])];
  const grouped = new Map<string, Row[]>();
  for (const row of rows) { const p = rowProvince(row); if (p) grouped.set(p, [...(grouped.get(p) || []), row]); }
  const mapData = [...grouped].map(([name, regionRows]) => {
    const values = regionRows.map(r => latency(r, tool)).filter(measured);
    const timeouts = regionRows.filter(r => ['timeout', 'bad'].includes(r.status)).length;
    return { name, value: values.length ? Math.round(Math.min(...values)) : timeouts ? http ? 100000 : 3001 : http ? 100001 : 4001, rows: regionRows, partialTimeout: timeouts > 0 && values.length > 0, selected: name === selectedRegion };
  });
  const pieces = http ? [
    { min: 100001, label: t('unavailable'), color: '#cbd5e1' }, { min: 100000, max: 100000, label: t('timeout'), color: '#f01818' }, { min: 10001, max: 99999, label: '>10s', color: '#ff9924' }, { min: 3001, max: 10000, label: '3s-10s', color: '#f7e733' }, { min: 1001, max: 3000, label: '1s-3s', color: '#b6f24c' }, { min: 501, max: 1000, label: '0.5s-1s', color: '#38dd47' }, { min: 0, max: 500, label: '<=0.5s', color: '#1fad18' }
  ] : [
    { min: 4001, label: t('unavailable'), color: '#cbd5e1' }, { min: 3001, max: 4000, label: t('timeout'), color: '#f01818' }, { min: 251, max: 3000, label: '>250ms', color: '#ff9924' }, { min: 201, max: 250, label: '201ms-250ms', color: '#f7e733' }, { min: 101, max: 200, label: '101ms-200ms', color: '#b6f24c' }, { min: 51, max: 100, label: '51ms-100ms', color: '#38dd47' }, { min: 0, max: 50, label: '<=50ms', color: '#1fad18' }
  ];
  const mobile = typeof document !== 'undefined' && document.documentElement.classList.contains('mobile-responsive-layout');
  const layout = { layoutCenter: [mobile ? '53%' : '50%', '51%'], layoutSize: mobile ? '104%' : '108%' };
  const option = { animation: false, tooltip: { trigger: 'item', ...(mobile ? { triggerOn: 'mousemove' } : {}), confine: true, enterable: true, hideDelay: 150, transitionDuration: 0, backgroundColor: 'transparent', borderWidth: 0, padding: 0, extraCssText: 'box-shadow:none;', formatter: (params: { name?: string; data?: { rows?: Row[] } }) => {
    const regionRows = params.data?.rows || [], valid = regionRows.map(r => latency(r, tool)).filter(measured);
    const body = regionRows.length ? regionRows.map(r => {
      const isp = lineLabel(r), color = ({ 电信: '#a3e635', 联通: '#fbbf24', 移动: '#22d3ee', 多线: '#c084fc' } as Record<string, string>)[isp] || '#93c5fd';
      return `<div class="map-result-tooltip-row"><span class="map-result-tooltip-isp" style="color:${color}">[${escapeHTML(isp)}]</span><span>${escapeHTML(labels.get(rowID(r)) || locationName(r))}：</span><b class="${timingClass(latency(r, tool), http, r.status)}">${escapeHTML(ok(r, tool) ? (http ? seconds : ms)(latency(r, tool)) : t(probeNodeStatus(r, tool)))}</b></div>`;
    }).join('') : `<div class="map-result-tooltip-empty">${escapeHTML(t('noData'))}</div>`;
    return `<div class="map-result-tooltip"><div class="map-result-tooltip-title">${escapeHTML(provinceShortName(params.name || ''))}</div><div class="map-result-tooltip-body"><div class="map-result-tooltip-fastest">最快响应：<b>${escapeHTML(valid.length ? (http ? seconds : ms)(Math.min(...valid)) : '--')}</b></div><div class="map-result-tooltip-rows">${body}</div>${regionRows.length ? '<div class="map-result-tooltip-hint">点击地图可筛选该地区结果</div>' : ''}</div></div>`;
  } }, visualMap: { left: mobile ? 0 : 8, bottom: mobile ? 0 : 8, itemWidth: mobile ? 10 : 12, itemHeight: mobile ? 8 : 10, ...(mobile ? { itemGap: 0, padding: 0, backgroundColor: 'rgba(246,249,253,.92)' } : {}), textStyle: { color: '#64748b', fontSize: mobile ? 13 : 11, ...(mobile ? { lineHeight: 12 } : {}) }, seriesIndex: 0, pieces }, geo: { map: 'china', roam: false, silent: true, ...layout, itemStyle: { areaColor: 'transparent', borderColor: 'transparent' }, emphasis: { disabled: true } }, ...(mobile ? { media: [
    { query: { maxWidth: 330 }, option: { geo: { layoutCenter: ['56%', '51%'], layoutSize: '98%' }, series: [{ layoutCenter: ['56%', '51%'], layoutSize: '98%' }] } },
    { option: { geo: layout, series: [layout] } }
  ] } : {}), series: [
    { name: t('latency'), type: 'map', map: 'china', cursor: 'pointer', selectedMode: 'single', roam: false, ...layout, label: { show: false }, emphasis: { label: { show: false }, itemStyle: { areaColor: '#7ea6ff' } }, itemStyle: { borderColor: '#fff', borderWidth: 1, areaColor: '#e8eef7' }, markPoint: { silent: true, symbol: 'path://M12.2 2L4.8 12.5H10.2L9.2 22L19.2 9.4H13.5L12.2 2Z', symbolSize: 13, symbolKeepAspect: true, label: { show: false }, itemStyle: { color: '#f01818' }, tooltip: { show: false }, data: markTimeout ? mapData.filter(r => r.partialTimeout && provinceMapCenters[r.name]).map(r => ({ name: r.name, coord: provinceMapCenters[r.name] })) : [] }, data: mapData },
    { type: 'scatter', coordinateSystem: 'geo', cursor: 'pointer', symbol: 'circle', symbolSize: 14, z: 10, data: mapData.filter(r => ['香港特别行政区', '澳门特别行政区'].includes(r.name)).map(r => ({ ...r, value: [...(r.name === '香港特别行政区' ? [114.173355, 22.320048] : [113.54909, 22.198951]), r.value], itemStyle: { color: pieces.find(p => r.value >= p.min && (p.max === undefined || r.value <= p.max))?.color || '#cbd5e1', borderColor: '#fff', borderWidth: 2 } })) },
    { type: 'map', map: 'china-south-sea', silent: true, roam: false, layoutCenter: ['88%', '82%'], layoutSize: '29%', label: { show: false }, itemStyle: { areaColor: 'transparent', borderColor: '#fff', borderWidth: 1 }, emphasis: { disabled: true }, tooltip: { show: false } }
  ] };
  return <section className={`summary-grid map-summary-grid ${tool === 'dns' ? 'dns-region-summary' : ''}`}><div className="card map-panel map-panel-hero"><div className="panel-head"><img className="map-panel-brand" src={logo} alt="" /><div className="map-marker-control" data-tooltip={markTimeout ? '当前已开启：闪电标记部分节点超时的地区。点击关闭后将隐藏闪电标记。' : '当前已关闭：点击开启地图部分超时标记。'}><Zap size={12} /><label className="map-marker-switch"><input type="checkbox" aria-label={markTimeout ? '关闭地图部分超时标记' : '开启地图部分超时标记'} checked={markTimeout} onChange={e => setMarkTimeout(e.target.checked)} /><span aria-hidden="true" /></label></div></div><div className="echart-map echart-map-hero"><Suspense fallback={<div className="map-loading">{t('loading')}</div>}><ChinaProbeMap option={option} onEvents={{ click: params => { if (params.name) onRegion(params.name); } }} /></Suspense></div>{selectedRegion && <div className="map-filter-feedback" role="status"><span>已筛选{provinceShortName(selectedRegion)}，下方结果已同步</span><button type="button" aria-label={t('clearFilter')} onClick={() => onRegion('')}><X size={13} /></button></div>}</div>
    <div className="card region-panel region-panel-hero"><div className="region-summary-table"><div className="region-summary-tabs"><button type="button" className={scope === 'china' ? 'active' : ''} aria-pressed={scope === 'china'} onClick={() => setScope('china')}>{t('china')}</button><button type="button" className={scope === 'overseas' ? 'active' : ''} aria-pressed={scope === 'overseas'} onClick={() => setScope('overseas')}>{t('overseas')}</button><span><b>{taskProgress?.completedNodes ?? rows.filter(r => r.status !== 'unavailable').length}</b> {t('nodeProgress')}</span><div className="region-progress" role="progressbar" aria-label={t('results')} aria-valuemin={0} aria-valuemax={total} aria-valuenow={completed}><i style={{ width: `${progress}%` }} /><em>{busy && !completed ? t('waitingRun') : `${progress}%`}</em></div></div><table data-mobile-expanded={summaryExpanded || groups.length <= 5}><thead><tr><th>{screenLabel(t('region'))}</th><th>{t('fastestShort')}</th><th>{t('slowestShort')}</th><th>{t('averageShort')}</th></tr></thead><tbody>{groups.map((group, index) => {
      const valid = group.rows.filter(row => measured(latency(row, tool))), format = http ? seconds : ms;
      const value = (row: Row, kind: 'min' | 'max') => tool === 'http' ? row.total_time : tool === 'dns' ? row.elapsedMs : row[`${kind}_latency`] ?? latency(row, tool);
      const fastest = [...valid].sort((a, b) => value(a, 'min') - value(b, 'min'))[0], slowest = [...valid].sort((a, b) => value(b, 'max') - value(a, 'max'))[0];
      const cell = (row: Row | undefined, kind: 'min' | 'max') => row ? <button type="button" className="target-result-demo" onClick={() => onJump(row)}><span className="mobile-target-location probe-node-name" data-screenshot-mask="location">{labels.get(rowID(row)) || row.region || locationName(row)}</span>{' '}<span className={`mobile-target-latency probe-time-value ${timingClass(value(row, kind), http)}`}>{format(value(row, kind))}</span></button> : '--';
      const average = valid.length ? Math.round(valid.reduce((sum, row) => sum + latency(row, tool), 0) / valid.length) : undefined;
      return <tr key={group.name} data-mobile-overflow={index >= 5 ? '' : undefined}><td>{screenLabel(group.name)}</td><td>{cell(fastest, 'min')}</td><td>{cell(slowest, 'max')}</td><td className={`probe-time-value ${timingClass(average, http)}`}>{format(average)}</td></tr>;
    })}</tbody></table>{groups.length > 5 && <button type="button" className="mobile-more-toggle" data-mobile-fold="region-summary" aria-expanded={summaryExpanded} onClick={() => setSummaryExpanded(!summaryExpanded)}>{summaryExpanded ? '点击收起更多' : '点击查看更多'}<span className={`mobile-more-chevron ${summaryExpanded ? 'is-expanded' : ''}`} aria-hidden="true" /></button>}</div></div>
  </section>;
}
