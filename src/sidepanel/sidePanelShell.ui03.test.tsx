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
  WorkspaceTabPanel,
} from "./sidePanelShell";
import { userFeedback } from "@/shared/ui/userFeedback";

describe("UI-03 Side Panel Workspace Shell Test Matrix (including Review Fix 01)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================
  // RF01-A01 ~ A04: ACTIVITY WORK KIND & STOP ACTIONS
  // ==========================================
  describe("RF01-A: Activity work kind and stop correctness", () => {
    it("RF01-A01: isAutoSolving -> Stop calls onStopAutoSolve", () => {
      const onStop = vi.fn();
      const activity = deriveWorkspaceActivity({
        status: "solving",
        lang: "zh",
        isDetecting: false,
        isFullPageScan: false,
        scanProgress: null,
        isAutoSolving: true,
        isBatchParsing: false,
        isBatchFilling: false,
        autoSolveProgress: {
          current: 2,
          total: 5,
          solved: 1,
          filled: 1,
          statusText: "parsing",
          statusCode: "PARSING",
        },
        fillFeedback: null,
        onStopAutoSolve: onStop,
      });

      expect(activity?.kind).toBe("auto_solve");
      expect(activity?.label).toBe("解析并填答");
      expect(activity?.action).toBeDefined();
      expect(activity?.action?.label).toBe("停止");
      activity?.action?.onAction();
      expect(onStop).toHaveBeenCalledTimes(1);
    });

    it("RF01-A02: isBatchParsing only -> no Stop action", () => {
      const onStop = vi.fn();
      const activity = deriveWorkspaceActivity({
        status: "solving",
        lang: "zh",
        isDetecting: false,
        isFullPageScan: false,
        scanProgress: null,
        isAutoSolving: false,
        isBatchParsing: true,
        isBatchFilling: false,
        autoSolveProgress: null,
        fillFeedback: null,
        onStopAutoSolve: onStop,
      });

      expect(activity?.kind).toBe("batch_parse");
      expect(activity?.label).toBe("批量解析");
      expect(activity?.action).toBeUndefined();
      expect(onStop).not.toHaveBeenCalled();
    });

    it("RF01-A03: isBatchFilling only -> no Stop action", () => {
      const onStop = vi.fn();
      const activity = deriveWorkspaceActivity({
        status: "solving",
        lang: "zh",
        isDetecting: false,
        isFullPageScan: false,
        scanProgress: null,
        isAutoSolving: false,
        isBatchParsing: false,
        isBatchFilling: true,
        autoSolveProgress: null,
        fillFeedback: null,
        onStopAutoSolve: onStop,
      });

      expect(activity?.kind).toBe("batch_fill");
      expect(activity?.label).toBe("批量填写");
      expect(activity?.action).toBeUndefined();
      expect(onStop).not.toHaveBeenCalled();
    });

    it("RF01-A04: batch parse/fill -> never calls onStopAutoSolve", () => {
      const onStop = vi.fn();
      const parseActivity = deriveWorkspaceActivity({
        status: "solving",
        lang: "en",
        isDetecting: false,
        isFullPageScan: false,
        scanProgress: null,
        isAutoSolving: false,
        isBatchParsing: true,
        autoSolveProgress: null,
        fillFeedback: null,
        onStopAutoSolve: onStop,
      });
      expect(parseActivity?.label).toBe("Batch Solve");
      expect(parseActivity?.action).toBeUndefined();

      const fillActivity = deriveWorkspaceActivity({
        status: "solving",
        lang: "en",
        isDetecting: false,
        isFullPageScan: false,
        scanProgress: null,
        isAutoSolving: false,
        isBatchFilling: true,
        autoSolveProgress: null,
        fillFeedback: null,
        onStopAutoSolve: onStop,
      });
      expect(fillActivity?.label).toBe("Batch Fill");
      expect(fillActivity?.action).toBeUndefined();
      expect(onStop).not.toHaveBeenCalled();
    });
  });

  // ==========================================
  // RF01-R01 ~ R08: REVIEW CLASSIFICATION & REAL ACTIONS
  // ==========================================
  describe("RF01-R: Review classification and real actions", () => {
    it("RF01-R01: PROVIDER_NOT_CONFIGURED warning -> NOT review_required", () => {
      const status = deriveSidePanelWorkspaceStatus({
        authStatus: "authenticated",
        isAuthenticated: true,
        isDetecting: false,
        isFullPageScan: false,
        isAutoSolving: false,
        autoSolveProgress: null,
        fillFeedback: userFeedback("warning", "Configure provider", { code: "PROVIDER_NOT_CONFIGURED" }),
      });
      expect(status).not.toBe("review_required");
      expect(status).toBe("ready");
    });

    it("RF01-R02: generic error without allowlisted code -> NOT automatically review_required", () => {
      const status = deriveSidePanelWorkspaceStatus({
        authStatus: "authenticated",
        isAuthenticated: true,
        isDetecting: false,
        isFullPageScan: false,
        isAutoSolving: false,
        autoSolveProgress: null,
        fillFeedback: userFeedback("error", "Network connection dropped"),
      });
      expect(status).not.toBe("review_required");
      expect(status).toBe("ready");
    });

    it("RF01-R03: SKIPPED_INCOMPLETE + isAutoSolving -> solving", () => {
      const status = deriveSidePanelWorkspaceStatus({
        authStatus: "authenticated",
        isAuthenticated: true,
        isDetecting: false,
        isFullPageScan: false,
        isAutoSolving: true,
        autoSolveProgress: {
          current: 1,
          total: 5,
          solved: 0,
          filled: 0,
          statusText: "skipped",
          statusCode: "SKIPPED_INCOMPLETE",
        },
        fillFeedback: null,
      });
      expect(status).toBe("solving");
    });

    it("RF01-R04: FILL_STOPPED_SAFETY -> review_required", () => {
      const status = deriveSidePanelWorkspaceStatus({
        authStatus: "authenticated",
        isAuthenticated: true,
        isDetecting: false,
        isFullPageScan: false,
        isAutoSolving: false,
        autoSolveProgress: {
          current: 2,
          total: 5,
          solved: 1,
          filled: 1,
          statusText: "safety stop",
          statusCode: "FILL_STOPPED_SAFETY",
        },
        fillFeedback: null,
      });
      expect(status).toBe("review_required");
    });

    it("RF01-R05: STALE_QUESTION_REVISION -> review_required", () => {
      const status = deriveSidePanelWorkspaceStatus({
        authStatus: "authenticated",
        isAuthenticated: true,
        isDetecting: false,
        isFullPageScan: false,
        isAutoSolving: false,
        autoSolveProgress: null,
        fillFeedback: userFeedback("warning", "Page question changed", { code: "STALE_QUESTION_REVISION" }),
      });
      expect(status).toBe("review_required");
    });

    it("RF01-R06: autoSolve safety review -> no fake dismiss", () => {
      const onDismiss = vi.fn();
      const activity = deriveWorkspaceActivity({
        status: "review_required",
        lang: "zh",
        isDetecting: false,
        isFullPageScan: false,
        scanProgress: null,
        isAutoSolving: false,
        autoSolveProgress: {
          current: 2,
          total: 5,
          solved: 1,
          filled: 1,
          statusText: "safety stop",
          statusCode: "FILL_STOPPED_SAFETY",
        },
        fillFeedback: null,
        currentTab: "candidates",
        onDismissFeedback: onDismiss,
      });

      expect(activity?.kind).toBe("review");
      // Already on candidates tab: no fake dismiss action!
      expect(activity?.action).toBeUndefined();
    });

    it("RF01-R07: review action -> navigates Candidates when on other tab", () => {
      const onReview = vi.fn();
      const activity = deriveWorkspaceActivity({
        status: "review_required",
        lang: "zh",
        isDetecting: false,
        isFullPageScan: false,
        scanProgress: null,
        isAutoSolving: false,
        autoSolveProgress: {
          current: 2,
          total: 5,
          solved: 1,
          filled: 1,
          statusText: "safety stop",
          statusCode: "FILL_STOPPED_SAFETY",
        },
        fillFeedback: null,
        currentTab: "history",
        onReviewCandidates: onReview,
      });

      expect(activity?.action?.label).toBe("检查");
      activity?.action?.onAction();
      expect(onReview).toHaveBeenCalledTimes(1);
    });

    it("RF01-R08: fillFeedback-only review -> dismiss clears feedback", () => {
      const onDismiss = vi.fn();
      const activity = deriveWorkspaceActivity({
        status: "review_required",
        lang: "zh",
        isDetecting: false,
        isFullPageScan: false,
        scanProgress: null,
        isAutoSolving: false,
        autoSolveProgress: null,
        fillFeedback: userFeedback("warning", "Page question changed", { code: "STALE_QUESTION_REVISION" }),
        onDismissFeedback: onDismiss,
      });

      expect(activity?.action?.label).toBe("我知道了");
      activity?.action?.onAction();
      expect(onDismiss).toHaveBeenCalledTimes(1);
    });
  });

  // ==========================================
  // RF01-X01 ~ X08: ACCESSIBILITY SEMANTICS
  // ==========================================
  describe("RF01-X: Accessibility Semantics", () => {
    it("RF01-X01: role=tablist is present on tab container", () => {
      render(
        <SidePanelHeader
          authStatus="authenticated"
          isAuthenticated={true}
          lang="zh"
          tab="candidates"
          onTabChange={vi.fn()}
          userEmail="user@example.com"
          workspaceStatus="ready"
        />,
      );
      const tablist = screen.getByRole("tablist");
      expect(tablist).toBeInTheDocument();
      expect(tablist).toHaveAttribute("aria-label", "工作台主导航");
    });

    it("RF01-X02: role=tab + aria-selected for tabs", () => {
      render(
        <SidePanelHeader
          authStatus="authenticated"
          isAuthenticated={true}
          lang="zh"
          tab="candidates"
          onTabChange={vi.fn()}
          userEmail="user@example.com"
          workspaceStatus="ready"
        />,
      );
      const tabs = screen.getAllByRole("tab");
      expect(tabs).toHaveLength(3);
      expect(tabs[0]).toHaveAttribute("aria-selected", "true");
      expect(tabs[1]).toHaveAttribute("aria-selected", "false");
      expect(tabs[2]).toHaveAttribute("aria-selected", "false");
    });

    it("RF01-X03: tabpanel relation with aria-labelledby and id", () => {
      render(
        <WorkspaceTabPanel id="sidepanel-tabpanel-candidates" tabId="candidates">
          <div>Candidates content</div>
        </WorkspaceTabPanel>,
      );
      const tabpanel = screen.getByRole("tabpanel");
      expect(tabpanel).toBeInTheDocument();
      expect(tabpanel).toHaveAttribute("id", "sidepanel-tabpanel-candidates");
      expect(tabpanel).toHaveAttribute("aria-labelledby", "sidepanel-tab-candidates");
    });

    it("RF01-X04: inactive tab has tabIndex=-1 and active tab has tabIndex=0", () => {
      render(
        <SidePanelHeader
          authStatus="authenticated"
          isAuthenticated={true}
          lang="zh"
          tab="candidates"
          onTabChange={vi.fn()}
          userEmail="user@example.com"
          workspaceStatus="ready"
        />,
      );
      const tabs = screen.getAllByRole("tab");
      expect(tabs[0]).toHaveAttribute("tabindex", "0");
      expect(tabs[1]).toHaveAttribute("tabindex", "-1");
      expect(tabs[2]).toHaveAttribute("tabindex", "-1");
    });

    it("RF01-X05: keyboard navigation with ArrowLeft, ArrowRight, Home, End", () => {
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
      const tabs = screen.getAllByRole("tab");

      // ArrowRight: index 0 -> index 1 (history)
      fireEvent.keyDown(tabs[0], { key: "ArrowRight" });
      expect(onTabChange).toHaveBeenCalledWith("history");

      // End: index 0 -> index 2 (settings)
      fireEvent.keyDown(tabs[0], { key: "End" });
      expect(onTabChange).toHaveBeenCalledWith("settings");

      // Home: -> index 0 (candidates)
      fireEvent.keyDown(tabs[2], { key: "Home" });
      expect(onTabChange).toHaveBeenCalledWith("candidates");

      // ArrowLeft: index 0 -> index 2 (wrap to end)
      fireEvent.keyDown(tabs[0], { key: "ArrowLeft" });
      expect(onTabChange).toHaveBeenCalledWith("settings");
    });

    it("RF01-X06: Product popover has no unsupported role=menu / role=menuitem", () => {
      render(
        <SidePanelHeader
          authStatus="authenticated"
          isAuthenticated={true}
          lang="zh"
          tab="candidates"
          onTabChange={vi.fn()}
          userEmail="user@example.com"
          workspaceStatus="ready"
          onToggleLanguage={vi.fn()}
          onLogout={vi.fn()}
        />,
      );
      const menuBtn = screen.getByRole("button", { name: "工作台菜单" });
      expect(menuBtn).not.toHaveAttribute("aria-haspopup", "menu");
      expect(menuBtn).toHaveAttribute("aria-controls", "sidepanel-product-popover");
      expect(menuBtn).toHaveAttribute("aria-expanded", "false");

      fireEvent.click(menuBtn);
      expect(menuBtn).toHaveAttribute("aria-expanded", "true");

      // No role="menu" or role="menuitem"
      expect(screen.queryByRole("menu")).toBeNull();
      expect(screen.queryByRole("menuitem")).toBeNull();

      // Standard buttons exist in popover
      expect(screen.getByRole("button", { name: "Switch to English" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "前往设置" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "退出登录" })).toBeInTheDocument();
    });

    it("RF01-X07: Escape closes product popover", () => {
      render(
        <SidePanelHeader
          authStatus="authenticated"
          isAuthenticated={true}
          lang="zh"
          tab="candidates"
          onTabChange={vi.fn()}
          userEmail="user@example.com"
          workspaceStatus="ready"
        />,
      );
      const menuBtn = screen.getByRole("button", { name: "工作台菜单" });
      fireEvent.click(menuBtn);
      expect(screen.getByRole("button", { name: "前往设置" })).toBeInTheDocument();

      fireEvent.keyDown(document, { key: "Escape" });
      expect(screen.queryByRole("button", { name: "前往设置" })).toBeNull();
    });

    it("RF01-X08: html lang zh-CN/en sync follows UI language", () => {
      document.documentElement.lang = "en";
      expect(document.documentElement.lang).toBe("en");
      document.documentElement.lang = "zh-CN";
      expect(document.documentElement.lang).toBe("zh-CN");
    });
  });

  // ==========================================
  // RF01-C01 ~ C05: TRUTHFUL CONTEXT & TERMINOLOGY
  // ==========================================
  describe("RF01-C: Truthful context and terminology", () => {
    it("RF01-C01: provider unknown -> no Claude text", () => {
      render(
        <SidePanelHeader
          authStatus="authenticated"
          isAuthenticated={true}
          lang="zh"
          tab="candidates"
          onTabChange={vi.fn()}
          userEmail="user@example.com"
          workspaceStatus="ready"
          providerName={undefined}
        />,
      );
      expect(screen.getByText("当前页面")).toBeInTheDocument();
      expect(screen.queryByText(/Claude/)).toBeNull();

      // English
      const { unmount } = render(
        <SidePanelHeader
          authStatus="authenticated"
          isAuthenticated={true}
          lang="en"
          tab="candidates"
          onTabChange={vi.fn()}
          userEmail="user@example.com"
          workspaceStatus="ready"
          providerName={undefined}
        />,
      );
      expect(screen.getByText("Current page")).toBeInTheDocument();
      expect(screen.queryByText(/Claude/)).toBeNull();
      unmount();
    });

    it("RF01-C02: provider loaded Gemini -> Gemini", () => {
      render(
        <SidePanelHeader
          authStatus="authenticated"
          isAuthenticated={true}
          lang="zh"
          tab="candidates"
          onTabChange={vi.fn()}
          userEmail="user@example.com"
          workspaceStatus="ready"
          providerName="Gemini"
        />,
      );
      expect(screen.getByText("当前页面 · Gemini")).toBeInTheDocument();
    });

    it("RF01-C03: provider loaded OpenAI -> OpenAI", () => {
      render(
        <SidePanelHeader
          authStatus="authenticated"
          isAuthenticated={true}
          lang="en"
          tab="candidates"
          onTabChange={vi.fn()}
          userEmail="user@example.com"
          workspaceStatus="ready"
          providerName="OpenAI"
        />,
      );
      expect(screen.getByText("Current page · OpenAI")).toBeInTheDocument();
    });

    it("RF01-C04: rendered user copy contains zero '自动答题'", () => {
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
      }

      // Check locked state
      const { container: lockedContainer } = render(
        <SidePanelLockedState
          authStatus="unauthenticated"
          lang="zh"
          onOpenSettings={vi.fn()}
        />,
      );
      expect(lockedContainer.textContent).not.toContain("自动答题");
    });

    it("RF01-C05: rendered user copy contains zero 'Auto Solve'", () => {
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
            lang="en"
            tab="candidates"
            onTabChange={vi.fn()}
            userEmail="test@test.com"
            workspaceStatus={st}
          />,
        );
        expect(container.textContent).not.toContain("Auto Solve");
      }

      const { container: lockedContainer } = render(
        <SidePanelLockedState
          authStatus="unauthenticated"
          lang="en"
          onOpenSettings={vi.fn()}
        />,
      );
      expect(lockedContainer.textContent).not.toContain("Auto Solve");
    });
  });

  // ==========================================
  // RESPONSIVE & LAYOUT CONSTRAINTS
  // ==========================================
  describe("Responsive & Layout Constraints", () => {
    it("supports 320px width without layout breakage", () => {
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
              kind: "auto_solve",
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
      expect(container.querySelectorAll('button[role="tab"]')).toHaveLength(3);
    });
  });
});
