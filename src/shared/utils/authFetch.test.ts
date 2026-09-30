import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchJsonWithTimeout, type AuthRequestError } from "./authFetch";

describe("authFetch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("AUTH_UI_SEND_CODE_TIMEOUT rejects with a stable timeout error when the server never answers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      })),
    );

    const pending = fetchJsonWithTimeout("https://api.example.com/auth/send-verification-code", {
      method: "POST",
    }, 5_000);

    const assertion = expect(pending).rejects.toThrow("AUTH_REQUEST_TIMEOUT");
    await vi.advanceTimersByTimeAsync(5_001);
    await assertion;
    const error = await pending.catch((err: unknown) => err as AuthRequestError);
    expect((error as AuthRequestError).kind).toBe("timeout");
  });

  it("maps network failures to the stable network error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }));

    await expect(fetchJsonWithTimeout("https://api.example.com/auth/session", { method: "POST" })).rejects.toThrow(
      "AUTH_NETWORK_ERROR",
    );
  });

  it("parses json payloads and preserves status for ok:false responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 429,
        json: async () => ({ ok: false, error: "rate limit exceeded; retry after 30s" }),
      })),
    );

    const result = await fetchJsonWithTimeout("https://api.example.com/auth/login", { method: "POST" });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(429);
  });

  it("returns a null payload when the body is not json instead of throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError("Unexpected token");
        },
      })),
    );

    const result = await fetchJsonWithTimeout("https://api.example.com/auth/logout", { method: "POST" });
    expect(result.ok).toBe(true);
    expect(result.payload).toBeNull();
  });
});
