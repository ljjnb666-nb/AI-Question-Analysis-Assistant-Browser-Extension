import type {
  AdminAnalyticsDays,
  AdminErrorsResponse,
  AdminLatencyResponse,
  AdminOverviewResponse,
  AdminProvidersResponse,
  AdminTimeseriesResponse,
  AdminVersionsResponse,
} from "../types/adminAnalytics";

export async function fetchAdminJson<T>(
  url: string,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(url, {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
    signal,
  });

  if (response.status === 401) {
    window.location.replace("/admin/login");
    throw new Error("ADMIN_SESSION_REQUIRED");
  }

  if (!response.ok) {
    let errorCode =
      response.status === 429 ? "ADMIN_RATE_LIMITED" : "ADMIN_INTERNAL_ERROR";
    try {
      const body = (await response.json()) as {
        ok?: boolean;
        error?: { code?: string };
      };
      if (body?.error?.code) {
        errorCode = body.error.code;
      }
    } catch {
      // JSON parse fallback
    }
    throw new Error(errorCode);
  }

  return (await response.json()) as T;
}

export async function fetchAdminOverview(
  days: AdminAnalyticsDays = 14,
  signal?: AbortSignal,
): Promise<AdminOverviewResponse> {
  return fetchAdminJson<AdminOverviewResponse>(
    `/admin/api/overview?days=${days}`,
    signal,
  );
}

export async function fetchAdminTimeseries(
  days: AdminAnalyticsDays = 14,
  signal?: AbortSignal,
): Promise<AdminTimeseriesResponse> {
  return fetchAdminJson<AdminTimeseriesResponse>(
    `/admin/api/analytics/timeseries?days=${days}`,
    signal,
  );
}

export async function fetchAdminProviders(
  days: AdminAnalyticsDays = 14,
  signal?: AbortSignal,
): Promise<AdminProvidersResponse> {
  return fetchAdminJson<AdminProvidersResponse>(
    `/admin/api/analytics/providers?days=${days}`,
    signal,
  );
}

export async function fetchAdminErrors(
  days: AdminAnalyticsDays = 14,
  signal?: AbortSignal,
): Promise<AdminErrorsResponse> {
  return fetchAdminJson<AdminErrorsResponse>(
    `/admin/api/analytics/errors?days=${days}`,
    signal,
  );
}

export async function fetchAdminVersions(
  days: AdminAnalyticsDays = 14,
  signal?: AbortSignal,
): Promise<AdminVersionsResponse> {
  return fetchAdminJson<AdminVersionsResponse>(
    `/admin/api/analytics/versions?days=${days}`,
    signal,
  );
}

export async function fetchAdminLatency(
  days: AdminAnalyticsDays = 14,
  signal?: AbortSignal,
): Promise<AdminLatencyResponse> {
  return fetchAdminJson<AdminLatencyResponse>(
    `/admin/api/analytics/latency?days=${days}`,
    signal,
  );
}
