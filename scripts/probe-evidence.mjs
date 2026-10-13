import { isIP } from 'node:net';

export function hasMeasurement(row, type, ipVersion = '4') {
  const nativeV6 = value => isIP(value || '') === 6 && !/^::ffff:/i.test(value);
  if (ipVersion === '6') {
    const familyMatches = type === 'dns' ? row.results?.some(nativeV6) : ['traceroute', 'mtr'].includes(type) ? (!row.trace?.targetIp || nativeV6(row.trace.targetIp)) && row.trace?.hops?.some(h => nativeV6(h.ip) && Number.isFinite(h.averageMs)) : nativeV6(row.ip);
    if (!familyMatches) return false;
  }
  if (type === 'dns') return ['ok', 'success'].includes(row.status) && row.results?.length > 0 && Number.isFinite(row.elapsedMs);
  if (['traceroute', 'mtr'].includes(type)) return row.available === true && row.trace?.hops?.some(h => h.ip && h.ip !== '*' && Number.isFinite(h.averageMs));
  if (type === 'http') return row.http_status >= 200 && row.http_status < 400 && Number.isFinite(row.total_time);
  return ['ok', 'success', 'slow'].includes(row.status) && row.loss_rate < 100 && Number.isFinite(row.avg_latency);
}
