import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  deriveSidePanelWorkspaceStatus,
  deriveWorkspaceActivity,
  type SidePanelWorkspaceStatus,
} from "./sidePanelWorkspaceState";
import {
  SidePanelHeader,
  SidePanelLockedState,
  SidePanelActivityStrip,
} from "./sidePanelShell";
import { userFeedback } from "@/shared/ui/userFeedback";

describe("UI-03 Side Panel Workspace Shell Test Matrix", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================
  // STATUS DERIVATION & PRIORITY TESTS
  // ==========================================
  describe("deriveSidePanelWorkspaceStatus priority rules", () => {
    it("UI03-S02 / UI03-P01: Priority 1 - session checking takes highest precedence", () => {
      const status = deriveSidePanelWorkspaceStatus({
        authStatus: "loading",
        isAuthenticated: false,
        isDetecting: true,
        isFullPageScan: true,
        isAutoSolving: true,
        autoSolveProgress: {
          current: 1,
          total: 5,
          solved: 1,
          filled: 1,
          statusText: "working",
          statusCode: "FILL_STOPPED_SAFETY",
        },
        fillFeedback: userFeedback("error", "Safety stop"),
      });
      expect(status).toBe("checking_session");

      const validatingStatus = deriveSidePanelWorkspaceStatus({
        authStatus: "validating",
        isAuthenticated: true,
        isDetecting: true,
        isFullPageScan: false,
        isAutoSolving: false,
        autoSolveProgress: null,
        fillFeedback: null,
      });
      expect(validatingStatus).toBe("checking_session");
    });

    it("UI03-S04 / UI03-P02: Priority 2 - server unavailable beats signed out and active work", () => {
      const status = deriveSidePanelWorkspaceStatus({
        authStatus: "server_unavailable",
        isAuthenticated: false,
        isDetecting: true,
        isFullPageScan: false,
        isAutoSolving: false,
        autoSolveProgress: null,
        fillFeedback: null,
      });
      expect(status).toBe("service_unavailable");
    });

    it("UI03-S03 / UI03-P03: Priority 3 - signed out beats running flags", () => {
      const status = deriveSidePanelWorkspaceStatus({
        authStatus: "unauthenticated",
        isAuthenticated: false,
        isDetecting: true,
        isFullPageScan: true,
        isAutoSolving: true,
        autoSolveProgress: null,
        fillFeedback: null,
      });
      expect(status).toBe("signed_out");
    });

    it("UI03-A04 / UI03-P04: Priority 4 - safety review beats normal solving, scanning, detecting", () => {
      // AutoSolve statusCode error (FILL_STOPPED_SAFETY)
      const safetyStatus = deriveSidePanelWorkspaceStatus({
        authStatus: "authenticated",
        isAuthenticated: true,
        isDetecting: true,
        isFullPageScan: true,
        isAutoSolving: true,
        autoSolveProgress: {
          current: 3,
          total: 10,
          solved: 2,
          filled: 2,
          statusText: "safety stop",
          statusCode: "FILL_STOPPED_SAFETY",
        },
        fillFeedback: null,
      });
      expect(safetyStatus).toBe("review_required");

      // Warning tone from skip or fill feedback
      const warningStatus = deriveSidePanelWorkspaceStatus({
        authStatus: "authenticated",
        isAuthenticated: true,
        isDetecting: false,
        isFullPageScan: false,
        isAutoSolving: false,
        autoSolveProgress: null,
        fillFeedback: userFeedback("warning", "Page revision changed", { code: "STALE_QUESTION_REVISION" }),
      });
      expect(warningStatus).toBe("review_required");
    });

    it("UI03-A03 / UI03-P05: Priority 5 - solving beats scanning and detecting", () => {
      const status = deriveSidePanelWorkspaceStatus({
        authStatus: "authenticated",
        isAuthenticated: true,
        isDetecting: true,
        isFullPageScan: true,
        isAutoSolving: true,
        autoSolveProgress: {
          current: 2,
          total: 5,
          solved: 1,
          filled: 1,
          statusText: "parsing",
          statusCode: "PARSING",
        },
        fillFeedback: null,
      });
      expect(status).toBe("solving");
    });

    it("UI03-A02 / UI03-P06: Priority 6 - scanning beats detecting", () => {
      const status = deriveSidePanelWorkspaceStatus({
        authStatus: "authenticated",
        isAuthenticated: true,
        isDetecting: true,
        isFullPageScan: true,
        isAutoSolving: false,
        autoSolveProgress: null,
        fillFeedback: null,
      });
      expect(status).toBe("scanning");
    });

    it("UI03-A01 / UI03-P07: Priority 7 - detecting", () => {
      const status = deriveSidePanelWorkspaceStatus({
        authStatus: "authenticated",
        isAuthenticated: true,
        isDetecting: true,
        isFullPageScan: false,
        isAutoSolving: false,
        autoSolveProgress: null,
        fillFeedback: null,
      });
      expect(status).toBe("detecting");
    });

    it("UI03-S01 / UI03-P08: Priority 8 - ready when authenticated and idle", () => {
      const status = deriveSidePanelWorkspaceStatus({
        authStatus: "authenticated",
        isAuthenticated: true,
        isDetecting: false,
        isFullPageScan: false,
        isAutoSolving: false,
        autoSolveProgress: null,
        fillFeedback: null,
      });
      expect(status).toBe("ready");
    });
  });

  // ==========================================
  // WORKSPACE ACTIVITY DERIVATION
  // ==========================================
  describe("deriveWorkspaceActivity", () => {
    it("UI03-A05: returns null when idle", () => {
      const activity = deriveWorkspaceActivity({
        status: "ready",
        lang: "zh",
        isDetecting: false,
        isFullPageScan: false,
        scanProgress: null,
        isAutoSolving: false,
        autoSolveProgress: null,
        fillFeedback: null,
      });
      expect(activity).toBeNull();
    });

    it("UI03-A01: detecting activity", () => {
      const zhActivity = deriveWorkspaceActivity({
        status: "detecting",
        lang: "zh",
        isDetecting: true,
        isFullPageScan: false,
        scanProgress: null,
        isAutoSolving: false,
        autoSolveProgress: null,
        fillFeedback: null,
      });
      expect(zhActivity?.kind).toBe("detecting");
      expect(zhActivity?.tone).toBe("info");
      expect(zhActivity?.label).toBe("正在识别当前页面");

      const enActivity = deriveWorkspaceActivity({
        status: "detecting",
        lang: "en",
        isDetecting: true,
        isFullPageScan: false,
        scanProgress: null,
        isAutoSolving: false,
        autoSolveProgress: null,
        fillFeedback: null,
      });
      expect(enActivity?.label).toBe("Detecting current page...");
    });

    it("UI03-A02: scanning activity with real progress and cancel action", () => {
      const onCancel = vi.fn();
      const activity = deriveWorkspaceActivity({
        status: "scanning",
        lang: "zh",
        isDetecting: false,
        isFullPageScan: true,
        scanProgress: { step: 4, total: 10, found: 8, progress: 40 },
        isAutoSolving: false,
        autoSolveProgress: null,
        fillFeedback: null,
        onCancelFullPage: onCancel,
      });
      expect(activity?.kind).toBe("scanning");
      expect(activity?.tone).toBe("info");
      expect(activity?.label).toBe("整页扫描");
      expect(activity?.secondary).toBe("第 4 / 10 步 · 已发现 8 题");
      expect(activity?.progress).toBe(40);
      expect(activity?.action?.label).toBe("停止");
      activity?.action?.onAction();
      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it("UI03-A03: solving activity with Solve & Fill terminology and stop action", () => {
      const onStop = vi.fn();
      const activity = deriveWorkspaceActivity({
        status: "solving",
        lang: "zh",
        isDetecting: false,
        isFullPageScan: false,
        scanProgress: null,
        isAutoSolving: true,
        autoSolveProgress: {
          current: 5,
          total: 8,
          solved: 4,
          filled: 4,
          statusText: "parsing",
          statusCode: "PARSING",
        },
        fillFeedback: null,
        onStopAutoSolve: onStop,
      });
      expect(activity?.kind).toBe("solving");
      expect(activity?.tone).toBe("ai");
      expect(activity?.label).toBe("解析并填答");
      expect(activity?.secondary).toBe("第 5 / 8 题 · 已填写 4 题");
      expect(activity?.action?.label).toBe("停止");
      activity?.action?.onAction();
      expect(onStop).toHaveBeenCalledTimes(1);

      // Verify EN terminology
      const enActivity = deriveWorkspaceActivity({
        status: "solving",
        lang: "en",
        isDetecting: false,
        isFullPageScan: false,
        scanProgress: null,
        isAutoSolving: true,
        autoSolveProgress: {
          current: 5,
          total: 8,
          solved: 4,
          filled: 4,
          statusText: "parsing",
        },
        fillFeedback: null,
      });
      expect(enActivity?.label).toBe("Solve & Fill");
      expect(enActivity?.secondary).toBe("Question 5 / 8 · Filled 4");
    });

    it("UI03-A04: safety review activity", () => {
      const onDismiss = vi.fn();
      const activity = deriveWorkspaceActivity({
        status: "review_required",
        lang: "zh",
        isDetecting: false,
        isFullPageScan: false,
        scanProgress: null,
        isAutoSolving: false,
        autoSolveProgress: {
          current: 3,
          total: 5,
          solved: 2,
          filled: 2,
          statusText: "safety",
          statusCode: "FILL_STOPPED_SAFETY",
          statusDetail: "STALE_QUESTION_REVISION",
        },
        fillFeedback: null,
        onDismissFeedback: onDismiss,
      });
      expect(activity?.kind).toBe("review");
      expect(activity?.tone).toBe("error");
      expect(activity?.label).toBe("需要检查");
      expect(activity?.action?.label).toBe("我知道了");
      activity?.action?.onAction();
      expect(onDismiss).toHaveBeenCalledTimes(1);
    });
  });

  // ==========================================
  // HEADER & APP BAR RENDERING
  // ==========================================
  describe("SidePanelHeader UI tests", () => {
    it("UI03-S01: renders compact app bar with app title and context line", () => {
      render(
        <SidePanelHeader
          authStatus="authenticated"
          isAuthenticated={true}
          lang="zh"
          tab="candidates"
          onTabChange={vi.fn()}
          userEmail="user@example.com"
          workspaceStatus="ready"
          providerName="Claude"
        />,
      );
      expect(screen.getByText("题目解析助手")).toBeInTheDocument();
      expect(screen.getByText("当前页面 · Claude")).toBeInTheDocument();
      expect(screen.getByText("已就绪")).toBeInTheDocument();
    });

    it("UI03-N01 to UI03-N04: renders tabs with standard navigation and handles tab selection", () => {
      const onTabChange = vi.fn();
      render(
        <SidePanelHeader
          authStatus="authenticated"
          isAuthenticated={true}
          lang="zh"
          tab="candidates"
          onTabChange={onTabChange}
          userEmail="user@example.com"
          workspaceStatus="ready"
        />,
      );

      const nav = screen.getByRole("navigation");
      expect(nav).toBeInTheDocument();

      const candidatesTab = screen.getByRole("button", { name: "候选题" });
      const historyTab = screen.getByRole("button", { name: "历史" });
      const settingsTab = screen.getByRole("button", { name: "设置" });

      expect(candidatesTab).toHaveAttribute("aria-pressed", "true");
      expect(historyTab).toHaveAttribute("aria-pressed", "false");
      expect(settingsTab).toHaveAttribute("aria-pressed", "false");

      fireEvent.click(historyTab);
      expect(onTabChange).toHaveBeenCalledWith("history");
    });

    it("UI03-N05: tab keyboard navigation (ArrowRight, ArrowLeft, Home, End)", () => {
      const onTabChange = vi.fn();
      render(
        <SidePanelHeader
          authStatus="authenticated"
          isAuthenticated={true}
          lang="zh"
          tab="candidates"
          onTabChange={onTabChange}
          userEmail="user@example.com"
          workspaceStatus="ready"
        />,
      );

      const candidatesTab = screen.getByRole("button", { name: "候选题" });

      // ArrowRight moves from candidates (index 0) to history (index 1)
      fireEvent.keyDown(candidatesTab, { key: "ArrowRight" });
      expect(onTabChange).toHaveBeenCalledWith("history");

      // End moves to last tab (settings)
      fireEvent.keyDown(candidatesTab, { key: "End" });
      expect(onTabChange).toHaveBeenCalledWith("settings");

      // Home moves to first tab (candidates)
      fireEvent.keyDown(candidatesTab, { key: "Home" });
      expect(onTabChange).toHaveBeenCalledWith("candidates");
    });

    it("UI03-S03: does not render tabs when unauthenticated", () => {
      render(
        <SidePanelHeader
          authStatus="unauthenticated"
          isAuthenticated={false}
          lang="zh"
          tab="settings"
          onTabChange={vi.fn()}
          userEmail=""
          workspaceStatus="signed_out"
        />,
      );
      expect(screen.queryByRole("navigation")).toBeNull();
      expect(screen.getByText("未登录")).toBeInTheDocument();
      expect(screen.getByText("登录账号")).toBeInTheDocument();
    });

    it("renders product menu with switch language, settings, and logout", () => {
      const onToggleLang = vi.fn();
      const onLogout = vi.fn();
      const onTabChange = vi.fn();

      render(
        <SidePanelHeader
          authStatus="authenticated"
          isAuthenticated={true}
          lang="zh"
          tab="candidates"
          onTabChange={onTabChange}
          userEmail="operator@example.com"
          workspaceStatus="ready"
          onToggleLanguage={onToggleLang}
          onLogout={onLogout}
        />,
      );

      const menuButton = screen.getByRole("button", { name: "工作台菜单" });
      expect(menuButton).toBeInTheDocument();

      // Open menu
      fireEvent.click(menuButton);

      // Verify email, switch language, settings, logout items
      expect(screen.getByText("operator@example.com")).toBeInTheDocument();
      expect(screen.getByRole("menuitem", { name: "Switch to English" })).toBeInTheDocument();
      expect(screen.getByRole("menuitem", { name: "前往设置" })).toBeInTheDocument();
      expect(screen.getByRole("menuitem", { name: "退出登录" })).toBeInTheDocument();

      // Click toggle language
      fireEvent.click(screen.getByRole("menuitem", { name: "Switch to English" }));
      expect(onToggleLang).toHaveBeenCalledTimes(1);
    });
  });

  // ==========================================
  // LOCKED STATE TESTS
  // ==========================================
  describe("SidePanelLockedState", () => {
    it("UI03-S02: checking session shows no CTA buttons", () => {
      const onOpenSettings = vi.fn();
      render(
        <SidePanelLockedState
          authStatus="validating"
          lang="zh"
          onOpenSettings={onOpenSettings}
        />,
      );
      expect(screen.getByText("正在验证登录状态")).toBeInTheDocument();
      expect(screen.getByText("受保护功能暂时保持锁定")).toBeInTheDocument();
      expect(screen.queryByRole("button")).toBeNull();
    });

    it("UI03-S04: server unavailable shows retry and open settings buttons", () => {
      const onOpenSettings = vi.fn();
      const onRetry = vi.fn();
      render(
        <SidePanelLockedState
          authStatus="server_unavailable"
          lang="zh"
          onOpenSettings={onOpenSettings}
          onRetryValidation={onRetry}
        />,
      );
      expect(screen.getByText("暂时无法验证登录状态")).toBeInTheDocument();
      expect(screen.getByText("工作台保持锁定")).toBeInTheDocument();

      const retryBtn = screen.getByRole("button", { name: "重试" });
      const settingsBtn = screen.getByRole("button", { name: "前往设置" });

      fireEvent.click(retryBtn);
      expect(onRetry).toHaveBeenCalledTimes(1);

      fireEvent.click(settingsBtn);
      expect(onOpenSettings).toHaveBeenCalledTimes(1);
    });

    it("UI03-S03: signed out shows sign-in button without marketing hero or auto-solve copy", () => {
      const onOpenSettings = vi.fn();
      const { container } = render(
        <SidePanelLockedState
          authStatus="unauthenticated"
          lang="zh"
          onOpenSettings={onOpenSettings}
        />,
      );
      expect(screen.getByText("登录后使用工作台")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "登录 / 前往设置" })).toBeInTheDocument();

      // Verify no "自动答题" in text
      expect(container.textContent).not.toContain("自动答题");
      expect(container.textContent).not.toContain("Auto Solve");
    });
  });

  // ==========================================
  // ACTIVITY STRIP COMPONENT TESTS
  // ==========================================
  describe("SidePanelActivityStrip component", () => {
    it("renders activity with status role and action button", () => {
      const onAction = vi.fn();
      render(
        <SidePanelActivityStrip
          activity={{
            kind: "solving",
            tone: "ai",
            label: "解析并填答",
            secondary: "第 3 / 5 题 · 已填写 2 题",
            action: { label: "停止", onAction },
          }}
          lang="zh"
        />,
      );

      const statusEl = screen.getByRole("status");
      expect(statusEl).toBeInTheDocument();
      expect(screen.getByText("解析并填答")).toBeInTheDocument();
      expect(screen.getByText("第 3 / 5 题 · 已填写 2 题")).toBeInTheDocument();

      const stopBtn = screen.getByRole("button", { name: "停止" });
      fireEvent.click(stopBtn);
      expect(onAction).toHaveBeenCalledTimes(1);
    });

    it("renders progressbar when numerical progress is provided", () => {
      render(
        <SidePanelActivityStrip
          activity={{
            kind: "scanning",
            tone: "info",
            label: "整页扫描",
            secondary: "第 2 / 10 步",
            progress: 20,
          }}
          lang="zh"
        />,
      );
      const progressbar = screen.getByRole("progressbar");
      expect(progressbar).toBeInTheDocument();
      expect(progressbar).toHaveAttribute("aria-valuenow", "20");
    });
  });

  // ==========================================
  // ACCESSIBILITY & RESPONSIVE CONSTRAINTS
  // ==========================================
  describe("Accessibility & Responsive", () => {
    it("UI03-X04 / UI03-X05: supports 320px width without layout breakage", () => {
      const { container } = render(
        <div style={{ width: 320, overflow: "hidden" }}>
          <SidePanelHeader
            authStatus="authenticated"
            isAuthenticated={true}
            lang="en"
            tab="candidates"
            onTabChange={vi.fn()}
            userEmail="test@example.com"
            workspaceStatus="solving"
            providerName="Anthropic Claude 3.5 Sonnet"
          />
          <SidePanelActivityStrip
            activity={{
              kind: "solving",
              tone: "ai",
              label: "Solve & Fill",
              secondary: "Question 5 / 8 · Filled 4",
              action: { label: "Stop", onAction: vi.fn() },
            }}
            lang="en"
          />
        </div>,
      );
      expect(screen.getByText("Quiz Solver")).toBeInTheDocument();
      expect(screen.getByText("Solve & Fill")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();
      expect(container.querySelectorAll('button[aria-controls^="sidepanel-tabpanel"]')).toHaveLength(3);
    });

    it("UI03-R05: No automatic submission text anywhere in shell copy", () => {
      const allStatuses: SidePanelWorkspaceStatus[] = [
        "checking_session",
        "signed_out",
        "service_unavailable",
        "ready",
        "detecting",
        "scanning",
        "solving",
        "review_required",
      ];
      for (const st of allStatuses) {
        const { container } = render(
          <SidePanelHeader
            authStatus={st === "signed_out" ? "unauthenticated" : "authenticated"}
            isAuthenticated={st !== "signed_out"}
            lang="zh"
            tab="candidates"
            onTabChange={vi.fn()}
            userEmail="test@test.com"
            workspaceStatus={st}
          />,
        );
        expect(container.textContent).not.toContain("自动答题");
        expect(container.textContent).not.toContain("Auto Solve");
      }
    });
  });
});
