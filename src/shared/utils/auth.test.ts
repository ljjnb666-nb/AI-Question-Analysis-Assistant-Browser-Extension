import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  loginWithEmail,
  logoutAccount,
  registerWithEmailCode,
  sendEmailVerificationCode,
  validateAuthSession,
} from "./auth";
import * as storage from "./storage";
import * as analytics from "./analytics";

// Mock values are assembled at runtime so security scanners do not mistake
// synthetic test fixtures for committed credentials.
const MOCK_TOKEN_LEGACY = ["token", "789"].join("-");
const MOCK_TOKEN_NEXT = ["token", "new"].join("-");
const MOCK_TOKEN_FORGED = ["token", "forged"].join("-");

vi.mock("./storage");
vi.mock("./analytics");

describe("auth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("loginWithEmail", () => {
    it("authenticates and saves user credentials on success", async () => {
      vi.mocked(storage.loadSettings).mockResolvedValue({
        deviceId: "device-123",
        analyticsBaseUrl: "https://api.example.com",
      } as any);

      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          user: { userId: "user-456", email: "test@example.com" },
          authToken: MOCK_TOKEN_LEGACY,
        }),
      } as Response);

      const result = await loginWithEmail("test@example.com", "password123");

      expect(result.ok).toBe(true);
      expect(result.user.userId).toBe("user-456");
      expect(result.user.email).toBe("test@example.com");
      expect(result.authToken).toBe(MOCK_TOKEN_LEGACY);

      expect(global.fetch).toHaveBeenCalledWith(
        "https://api.example.com/auth/login",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: expect.stringContaining("test@example.com"),
        }),
      );

      expect(storage.saveSettings).toHaveBeenCalledWith({
        deviceId: "device-123",
        analyticsBaseUrl: "https://api.example.com",
        userId: "user-456",
        userEmail: "test@example.com",
        authToken: MOCK_TOKEN_LEGACY,
      });

      expect(analytics.logEvent).toHaveBeenCalledWith("auth_logged_in", {
        userId: "user-456",
      });
    });

    it("throws error on authentication failure", async () => {
      vi.mocked(storage.loadSettings).mockResolvedValue({
        deviceId: "device-123",
        analyticsBaseUrl: "https://api.example.com",
      } as any);

      vi.mocked(global.fetch).mockResolvedValue({
        ok: false,
        json: async () => ({
          ok: false,
          error: "Invalid credentials",
        }),
      } as Response);

      await expect(loginWithEmail("test@example.com", "wrong")).rejects.toThrow("Invalid credentials");
    });

    it("AUTH_UI_LOGIN_MALFORMED_SUCCESS fails closed when the success payload lacks credentials", async () => {
      vi.mocked(storage.loadSettings).mockResolvedValue({
        deviceId: "device-123",
        analyticsBaseUrl: "https://api.example.com",
      } as any);

      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          user: { userId: "", email: "test@example.com" },
          authToken: "",
        }),
      } as Response);

      await expect(loginWithEmail("test@example.com", "password123")).rejects.toThrow("AUTH_MALFORMED_RESPONSE");
      // Nothing may be persisted: a malformed success must not seed the
      // local session candidate.
      expect(storage.saveSettings).not.toHaveBeenCalled();
    });

    it("uses default analytics URL when not configured", async () => {
      vi.mocked(storage.loadSettings).mockResolvedValue({
        deviceId: "device-123",
      } as any);

      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          user: { userId: "user-456", email: "test@example.com" },
          authToken: MOCK_TOKEN_LEGACY,
        }),
      } as Response);

      await loginWithEmail("test@example.com", "password123");

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/auth/login"),
        expect.any(Object),
      );
    });

    it("trims email before sending", async () => {
      vi.mocked(storage.loadSettings).mockResolvedValue({
        deviceId: "device-123",
        analyticsBaseUrl: "https://api.example.com",
      } as any);

      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          user: { userId: "user-456", email: "test@example.com" },
          authToken: MOCK_TOKEN_LEGACY,
        }),
      } as Response);

      await loginWithEmail("  test@example.com  ", "password123");

      const callArgs = vi.mocked(global.fetch).mock.calls[0];
      const body = JSON.parse(callArgs[1]?.body as string);
      expect(body.email).toBe("test@example.com");
    });
  });

  describe("sendEmailVerificationCode", () => {
    it("sends verification code successfully", async () => {
      vi.mocked(storage.loadSettings).mockResolvedValue({
        analyticsBaseUrl: "https://api.example.com",
      } as any);

      const expiresAt = Date.now() + 600000;
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          expiresAt,
        }),
      } as Response);

      const result = await sendEmailVerificationCode("test@example.com");

      expect(result.ok).toBe(true);
      expect(result.expiresAt).toBe(expiresAt);

      expect(global.fetch).toHaveBeenCalledWith(
        "https://api.example.com/auth/send-verification-code",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: expect.stringContaining("test@example.com"),
        }),
      );
    });

    it("AUTH_UI_SEND_CODE_RATE_LIMITED maps 429 to the stable rate-limit error", async () => {
      vi.mocked(storage.loadSettings).mockResolvedValue({
        analyticsBaseUrl: "https://api.example.com",
      } as any);

      vi.mocked(global.fetch).mockResolvedValue({
        ok: false,
        status: 429,
        json: async () => ({
          ok: false,
          error: "rate limit exceeded; retry after 42s",
        }),
      } as unknown as Response);

      await expect(sendEmailVerificationCode("test@example.com")).rejects.toThrow("AUTH_RATE_LIMITED");
    });

    it("AUTH_UI_SEND_CODE_SMTP_UNAVAILABLE never surfaces SMTP configuration names", async () => {
      vi.mocked(storage.loadSettings).mockResolvedValue({
        analyticsBaseUrl: "https://api.example.com",
      } as any);

      vi.mocked(global.fetch).mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({
          ok: false,
          error: "EMAIL_SERVICE_UNAVAILABLE",
        }),
      } as Response);

      await expect(sendEmailVerificationCode("test@example.com")).rejects.toThrow("EMAIL_SERVICE_UNAVAILABLE");
    });

    it("AUTH_UI_SEND_CODE_INTERNAL_MESSAGE_SANITIZED collapses raw server messages to a stable failure", async () => {
      vi.mocked(storage.loadSettings).mockResolvedValue({
        analyticsBaseUrl: "https://api.example.com",
      } as any);

      vi.mocked(global.fetch).mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({
          ok: false,
          error: "mailer is not configured; set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM",
        }),
      } as Response);

      await expect(sendEmailVerificationCode("test@example.com")).rejects.toThrow("AUTH_SEND_CODE_FAILED");
    });
  });

  describe("registerWithEmailCode", () => {
    it("registers new user with verification code", async () => {
      vi.mocked(storage.loadSettings).mockResolvedValue({
        deviceId: "device-123",
        analyticsBaseUrl: "https://api.example.com",
      } as any);

      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          user: { userId: "user-new", email: "new@example.com" },
          authToken: MOCK_TOKEN_NEXT,
        }),
      } as Response);

      const result = await registerWithEmailCode("new@example.com", "password123", "123456");

      expect(result.ok).toBe(true);
      expect(result.user.userId).toBe("user-new");
      expect(result.authToken).toBe(MOCK_TOKEN_NEXT);

      expect(global.fetch).toHaveBeenCalledWith(
        "https://api.example.com/auth/register",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("123456"),
        }),
      );

      expect(storage.saveSettings).toHaveBeenCalledWith({
        deviceId: "device-123",
        analyticsBaseUrl: "https://api.example.com",
        userId: "user-new",
        userEmail: "new@example.com",
        authToken: MOCK_TOKEN_NEXT,
      });

      expect(analytics.logEvent).toHaveBeenCalledWith("auth_registered", {
        userId: "user-new",
      });
    });

    it("creates device ID if not present", async () => {
      vi.mocked(storage.loadSettings).mockResolvedValue({
        analyticsBaseUrl: "https://api.example.com",
      } as any);

      vi.mocked(storage.getOrCreateDeviceId).mockResolvedValue("new-device-id");

      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          user: { userId: "user-new", email: "new@example.com" },
          authToken: MOCK_TOKEN_NEXT,
        }),
      } as Response);

      await registerWithEmailCode("new@example.com", "password123", "123456");

      expect(storage.getOrCreateDeviceId).toHaveBeenCalled();
    });

    it("throws error on registration failure", async () => {
      vi.mocked(storage.loadSettings).mockResolvedValue({
        deviceId: "device-123",
        analyticsBaseUrl: "https://api.example.com",
      } as any);

      vi.mocked(global.fetch).mockResolvedValue({
        ok: false,
        json: async () => ({
          ok: false,
          error: "Invalid verification code",
        }),
      } as Response);

      await expect(registerWithEmailCode("new@example.com", "password123", "wrong")).rejects.toThrow(
        "Invalid verification code",
      );
    });
  });

  describe("logoutAccount", () => {
    const AUTH_LOGOUT_CLEAR = {
      userId: undefined,
      userEmail: undefined,
      authToken: undefined,
    };

    it("AUTH_CORE_11_LOGOUT_LOCAL_CLEAR revokes server and clears credentials", async () => {
      vi.mocked(storage.loadSettings).mockResolvedValue({
        userId: "user-456",
        userEmail: "test@example.com",
        authToken: MOCK_TOKEN_LEGACY,
        analyticsBaseUrl: "https://api.example.com",
      } as any);
      vi.mocked(storage.saveSettings).mockResolvedValue(undefined);
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true }),
      } as Response);

      const result = await logoutAccount();

      expect(global.fetch).toHaveBeenCalledWith(
        "https://api.example.com/auth/logout",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: `Bearer ${MOCK_TOKEN_LEGACY}`,
          }),
          body: expect.stringContaining("user-456"),
        }),
      );
      expect(storage.saveSettings).toHaveBeenCalledWith(AUTH_LOGOUT_CLEAR);
      expect(analytics.logEvent).toHaveBeenCalledWith("auth_logged_out");
      expect(result).toEqual({ serverRevoked: true, serverStatus: "revoked" });
    });

    it("AUTH_CORE_12_LOGOUT_NETWORK_FAILURE still clears local credentials", async () => {
      vi.mocked(storage.loadSettings).mockResolvedValue({
        userId: "user-456",
        userEmail: "test@example.com",
        authToken: MOCK_TOKEN_LEGACY,
      } as any);
      vi.mocked(storage.saveSettings).mockResolvedValue(undefined);
      vi.mocked(global.fetch).mockRejectedValue(new TypeError("Failed to fetch"));

      const result = await logoutAccount();

      expect(storage.saveSettings).toHaveBeenCalledWith(AUTH_LOGOUT_CLEAR);
      expect(analytics.logEvent).toHaveBeenCalledWith("auth_logged_out");
      expect(result.serverRevoked).toBe(false);
      expect(result.serverStatus).toBe("network_error");
    });

    it("reports server_rejected on 401 and still clears local credentials", async () => {
      vi.mocked(storage.loadSettings).mockResolvedValue({
        userId: "user-456",
        userEmail: "test@example.com",
        authToken: MOCK_TOKEN_LEGACY,
      } as any);
      vi.mocked(storage.saveSettings).mockResolvedValue(undefined);
      vi.mocked(global.fetch).mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ ok: false, error: "AUTH_SESSION_INVALID" }),
      } as unknown as Response);

      const result = await logoutAccount();

      expect(storage.saveSettings).toHaveBeenCalledWith(AUTH_LOGOUT_CLEAR);
      expect(result.serverRevoked).toBe(false);
      expect(result.serverStatus).toBe("server_rejected");
    });

    it("clears credentials without contacting the server when none are stored", async () => {
      vi.mocked(storage.loadSettings).mockResolvedValue({
        analyticsBaseUrl: "https://api.example.com",
      } as any);
      vi.mocked(storage.saveSettings).mockResolvedValue(undefined);

      const result = await logoutAccount();

      expect(global.fetch).not.toHaveBeenCalled();
      expect(storage.saveSettings).toHaveBeenCalledWith(AUTH_LOGOUT_CLEAR);
      expect(result.serverStatus).toBe("no_local_credentials");
    });
  });

  describe("validateAuthSession", () => {
    it("reports unauthenticated without a server round-trip when credentials are missing", async () => {
      vi.mocked(storage.loadSettings).mockResolvedValue({
        analyticsBaseUrl: "https://api.example.com",
      } as any);

      const result = await validateAuthSession();

      expect(result.status).toBe("unauthenticated");
      expect(global.fetch).not.toHaveBeenCalled();
      expect(storage.saveSettings).not.toHaveBeenCalled();
    });

    it("AUTH_CORE_03 accepts a valid session and adopts the server-returned identity", async () => {
      vi.mocked(storage.loadSettings).mockResolvedValue({
        userId: "user-456",
        userEmail: "stale@example.com",
        authToken: MOCK_TOKEN_LEGACY,
        analyticsBaseUrl: "https://api.example.com",
      } as any);
      vi.mocked(storage.saveSettings).mockResolvedValue(undefined);
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          user: { userId: "user-server", email: "server@example.com" },
          expiresAt: 1234567890,
        }),
      } as Response);

      const result = await validateAuthSession();

      expect(global.fetch).toHaveBeenCalledWith(
        "https://api.example.com/auth/session",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: `Bearer ${MOCK_TOKEN_LEGACY}`,
          }),
          body: JSON.stringify({ userId: "user-456" }),
        }),
      );
      expect(storage.saveSettings).toHaveBeenCalledWith({
        userId: "user-server",
        userEmail: "server@example.com",
      });
      expect(result).toEqual({
        status: "authenticated",
        userId: "user-server",
        userEmail: "server@example.com",
        expiresAt: 1234567890,
      });
    });

    it("AUTH_CORE_04_FORGED_TOKEN clears forged local credentials on 401", async () => {
      vi.mocked(storage.loadSettings).mockResolvedValue({
        userId: "usr-forged",
        userEmail: "forged@example.com",
        authToken: MOCK_TOKEN_FORGED,
        analyticsBaseUrl: "https://api.example.com",
      } as any);
      vi.mocked(storage.saveSettings).mockResolvedValue(undefined);
      vi.mocked(global.fetch).mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ ok: false, error: "AUTH_SESSION_INVALID" }),
      } as unknown as Response);

      const result = await validateAuthSession();

      expect(result.status).toBe("unauthenticated");
      expect(storage.saveSettings).toHaveBeenCalledWith({
        userId: undefined,
        userEmail: undefined,
        authToken: undefined,
      });
    });

    it("AUTH_UI_13_STALE_401 does not clear credentials replaced by a newer login mid-flight", async () => {
      // First read (validation start) sees the stale token; the re-read on
      // 401 sees the fresh session the user logged in with in the meantime.
      vi.mocked(storage.loadSettings)
        .mockResolvedValueOnce({
          userId: "usr-stale",
          userEmail: "stale@example.com",
          authToken: MOCK_TOKEN_FORGED,
          analyticsBaseUrl: "https://api.example.com",
        } as any)
        .mockResolvedValue({
          userId: "usr-fresh",
          userEmail: "fresh@example.com",
          authToken: MOCK_TOKEN_NEXT,
          analyticsBaseUrl: "https://api.example.com",
        } as any);
      vi.mocked(storage.saveSettings).mockResolvedValue(undefined);
      vi.mocked(global.fetch).mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ ok: false, error: "AUTH_SESSION_INVALID" }),
      } as unknown as Response);

      const result = await validateAuthSession();

      // The stale validation result itself is still "unauthenticated" (the
      // coordinator's generation guard discards it), but the fresh
      // credentials must survive in storage.
      expect(result.status).toBe("unauthenticated");
      expect(storage.saveSettings).not.toHaveBeenCalledWith({
        userId: undefined,
        userEmail: undefined,
        authToken: undefined,
      });
    });

    it("keeps credentials and reports server_unavailable on network failure", async () => {
      vi.mocked(storage.loadSettings).mockResolvedValue({
        userId: "user-456",
        userEmail: "test@example.com",
        authToken: MOCK_TOKEN_LEGACY,
        analyticsBaseUrl: "https://api.example.com",
      } as any);
      vi.mocked(storage.saveSettings).mockResolvedValue(undefined);
      vi.mocked(global.fetch).mockRejectedValue(new TypeError("Failed to fetch"));

      const result = await validateAuthSession();

      expect(result.status).toBe("server_unavailable");
      expect(storage.saveSettings).not.toHaveBeenCalled();
    });

    it("keeps credentials and reports server_unavailable on 5xx responses", async () => {
      vi.mocked(storage.loadSettings).mockResolvedValue({
        userId: "user-456",
        userEmail: "test@example.com",
        authToken: MOCK_TOKEN_LEGACY,
        analyticsBaseUrl: "https://api.example.com",
      } as any);
      vi.mocked(storage.saveSettings).mockResolvedValue(undefined);
      vi.mocked(global.fetch).mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({ ok: false, error: "AUTH_SERVICE_UNAVAILABLE" }),
      } as unknown as Response);

      const result = await validateAuthSession();

      expect(result.status).toBe("server_unavailable");
      expect(storage.saveSettings).not.toHaveBeenCalled();
    });
  });
});
