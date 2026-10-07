import type { AdminAuditResponse } from "../types/adminAudit";

export async function fetchAdminAudit(
  {
    limit = 50,
    cursor,
    signal,
  }: {
    limit?: number;
    cursor?: string | null;
    signal?: AbortSignal;
  } = {},
): Promise<AdminAuditResponse> {
  const params = new URLSearchParams();
  if (limit !== 50) params.set("limit", String(limit));
  if (cursor) params.set("cursor", cursor);
  const query = params.toString();
  const response = await fetch(
    query ? `/admin/api/audit?${query}` : "/admin/api/audit",
    {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      signal,
    },
  );

  if (response.status === 401) {
    window.location.replace("/admin/login");
    throw new Error("ADMIN_SESSION_REQUIRED");
  }
  if (!response.ok) {
    let code = response.status === 429 ? "ADMIN_RATE_LIMITED" : "ADMIN_INTERNAL_ERROR";
    try {
      const body = (await response.json()) as {
        error?: { code?: string };
      };
      if (body?.error?.code) code = body.error.code;
    } catch {
      // Stable fallback above.
    }
    throw new Error(code);
  }
  return (await response.json()) as AdminAuditResponse;
}
