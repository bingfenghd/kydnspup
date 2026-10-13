type Capabilities = { ipVersions?: string[]; tools?: string[] };
const tools = ['ping', 'tcping', 'http', 'dns', 'traceroute', 'mtr'];
export function nodeCapabilities(value: unknown): Capabilities | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>, result: Capabilities = {};
  if (Array.isArray(raw.ipVersions) && raw.ipVersions.every(v => typeof v === 'string')) result.ipVersions = raw.ipVersions.filter(v => ['4', '6'].includes(v));
  if (Array.isArray(raw.tools) && raw.tools.every(v => typeof v === 'string')) result.tools = raw.tools.filter(v => tools.includes(v));
  return Object.keys(result).length ? result : undefined;
}
// Missing metadata remains unknown; the upstream validates actual eligibility.
export function nodeSupports(node: { status?: string; capabilities?: Capabilities }, tool: string, version: string): boolean {
  return (!node.status || node.status === 'online') && (!node.capabilities?.ipVersions || node.capabilities.ipVersions.includes(version)) && (!node.capabilities?.tools || node.capabilities.tools.includes(tool));
}
