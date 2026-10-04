export type EvidenceLevel = "official" | "media" | "analysis" | "unknown";
export type Confidence = "high" | "medium" | "low" | "unknown";

export type TopicSuggestion = {
  hash: string;
  model: string;
  promptVersion: string;
  topic: string | null;
  confidence: number;
  probabilities: Array<{ topic: string; probability: number }>;
  cached: boolean;
};

export type Signal = {
  id: string;
  date: string;
  entity: string;
  entityType: string;
  companies: string[];
  product: string;
  title: string;
  summary: string;
  topics: string[];
  topicOverride?: string | null;
  topicMode: string;
  source: string;
  domain: string;
  url: string;
  evidenceLevel: EvidenceLevel;
  confidence: Confidence;
  collectionSource: string;
  aiClassification: Record<string, unknown>;
  confirmed: boolean;
  createdAt: string;
  updatedAt: string;
  discoveredAt?: string;
  revision?: number;
  reviewStatus?: "unreviewed" | "confirmed" | "dismissed";
  reviewNote?: string;
  reviewedAt?: string | null;
  reviewedRevision?: number | null;
  upstreamSelected?: boolean | null;
  evidence?: {
    sourceStatus: "direct" | "search" | "redirect" | "missing";
    reviewStatus: "unreviewed" | "confirmed" | "dismissed" | "stale";
    sourceLabel: string;
    reviewLabel: string;
  };
};

export type Source = {
  id: number;
  name: string;
  domain: string;
  queryTemplate: string;
  enabled: boolean;
};

export type CollectionRun = {
  id: string;
  status: "running" | "completed" | "failed";
  startedAt: string;
  finishedAt: string | null;
  foundCount: number;
  insertedCount: number;
  skippedCount: number;
  errorCount: number;
  logs: Array<Record<string, unknown>>;
};

export type SignalFilters = {
  company?: string;
  companies?: string[];
  topic?: string;
  topics?: string[];
  query?: string;
  startDate?: string;
  endDate?: string;
};
