export type AdminSessionState =
  | { kind: "checking" }
  | { kind: "authorized"; expiresAt: number }
  | { kind: "unauthorized" }
  | { kind: "unavailable" };

type SessionPayload = {
  ok?: boolean;
  session?: { expiresAt?: unknown };
};

// The only Admin API call in this phase. A 401 is treated as authoritative
// session loss: the caller must stop rendering protected state and hand the
// browser back to the server-rendered login.
export async function fetchAdminSession(): Promise<AdminSessionState> {
  try {
    const response = await fetch("/admin/api/session", {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (response.status === 401) return { kind: "unauthorized" };
    if (!response.ok) return { kind: "unavailable" };
    const payload: SessionPayload = await response.json();
    const expiresAt = Number(payload?.session?.expiresAt);
    if (payload?.ok !== true || !Number.isFinite(expiresAt)) return { kind: "unavailable" };
    return { kind: "authorized", expiresAt };
  } catch {
    return { kind: "unavailable" };
  }
}
