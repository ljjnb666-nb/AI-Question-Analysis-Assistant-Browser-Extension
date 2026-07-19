import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { loginWithEmail, registerWithEmailCode, sendEmailVerificationCode, logoutAccount } from "./auth";
import * as storage from "./storage";
import * as analytics from "./analytics";

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
          authToken: "token-789",
        }),
      } as Response);

      const result = await loginWithEmail("test@example.com", "password123");

      expect(result.ok).toBe(true);
      expect(result.user.userId).toBe("user-456");
      expect(result.user.email).toBe("test@example.com");
      expect(result.authToken).toBe("token-789");

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
        authToken: "token-789",
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

    it("uses default analytics URL when not configured", async () => {
      vi.mocked(storage.loadSettings).mockResolvedValue({
        deviceId: "device-123",
      } as any);

      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          user: { userId: "user-456", email: "test@example.com" },
          authToken: "token-789",
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
          authToken: "token-789",
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

    it("throws error when code sending fails", async () => {
      vi.mocked(storage.loadSettings).mockResolvedValue({
        analyticsBaseUrl: "https://api.example.com",
      } as any);

      vi.mocked(global.fetch).mockResolvedValue({
        ok: false,
        json: async () => ({
          ok: false,
          error: "Rate limit exceeded",
        }),
      } as Response);

      await expect(sendEmailVerificationCode("test@example.com")).rejects.toThrow("Rate limit exceeded");
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
          authToken: "token-new",
        }),
      } as Response);

      const result = await registerWithEmailCode("new@example.com", "password123", "123456");

      expect(result.ok).toBe(true);
      expect(result.user.userId).toBe("user-new");
      expect(result.authToken).toBe("token-new");

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
        authToken: "token-new",
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
          authToken: "token-new",
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
    it("clears user credentials on logout", async () => {
      vi.mocked(storage.saveSettings).mockResolvedValue(undefined);

      await logoutAccount();

      expect(storage.saveSettings).toHaveBeenCalledWith({
        userId: undefined,
        userEmail: undefined,
        authToken: undefined,
      });

      expect(analytics.logEvent).toHaveBeenCalledWith("auth_logged_out");
    });
  });
});
