const VOLATILE_QUERY_KEYS = new Set([
  "timestamp", "ts", "cache", "cachebust", "cache_bust", "cb", "_", "expires", "signature",
  "x-amz-signature", "x-amz-credential", "x-amz-date", "x-amz-expires", "token", "access_token",
]);

/** Removes volatile credentials while retaining resource and semantic query identity. */
export function sanitizeMediaUrlForSerialization(raw?: string): string | undefined {
  const value = String(raw || "").trim();
  if (!value) return undefined;
  if (/^media:\/\//i.test(value)) return value;
  if (/^(?:data:|blob:)/i.test(value)) return undefined;
  try {
    const url = new URL(value, typeof window === "undefined" ? "https://invalid.local" : window.location.href);
    if (!/^https?:$/i.test(url.protocol)) return undefined;
    url.hash = "";
    for (const key of Array.from(url.searchParams.keys())) {
      if (VOLATILE_QUERY_KEYS.has(key.toLowerCase()) || key.toLowerCase().startsWith("utm_")) url.searchParams.delete(key);
    }
    const normalized = Array.from(url.searchParams.entries()).sort(([a, av], [b, bv]) => a.localeCompare(b) || av.localeCompare(bv));
    url.search = normalized.length ? `?${new URLSearchParams(normalized).toString()}` : "";
    return url.toString();
  } catch { return undefined; }
}

export function canonicalizeMediaUrl(raw?: string): string {
  return sanitizeMediaUrlForSerialization(raw) ?? "";
}
