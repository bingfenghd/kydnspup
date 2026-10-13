import { useEffect, useState } from 'react';
export const zh = {
  recoverResult: '找回原请求结果',
  recoverHint: '只查询原请求，不重新检测。支持任务查询的平台可保留结果 24 小时；旧平台仅支持本站 10 分钟内存缓存，重启后不可恢复。',
  diagnosticExport: '脱敏诊断',
  diagnosticCounts: '返回 {returned}/{expected} · 正常 {ok} · 部分 {partial} · 超时 {timeout} · 不可用 {unavailable} · 失败 {failed} · 未返回 {missing}',
  destinationCounts: '终点应答 {reached} · 未取得终点应答 {unreached} · 终点未知 {unknownDestination}',
  taskCompletionHint: '任务完成表示请求处理结束，不代表所有节点检测成功；HTTP 状态码需单独判断。',
  traceCompletionHint: '任务结束、路由完整和目标应答是不同状态。ICMP 丢包统计不等于业务流量丢包率。',
  reached: '已取得终点应答',
  unreached: '未取得终点应答',
  unknown: '终点未知',
  taskUnknown: '执行状态未知',

  selectAll: "全选",
  overseasLines: "港澳台、海外",
  navDNS: "DNS查询",
  ipv6Tools: "IPV6工具",
  singleTest: "单次测试",
  quickTest: "快速测试",
  slowTest: "缓慢测试",
  advanced: "高级选项",
  apiPending: "客户 API 暂未支持此选项",
  dnsPlaceholder: "例如：223.5.5.5",
  probePreferences: "节点选择与检测设置",
  allNodes: "全部节点",
  nodeProgress: "个监测点返回结果，当前进度：",
  fastestShort: "最快",
  slowestShort: "最慢",
  averageShort: "平均",
  timeoutMarkers: "地图部分超时标记",
  pingBreadcrumb: "多地Ping、常规版、icmp协议、网络延迟测试",
  tcpingBreadcrumb: "多地Tcping、TCP端口连通性、网络延迟测试",
  httpBreadcrumb: "网站测速、HTTP响应、网站访问速度测试",
  dnsBreadcrumb: "DNS查询、多地DNS解析、域名解析记录查询",
  tracerouteBreadcrumb: "路由追踪、网络路由、逐跳延迟检测",
  mtrBreadcrumb: "MTR路由追踪、逐跳延迟、丢包检测",

  stopped: '已停止',
  continuous: "持续测试",
  stop: "停止测试",
  stopping: "正在停止，等待本轮返回",
  screenshot: "完整截图",
  capturing: "正在截图",
  screenshotFailed: "截图失败，请稍后重试",
  screenshotMask: "截图隐藏：",
  ispDNS: "运营商DNS",
  customDNS: "指定DNS",
  dnsRequired: "请填写指定 DNS 服务器",
  sampleCount: "单次采样",
  repeatRounds: "持续测试轮数",
  roundRange: "持续测试轮数应为 2 至 100",
  roundProgress: "已返回 {n} / {total} 轮",
  repeatCost: "每轮各节点采样一次并消耗一次 API 请求。按本站频率间隔执行；停止后本轮仍会返回，异常时不再继续。",
  recentTargets: "最近检测（本机）",
  ipStats: "域名解析统计",
  copyIPs: "复制 IP",
  ipStatsHint: "点击 IP 筛选结果",
  failedOnly: "异常节点",
  clearFilter: "清除筛选",
  quality: "网络质量（最近 60 次）",
  quickTools: "快捷检测",
  responseHeaders: "响应头",

  telecom: '中国电信', unicom: '中国联通', chinaMobile: '中国移动', multiline: '多线', eastChina: '华东地区', southChina: '华南地区', centralChina: '华中地区', northChina: '华北地区', southwestChina: '西南地区', northwestChina: '西北地区', northeastChina: '东北地区', hmt: '港澳台', asia: '亚洲地区', northAmerica: '北美地区', europe: '欧洲地区',
  home: '首页', homeIntro: '选择工具，开始检测网站与网络。', allTools: '显示所有', all: '全部', navigation: '打开导航菜单', close: '关闭', china: '中国地区', overseas: '海外地区', region: '区域/运营商',
  toolbox: '检测工具', help: '使用帮助', admin: '站长管理', connection: '节点服务', connected: '已连接', unconfigured: '待配置',
  eyebrow: 'NETWORK TOOLKIT', headline: '让每一次连接，', headlineAccent: '都清晰可见。', intro: '从不同地区与运营商，观察你的网站与网络连接。',
  ping: '在线Ping', tcping: '在线Tcping', http: '网站测速', dns: 'DNS记录查询', traceroute: '路由追踪', mtr: 'MTR 检测',
  pingDesc: '测量延迟与丢包，了解网络连通质量。', tcpingDesc: '从多地检查端口连通性与连接延迟。', httpDesc: '检查网站状态码和各阶段响应耗时。', dnsDesc: '对比不同地区的 DNS 解析结果。', tracerouteDesc: '沿着数据包的路径，定位连接的每一跳。', mtrDesc: '持续采样路由，观察各跳延迟与丢包。',
  target: '检测目标', targetHint: '请输入域名或IP，例如：example.com 、8.8.8.8', urlHint: '输入网址，例如 https://example.com', start: '开始检测', running: '正在检测',
  port: '端口', method: '请求方法', record: '记录类型', version: '网络协议', nodes: '检测节点', choose: '选择节点', selected: '已选择', nodeUnit: '个',
  allRegions: '全部地区', allISPs: '全部运营商', nodeSearch: '搜索地区或节点', selectFiltered: '选择筛选结果', clear: '清空', maxNodes: '单次最多 {n} 个节点',
  refresh: '刷新节点', loading: '正在加载', noNodes: '暂无可用节点', noMatches: '没有匹配的节点', notReady: '节点服务尚未连接', notReadyDesc: '站长配置 DNSPup API 后，即可从授权节点发起真实检测。',
  results: '检测结果', export: '导出 JSON', copy: '复制结果', copied: '已复制', copyFailed: '复制失败，请使用导出',
  waiting: '准备好，开始一次检测', waitingDesc: '输入目标并选择节点，真实检测结果将在这里展示。', waitingRun: '正在等待节点返回', waitingRunDesc: '本次接口将在检测结束后统一返回结果。MTR 可能需要数分钟。',
  elapsed: '已等待 {n} 秒', completed: '检测完成', partial: '部分完成', timeout: '检测超时', failed: '未完成', status: '状态',
  location: '检测节点', address: '目标地址', latency: '耗时', loss: '丢包', details: '详细结果', error: '错误', noData: '暂无数据',
  average: '平均延迟', fastest: '最快延迟', slowest: '最慢延迟', returned: '返回节点', unavailable: '不可用', ok: '正常',
  httpStatus: '状态码', dnsTime: 'DNS 解析', connectTime: '建立连接', downloadTime: '下载耗时', totalTime: '总耗时', redirects: '重定向次数',
  hop: '跳数', sent: '发送', routeIP: '路由地址', geo: '归属地', latest: '最近延迟', raw: '原始结果',
  privateTitle: '凭据留在服务端', privateDesc: '访客无需 API 密钥，通过本站安全发起检测。',
  realTitle: '来自真实节点', realDesc: '结果由 DNSPup 授权节点执行并返回。',
  regionTitle: '换个地区看网络', regionDesc: '按地区和运营商选择检测视角。',
  powered: '节点服务由 DNSPup 提供', privacy: '服务与隐私', contact: '联系站长', links: '友情链接', ad: '广告',
  helpTitle: '从一个目标开始', helpIntro: '选择工具、输入地址、勾选节点，再点击开始检测。',
  helpContent: 'Ping 用于观察延迟与丢包；TCPing 检查端口；HTTP 查看网站响应；DNS 对比解析；路由追踪和 MTR 帮助了解网络路径。节点能否执行所选 IPv4/IPv6 检测，最终由节点服务校验。',
  helpCost: '每次提交可能消耗站长的 API 请求额度。等待期间请勿重复提交；网络中断不一定表示上游没有执行。',
  privacyTitle: '数据怎样流转', privacyContent: '检测目标和必要参数会通过本站服务器发送至 DNSPup。本站保存必要的调用记录用于排障与额度保护，记录保留 7 天；不保存 URL 查询参数。请不要在检测地址中填写密码或其他敏感信息。',
  privacyExternal: '最近检测记录仅保存在当前浏览器，可在输入框的历史列表中清空；网址查询参数不写入该记录。站长配置的外部 Logo 和广告图片可能向图片托管方发送访问请求。没有配置广告时，不加载广告资源。',
  back: '返回检测', errorGeneric: '请求失败，请稍后再试或联系站长。', selectNodes: '请先选择至少一个节点', toolDisabled: '此工具未获得 API 授权',
  localLimit: '请求受到本站额度或频率限制，请稍后重试。', serviceError: '节点服务暂不可用，请联系站长。', query: '解析结果', sort: '按耗时排序', original: '默认顺序',
  language: '语言', tagline: '用更清晰的数据，了解你的网络。'
};
export type TextKey = keyof typeof zh;
export type Locale = 'zh-CN' | 'zh-TW' | 'en' | 'ja' | 'ko';
export const languages: [Locale, string][] = [['zh-CN', '简体中文'], ['zh-TW', '繁體中文'], ['en', 'English'], ['ja', '日本語'], ['ko', '한국어']];
function initialLocale(): Locale {
  try { const saved = localStorage.getItem('ky-language') as Locale; if (languages.some(([id]) => id === saved)) return saved; } catch {}
  const lang = navigator.language.toLowerCase();
  if (/^zh-(tw|hk|hant)/.test(lang)) return 'zh-TW';
  if (lang.startsWith('zh')) return 'zh-CN';
  return (['en', 'ja', 'ko'].find(id => lang.startsWith(id)) || 'zh-CN') as Locale;
}
export function useLanguage() {
  const [locale, setLocale] = useState<Locale>(initialLocale), [dictionary, setDictionary] = useState<Record<string, string>>(zh);
  useEffect(() => {
    let alive = true;
    document.documentElement.lang = locale;
    try { localStorage.setItem('ky-language', locale); } catch {}
    if (locale === 'zh-CN') setDictionary(zh);
    else import(`./locales/${locale}.json`).then(module => { if (alive) setDictionary(module.default); });
    return () => { alive = false; };
  }, [locale]);
  const t = (key: TextKey, vars?: Record<string, string | number>): string => {
    let value = dictionary[key] || zh[key]; for (const [k, v] of Object.entries(vars || {})) value = value.replaceAll(`{${k}}`, String(v)); return value;
  };
  return { locale, setLocale, t };
}
