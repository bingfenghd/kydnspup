export const TOOL_IDS = ['ping', 'tcping', 'http', 'dns', 'traceroute', 'mtr'];
export const DEFAULT_SETTINGS = {
  name: 'KY DNSPup', tagline: '让每一次连接，都清晰可见。',
  description: '从不同地区与运营商，检测网络连通性、网站响应和路由质量。',
  logoUrl: '', siteUrl: '', contact: '', footer: '用更清晰的数据，了解你的网络。',
  seoTitle: 'KY DNSPup · 多地网络检测',
  tools: TOOL_IDS, defaultNodeIds: [],
  maxNodes: 20, requestsPerMinute: 5, dailyLimit: 1000, concurrency: 3,
  ads: { desktop: { enabled: false, title: '', image: '', url: '' }, mobile: { enabled: false, title: '', image: '', url: '' } },
  headerAds: [], toolAds: [], toolBottomAds: [],
  contentAds: [], mobileHeaderAds: [], mobileMenuAds: [], mobileSummaryAds: [], mobileResultAds: [],
  links: []
};
export class AppError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
export const fail = (message, code = 'invalid_request', status = 400) => { throw new AppError(status, code, message); };
export function text(value, max = 200) {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008]/.test(value)) fail('文字格式或长度不正确');
  return value.trim();
}
export function webUrl(value, allowEmpty = true) {
  const valueText = text(value, 1000);
  if (!valueText && allowEmpty) return '';
  let url; try { url = new URL(valueText); } catch { fail('请输入完整的 HTTP 或 HTTPS 地址'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) fail('只支持不含用户名密码的 HTTP 或 HTTPS 地址');
  return url.href;
}
export function integer(value, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) fail(`数值必须在 ${min} 到 ${max} 之间`);
  return value;
}
export function validateSettings(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('配置格式不正确');
  const s = {};
  for (const [key, max] of Object.entries({ name: 40, tagline: 80, description: 240, contact: 200, footer: 160, seoTitle: 120 })) s[key] = text(input[key], max);
  if (!s.name || !s.seoTitle) fail('站点名称和页面标题不能为空');
  s.logoUrl = webUrl(input.logoUrl); s.siteUrl = webUrl(input.siteUrl);
  if (!Array.isArray(input.tools) || !input.tools.length || input.tools.some(t => !TOOL_IDS.includes(t)) || new Set(input.tools).size !== input.tools.length) fail('至少启用一个有效工具，工具不能重复');
  s.tools = input.tools;
  if (!Array.isArray(input.defaultNodeIds) || input.defaultNodeIds.length > 100 || input.defaultNodeIds.some(id => typeof id !== 'string' || id.length > 150)) fail('默认节点配置不正确');
  s.defaultNodeIds = [...new Set(input.defaultNodeIds)];
  for (const [key, min, max] of [['maxNodes', 1, 100], ['requestsPerMinute', 1, 60], ['dailyLimit', 1, 100000], ['concurrency', 1, 10]]) s[key] = integer(input[key], min, max);
  s.ads = {};
  for (const [key, max] of [['headerAds', 2], ['toolAds', 6], ['toolBottomAds', 6], ['contentAds', 2], ['mobileHeaderAds', 1], ['mobileMenuAds', 2], ['mobileSummaryAds', 2], ['mobileResultAds', 2]]) {
    const ads = input[key] ?? [];
    if (!Array.isArray(ads) || ads.length > max) fail('广告位数量不正确');
    s[key] = ads.map(ad => {
      if (!ad || typeof ad.enabled !== 'boolean') fail('广告配置不正确');
      const value = { enabled: ad.enabled, title: text(ad.title, 80), image: webUrl(ad.image), url: webUrl(ad.url) };
      if (value.enabled && (!value.title || !value.url)) fail('启用广告时请填写标题和链接');
      return value;
    });
  }
  for (const surface of ['desktop', 'mobile']) {
    const ad = input.ads?.[surface]; if (!ad || typeof ad.enabled !== 'boolean') fail('广告配置不正确');
    s.ads[surface] = { enabled: ad.enabled, title: text(ad.title, 80), image: webUrl(ad.image), url: webUrl(ad.url) };
    if (ad.enabled && (!ad.title || !ad.url)) fail('启用广告时请填写标题和链接');
  }
  if (!Array.isArray(input.links) || input.links.length > 12) fail('友情链接最多 12 个');
  s.links = input.links.map(link => ({ title: text(link.title, 40), url: webUrl(link.url, false) }));
  if (s.links.some(link => !link.title)) fail('友情链接标题不能为空');
  return s;
}
