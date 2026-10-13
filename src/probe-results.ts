import type { ProbeResponse } from './types';

export { probeNodeStatus } from '../shared/probe-diagnostics.ts';

// Adapted from itdog's mergeContinuousProbeResult. A repeat request uses count=1.
export function mergeRound(previous: ProbeResponse | undefined, next: ProbeResponse): ProbeResponse {
  const old = new Map(previous?.results?.map(row => [row.node_id, row]));
  return { ...next, results: next.results?.map(row => {
    const prior = old.get(row.node_id);
    const valid = ['ok', 'success', 'slow'].includes(row.status);
    const value = valid && typeof (row.avg_latency ?? row.latency_ms) === 'number' ? row.avg_latency ?? row.latency_ms : null;
    const sent = Number.isInteger(row.sent_count) ? row.sent_count : row.status === 'unavailable' ? 0 : 1;
    const received = Number.isInteger(row.received_count) ? Math.min(sent, row.received_count) : value !== null ? sent : 0;
    const totalSent = (prior?.sent_count || 0) + sent, totalReceived = (prior?.received_count || 0) + received;
    const totalLatency = (prior?.latency_total || 0) + (value ?? 0) * received;
    const best = [prior?.min_latency, value !== null ? row.min_latency ?? value : undefined].filter(v => typeof v === 'number' && v >= 0);
    const worst = [prior?.max_latency, value !== null ? row.max_latency ?? value : undefined].filter(v => typeof v === 'number' && v >= 0);
    return { ...row, cumulative: true, sent_count: totalSent, received_count: totalReceived, latency_total: totalLatency,
      loss_rate: totalSent ? Math.round((totalSent - totalReceived) / totalSent * 10000) / 100 : undefined,
      avg_latency: totalReceived ? totalLatency / totalReceived : undefined,
      min_latency: best.length ? Math.min(...best) : undefined, max_latency: worst.length ? Math.max(...worst) : undefined,
      samples: [...(prior?.samples || []), value].slice(-60) };
  }) };
}
