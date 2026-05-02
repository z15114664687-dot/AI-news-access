export type EvidenceLevel = "official" | "media" | "analysis";
export type Confidence = "high" | "medium" | "low";

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
