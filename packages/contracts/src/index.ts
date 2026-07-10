export type IntelligenceMode =
  "local" | "on_device_ai" | "cloud_ai" | "offline_snapshot";

export type ReadinessStatus =
  "not_checked" | "clear" | "monitor" | "action_needed" | "critical";

export interface TripDraft {
  id: string;
  origin: string;
  destination: string;
  startDate: string;
  endDate: string;
}

export interface HealthResponse {
  status: "ok";
  service: "voyalier-server";
  version: string;
  intelligence_mode: IntelligenceMode;
}

export interface SourceProvenance {
  sourceId: string;
  sourceUrl?: string;
  documentId?: string;
  documentSpan?: string;
  fetchedAt: string;
  validUntil?: string;
  license: string;
  contentHash: string;
  confidence: number;
}
