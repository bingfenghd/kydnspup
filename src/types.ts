export type Tool = 'ping' | 'tcping' | 'http' | 'dns' | 'traceroute' | 'mtr';
export type Ad = { enabled: boolean; title: string; image: string; url: string };
export type Site = {
  name: string; tagline: string; description: string; logoUrl: string; siteUrl: string; contact: string; footer: string; seoTitle: string;
  tools: Tool[]; defaultNodeIds: string[]; maxNodes: number; requestsPerMinute: number; dailyLimit: number; concurrency: number;
  ads: { desktop: Ad; mobile: Ad }; links: { title: string; url: string }[]; connected?: boolean;
  headerAds?: Ad[]; toolAds?: Ad[]; toolBottomAds?: Ad[];
  contentAds?: Ad[]; mobileHeaderAds?: Ad[]; mobileMenuAds?: Ad[]; mobileSummaryAds?: Ad[]; mobileResultAds?: Ad[];
};
export type Node = { id: string; name: string; region: string; city: string; isp: string; status: string; capabilities?: { ipVersions?: string[]; tools?: string[] }; lastSeenAt?: string };
export type Catalog = { nodes: Node[]; tools: { id: Tool; enabled: boolean }[]; maxNodes: number; maxCount: number; requestsPerMinute: number };
export type ProbeResponse = { requestId: string; type: Tool; target: string; status: string; diagnostics?: ReturnType<typeof import('../shared/probe-diagnostics.ts').summarizeProbe>; results?: Record<string, any>[]; rows?: Record<string, any>[]; traces?: Record<string, any>[] };
export type ProbeProgress = { completedNodes?: number; totalNodes?: number };
export type ProbeJob = ProbeProgress & { id: string; status: string; resultAvailable: boolean; result?: ProbeResponse; error?: { code: string; message: string } };
export const TOOLS: Tool[] = ['ping', 'tcping', 'http', 'dns', 'traceroute', 'mtr'];
