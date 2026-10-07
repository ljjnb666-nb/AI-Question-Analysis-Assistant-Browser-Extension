import React from "react";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { AdminApp, normalizePath } from "./main";
import { AdminShell } from "./components/AdminShell";
import { SessionStatus } from "./components/SessionStatus";
import { LatencyChart } from "./components/analytics/LatencyChart";
import {
  formatDuration,
  formatNumber,
  formatPercent,
  formatProviderName,
  formatErrorCategory,
  getAdminErrorMessage,
  getLatestGeneratedAt,
} from "./lib/adminAnalyticsFormat";
import {
  formatAdminDateTime,
  formatUptimeDuration,
  getUsersErrorMessage,
  getSystemErrorMessage,
} from "./lib/adminManagementFormat";
import type {
  AdminOverviewResponse,
  AdminTimeseriesResponse,
  AdminProvidersResponse,
  AdminErrorsResponse,
  AdminVersionsResponse,
  AdminLatencyResponse,
} from "./types/adminAnalytics";
import type {
  AdminUsersResponse,
  AdminSystemResponse,
} from "./types/adminManagement";

const MOCK_OVERVIEW: AdminOverviewResponse = {
  ok: true,
  generatedAt: "2026-10-07T10:00:00.000Z",
  analyticsScope: "opt_in_only",
  accountScope: "all_registered_accounts",
  window: {
    days: 14,
    from: "2026-09-24T00:00:00.000Z",
    to: "2026-10-07T10:00:00.000Z",
    retentionDays: 90,
  },
  activity: {
    dau: 120,
    wau: 450,
    mau: 1280,
  },
  accounts: {
    registeredUsers: 3500,
    registrationsToday: 25,
  },
  observed: {
    installDevicesToday: 18,
    parseOutcomeDevicesToday: 95,
    parseOutcomesToday: {
      success: 320,
      error: 40,
      total: 360,
      successRatio: 320 / 360,
    },
    parseOutcomeLatencyWindowMs: {
      samples: 4200,
      average: 350.5,
    },
  },
};

const MOCK_TIMESERIES: AdminTimeseriesResponse = {
  ok: true,
  kind: "timeseries",
  metric: "observed_activity_and_parse_outcomes",
  generatedAt: "2026-10-07T10:00:00.000Z",
  analyticsScope: "opt_in_only",
  accountScope: "all_registered_accounts",
  window: {
    days: 14,
    from: "2026-09-24T00:00:00.000Z",
    to: "2026-10-07T10:00:00.000Z",
    retentionDays: 90,
  },
  data: [
    {
      date: "2026-10-06",
      optInDau: 110,
      observedInstallDevices: 15,
      parseSuccesses: 290,
      parseErrors: 30,
      parseOutcomeSuccessRatio: 290 / 320,
      registrations: 20,
    },
    {
      date: "2026-10-07",
      optInDau: 120,
      observedInstallDevices: 18,
      parseSuccesses: 320,
      parseErrors: 40,
      parseOutcomeSuccessRatio: 320 / 360,
      registrations: 25,
    },
  ],
};

const MOCK_PROVIDERS: AdminProvidersResponse = {
  ok: true,
  kind: "providers",
  metric: "observed_parse_outcomes_by_provider",
  generatedAt: "2026-10-07T10:00:00.000Z",
  analyticsScope: "opt_in_only",
  window: {
    days: 14,
    from: "2026-09-24T00:00:00.000Z",
    to: "2026-10-07T10:00:00.000Z",
    retentionDays: 90,
  },
  data: [
    {
      provider: "openai",
      success: 500,
      error: 50,
      outcomes: 550,
      successRatio: 500 / 550,
    },
    {
      provider: "deepseek",
      success: 300,
      error: 30,
      outcomes: 330,
      successRatio: 300 / 330,
    },
  ],
};

const MOCK_ERRORS: AdminErrorsResponse = {
  ok: true,
  kind: "errors",
  metric: "observed_parse_errors_by_category",
  generatedAt: "2026-10-07T10:00:00.000Z",
  analyticsScope: "opt_in_only",
  window: {
    days: 14,
    from: "2026-09-24T00:00:00.000Z",
    to: "2026-10-07T10:00:00.000Z",
    retentionDays: 90,
  },
  data: [
    {
      category: "timeout",
      count: 45,
      exhaustedCount: 12,
    },
    {
      category: "network",
      count: 25,
      exhaustedCount: 5,
    },
  ],
};

const MOCK_VERSIONS: AdminVersionsResponse = {
  ok: true,
  kind: "versions",
  metric: "latest_observed_version_per_opt_in_device",
  generatedAt: "2026-10-07T10:00:00.000Z",
  analyticsScope: "opt_in_only",
  window: {
    days: 14,
    from: "2026-09-24T00:00:00.000Z",
    to: "2026-10-07T10:00:00.000Z",
    retentionDays: 90,
  },
  data: [
    {
      extensionVersion: "0.2.0",
      devices: 98,
    },
    {
      extensionVersion: "0.1.9",
      devices: 14,
    },
  ],
};

const MOCK_LATENCY: AdminLatencyResponse = {
  ok: true,
  kind: "latency",
  metric: "observed_parse_outcome_duration_ms",
  generatedAt: "2026-10-07T10:00:00.000Z",
  analyticsScope: "opt_in_only",
  window: {
    days: 14,
    from: "2026-09-24T00:00:00.000Z",
    to: "2026-10-07T10:00:00.000Z",
    retentionDays: 90,
  },
  data: [
    {
      date: "2026-10-06",
      samples: 320,
      averageMs: 340.2,
    },
    {
      date: "2026-10-07",
      samples: 360,
      averageMs: 360.8,
    },
  ],
};

const MOCK_USERS: AdminUsersResponse = {
  ok: true,
  generatedAt: "2026-10-07T10:00:00.000Z",
  data: [
    {
      userId: "user_alice_123456",
      email: "alice@example.com",
      createdAt: "2026-09-01T08:30:00.000Z",
      linkedDeviceCount: 2,
      latestDeviceSeenAt: "2026-10-07T09:45:00.000Z",
    },
    {
      userId: "user_bob_789012",
      email: "bob@example.com",
      createdAt: "2026-09-15T12:00:00.000Z",
      linkedDeviceCount: 0,
      latestDeviceSeenAt: null,
    },
  ],
  page: {
    limit: 50,
    nextCursor: "opaque-next-cursor-token-123",
  },
  query: {
    q: null,
  },
};

const MOCK_SYSTEM_SQLITE: AdminSystemResponse = {
  ok: true,
  generatedAt: "2026-10-07T10:00:00.000Z",
  service: {
    status: "ok",
    uptimeSeconds: 187400, // 2 days 4 hours
  },
  storage: {
    driver: "sqlite",
  },
  email: {
    configured: true,
  },
  deployment: {
    authority: "single_process",
  },
  analytics: {
    retentionDays: 90,
    privacyEpoch: 1,
  },
};

const MOCK_SYSTEM_JSON: AdminSystemResponse = {
  ok: true,
  generatedAt: "2026-10-07T10:00:00.000Z",
  service: {
    status: "ok",
    uptimeSeconds: 45, // 45 seconds
  },
  storage: {
    driver: "json",
  },
  email: {
    configured: false,
  },
  deployment: {
    authority: "single_process",
  },
  analytics: {
    retentionDays: 90,
    privacyEpoch: 1,
  },
};

describe("Admin Console UI & Analytics UI Tests", () => {
  const originalLocation = window.location;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
  });

  describe("Formatters and Mapping Helpers", () => {
    it("formats numbers with thousand separators", () => {
      expect(formatNumber(1284)).toBe("1,284");
      expect(formatNumber(0)).toBe("0");
      expect(formatNumber(null)).toBe("0");
      expect(formatNumber(undefined, "—")).toBe("—");
    });

    it("formats ratios accurately with max 1 decimal place and handles null safely", () => {
      expect(formatPercent(1)).toBe("100%");
      expect(formatPercent(0)).toBe("0%");
      expect(formatPercent(0.8734)).toBe("87.3%");
      expect(formatPercent(0.87)).toBe("87%");
      expect(formatPercent(null)).toBe("—");
      expect(formatPercent(null, "暂无样本")).toBe("暂无样本");
    });

    it("formats durations accurately in ms or s and handles null safely", () => {
      expect(formatDuration(250)).toBe("250 ms");
      expect(formatDuration(999)).toBe("999 ms");
      expect(formatDuration(1000)).toBe("1.00 s");
      expect(formatDuration(1534)).toBe("1.53 s");
      expect(formatDuration(null)).toBe("—");
      expect(formatDuration(null, "暂无样本")).toBe("暂无样本");
    });

    it("maps provider names to user-friendly Chinese and brand display names", () => {
      expect(formatProviderName("openai")).toBe("OpenAI");
      expect(formatProviderName("anthropic")).toBe("Anthropic");
      expect(formatProviderName("deepseek")).toBe("DeepSeek");
      expect(formatProviderName("zhipu")).toBe("智谱");
      expect(formatProviderName("minimax")).toBe("MiniMax");
      expect(formatProviderName("custom")).toBe("自定义");
    });

    it("maps error categories to user-friendly Chinese names", () => {
      expect(formatErrorCategory("timeout")).toBe("超时");
      expect(formatErrorCategory("network")).toBe("网络错误");
      expect(formatErrorCategory("http_4xx")).toBe("请求错误（4xx）");
      expect(formatErrorCategory("http_5xx")).toBe("服务错误（5xx）");
      expect(formatErrorCategory("unknown")).toBe("未知错误");
    });

    it("converts internal error codes into user-friendly Chinese product copy without raw dumps", () => {
      expect(getAdminErrorMessage("ADMIN_RATE_LIMITED")).toBe(
        "请求过于频繁，请稍后重试",
      );
      expect(getAdminErrorMessage("ADMIN_STORAGE_UNAVAILABLE")).toBe(
        "数据暂时不可用，请稍后重试",
      );
      expect(getAdminErrorMessage("ADMIN_INTERNAL_ERROR")).toBe(
        "数据加载失败，请稍后重试",
      );
    });
  });

  describe("normalizePath helper", () => {
    it("normalizes root and trailing slashes correctly", () => {
      expect(normalizePath("/admin")).toBe("/admin");
      expect(normalizePath("/admin/")).toBe("/admin");
      expect(normalizePath("/admin/analytics/")).toBe("/admin/analytics");
      expect(normalizePath("/admin/users///")).toBe("/admin/users");
      expect(normalizePath("")).toBe("/admin");
    });
  });

  describe("Session & Loading States", () => {
    it("renders loading state with aria-live and professional prompt", () => {
      vi.spyOn(globalThis, "fetch").mockImplementation(
        () => new Promise(() => {}),
      );

      render(<AdminApp />);

      const loadingContainer = screen.getByText("正在验证管理员会话…");
      expect(loadingContainer).toBeDefined();
      const liveRegion = screen.getByRole("main");
      expect(liveRegion.getAttribute("aria-live")).toBe("polite");
    });

    it("redirects to /admin/login when session API returns 401", async () => {
      const replaceMock = vi.fn();
      Object.defineProperty(window, "location", {
        configurable: true,
        value: {
          ...originalLocation,
          pathname: "/admin",
          replace: replaceMock,
        },
      });

      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: false,
        status: 401,
      } as Response);

      render(<AdminApp />);

      await waitFor(() => {
        expect(replaceMock).toHaveBeenCalledWith("/admin/login");
      });
    });

    it("renders professional error state on session fetch failure with reload button", async () => {
      const reloadMock = vi.fn();
      Object.defineProperty(window, "location", {
        configurable: true,
        value: {
          ...originalLocation,
          pathname: "/admin",
          reload: reloadMock,
        },
      });

      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: false,
        status: 500,
      } as Response);

      render(<AdminApp />);

      await waitFor(() => {
        expect(screen.getByRole("alert")).toBeDefined();
      });

      expect(
        screen.getByText("管理后台暂时不可用。请刷新页面后重试。"),
      ).toBeDefined();
      const retryBtn = screen.getByRole("button", { name: /刷新页面/i });
      expect(retryBtn).toBeDefined();

      fireEvent.click(retryBtn);
      expect(reloadMock).toHaveBeenCalledTimes(1);
    });

    it("formats session expiration gracefully without raw ISO string or fake identity", () => {
      render(<SessionStatus expiresAt="2026-10-07T15:30:00.000Z" />);
      expect(screen.getByText("管理员会话")).toBeDefined();
      expect(screen.queryByText("2026-10-07T15:30:00.000Z")).toBeNull();
      expect(screen.getByText(/本次会话将在 \d{2}:\d{2} 到期/)).toBeDefined();
    });

    it("falls back to 会话有效 when expiresAt is null or invalid", () => {
      render(<SessionStatus expiresAt={null} />);
      expect(screen.getByText("会话有效")).toBeDefined();

      const { container } = render(<SessionStatus expiresAt="invalid-date" />);
      expect(container.textContent).toContain("会话有效");
    });
  });

  describe("Overview View (/admin)", () => {
    it("renders live authoritative overview KPIs, ratios, latency, and scope disclosures", async () => {
      vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
        const url = String(input);
        if (url.includes("/admin/api/overview")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => MOCK_OVERVIEW,
          } as Response);
        }
        return Promise.reject(new Error("Unknown route"));
      });

      render(<AdminShell currentPath="/admin" expiresAt={null} />);

      // Top KPIs
      await waitFor(() => {
        expect(screen.getByText("今日已授权活跃设备")).toBeDefined();
        expect(screen.getByText("120")).toBeDefined();
        expect(screen.getByText("7 日已授权活跃设备")).toBeDefined();
        expect(screen.getByText("450")).toBeDefined();
        expect(screen.getByText("30 日已授权活跃设备")).toBeDefined();
        expect(screen.getByText("1,280")).toBeDefined();
        expect(screen.getByText("注册用户总数")).toBeDefined();
        expect(screen.getByText("3,500")).toBeDefined();
      });

      // Second row
      expect(screen.getByText("今日新注册")).toBeDefined();
      expect(screen.getByText("25")).toBeDefined();
      expect(screen.getByText("今日观测安装设备")).toBeDefined();
      expect(screen.getByText("18")).toBeDefined();
      expect(screen.getByText("今日产生解析结果的设备")).toBeDefined();
      expect(screen.getByText("95")).toBeDefined();
      expect(screen.getByText("今日解析结果数")).toBeDefined();
      expect(screen.getByText("360")).toBeDefined();

      // Ratios & Latency
      expect(screen.getByText("今日观测解析结果成功率")).toBeDefined();
      expect(screen.getByText("88.9%")).toBeDefined();
      expect(screen.getByText("平均观测解析耗时")).toBeDefined();
      expect(screen.getByText("351 ms")).toBeDefined();

      // Scope Disclosure
      expect(
        screen.getByText(/活动与解析指标仅基于已授权匿名统计数据/),
      ).toBeDefined();
      expect(screen.getByText(/统计日期按 UTC 聚合/)).toBeDefined();

      // No old placeholder copy
      expect(screen.queryByText("概览数据尚未接入")).toBeNull();
      expect(screen.queryByText("等待数据接入")).toBeNull();
    });

    it("handles null success ratio safely (shows 暂无样本 / — and never 0%)", async () => {
      const nullRatioOverview: AdminOverviewResponse = {
        ...MOCK_OVERVIEW,
        observed: {
          ...MOCK_OVERVIEW.observed,
          parseOutcomesToday: {
            success: 0,
            error: 0,
            total: 0,
            successRatio: null,
          },
          parseOutcomeLatencyWindowMs: {
            samples: 0,
            average: null,
          },
        },
      };

      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => nullRatioOverview,
      } as Response);

      render(<AdminShell currentPath="/admin" expiresAt={null} />);

      await waitFor(() => {
        expect(screen.getByText("今日观测解析结果成功率")).toBeDefined();
      });

      // Should show "暂无样本", NOT "0%"
      const samplesNotices = screen.getAllByText("暂无样本");
      expect(samplesNotices.length).toBeGreaterThanOrEqual(2);
      expect(screen.queryByText("0%")).toBeNull();
      expect(screen.queryByText("0 ms")).toBeNull();
    });

    it("redirects to /admin/login when overview API returns 401", async () => {
      const replaceMock = vi.fn();
      Object.defineProperty(window, "location", {
        configurable: true,
        value: {
          ...originalLocation,
          pathname: "/admin",
          replace: replaceMock,
        },
      });

      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: false,
        status: 401,
      } as Response);

      render(<AdminShell currentPath="/admin" expiresAt={null} />);

      await waitFor(() => {
        expect(replaceMock).toHaveBeenCalledWith("/admin/login");
      });
    });

    it("renders friendly error message and allows manual refresh on overview failure", async () => {
      let callCount = 0;
      vi.spyOn(globalThis, "fetch").mockImplementation(() => {
        callCount += 1;
        if (callCount === 1) {
          return Promise.resolve({
            ok: false,
            status: 503,
            json: async () => ({
              ok: false,
              error: { code: "ADMIN_STORAGE_UNAVAILABLE" },
            }),
          } as Response);
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => MOCK_OVERVIEW,
        } as Response);
      });

      render(<AdminShell currentPath="/admin" expiresAt={null} />);

      await waitFor(() => {
        expect(screen.getByText("数据暂时不可用，请稍后重试")).toBeDefined();
      });

      const retryBtn = screen.getByRole("button", { name: "重试" });
      fireEvent.click(retryBtn);

      await waitFor(() => {
        expect(screen.getByText("今日已授权活跃设备")).toBeDefined();
        expect(screen.getByText("120")).toBeDefined();
      });
    });
  });

  describe("Analytics View (/admin/analytics)", () => {
    it("renders live analytics charts, provider distribution, error breakdown, versions, and latency with default 14 days", async () => {
      vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
        const url = String(input);
        if (url.includes("/admin/api/analytics/timeseries")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => MOCK_TIMESERIES,
          } as Response);
        }
        if (url.includes("/admin/api/analytics/providers")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => MOCK_PROVIDERS,
          } as Response);
        }
        if (url.includes("/admin/api/analytics/errors")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => MOCK_ERRORS,
          } as Response);
        }
        if (url.includes("/admin/api/analytics/versions")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => MOCK_VERSIONS,
          } as Response);
        }
        if (url.includes("/admin/api/analytics/latency")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => MOCK_LATENCY,
          } as Response);
        }
        return Promise.reject(new Error("Unknown route"));
      });

      render(<AdminShell currentPath="/admin/analytics" expiresAt={null} />);

      // Sections
      await waitFor(() => {
        expect(screen.getByText("解析结果趋势")).toBeDefined();
        expect(screen.getByText("已授权活跃设备与注册趋势")).toBeDefined();
        expect(screen.getByText("解析结果提供商分布")).toBeDefined();
        expect(screen.getByText("解析错误分类")).toBeDefined();
        expect(screen.getByText("最新观测扩展版本分布")).toBeDefined();
        expect(screen.getByText("观测解析耗时趋势")).toBeDefined();
      });

      // Providers mapped
      expect(screen.getByText("OpenAI")).toBeDefined();
      expect(screen.getByText("DeepSeek")).toBeDefined();

      // Errors mapped
      expect(screen.getByText("超时")).toBeDefined();
      expect(screen.getByText("网络错误")).toBeDefined();

      // Versions mapped
      expect(screen.getByText("0.2.0")).toBeDefined();
      expect(screen.getByText("0.1.9")).toBeDefined();

      // Default 14 days button selected
      const btn14 = screen.getByRole("button", { name: "14 天" });
      expect(btn14.getAttribute("aria-pressed")).toBe("true");

      // Scope Disclosure
      expect(
        screen.getByText(/活动与解析指标仅基于已授权匿名统计数据/),
      ).toBeDefined();

      // Ensure old placeholder copy is gone
      expect(screen.queryByText("分析数据尚未接入")).toBeNull();
    });

    it("switches time windows (7, 30, 90 days) and dispatches requests with ?days=N", async () => {
      const fetchedUrls: string[] = [];
      vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
        const url = String(input);
        fetchedUrls.push(url);
        if (url.includes("/admin/api/analytics/timeseries")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => MOCK_TIMESERIES,
          } as Response);
        }
        if (url.includes("/admin/api/analytics/providers")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => MOCK_PROVIDERS,
          } as Response);
        }
        if (url.includes("/admin/api/analytics/errors")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => MOCK_ERRORS,
          } as Response);
        }
        if (url.includes("/admin/api/analytics/versions")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => MOCK_VERSIONS,
          } as Response);
        }
        if (url.includes("/admin/api/analytics/latency")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => MOCK_LATENCY,
          } as Response);
        }
        return Promise.reject(new Error("Unknown route"));
      });

      render(<AdminShell currentPath="/admin/analytics" expiresAt={null} />);

      await waitFor(() => {
        expect(screen.getByText("解析结果趋势")).toBeDefined();
      });

      // Switch to 30 days
      const btn30 = screen.getByRole("button", { name: "30 天" });
      fireEvent.click(btn30);

      await waitFor(() => {
        expect(
          fetchedUrls.some((u) => u.includes("timeseries?days=30")),
        ).toBe(true);
      });
      expect(btn30.getAttribute("aria-pressed")).toBe("true");

      // Switch to 90 days
      const btn90 = screen.getByRole("button", { name: "90 天" });
      fireEvent.click(btn90);

      await waitFor(() => {
        expect(
          fetchedUrls.some((u) => u.includes("timeseries?days=90")),
        ).toBe(true);
      });
    });

    it("handles partial endpoint failure gracefully without crashing the whole analytics dashboard", async () => {
      vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
        const url = String(input);
        if (url.includes("/admin/api/analytics/timeseries")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => MOCK_TIMESERIES,
          } as Response);
        }
        // Providers fails with 500
        if (url.includes("/admin/api/analytics/providers")) {
          return Promise.resolve({
            ok: false,
            status: 500,
            json: async () => ({
              ok: false,
              error: { code: "ADMIN_INTERNAL_ERROR" },
            }),
          } as Response);
        }
        if (url.includes("/admin/api/analytics/errors")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => MOCK_ERRORS,
          } as Response);
        }
        if (url.includes("/admin/api/analytics/versions")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => MOCK_VERSIONS,
          } as Response);
        }
        if (url.includes("/admin/api/analytics/latency")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => MOCK_LATENCY,
          } as Response);
        }
        return Promise.reject(new Error("Unknown route"));
      });

      render(<AdminShell currentPath="/admin/analytics" expiresAt={null} />);

      await waitFor(() => {
        // Timeseries, Errors, Versions still render successfully!
        expect(screen.getByText("解析结果趋势")).toBeDefined();
        expect(screen.getByText("超时")).toBeDefined();
        expect(screen.getByText("0.2.0")).toBeDefined();
      });

      // Provider section shows friendly error message
      expect(screen.getByText("数据加载失败，请稍后重试")).toBeDefined();
    });

    it("renders friendly message on 429 ADMIN_RATE_LIMITED", async () => {
      vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
        const url = String(input);
        if (url.includes("/admin/api/analytics/timeseries")) {
          return Promise.resolve({
            ok: false,
            status: 429,
            json: async () => ({
              ok: false,
              error: { code: "ADMIN_RATE_LIMITED" },
            }),
          } as Response);
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ ok: true, data: [] }),
        } as Response);
      });

      render(<AdminShell currentPath="/admin/analytics" expiresAt={null} />);

      await waitFor(() => {
        const rateLimitNotices = screen.getAllByText("请求过于频繁，请稍后重试");
        expect(rateLimitNotices.length).toBeGreaterThanOrEqual(1);
      });
    });

    it("renders empty states (HTTP 200 with data=[]) as empty, not error", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          data: [],
          window: { days: 14, from: "2026-09-24T00:00:00.000Z", to: "2026-10-07T10:00:00.000Z", retentionDays: 90 },
          generatedAt: "2026-10-07T10:00:00.000Z",
        }),
      } as Response);

      render(<AdminShell currentPath="/admin/analytics" expiresAt={null} />);

      await waitFor(() => {
        expect(
          screen.getByText("当前时间范围内暂无解析结果提供商数据"),
        ).toBeDefined();
        expect(
          screen.getByText("当前时间范围内暂无解析错误数据"),
        ).toBeDefined();
        expect(screen.getByText("当前时间范围内暂无版本数据")).toBeDefined();
      });

      expect(screen.queryByText("后台不可用")).toBeNull();
    });

    it("allows toggling between visual chart and accessible data table", async () => {
      vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
        const url = String(input);
        if (url.includes("/admin/api/analytics/timeseries")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => MOCK_TIMESERIES,
          } as Response);
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ ok: true, data: [] }),
        } as Response);
      });

      render(<AdminShell currentPath="/admin/analytics" expiresAt={null} />);

      await waitFor(() => {
        expect(screen.getByText("解析结果趋势")).toBeDefined();
      });

      const toggleBtns = screen.getAllByRole("button", {
        name: "查看数据表格",
      });
      fireEvent.click(toggleBtns[0]);

      // Table is now displayed
      expect(screen.getByRole("table", { name: "解析结果详细数据列表" })).toBeDefined();
      expect(screen.getByRole("button", { name: "查看图表" })).toBeDefined();
    });
  });

  describe("Preserved Navigation & Placeholder States for Other Routes", () => {
    const placeholderRoutes = [
      { path: "/admin/audit", title: "审计", notice: "审计记录尚未接入" },
    ];

    placeholderRoutes.forEach(({ path, title, notice }) => {
      it(`preserves placeholder state for route ${path}`, () => {
        render(
          <AdminShell
            currentPath={path}
            expiresAt="2026-10-07T12:00:00.000Z"
          />,
        );

        expect(
          screen.getByRole("heading", { level: 1, name: title }),
        ).toBeDefined();

        expect(screen.getByText(notice)).toBeDefined();

        const activeLink = screen.getByRole("link", {
          name: new RegExp(title),
        });
        expect(activeLink.getAttribute("aria-current")).toBe("page");
        expect(activeLink.getAttribute("href")).toBe(path);
      });
    });

    it("preserves authoritative logout contract form POST /admin/logout", () => {
      render(<AdminShell currentPath="/admin/users" expiresAt={null} />);

      const logoutForm = document.querySelector('form[action="/admin/logout"]');
      expect(logoutForm).not.toBeNull();
      expect(logoutForm?.getAttribute("method")).toBe("POST");

      const submitBtn = logoutForm?.querySelector('button[type="submit"]');
      expect(submitBtn?.textContent).toContain("退出登录");
    });
  });

  describe("Mobile Drawer Keyboard Accessibility & Focus Management (Preserved 11B2-R1)", () => {
    it("provides aria-controls and id contract for the drawer", () => {
      render(<AdminShell currentPath="/admin" expiresAt={null} />);

      const menuBtn = screen.getByLabelText("打开导航菜单");
      expect(menuBtn.getAttribute("aria-controls")).toBe(
        "admin-navigation-drawer",
      );
      expect(menuBtn.getAttribute("aria-expanded")).toBe("false");

      const drawer = document.getElementById("admin-navigation-drawer");
      expect(drawer).not.toBeNull();
      expect(drawer?.tagName.toLowerCase()).toBe("aside");
    });

    it("moves focus to close button when opened, and restores focus to menu trigger on Escape", async () => {
      render(<AdminShell currentPath="/admin" expiresAt={null} />);

      const menuBtn = screen.getByLabelText("打开导航菜单");
      menuBtn.focus();
      expect(document.activeElement).toBe(menuBtn);

      // Open drawer
      fireEvent.click(menuBtn);
      expect(menuBtn.getAttribute("aria-expanded")).toBe("true");

      // Verify close button receives focus
      await waitFor(() => {
        const closeBtn = screen.getByLabelText("关闭导航抽屉");
        expect(document.activeElement).toBe(closeBtn);
      });

      // Press Escape
      act(() => {
        fireEvent.keyDown(window, { key: "Escape" });
      });

      // Drawer is closed and focus returns to menu button
      expect(menuBtn.getAttribute("aria-expanded")).toBe("false");
      expect(document.activeElement).toBe(menuBtn);
    });

    it("restores focus to menu trigger when clicking close button", async () => {
      render(<AdminShell currentPath="/admin" expiresAt={null} />);

      const menuBtn = screen.getByLabelText("打开导航菜单");
      menuBtn.focus();

      // Open drawer
      fireEvent.click(menuBtn);

      const closeBtn = await screen.findByLabelText("关闭导航抽屉");
      expect(document.activeElement).toBe(closeBtn);

      // Click close button
      fireEvent.click(closeBtn);

      expect(menuBtn.getAttribute("aria-expanded")).toBe("false");
      expect(document.activeElement).toBe(menuBtn);
    });

    it("traps tab focus within open drawer", async () => {
      render(<AdminShell currentPath="/admin" expiresAt={null} />);

      const menuBtn = screen.getByLabelText("打开导航菜单");
      fireEvent.click(menuBtn);

      const closeBtn = await screen.findByLabelText("关闭导航抽屉");
      const drawer = document.getElementById("admin-navigation-drawer")!;
      const submitBtn = drawer.querySelector<HTMLButtonElement>(
        'button[type="submit"]',
      )!;

      // Focus on close button (first element) and press Shift+Tab -> should cycle to submitBtn (last element)
      closeBtn.focus();
      expect(document.activeElement).toBe(closeBtn);

      fireEvent.keyDown(drawer, { key: "Tab", shiftKey: true });
      expect(document.activeElement).toBe(submitBtn);

      // Focus on submitBtn (last element) and press Tab -> should cycle to closeBtn (first element)
      submitBtn.focus();
      fireEvent.keyDown(drawer, { key: "Tab", shiftKey: false });
      expect(document.activeElement).toBe(closeBtn);
    });
  });

  describe("Truth-Semantic Invariants & Contract Protections (Section 47)", () => {
    it("pins truth copy on /admin and rejects ungrounded metric claims", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => MOCK_OVERVIEW,
      } as Response);

      render(<AdminShell currentPath="/admin" expiresAt={null} />);

      await waitFor(() => {
        expect(screen.getByText("今日已授权活跃设备")).toBeDefined();
      });

      const bodyText = document.body.textContent ?? "";
      // Grounded truthful copy
      expect(bodyText).toContain("今日已授权活跃设备");
      expect(bodyText).toContain("今日产生解析结果的设备");
      expect(bodyText).toContain("平均观测解析耗时");
      expect(bodyText).toContain("活动与解析指标仅基于已授权匿名统计数据");

      // Forbidden ungrounded copy
      expect(bodyText).not.toContain("AI 延迟");
      expect(bodyText).not.toContain("模型延迟");
      expect(bodyText).not.toContain("API 延迟");
      expect(bodyText).not.toContain("服务器延迟");
      expect(bodyText).not.toContain("真实总安装量");
      expect(bodyText).not.toContain("API 请求量");
    });

    it("pins truth copy on /admin/analytics and rejects ungrounded provider and version claims", async () => {
      vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
        const url = String(input);
        if (url.includes("/admin/api/analytics/timeseries")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => MOCK_TIMESERIES,
          } as Response);
        }
        if (url.includes("/admin/api/analytics/providers")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => MOCK_PROVIDERS,
          } as Response);
        }
        if (url.includes("/admin/api/analytics/errors")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => MOCK_ERRORS,
          } as Response);
        }
        if (url.includes("/admin/api/analytics/versions")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => MOCK_VERSIONS,
          } as Response);
        }
        if (url.includes("/admin/api/analytics/latency")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => MOCK_LATENCY,
          } as Response);
        }
        return Promise.reject(new Error("Unknown route"));
      });

      render(<AdminShell currentPath="/admin/analytics" expiresAt={null} />);

      await waitFor(() => {
        expect(screen.getByText("解析结果趋势")).toBeDefined();
      });

      const bodyText = document.body.textContent ?? "";
      // Truthful grounded labels
      expect(bodyText).toContain("解析结果提供商分布");
      expect(bodyText).toContain("解析错误分类");
      expect(bodyText).toContain("最新观测扩展版本分布");
      expect(bodyText).toContain("观测解析耗时趋势");

      // Forbidden ungrounded provider / version / latency copy
      expect(bodyText).not.toContain("API 请求量");
      expect(bodyText).not.toContain("模型调用量");
      expect(bodyText).not.toContain("当前用户 Provider 配置");
      expect(bodyText).not.toContain("Provider 使用人数");
      expect(bodyText).not.toContain("所有用户版本分布");
      expect(bodyText).not.toContain("当前安装版本");
      expect(bodyText).not.toContain("真实安装份额");
      expect(bodyText).not.toContain("AI 响应延迟");
      expect(bodyText).not.toContain("模型 latency");
      expect(bodyText).not.toContain("server latency");
    });

    it("prevents late responses from overwriting new window on fast time window switching", async () => {
      const resolve30DaysRef = {
        current: null as ((value: Response) => void) | null,
      };
      const days7Timeseries: AdminTimeseriesResponse = {
        ...MOCK_TIMESERIES,
        window: { ...MOCK_TIMESERIES.window, days: 7 },
        data: [
          {
            date: "2026-10-07",
            optInDau: 999,
            observedInstallDevices: 99,
            parseSuccesses: 888,
            parseErrors: 12,
            parseOutcomeSuccessRatio: 888 / 900,
            registrations: 77,
          },
        ],
      };

      vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
        const url = String(input);
        const signal = (init as RequestInit)?.signal;

        if (url.includes("timeseries?days=30")) {
          return new Promise<Response>((resolve, reject) => {
            resolve30DaysRef.current = resolve;
            signal?.addEventListener("abort", () => {
              const abortErr = new Error("Aborted");
              abortErr.name = "AbortError";
              reject(abortErr);
            });
          });
        }
        if (url.includes("timeseries?days=7")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => days7Timeseries,
          } as Response);
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ ok: true, data: [] }),
        } as Response);
      });

      render(<AdminShell currentPath="/admin/analytics" expiresAt={null} />);

      await waitFor(() => {
        expect(screen.getByText("解析结果趋势")).toBeDefined();
      });

      // User clicks 30 days (slow request)
      const btn30 = screen.getByRole("button", { name: "30 天" });
      fireEvent.click(btn30);

      await waitFor(() => {
        expect(resolve30DaysRef.current).not.toBeNull();
      });

      // User clicks 7 days (fast request)
      const btn7 = screen.getByRole("button", { name: "7 天" });
      fireEvent.click(btn7);

      // Fast 7 days request resolves and updates UI
      await waitFor(() => {
        expect(screen.getAllByText(/888/).length).toBeGreaterThanOrEqual(1);
      });

      // Now if 30 days slow response attempts to resolve
      if (resolve30DaysRef.current) {
        resolve30DaysRef.current({
          ok: true,
          status: 200,
          json: async () => ({
            ...MOCK_TIMESERIES,
            window: { ...MOCK_TIMESERIES.window, days: 30 },
            data: [
              {
                date: "2026-10-07",
                optInDau: 111,
                observedInstallDevices: 11,
                parseSuccesses: 222,
                parseErrors: 22,
                parseOutcomeSuccessRatio: 222 / 244,
                registrations: 33,
              },
            ],
          }),
        } as Response);
      }

      // Ensure 7 days data remains visible (not overwritten by 30 days response)
      expect(screen.getAllByText(/888/).length).toBeGreaterThanOrEqual(1);
      expect(screen.queryByText(/222/)).toBeNull();
    });
  });

  describe("Phase 11C2-R1 Regression & Repair Tests", () => {
    it("C2-R1-OVERVIEW-01: Overview does not expose fake 7/14/30/90 control while retaining refresh", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => MOCK_OVERVIEW,
      } as Response);

      render(<AdminShell currentPath="/admin" expiresAt={null} />);

      await waitFor(() => {
        expect(screen.getByText("今日已授权活跃设备")).toBeDefined();
      });

      // Segmented period buttons must NOT be present on /admin
      expect(screen.queryByRole("button", { name: "7 天" })).toBeNull();
      expect(screen.queryByRole("button", { name: "14 天" })).toBeNull();
      expect(screen.queryByRole("button", { name: "30 天" })).toBeNull();
      expect(screen.queryByRole("button", { name: "90 天" })).toBeNull();

      // Refresh button and timestamp remain available
      expect(screen.getByRole("button", { name: "刷新数据" })).toBeDefined();
      expect(screen.getByText(/数据生成时间/)).toBeDefined();
    });

    it("C2-R1-WINDOW-01: new period never renders old-period response (shows loading during switch)", async () => {
      const resolvers90Days: Record<string, (res: Response) => void> = {};

      vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
        const url = String(input);
        if (url.includes("days=14")) {
          if (url.includes("timeseries")) {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: async () => MOCK_TIMESERIES,
            } as Response);
          }
          if (url.includes("providers")) {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: async () => MOCK_PROVIDERS,
            } as Response);
          }
          if (url.includes("errors")) {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: async () => MOCK_ERRORS,
            } as Response);
          }
          if (url.includes("versions")) {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: async () => MOCK_VERSIONS,
            } as Response);
          }
          if (url.includes("latency")) {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: async () => MOCK_LATENCY,
            } as Response);
          }
        }

        if (url.includes("days=90")) {
          return new Promise<Response>((resolve) => {
            if (url.includes("providers")) resolvers90Days.providers = resolve;
            if (url.includes("timeseries")) resolvers90Days.timeseries = resolve;
            if (url.includes("errors")) resolvers90Days.errors = resolve;
            if (url.includes("versions")) resolvers90Days.versions = resolve;
            if (url.includes("latency")) resolvers90Days.latency = resolve;
          });
        }

        return Promise.reject(new Error("Unknown route"));
      });

      render(<AdminShell currentPath="/admin/analytics" expiresAt={null} />);

      // Wait for initial 14-day data to load
      await waitFor(() => {
        expect(screen.getByText("OpenAI")).toBeDefined();
        expect(screen.getByText("最近 14 日观测到的成功与失败解析结果时间序列分布")).toBeDefined();
      });

      // User clicks 90 days button
      const btn90 = screen.getByRole("button", { name: "90 天" });
      fireEvent.click(btn90);

      // Label immediately updates to 90 days
      expect(screen.getByText("最近 90 日观测到的成功与失败解析结果时间序列分布")).toBeDefined();
      expect(btn90.getAttribute("aria-pressed")).toBe("true");

      // BEFORE 90-day response arrives: old 14-day provider "OpenAI" must NOT be rendered under 90-day label
      expect(screen.queryByText("OpenAI")).toBeNull();

      // SectionState renders loading state
      const loadingBoxes = document.querySelectorAll(".admin-spinner, [aria-busy='true']");
      expect(loadingBoxes.length).toBeGreaterThanOrEqual(1);

      // Resolve 90-day responses
      act(() => {
        resolvers90Days.providers?.({
          ok: true,
          status: 200,
          json: async () => ({
            ...MOCK_PROVIDERS,
            window: { ...MOCK_PROVIDERS.window, days: 90 },
            data: [
              {
                provider: "qwen",
                success: 900,
                error: 90,
                outcomes: 990,
                successRatio: 900 / 990,
              },
            ],
          }),
        } as Response);
      });

      // Now 90-day data becomes visible
      await waitFor(() => {
        expect(screen.getByText("Qwen")).toBeDefined();
      });
    });

    it("C2-R1-LATENCY-01: null sample breaks line segment and does not connect across gap", () => {
      const latencyGapData = [
        { date: "2026-10-01", samples: 5, averageMs: 200 },
        { date: "2026-10-02", samples: 0, averageMs: null },
        { date: "2026-10-03", samples: 8, averageMs: 500 },
      ];

      const { container } = render(<LatencyChart data={latencyGapData} />);

      // Polylines rendered: since day 2 is null, Day 1 is length 1 and Day 3 is length 1
      // Neither forms a multi-point segment, so 0 connecting polylines exist across the gap
      const polylines = container.querySelectorAll("polyline.admin-line-warning");
      expect(polylines.length).toBe(0);

      // Points rendered: Day 1 (circle), Day 2 (empty marker), Day 3 (circle)
      const circles = container.querySelectorAll("circle");
      expect(circles.length).toBe(3);

      const emptyMarkers = container.querySelectorAll("circle.admin-point-empty");
      expect(emptyMarkers.length).toBe(1);

      // Textual / table fallback exists and shows 暂无样本 for Day 2
      const toggleBtn = screen.getByRole("button", { name: "查看数据表格" });
      fireEvent.click(toggleBtn);

      const cells = screen.getAllByRole("cell");
      expect(cells.some((c) => c.textContent?.includes("暂无样本"))).toBe(true);
    });

    it("C2-R1-TIME-01: latest generatedAt is selected from current valid responses", () => {
      const timestamps = [
        "2026-10-07T08:00:00.000Z",
        "2026-10-07T10:15:30.000Z",
        "2026-10-07T09:30:00.000Z",
        null,
        undefined,
        "invalid-date",
      ];

      const latest = getLatestGeneratedAt(timestamps);
      expect(latest).toBe("2026-10-07T10:15:30.000Z");

      expect(getLatestGeneratedAt([null, undefined])).toBeNull();
    });

    it("C2-R1-RETRY-01: section retry only refetches the failed endpoint", async () => {
      const fetchCounts = {
        timeseries: 0,
        providers: 0,
        errors: 0,
        versions: 0,
        latency: 0,
      };

      vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
        const url = String(input);
        if (url.includes("timeseries")) {
          fetchCounts.timeseries++;
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => MOCK_TIMESERIES,
          } as Response);
        }
        if (url.includes("providers")) {
          fetchCounts.providers++;
          // First attempt fails, retry will succeed
          if (fetchCounts.providers === 1) {
            return Promise.resolve({
              ok: false,
              status: 503,
              json: async () => ({ ok: false, error: { code: "ADMIN_STORAGE_UNAVAILABLE" } }),
            } as Response);
          }
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => MOCK_PROVIDERS,
          } as Response);
        }
        if (url.includes("errors")) {
          fetchCounts.errors++;
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => MOCK_ERRORS,
          } as Response);
        }
        if (url.includes("versions")) {
          fetchCounts.versions++;
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => MOCK_VERSIONS,
          } as Response);
        }
        if (url.includes("latency")) {
          fetchCounts.latency++;
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => MOCK_LATENCY,
          } as Response);
        }
        return Promise.reject(new Error("Unknown route"));
      });

      render(<AdminShell currentPath="/admin/analytics" expiresAt={null} />);

      await waitFor(() => {
        expect(screen.getByText("数据暂时不可用，请稍后重试")).toBeDefined();
      });

      expect(fetchCounts.timeseries).toBe(1);
      expect(fetchCounts.providers).toBe(1);
      expect(fetchCounts.errors).toBe(1);
      expect(fetchCounts.versions).toBe(1);
      expect(fetchCounts.latency).toBe(1);

      // Click retry in the providers section
      const retryBtn = screen.getByRole("button", { name: "重试" });
      fireEvent.click(retryBtn);

      await waitFor(() => {
        expect(screen.getByText("OpenAI")).toBeDefined();
      });

      // Providers was retried (+1 = 2), but other 4 endpoints were NOT refetched!
      expect(fetchCounts.providers).toBe(2);
      expect(fetchCounts.timeseries).toBe(1);
      expect(fetchCounts.errors).toBe(1);
      expect(fetchCounts.versions).toBe(1);
      expect(fetchCounts.latency).toBe(1);
    });

    it("C2-R1-ARIA-01: segmented control buttons use correct aria-pressed semantics", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => MOCK_TIMESERIES,
      } as Response);

      render(<AdminShell currentPath="/admin/analytics" expiresAt={null} />);

      const btn7 = screen.getByRole("button", { name: "7 天" });
      const btn14 = screen.getByRole("button", { name: "14 天" });
      const btn30 = screen.getByRole("button", { name: "30 天" });
      const btn90 = screen.getByRole("button", { name: "90 天" });

      expect(btn14.getAttribute("aria-pressed")).toBe("true");
      expect(btn7.getAttribute("aria-pressed")).toBe("false");
      expect(btn30.getAttribute("aria-pressed")).toBe("false");
      expect(btn90.getAttribute("aria-pressed")).toBe("false");

      act(() => {
        fireEvent.click(btn30);
      });

      expect(btn30.getAttribute("aria-pressed")).toBe("true");
      expect(btn14.getAttribute("aria-pressed")).toBe("false");
    });
  });

  describe("Phase 11D2 Formatters & Helpers", () => {
    it("formats uptime duration accurately in Chinese units", () => {
      expect(formatUptimeDuration(45)).toBe("45 秒");
      expect(formatUptimeDuration(120)).toBe("2 分钟");
      expect(formatUptimeDuration(754)).toBe("12 分 34 秒");
      expect(formatUptimeDuration(3600)).toBe("1 小时");
      expect(formatUptimeDuration(11520)).toBe("3 小时 12 分");
      expect(formatUptimeDuration(187200)).toBe("2 天 4 小时");
      expect(formatUptimeDuration(86400)).toBe("1 天");
      expect(formatUptimeDuration(0)).toBe("0 秒");
      expect(formatUptimeDuration(-10)).toBe("—");
    });

    it("maps management error codes to Chinese localized messages", () => {
      expect(getUsersErrorMessage("ADMIN_RATE_LIMITED")).toBe("请求过于频繁，请稍后重试");
      expect(getUsersErrorMessage("ADMIN_STORAGE_UNAVAILABLE")).toBe("用户数据暂时不可用");
      expect(getUsersErrorMessage("ADMIN_AUTH_NOT_CONFIGURED")).toBe("管理后台认证尚未配置");
      expect(getUsersErrorMessage("INVALID_ADMIN_QUERY")).toBe("请求参数无效");
      expect(getUsersErrorMessage("ADMIN_INTERNAL_ERROR")).toBe("用户数据暂时不可用");

      expect(getSystemErrorMessage("ADMIN_RATE_LIMITED")).toBe("请求过于频繁，请稍后重试");
      expect(getSystemErrorMessage("ADMIN_STORAGE_UNAVAILABLE")).toBe("系统状态暂时不可用");
      expect(getSystemErrorMessage("ADMIN_AUTH_NOT_CONFIGURED")).toBe("管理后台认证尚未配置");
    });

    it("formats datetime strings safely and returns fallback for null / invalid dates", () => {
      const formatted = formatAdminDateTime("2026-10-07T10:00:00.000Z");
      expect(formatted).toContain("2026/");
      expect(formatAdminDateTime(null, "暂无观测")).toBe("暂无观测");
      expect(formatAdminDateTime(undefined, "—")).toBe("—");
      expect(formatAdminDateTime("invalid-date", "暂无观测")).toBe("暂无观测");
    });

    it("formats uptime duration safely and handles invalid / negative values", () => {
      expect(formatUptimeDuration(-10)).toBe("—");
      expect(formatUptimeDuration(Number.NaN)).toBe("—");
      expect(formatUptimeDuration(Infinity)).toBe("—");
      expect(formatUptimeDuration(-0.5)).toBe("—");
      expect(formatUptimeDuration(0)).toBe("0 秒");
      expect(formatUptimeDuration(45)).toBe("45 秒");
      expect(formatUptimeDuration(125)).toBe("2 分 5 秒");
      expect(formatUptimeDuration(3665)).toBe("1 小时 1 分");
      expect(formatUptimeDuration(90000)).toBe("1 天 1 小时");
    });
  });

  describe("Phase 11D2 Users Directory Tests", () => {
    it("D2-USERS-01: initial loading state displays loading spinner", async () => {
      vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise(() => {}));

      render(<AdminShell currentPath="/admin/users" expiresAt={null} />);

      expect(screen.getByText("正在加载用户数据…")).toBeDefined();
    });

    it("D2-USERS-02: successful allowlisted rows are rendered in table", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => MOCK_USERS,
      } as Response);

      render(<AdminShell currentPath="/admin/users" expiresAt={null} />);

      await waitFor(() => {
        expect(screen.getAllByText("alice@example.com").length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText("bob@example.com").length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText("user_alice_123456").length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText("user_bob_789012").length).toBeGreaterThanOrEqual(1);
      });

      // Headers check
      expect(screen.getByRole("columnheader", { name: "账号" })).toBeDefined();
      expect(screen.getByRole("columnheader", { name: "用户 ID" })).toBeDefined();
      expect(screen.getByRole("columnheader", { name: "注册时间" })).toBeDefined();
      expect(screen.getByRole("columnheader", { name: "关联设备" })).toBeDefined();
      expect(screen.getByRole("columnheader", { name: "最近设备观测" })).toBeDefined();
    });

    it("D2-USERS-03: empty users response renders empty notice", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          ...MOCK_USERS,
          data: [],
          page: { limit: 50, nextCursor: null },
        }),
      } as Response);

      render(<AdminShell currentPath="/admin/users" expiresAt={null} />);

      await waitFor(() => {
        expect(screen.getByText("暂无已注册用户")).toBeDefined();
      });
      expect(screen.queryByText("后台不可用")).toBeNull();
    });

    it("D2-USERS-04: search email / user ID submits query", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          ...MOCK_USERS,
          data: [MOCK_USERS.data[0]],
          query: { q: "alice" },
        }),
      } as Response);

      render(<AdminShell currentPath="/admin/users" expiresAt={null} />);

      await waitFor(() => {
        expect(screen.getAllByText("alice@example.com").length).toBeGreaterThanOrEqual(1);
      });

      const input = screen.getByPlaceholderText("搜索邮箱或用户 ID");
      fireEvent.change(input, { target: { value: "alice" } });

      const searchBtn = screen.getByRole("button", { name: "搜索" });
      act(() => {
        fireEvent.click(searchBtn);
      });

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledWith(
          expect.stringContaining("q=alice"),
          expect.anything(),
        );
      });
    });

    it("D2-USERS-05: clear search clears input and re-fetches first page with no query", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => MOCK_USERS,
      } as Response);

      render(<AdminShell currentPath="/admin/users" expiresAt={null} />);

      await waitFor(() => {
        expect(screen.getAllByText("alice@example.com").length).toBeGreaterThanOrEqual(1);
      });

      const input = screen.getByPlaceholderText("搜索邮箱或用户 ID");
      const searchBtn = screen.getByRole("button", { name: "搜索" });

      act(() => {
        fireEvent.change(input, { target: { value: "bob" } });
        fireEvent.click(searchBtn);
      });

      // Click clear input icon
      const clearBtn = screen.getByRole("button", { name: "清除搜索输入" });
      act(() => {
        fireEvent.click(clearBtn);
      });

      expect((input as HTMLInputElement).value).toBe("");
      expect(fetchSpy).toHaveBeenCalled();
    });

    it("D2-USERS-06: cursor load more appends additional rows", async () => {
      const secondPageUsers: AdminUsersResponse = {
        ok: true,
        generatedAt: "2026-10-07T10:05:00.000Z",
        data: [
          {
            userId: "user_carol_345678",
            email: "carol@example.com",
            createdAt: "2026-09-20T14:00:00.000Z",
            linkedDeviceCount: 1,
            latestDeviceSeenAt: "2026-10-07T10:01:00.000Z",
          },
        ],
        page: {
          limit: 50,
          nextCursor: null,
        },
        query: {
          q: null,
        },
      };

      vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
        const url = String(input);
        if (url.includes("cursor=opaque-next-cursor-token-123")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => secondPageUsers,
          } as Response);
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => MOCK_USERS,
        } as Response);
      });

      render(<AdminShell currentPath="/admin/users" expiresAt={null} />);

      await waitFor(() => {
        expect(screen.getAllByText("alice@example.com").length).toBeGreaterThanOrEqual(1);
      });

      const loadMoreBtn = screen.getByRole("button", { name: "加载更多" });
      act(() => {
        fireEvent.click(loadMoreBtn);
      });

      await waitFor(() => {
        expect(screen.getAllByText("carol@example.com").length).toBeGreaterThanOrEqual(1);
        // Existing rows remain
        expect(screen.getAllByText("alice@example.com").length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText("bob@example.com").length).toBeGreaterThanOrEqual(1);
      });
    });

    it("D2-USERS-07: nextCursor null hides load-more button", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          ...MOCK_USERS,
          page: { limit: 50, nextCursor: null },
        }),
      } as Response);

      render(<AdminShell currentPath="/admin/users" expiresAt={null} />);

      await waitFor(() => {
        expect(screen.getAllByText("alice@example.com").length).toBeGreaterThanOrEqual(1);
      });

      expect(screen.queryByRole("button", { name: "加载更多" })).toBeNull();
    });

    it("D2-USERS-08: load-more failure keeps existing rows and shows inline retry", async () => {
      vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
        const url = String(input);
        if (url.includes("cursor=")) {
          return Promise.resolve({
            ok: false,
            status: 503,
            json: async () => ({ ok: false, error: { code: "ADMIN_STORAGE_UNAVAILABLE" } }),
          } as Response);
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => MOCK_USERS,
        } as Response);
      });

      render(<AdminShell currentPath="/admin/users" expiresAt={null} />);

      await waitFor(() => {
        expect(screen.getAllByText("alice@example.com").length).toBeGreaterThanOrEqual(1);
      });

      const loadMoreBtn = screen.getByRole("button", { name: "加载更多" });
      act(() => {
        fireEvent.click(loadMoreBtn);
      });

      await waitFor(() => {
        expect(screen.getByText("用户数据暂时不可用")).toBeDefined();
        // Existing users stay visible
        expect(screen.getAllByText("alice@example.com").length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText("bob@example.com").length).toBeGreaterThanOrEqual(1);
      });
    });

    it("D2-USERS-09: refresh resets to first page", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => MOCK_USERS,
      } as Response);

      render(<AdminShell currentPath="/admin/users" expiresAt={null} />);

      await waitFor(() => {
        expect(screen.getAllByText("alice@example.com").length).toBeGreaterThanOrEqual(1);
      });

      const refreshBtn = screen.getByRole("button", { name: "刷新用户数据" });
      act(() => {
        fireEvent.click(refreshBtn);
      });

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledTimes(2);
      });
    });

    it("D2-USERS-10: 401 redirects to /admin/login", async () => {
      const replaceSpy = vi.fn();
      Object.defineProperty(window, "location", {
        configurable: true,
        value: { replace: replaceSpy },
      });

      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: false,
        status: 401,
      } as Response);

      render(<AdminShell currentPath="/admin/users" expiresAt={null} />);

      await waitFor(() => {
        expect(replaceSpy).toHaveBeenCalledWith("/admin/login");
      });
    });

    it("D2-USERS-11: 429 displays Chinese localized message", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: false,
        status: 429,
        json: async () => ({ ok: false, error: { code: "ADMIN_RATE_LIMITED" } }),
      } as Response);

      render(<AdminShell currentPath="/admin/users" expiresAt={null} />);

      await waitFor(() => {
        expect(screen.getByText("请求过于频繁，请稍后重试")).toBeDefined();
      });
    });

    it("D2-USERS-12: latestDeviceSeenAt null renders 暂无观测 and never falls back to fake date", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => MOCK_USERS,
      } as Response);

      render(<AdminShell currentPath="/admin/users" expiresAt={null} />);

      await waitFor(() => {
        expect(screen.getAllByText("暂无观测").length).toBeGreaterThanOrEqual(1);
      });
    });

    it("D2-USERS-13: stale search response cannot overwrite new query", async () => {
      const slowQueryState = {
        resolve: null as ((res: Response) => void) | null,
      };

      vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
        const url = String(input);
        const signal = (init as RequestInit)?.signal;

        if (url.includes("q=alice")) {
          return new Promise<Response>((resolve, reject) => {
            slowQueryState.resolve = resolve;
            signal?.addEventListener("abort", () => {
              const abortErr = new Error("Aborted");
              abortErr.name = "AbortError";
              reject(abortErr);
            });
          });
        }

        if (url.includes("q=bob")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              ...MOCK_USERS,
              data: [MOCK_USERS.data[1]],
              query: { q: "bob" },
            }),
          } as Response);
        }

        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => MOCK_USERS,
        } as Response);
      });

      render(<AdminShell currentPath="/admin/users" expiresAt={null} />);

      await waitFor(() => {
        expect(screen.getAllByText("alice@example.com").length).toBeGreaterThanOrEqual(1);
      });

      const form = screen.getByRole("search");
      const input = screen.getByPlaceholderText("搜索邮箱或用户 ID");

      // Search alice (slow)
      fireEvent.change(input, { target: { value: "alice" } });
      act(() => {
        fireEvent.submit(form);
      });

      // Wait for alice request to be in flight
      await waitFor(() => {
        expect(slowQueryState.resolve).not.toBeNull();
      });

      // Search bob (fast) while alice is still pending
      fireEvent.change(input, { target: { value: "bob" } });
      act(() => {
        fireEvent.submit(form);
      });

      await waitFor(() => {
        expect(screen.getAllByText("bob@example.com").length).toBeGreaterThanOrEqual(1);
      });

      // Now resolve slow alice response if possible
      if (slowQueryState.resolve) {
        slowQueryState.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            ...MOCK_USERS,
            data: [MOCK_USERS.data[0]],
            query: { q: "alice" },
          }),
        } as Response);
      }

      // bob must remain visible, and alice must not appear
      expect(screen.getAllByText("bob@example.com").length).toBeGreaterThanOrEqual(1);
      expect(screen.queryAllByText("alice@example.com").length).toBe(0);
    });

    it("D2-USERS-14: load-more is single-flight and disables button while loading", async () => {
      let loadMoreFetchCount = 0;

      vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
        const url = String(input);
        if (url.includes("cursor=")) {
          loadMoreFetchCount++;
          return new Promise<Response>(() => {});
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => MOCK_USERS,
        } as Response);
      });

      render(<AdminShell currentPath="/admin/users" expiresAt={null} />);

      await waitFor(() => {
        expect(screen.getAllByText("alice@example.com").length).toBeGreaterThanOrEqual(1);
      });

      const loadMoreBtn = screen.getByRole("button", { name: "加载更多" });
      act(() => {
        fireEvent.click(loadMoreBtn);
        fireEvent.click(loadMoreBtn); // Double click
      });

      expect(loadMoreFetchCount).toBe(1);
    });

    it("D2-USERS-TRUTH: locks truth copy and rejects ungrounded metric claims", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => MOCK_USERS,
      } as Response);

      render(<AdminShell currentPath="/admin/users" expiresAt={null} />);

      await waitFor(() => {
        expect(screen.getAllByText("alice@example.com").length).toBeGreaterThanOrEqual(1);
      });

      const bodyText = document.body.textContent ?? "";
      expect(bodyText).toContain("关联设备");
      expect(bodyText).toContain("最近设备观测");
      expect(bodyText).not.toContain("最后登录");
      expect(bodyText).not.toContain("在线状态");
      expect(bodyText).not.toContain("角色");
      expect(bodyText).not.toContain("套餐");
      expect(bodyText).not.toContain("总用户数");
    });
  });

  describe("Phase 11D2 System Status Tests", () => {
    it("D2-SYSTEM-01: initial loading state displays loading spinner", () => {
      vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise(() => {}));

      render(<AdminShell currentPath="/admin/system" expiresAt={null} />);

      expect(screen.getByText("正在加载系统状态…")).toBeDefined();
    });

    it("D2-SYSTEM-02: successful snapshot renders service, storage, email, deployment, analytics", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => MOCK_SYSTEM_SQLITE,
      } as Response);

      render(<AdminShell currentPath="/admin/system" expiresAt={null} />);

      await waitFor(() => {
        expect(screen.getByText("当前服务")).toBeDefined();
        expect(screen.getByText("正常")).toBeDefined();
        expect(screen.getByText("当前进程运行时长")).toBeDefined();
        expect(screen.getByText("2 天 4 小时")).toBeDefined();
        expect(screen.getByText("存储驱动")).toBeDefined();
        expect(screen.getByText("SQLite")).toBeDefined();
        expect(screen.getByText("邮件配置")).toBeDefined();
        expect(screen.getByText("已配置")).toBeDefined();
        expect(screen.getByText("运行权威")).toBeDefined();
        expect(screen.getByText("单进程")).toBeDefined();
        expect(screen.getByText("分析数据保留期")).toBeDefined();
        expect(screen.getByText("90 天")).toBeDefined();
        expect(screen.getByText("隐私纪元")).toBeDefined();
        expect(screen.getByText("1")).toBeDefined();
      });
    });

    it("D2-SYSTEM-03: SQLite storage driver description is displayed accurately", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => MOCK_SYSTEM_SQLITE,
      } as Response);

      render(<AdminShell currentPath="/admin/system" expiresAt={null} />);

      await waitFor(() => {
        expect(screen.getByText("当前后台使用 SQLite 作为数据存储。")).toBeDefined();
      });
    });

    it("D2-SYSTEM-04: JSON compatibility storage driver description is displayed accurately", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => MOCK_SYSTEM_JSON,
      } as Response);

      render(<AdminShell currentPath="/admin/system" expiresAt={null} />);

      await waitFor(() => {
        expect(screen.getByText("JSON 兼容存储")).toBeDefined();
        expect(screen.getByText("当前运行在 JSON 兼容存储模式。")).toBeDefined();
      });
    });

    it("D2-SYSTEM-05: email configured true renders 已配置 with bounded disclosure", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => MOCK_SYSTEM_SQLITE,
      } as Response);

      render(<AdminShell currentPath="/admin/system" expiresAt={null} />);

      await waitFor(() => {
        expect(screen.getByText("已配置")).toBeDefined();
        expect(screen.getByText("仅表示邮件发送配置已提供，不代表投递链路已验证。")).toBeDefined();
      });
    });

    it("D2-SYSTEM-06: email configured false renders 未配置", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => MOCK_SYSTEM_JSON,
      } as Response);

      render(<AdminShell currentPath="/admin/system" expiresAt={null} />);

      await waitFor(() => {
        expect(screen.getByText("未配置")).toBeDefined();
      });
    });

    it("D2-SYSTEM-08: refresh button refetches GET /admin/api/system", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => MOCK_SYSTEM_SQLITE,
      } as Response);

      render(<AdminShell currentPath="/admin/system" expiresAt={null} />);

      await waitFor(() => {
        expect(screen.getByText("当前服务")).toBeDefined();
      });

      const refreshBtn = screen.getByRole("button", { name: "刷新系统状态" });
      act(() => {
        fireEvent.click(refreshBtn);
      });

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledTimes(2);
      });
    });

    it("D2-SYSTEM-09: 401 redirects to /admin/login", async () => {
      const replaceSpy = vi.fn();
      Object.defineProperty(window, "location", {
        configurable: true,
        value: { replace: replaceSpy },
      });

      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: false,
        status: 401,
      } as Response);

      render(<AdminShell currentPath="/admin/system" expiresAt={null} />);

      await waitFor(() => {
        expect(replaceSpy).toHaveBeenCalledWith("/admin/login");
      });
    });

    it("D2-SYSTEM-10: 429 displays Chinese localized error message", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: false,
        status: 429,
        json: async () => ({ ok: false, error: { code: "ADMIN_RATE_LIMITED" } }),
      } as Response);

      render(<AdminShell currentPath="/admin/system" expiresAt={null} />);

      await waitFor(() => {
        expect(screen.getByText("请求过于频繁，请稍后重试")).toBeDefined();
      });
    });

    it("D2-SYSTEM-11: no fake infra metrics are displayed", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => MOCK_SYSTEM_SQLITE,
      } as Response);

      render(<AdminShell currentPath="/admin/system" expiresAt={null} />);

      await waitFor(() => {
        expect(screen.getByText("当前服务")).toBeDefined();
      });

      const bodyText = document.body.textContent ?? "";
      expect(bodyText).not.toContain("CPU");
      expect(bodyText).not.toContain("RAM");
      expect(bodyText).not.toContain("QPS");
      expect(bodyText).not.toContain("API 请求数");
      expect(bodyText).not.toContain("P95");
      expect(bodyText).not.toContain("P99");
      expect(bodyText).not.toContain("数据库大小");
      expect(bodyText).not.toContain("在线用户");
      expect(bodyText).not.toContain("99.9%");
    });

    it("D2-SYSTEM-TRUTH: locks truth copy and rejects ungrounded operational claims", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => MOCK_SYSTEM_SQLITE,
      } as Response);

      render(<AdminShell currentPath="/admin/system" expiresAt={null} />);

      await waitFor(() => {
        expect(screen.getByText("当前服务")).toBeDefined();
      });

      const bodyText = document.body.textContent ?? "";
      expect(bodyText).toContain("表示当前后台进程能够成功处理此状态请求。");
      expect(bodyText).toContain("当前后台 Node 进程的持续运行时间。");
      expect(bodyText).toContain("仅表示邮件发送配置已提供，不代表投递链路已验证。");
      expect(bodyText).toContain("当前 Admin 会话与限流状态由单个服务进程维护。");
      expect(bodyText).toContain("匿名统计分析事件的最长数据保留天数。");

      expect(bodyText).not.toContain("所有服务健康");
      expect(bodyText).not.toContain("系统一切正常");
      expect(bodyText).not.toContain("邮件服务正常");
      expect(bodyText).not.toContain("邮件发送成功");
      expect(bodyText).not.toContain("分布式");
      expect(bodyText).not.toContain("集群");
    });
  });

  describe("Phase 11D2-R1 Regression Tests", () => {
    it("D2-R1-USERS-01: aborted load-more cannot poison next first-page pagination state (search supersede)", async () => {
      let loadMoreSignal: AbortSignal | null | undefined;
      let loadMoreFetchCount = 0;

      vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
        const url = String(input);
        const signal = (init as RequestInit)?.signal;

        if (url.includes("cursor=opaque-next-cursor-token-123")) {
          loadMoreFetchCount++;
          loadMoreSignal = signal;
          return new Promise<Response>(() => {});
        }

        if (url.includes("cursor=cursor_bob_page_2")) {
          loadMoreFetchCount++;
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              ...MOCK_USERS,
              data: [{ ...MOCK_USERS.data[1], userId: "user_bob_page_2", email: "bob2@example.com" }],
              query: { q: "bob" },
              page: { limit: 50, nextCursor: null },
            }),
          } as Response);
        }

        if (url.includes("q=bob")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              ...MOCK_USERS,
              data: [MOCK_USERS.data[1]],
              query: { q: "bob" },
              page: { limit: 50, nextCursor: "cursor_bob_page_2" },
            }),
          } as Response);
        }

        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => MOCK_USERS,
        } as Response);
      });

      render(<AdminShell currentPath="/admin/users" expiresAt={null} />);

      await waitFor(() => {
        expect(screen.getAllByText("alice@example.com").length).toBeGreaterThanOrEqual(1);
      });

      const initialLoadMoreBtn = screen.getByRole("button", { name: "加载更多" });
      expect(initialLoadMoreBtn).toBeDefined();

      // 1. Click 加载更多, putting it into loading state
      act(() => {
        fireEvent.click(initialLoadMoreBtn);
      });

      expect(screen.getByText("正在加载更多…")).toBeDefined();
      expect(loadMoreFetchCount).toBe(1);

      // 2. While load-more is pending, submit a new search for "bob"
      const form = screen.getByRole("search");
      const input = screen.getByPlaceholderText("搜索邮箱或用户 ID");
      fireEvent.change(input, { target: { value: "bob" } });
      act(() => {
        fireEvent.submit(form);
      });

      // 3. Verify old cursor request gets aborted
      expect(loadMoreSignal?.aborted).toBe(true);

      // 4. Verify new first-page request resolves and button is cleanly enabled (not stuck on "正在加载更多…")
      await waitFor(() => {
        expect(screen.getAllByText("bob@example.com").length).toBeGreaterThanOrEqual(1);
      });

      const bobLoadMoreBtn = screen.getByRole("button", { name: "加载更多" });
      expect(bobLoadMoreBtn).toBeDefined();
      expect((bobLoadMoreBtn as HTMLButtonElement).disabled).toBe(false);
      expect(screen.queryByText("正在加载更多…")).toBeNull();

      // 5. A new load-more click issues exactly one request with the new cursor
      act(() => {
        fireEvent.click(bobLoadMoreBtn);
      });

      await waitFor(() => {
        expect(screen.getAllByText("bob2@example.com").length).toBeGreaterThanOrEqual(1);
      });
      expect(loadMoreFetchCount).toBe(2);
    });

    it("D2-R1-USERS-01b: clear search while load-more pending supersedes and cleans up pagination transient state", async () => {
      let loadMoreSignal: AbortSignal | null | undefined;

      vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
        const url = String(input);
        const signal = (init as RequestInit)?.signal;

        if (url.includes("cursor=opaque-next-cursor-token-123")) {
          loadMoreSignal = signal;
          return new Promise<Response>(() => {});
        }

        if (url.includes("q=alice")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              ...MOCK_USERS,
              data: [MOCK_USERS.data[0]],
              query: { q: "alice" },
              page: { limit: 50, nextCursor: "opaque-next-cursor-token-123" },
            }),
          } as Response);
        }

        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => MOCK_USERS,
        } as Response);
      });

      render(<AdminShell currentPath="/admin/users" expiresAt={null} />);

      await waitFor(() => {
        expect(screen.getAllByText("alice@example.com").length).toBeGreaterThanOrEqual(1);
      });

      // Search alice
      const form = screen.getByRole("search");
      const input = screen.getByPlaceholderText("搜索邮箱或用户 ID");
      fireEvent.change(input, { target: { value: "alice" } });
      act(() => {
        fireEvent.submit(form);
      });

      // Wait for alice search results to resolve
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "加载更多" })).toBeDefined();
        expect(screen.getByRole("button", { name: "清除搜索输入" })).toBeDefined();
      });

      // Trigger load more
      act(() => {
        fireEvent.click(screen.getByRole("button", { name: "加载更多" }));
      });
      expect(screen.getByText("正在加载更多…")).toBeDefined();

      // Clear search while load-more is pending
      const clearBtn = screen.getByRole("button", { name: "清除搜索输入" });
      act(() => {
        fireEvent.click(clearBtn);
      });

      // Old cursor request gets aborted immediately
      expect(loadMoreSignal?.aborted).toBe(true);

      // Verify first page is restored and load more button is healthy
      await waitFor(() => {
        expect(screen.getAllByText("bob@example.com").length).toBeGreaterThanOrEqual(1);
      });
      const restoredBtn = screen.getByRole("button", { name: "加载更多" });
      expect((restoredBtn as HTMLButtonElement).disabled).toBe(false);
      expect(screen.queryByText("正在加载更多…")).toBeNull();
    });

    it("D2-R1-SYSTEM-01: failed refresh never presents stale snapshot as current data and shows explicit stale notice", async () => {
      let callCount = 0;
      vi.spyOn(globalThis, "fetch").mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => MOCK_SYSTEM_SQLITE,
          } as Response);
        }
        return Promise.resolve({
          ok: false,
          status: 503,
          json: async () => ({ ok: false, error: { code: "ADMIN_STORAGE_UNAVAILABLE" } }),
        } as Response);
      });

      render(<AdminShell currentPath="/admin/system" expiresAt={null} />);

      // Initial successful load
      await waitFor(() => {
        expect(screen.getByText("当前服务")).toBeDefined();
        expect(screen.getByText("SQLite")).toBeDefined();
      });

      // Refresh fails
      const refreshBtn = screen.getByRole("button", { name: "刷新系统状态" });
      act(() => {
        fireEvent.click(refreshBtn);
      });

      await waitFor(() => {
        expect(screen.getByText(/刷新失败: 系统状态暂时不可用/)).toBeDefined();
      });

      // Stale notice and disclosure must be visible
      expect(screen.getByText(/以下为上次成功获取的数据/)).toBeDefined();
      expect(screen.getAllByText(/数据生成时间:/).length).toBeGreaterThanOrEqual(1);

      // Previous snapshot data is retained rather than disappearing
      expect(screen.getByText("当前服务")).toBeDefined();
      expect(screen.getByText("SQLite")).toBeDefined();

      // Retry button inside the stale notice
      expect(screen.getByRole("button", { name: "重试刷新系统状态" })).toBeDefined();
    });

    it("D2-R1-A11Y-01: mobile new controls meet touch-target CSS contract (>= 44px)", () => {
      const cssPath = path.resolve(__dirname, "admin.css");
      const cssContent = fs.readFileSync(cssPath, "utf-8");

      expect(cssContent).toContain("@media (max-width: 640px)");
      expect(cssContent).toMatch(/\.admin-search-input\s*\{[^}]*min-height:\s*44px/);
      expect(cssContent).toMatch(/\.admin-search-clear-btn\s*\{[^}]*min-height:\s*44px/);
      expect(cssContent).toMatch(/\.admin-search-clear-btn\s*\{[^}]*min-width:\s*44px/);
      expect(cssContent).toMatch(/\.admin-search-submit-btn[\s\S]*?min-height:\s*44px/);
      expect(cssContent).toMatch(/\.admin-load-more-btn[\s\S]*?min-height:\s*44px/);
      expect(cssContent).toMatch(/\.admin-refresh-btn[\s\S]*?min-height:\s*44px/);
      expect(cssContent).toMatch(/\.admin-stale-retry-btn[\s\S]*?min-height:\s*44px/);
    });
  });
});
