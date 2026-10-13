export type ProbeSummary = Partial<Record<'expected' | 'returned' | 'ok' | 'partial' | 'timeout' | 'unavailable' | 'failed' | 'missing' | 'measured' | 'reached' | 'unreached' | 'unknownDestination', number>>;
export type Diagnostics = {
  version: string;
  checkedAt: string;
  checks: { id: string; status: 'ok' | 'warning' | 'error'; message: string }[];
  onboarding: { credentialsSaved: boolean; connectionCheckedAt: string | null; connectionOk: boolean | null; firstProbeAt: string | null };
  calls: { id: string; created: string; tool: string; status: string; requestId: string | null; errorCode: string | null; summary: ProbeSummary | null }[];
};

export function callStatusText(status: string): string {
  return ({ completed: '任务已返回', partial: '部分结果', timeout: '等待超时', failed: '失败', running: '执行中', unknown: '结果未知' } as Record<string, string>)[status] || status;
}

export function probeSummaryText(summary?: ProbeSummary | null): string {
  if (!summary) return '';
  const count = (key: keyof ProbeSummary) => Number.isSafeInteger(summary[key]) && summary[key]! >= 0 ? summary[key] : undefined;
  const parts = count('returned') !== undefined && count('expected') !== undefined ? [`节点返回 ${count('returned')}/${count('expected')}`] : [];
  if (count('measured') !== undefined) parts.push(`有效测量 ${count('measured')}`);
  for (const [key, label] of [['partial', '部分结果'], ['timeout', '目标超时'], ['unavailable', '节点不可用'], ['failed', '检测失败'], ['missing', '未返回'], ['reached', '已取得终点应答'], ['unreached', '未取得终点应答'], ['unknownDestination', '目标地址未知']] as const) {
    if (count(key)) parts.push(`${label} ${count(key)}`);
  }
  return parts.join(' · ');
}
