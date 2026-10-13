export class APIError extends Error { code: string; status: number; constructor(message: string, code: string, status: number) { super(message); this.code = code; this.status = status; } }
export async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', 'X-KY-Request': '1', ...options.headers } });
  const data = await response.json();
  if (!response.ok) throw new APIError(data.error?.message || '请求失败', data.error?.code || 'unknown_error', response.status);
  return data;
}
export const send = (path: string, value: unknown, method = 'POST') => api(path, { method, body: JSON.stringify(value) });
export async function waitForProbe(id: string, active: () => boolean, onProgress?: (job: ProbeJob) => void): Promise<ProbeResponse | undefined> {
  while (active()) {
    const job = await api<ProbeJob>(`/api/probes/${encodeURIComponent(id)}`);
    if (!active()) return;
    onProgress?.(job);
    if (job.resultAvailable && job.result) return job.result;
    if (job.status !== 'running') throw new APIError(job.error?.message || '结果已过期，请查看原请求记录', job.error?.code || 'result_expired', 409);
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
}
export function downloadJSON(name: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
}
import type { ProbeJob, ProbeResponse } from './types';
