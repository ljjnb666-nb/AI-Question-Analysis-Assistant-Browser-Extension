export type AdminAnalyticsDays = 7 | 14 | 30 | 90;

export interface AdminWindowDto {
  days: number;
  from: string;
  to: string;
  retentionDays: number;
}

export interface AdminOverviewResponse {
  ok: true;
  generatedAt: string;
  analyticsScope: "opt_in_only";
  accountScope: "all_registered_accounts";
  window: AdminWindowDto;
  activity: {
    dau: number;
    wau: number;
    mau: number;
  };
  accounts: {
    registeredUsers: number;
    registrationsToday: number;
  };
  observed: {
    installDevicesToday: number;
    parseOutcomeDevicesToday: number;
    parseOutcomesToday: {
      success: number;
      error: number;
      total: number;
      successRatio: number | null;
    };
    parseOutcomeLatencyWindowMs: {
      samples: number;
      average: number | null;
    };
  };
}

export interface AdminTimeseriesItem {
  date: string;
  optInDau: number;
  observedInstallDevices: number;
  parseSuccesses: number;
  parseErrors: number;
  parseOutcomeSuccessRatio: number | null;
  registrations: number;
}

export interface AdminTimeseriesResponse {
  ok: true;
  kind: "timeseries";
  metric: "observed_activity_and_parse_outcomes";
  generatedAt: string;
  analyticsScope: "opt_in_only";
  accountScope: "all_registered_accounts";
  window: AdminWindowDto;
  data: AdminTimeseriesItem[];
}

export type AdminProviderType =
  | "anthropic"
  | "openai"
  | "deepseek"
  | "gemini"
  | "qwen"
  | "moonshot"
  | "zhipu"
  | "minimax"
  | "ollama"
  | "custom";

export interface AdminProviderItem {
  provider: AdminProviderType;
  success: number;
  error: number;
  outcomes: number;
  successRatio: number | null;
}

export interface AdminProvidersResponse {
  ok: true;
  kind: "providers";
  metric: "observed_parse_outcomes_by_provider";
  generatedAt: string;
  analyticsScope: "opt_in_only";
  window: AdminWindowDto;
  data: AdminProviderItem[];
}

export type AdminErrorCategoryType =
  | "timeout"
  | "network"
  | "http_4xx"
  | "http_5xx"
  | "media_unavailable"
  | "unsupported"
  | "unknown";

export interface AdminErrorItem {
  category: AdminErrorCategoryType;
  count: number;
  exhaustedCount: number;
}

export interface AdminErrorsResponse {
  ok: true;
  kind: "errors";
  metric: "observed_parse_errors_by_category";
  generatedAt: string;
  analyticsScope: "opt_in_only";
  window: AdminWindowDto;
  data: AdminErrorItem[];
}

export interface AdminVersionItem {
  extensionVersion: string;
  devices: number;
}

export interface AdminVersionsResponse {
  ok: true;
  kind: "versions";
  metric: "latest_observed_version_per_opt_in_device";
  generatedAt: string;
  analyticsScope: "opt_in_only";
  window: AdminWindowDto;
  data: AdminVersionItem[];
}

export interface AdminLatencyItem {
  date: string;
  samples: number;
  averageMs: number | null;
}

export interface AdminLatencyResponse {
  ok: true;
  kind: "latency";
  metric: "observed_parse_outcome_duration_ms";
  generatedAt: string;
  analyticsScope: "opt_in_only";
  window: AdminWindowDto;
  data: AdminLatencyItem[];
}

export type SectionFetchState<T> =
  | { status: "loading" }
  | { status: "success"; data: T }
  | { status: "empty"; message?: string }
  | { status: "error"; message: string; isRateLimited?: boolean };
