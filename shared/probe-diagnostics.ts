type Row = Record<string, any>;
export type NodeStatus = 'ok' | 'partial' | 'timeout' | 'unavailable' | 'failed';
const measuredHop = (hop: Row) => typeof hop.ip === 'string' && !!hop.ip && !['*', '--'].includes(hop.ip) && Number.isFinite(hop.averageMs) && hop.averageMs >= 0;

export function probeNodeStatus(row: Row, tool: string): NodeStatus {
  if (tool === 'traceroute' || tool === 'mtr') {
    const statuses = [row.status, row.trace?.status].filter(Boolean);
    for (const status of ['unavailable', 'timeout', 'failed', 'error', 'partial']) if (statuses.includes(status)) return status === 'error' ? 'failed' : status as NodeStatus;
    if (statuses.some(status => !['ok', 'success', 'slow'].includes(status))) return 'failed';
    const measured = Array.isArray(row.trace?.hops) && row.trace.hops.some(measuredHop);
    return row.available === true && measured ? row.trace?.complete === false ? 'partial' : 'ok' : 'failed';
  }
  if (['ok', 'success', 'slow'].includes(row.status) || tool === 'http' && row.http_status > 0) return 'ok';
  return row.status === 'unavailable' ? 'unavailable' : row.status === 'timeout' ? 'timeout' : 'failed';
}

function address(value: unknown): string {
  if (typeof value !== 'string') return '';
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(value) && value.split('.').every(n => Number(n) <= 255)) return value;
  if (value.includes(':')) { try { return new URL(`http://[${value}]`).hostname; } catch {} }
  return '';
}
export function traceDestination(row: Row, target?: string): 'reached' | 'unreached' | 'unknown' {
  const ip = address(row.trace?.targetIp) || address(row.targetIp) || address(target);
  if (!ip) return 'unknown';
  return row.trace?.hops?.some((hop: Row) => address(hop.ip) === ip && measuredHop(hop)) ? 'reached' : 'unreached';
}
export function summarizeProbe(result: Row, expected: number) {
  const rows: Row[] = result.results || result.rows || result.traces || [];
  const s = { expected, returned: rows.length, ok: 0, partial: 0, timeout: 0, unavailable: 0, failed: 0, missing: Math.max(0, expected - rows.length), measured: 0, reached: 0, unreached: 0, unknownDestination: 0 };
  for (const row of rows) {
    const status = probeNodeStatus(row, result.type); s[status]++;
    if (['traceroute', 'mtr'].includes(result.type)) {
      if (row.available === true && row.trace?.hops?.some(measuredHop)) s.measured++;
      const destination = traceDestination(row, result.target);
      s[destination === 'unknown' ? 'unknownDestination' : destination]++;
    } else if (status === 'ok') s.measured++;
  }
  return s;
}
