import React from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { AdminApp, normalizePath } from "./main";
import { AdminShell } from "./components/AdminShell";
import { SessionStatus } from "./components/SessionStatus";

describe("Admin Console UI & Shell Tests", () => {
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
      // Mock fetch that hangs to inspect loading
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
      // Expiration text should contain formatted time, not the raw ISO string
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

  describe("Navigation & Active Route States", () => {
    const routes = [
      { path: "/admin", title: "概览", notice: "概览数据尚未接入" },
      { path: "/admin/analytics", title: "分析", notice: "分析数据尚未接入" },
      { path: "/admin/users", title: "用户", notice: "用户数据尚未接入" },
      { path: "/admin/system", title: "系统", notice: "系统状态数据尚未接入" },
      { path: "/admin/audit", title: "审计", notice: "审计记录尚未接入" },
    ];

    routes.forEach(({ path, title, notice }) => {
      it(`renders route ${path} with correct title, notice, and aria-current`, () => {
        render(
          <AdminShell
            currentPath={path}
            expiresAt="2026-10-07T12:00:00.000Z"
          />,
        );

        // Check header title
        expect(
          screen.getByRole("heading", { level: 1, name: title }),
        ).toBeDefined();

        // Check empty notice
        expect(screen.getByText(notice)).toBeDefined();

        // Check active nav link
        const activeLink = screen.getByRole("link", {
          name: new RegExp(title),
        });
        expect(activeLink.getAttribute("aria-current")).toBe("page");
        expect(activeLink.getAttribute("href")).toBe(path);
      });
    });

    it("preserves authoritative logout contract form POST /admin/logout", () => {
      render(<AdminShell currentPath="/admin" expiresAt={null} />);

      const logoutForm = document.querySelector('form[action="/admin/logout"]');
      expect(logoutForm).not.toBeNull();
      expect(logoutForm?.getAttribute("method")).toBe("POST");

      const submitBtn = logoutForm?.querySelector('button[type="submit"]');
      expect(submitBtn?.textContent).toContain("退出登录");
    });
  });

  describe("Zero Fake Metrics Invariant", () => {
    it("guarantees placeholder metric cards display placeholder dashes and not fake numbers", () => {
      render(<AdminShell currentPath="/admin" expiresAt={null} />);

      // Verify no fake numbers exist
      expect(
        screen.queryByText(/1284|99\.8%|3\.2k|\$|DAU|WAU|MAU/i),
      ).toBeNull();

      // Check placeholder metrics
      const dashes = screen.getAllByText("—");
      expect(dashes.length).toBeGreaterThanOrEqual(4);
      expect(screen.getByText("活跃设备")).toBeDefined();
      expect(screen.getByText("解析请求数")).toBeDefined();
      expect(screen.getByText("解析成功率")).toBeDefined();
      expect(screen.getByText("平均响应时延")).toBeDefined();
    });

    it("renders natural Chinese without internal engineering jargon", () => {
      render(<AdminShell currentPath="/admin" expiresAt={null} />);

      const appText = document.body.textContent ?? "";
      expect(appText).not.toContain("Phase 11C");
      expect(appText).not.toContain("Phase 11D");
      expect(appText).not.toContain("Phase 11E");
      expect(appText).not.toContain("Read Model");
      expect(appText).not.toContain("server-authoritative");
    });
  });

  describe("Mobile Drawer Interactions & Accessibility", () => {
    it("toggles mobile menu and handles escape key", () => {
      render(<AdminShell currentPath="/admin" expiresAt={null} />);

      const menuBtn = screen.getByLabelText("打开导航菜单");
      expect(menuBtn.getAttribute("aria-expanded")).toBe("false");

      fireEvent.click(menuBtn);
      expect(menuBtn.getAttribute("aria-expanded")).toBe("true");

      const closeBtn = screen.getByLabelText("关闭导航菜单");
      expect(closeBtn).toBeDefined();

      // Press Escape to close
      fireEvent.keyDown(window, { key: "Escape" });
      expect(menuBtn.getAttribute("aria-expanded")).toBe("false");
    });
  });
});
