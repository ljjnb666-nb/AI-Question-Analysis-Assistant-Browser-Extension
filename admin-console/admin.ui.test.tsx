import React from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
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
      render(<AdminShell currentPath="/admin" expiresAt={null} />);

      const logoutForm = document.querySelector('form[action="/admin/logout"]');
      expect(logoutForm).not.toBeNull();
      expect(logoutForm?.getAttribute("method")).toBe("POST");

      const submitBtn = logoutForm?.querySelector('button[type="submit"]');
      expect(submitBtn?.textContent).toContain("退出登录");
    });
  });

  describe("Analytics Truth Copy Invariant (Repair 2)", () => {
    it("renders frozen analytics truth copy on overview route (/admin)", () => {
      render(<AdminShell currentPath="/admin" expiresAt={null} />);

      // Metrics in /admin
      expect(screen.getByText("已授权活跃设备")).toBeDefined();
      expect(screen.getByText("解析结果数")).toBeDefined();
      expect(screen.getByText("观测解析结果成功率")).toBeDefined();
      expect(screen.getByText("观测解析耗时")).toBeDefined();

      // Section descriptions in /admin
      expect(
        screen.getByText("展示已授权设备活跃度与解析结果统计"),
      ).toBeDefined();
      expect(
        screen.getByText("展示已授权设备的最新观测扩展版本分布"),
      ).toBeDefined();

      // Ensure obsolete / ungrounded copy is absent
      expect(screen.queryByText("活跃设备")).toBeNull();
      expect(screen.queryByText("解析请求数")).toBeNull();
      expect(screen.queryByText("解析成功率")).toBeNull();
      expect(screen.queryByText("平均响应时延")).toBeNull();
    });

    it("renders frozen analytics truth copy on analytics route (/admin/analytics)", () => {
      render(<AdminShell currentPath="/admin/analytics" expiresAt={null} />);

      // Metrics in /admin/analytics
      const resultsCounts = screen.getAllByText("解析结果数");
      expect(resultsCounts.length).toBeGreaterThanOrEqual(1);
      const providerRatios = screen.getAllByText("解析结果提供商分布");
      expect(providerRatios.length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText("解析错误分类")).toBeDefined();
      expect(screen.getByText("观测版本分布")).toBeDefined();

      // Section descriptions in /admin/analytics
      expect(screen.getByText("解析结果趋势")).toBeDefined();
      expect(
        screen.getByText("展示各提供商观测到的解析结果分布"),
      ).toBeDefined();

      // Ensure obsolete copy is absent
      expect(screen.queryByText("总解析量")).toBeNull();
      expect(screen.queryByText("模型调用分布")).toBeNull();
      expect(screen.queryByText("错误分类分布")).toBeNull();
      expect(screen.queryByText("活跃版本数")).toBeNull();
      expect(screen.queryByText("解析请求趋势")).toBeNull();
      expect(screen.queryByText("提供商与模型占比")).toBeNull();
    });

    it("guarantees placeholder metric cards display placeholder dashes and no fake numbers or ungrounded metrics", () => {
      render(<AdminShell currentPath="/admin" expiresAt={null} />);

      expect(
        screen.queryByText(
          /1284|99\.8%|3\.2k|\$|DAU|WAU|MAU|API request count|模型调用次数|HTTP request count|真实总安装量/i,
        ),
      ).toBeNull();

      const dashes = screen.getAllByText("—");
      expect(dashes.length).toBeGreaterThanOrEqual(4);
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

  describe("Mobile Drawer Keyboard Accessibility & Focus Management (Repair 1)", () => {
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
});
