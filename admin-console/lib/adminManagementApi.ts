import type {
  AdminSystemResponse,
  AdminUsersResponse,
  FetchAdminUsersOptions,
} from "../types/adminManagement";

export async function fetchAdminManagementJson<T>(
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

export async function fetchAdminUsers(
  options: FetchAdminUsersOptions = {},
): Promise<AdminUsersResponse> {
  const { limit = 50, cursor, q, signal } = options;
  const params = new URLSearchParams();

  if (limit && limit !== 50) {
    params.set("limit", String(limit));
  }
  if (cursor) {
    params.set("cursor", cursor);
  }
  if (q && q.trim()) {
    params.set("q", q.trim());
  }

  const queryString = params.toString();
  const url = queryString ? `/admin/api/users?${queryString}` : "/admin/api/users";

  return fetchAdminManagementJson<AdminUsersResponse>(url, signal);
}

export async function fetchAdminSystem(
  signal?: AbortSignal,
): Promise<AdminSystemResponse> {
  return fetchAdminManagementJson<AdminSystemResponse>("/admin/api/system", signal);
}
