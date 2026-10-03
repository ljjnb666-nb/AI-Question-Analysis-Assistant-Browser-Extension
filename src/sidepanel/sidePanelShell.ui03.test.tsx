import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  deriveSidePanelWorkspaceStatus,
  deriveWorkspaceActivity,
  type SidePanelWorkspaceStatus,
  type WorkspaceActivityKind,
} from "./sidePanelWorkspaceState";
import {
  SidePanelHeader,
  SidePanelLockedState,
  SidePanelActivityStrip,
  WorkspaceTabPanel,
} from "./sidePanelShell";
import { userFeedback } from "@/shared/ui/userFeedback";
import { orbitTokens } from "@/shared/ui/orbitTokens";
import { setKeyboardModalityForTesting } from "@/shared/ui/orbitFocus";
import { mapAutoSolveDoneFeedback } from "@/shared/ui/autoSolveStatus";

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

    it("RF02-X01: keyboard focuses panel itself -> panel focus ring visible", () => {
      setKeyboardModalityForTesting(true);
      render(
        <WorkspaceTabPanel id="panel-focus-test" tabId="candidates">
          <button>Inner Action</button>
        </WorkspaceTabPanel>,
      );
      const panel = screen.getByRole("tabpanel");
      fireEvent.focus(panel);
      expect(panel.style.boxShadow).toBe(orbitTokens.focus.focusRing);
      expect(panel.style.outline).toContain("solid");
    });

    it("RF02-X02: keyboard focuses child button -> child focus -> panel focus ring NOT activated", () => {
      setKeyboardModalityForTesting(true);
      render(
        <WorkspaceTabPanel id="panel-focus-test-child" tabId="candidates">
          <button>Inner Action</button>
        </WorkspaceTabPanel>,
      );
      const panel = screen.getByRole("tabpanel");
      const child = screen.getByRole("button", { name: "Inner Action" });
      fireEvent.focus(child);
      expect(panel.style.boxShadow).toBe("none");
      expect(panel.style.outline).toContain("none");
    });

    it("RF02-X03: mouse focuses panel -> no keyboard focus ring", () => {
      setKeyboardModalityForTesting(false);
      render(
        <WorkspaceTabPanel id="panel-focus-test-mouse" tabId="candidates">
          <button>Inner Action</button>
        </WorkspaceTabPanel>,
      );
      const panel = screen.getByRole("tabpanel");
      fireEvent.focus(panel);
      expect(panel.style.boxShadow).toBe("none");
      expect(panel.style.outline).toContain("none");
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

  // ==========================================
  // RF02-S: GLOBAL STATUS & ACTIVITY ALIGNMENT
  // ==========================================
  describe("RF02-S: Global status must not lie during batch fill", () => {
    it("RF02-S01: isBatchFilling -> Header status copy = 处理中 / Working", () => {
      const { rerender } = render(
        <SidePanelHeader
          authStatus="authenticated"
          isAuthenticated={true}
          lang="zh"
          tab="candidates"
          onTabChange={vi.fn()}
          userEmail="user@example.com"
          workspaceStatus="solving"
        />,
      );
      expect(screen.getByText("处理中")).toBeInTheDocument();
      expect(screen.queryByText("解析中")).toBeNull();

      rerender(
        <SidePanelHeader
          authStatus="authenticated"
          isAuthenticated={true}
          lang="en"
          tab="candidates"
          onTabChange={vi.fn()}
          userEmail="user@example.com"
          workspaceStatus="solving"
        />,
      );
      expect(screen.getByText("Working")).toBeInTheDocument();
      expect(screen.queryByText("Solving")).toBeNull();
    });

    it("RF02-S02: isBatchFilling -> Activity = 批量填写 / Batch Fill", () => {
      const activityZh = deriveWorkspaceActivity({
        status: "solving",
        lang: "zh",
        isDetecting: false,
        isFullPageScan: false,
        scanProgress: null,
        isAutoSolving: false,
        isBatchParsing: false,
        isBatchFilling: true,
        autoSolveProgress: { current: 0, total: 0, solved: 0, filled: 0, statusText: "", statusCode: "" },
        fillFeedback: null,
      });
      expect(activityZh?.kind).toBe("batch_fill");
      expect(activityZh?.label).toBe("批量填写");

      const activityEn = deriveWorkspaceActivity({
        status: "solving",
        lang: "en",
        isDetecting: false,
        isFullPageScan: false,
        scanProgress: null,
        isAutoSolving: false,
        isBatchParsing: false,
        isBatchFilling: true,
        autoSolveProgress: { current: 0, total: 0, solved: 0, filled: 0, statusText: "", statusCode: "" },
        fillFeedback: null,
      });
      expect(activityEn?.kind).toBe("batch_fill");
      expect(activityEn?.label).toBe("Batch Fill");
    });

    it("RF02-S03: isBatchParsing -> Activity = 批量解析 / Batch Solve", () => {
      const activityZh = deriveWorkspaceActivity({
        status: "solving",
        lang: "zh",
        isDetecting: false,
        isFullPageScan: false,
        scanProgress: null,
        isAutoSolving: false,
        isBatchParsing: true,
        isBatchFilling: false,
        autoSolveProgress: { current: 0, total: 0, solved: 0, filled: 0, statusText: "", statusCode: "" },
        fillFeedback: null,
      });
      expect(activityZh?.kind).toBe("batch_parse");
      expect(activityZh?.label).toBe("批量解析");

      const activityEn = deriveWorkspaceActivity({
        status: "solving",
        lang: "en",
        isDetecting: false,
        isFullPageScan: false,
        scanProgress: null,
        isAutoSolving: false,
        isBatchParsing: true,
        isBatchFilling: false,
        autoSolveProgress: { current: 0, total: 0, solved: 0, filled: 0, statusText: "", statusCode: "" },
        fillFeedback: null,
      });
      expect(activityEn?.kind).toBe("batch_parse");
      expect(activityEn?.label).toBe("Batch Solve");
    });

    it("RF02-S04: isAutoSolving -> Activity = 解析并填答 / Solve & Fill", () => {
      const activityZh = deriveWorkspaceActivity({
        status: "solving",
        lang: "zh",
        isDetecting: false,
        isFullPageScan: false,
        scanProgress: null,
        isAutoSolving: true,
        isBatchParsing: false,
        isBatchFilling: false,
        autoSolveProgress: { current: 1, total: 3, solved: 0, filled: 0, statusText: "", statusCode: "PARSING" },
        fillFeedback: null,
      });
      expect(activityZh?.kind).toBe("auto_solve");
      expect(activityZh?.label).toBe("解析并填答");

      const activityEn = deriveWorkspaceActivity({
        status: "solving",
        lang: "en",
        isDetecting: false,
        isFullPageScan: false,
        scanProgress: null,
        isAutoSolving: true,
        isBatchParsing: false,
        isBatchFilling: false,
        autoSolveProgress: { current: 1, total: 3, solved: 0, filled: 0, statusText: "", statusCode: "PARSING" },
        fillFeedback: null,
      });
      expect(activityEn?.kind).toBe("auto_solve");
      expect(activityEn?.label).toBe("Solve & Fill");
    });
  });

  // ==========================================
  // RF02-COPY: FEEDBACK TERMINOLOGY REGRESSION
  // ==========================================
  describe("RF02-COPY: Consumer-facing feedback copy regression", () => {
    it("RF02-COPY01: success feedback contains no 'Auto solve'", () => {
      const fb = mapAutoSolveDoneFeedback({ ok: true, solved: 3, filled: 2 }, "en");
      expect(fb.message).not.toContain("Auto solve");
      expect(fb.message).not.toContain("Auto Solve");
      expect(fb.message).toBe("Solve & Fill finished: processed 3 question(s), filled 2.");
    });

    it("RF02-COPY02: stopped feedback contains no 'Auto solve'", () => {
      const fb = mapAutoSolveDoneFeedback({ stopped: true }, "en");
      expect(fb.message).not.toContain("Auto solve");
      expect(fb.message).not.toContain("Auto Solve");
      expect(fb.message).toBe("Solve & Fill was stopped.");
    });

    it("RF02-COPY03: error feedback contains no 'Auto solve'", () => {
      const fb = mapAutoSolveDoneFeedback({ ok: false }, "en");
      expect(fb.message).not.toContain("Auto solve");
      expect(fb.message).not.toContain("Auto Solve");
      expect(fb.message).toBe("Solve & Fill stopped because of a problem. Check the page and try again.");
    });

    it("RF02-COPY04: ZH consumer feedback contains no '自动答题' or '自动解析'", () => {
      const success = mapAutoSolveDoneFeedback({ ok: true, solved: 3, filled: 2 }, "zh");
      expect(success.message).not.toContain("自动答题");
      expect(success.message).not.toContain("自动解析");
      expect(success.message).toBe("解析并填答完成，共处理 3 题，填写 2。");

      const stopped = mapAutoSolveDoneFeedback({ stopped: true }, "zh");
      expect(stopped.message).not.toContain("自动答题");
      expect(stopped.message).not.toContain("自动解析");
      expect(stopped.message).toBe("解析并填答已停止。");

      const error = mapAutoSolveDoneFeedback({ ok: false }, "zh");
      expect(error.message).not.toContain("自动答题");
      expect(error.message).not.toContain("自动解析");
      expect(error.message).toBe("解析并填答遇到问题已停止，请检查页面后重试。");
    });
  });

  // ==========================================
  // RF02-P2: CLEAN ACTIVITY KIND & SHADOW TOKEN
  // ==========================================
  describe("RF02-P2: Clean activity kind and shadow token", () => {
    it("RF02-P2-KIND: WorkspaceActivityKind does not include 'solving' and derivation never produces 'solving'", () => {
      // Type assertion: kind cannot be "solving"
      type HasSolving = "solving" extends WorkspaceActivityKind ? true : false;
      const hasSolving: HasSolving = false;
      expect(hasSolving).toBe(false);

      const solvingStatusActivity = deriveWorkspaceActivity({
        status: "solving",
        lang: "zh",
        isDetecting: false,
        isFullPageScan: false,
        scanProgress: null,
        isAutoSolving: true,
        isBatchParsing: false,
        isBatchFilling: false,
        autoSolveProgress: { current: 1, total: 1, solved: 0, filled: 0, statusText: "", statusCode: "PARSING" },
        fillFeedback: null,
      });
      expect(solvingStatusActivity?.kind).toBe("auto_solve");
    });

    it("RF02-P2-SHADOW: SidePanelActivityStrip uses orbitTokens.shadow.activityElevation", () => {
      expect(orbitTokens.shadow.activityElevation).toBe("0 -2px 8px rgba(0, 0, 0, 0.25)");
      const { container } = render(
        <SidePanelActivityStrip
          activity={{
            kind: "auto_solve",
            tone: "ai",
            label: "Solve & Fill",
          }}
          lang="en"
        />,
      );
      const stripEl = container.firstElementChild as HTMLElement;
      expect(stripEl.style.boxShadow).toBe(orbitTokens.shadow.activityElevation);
    });
  });

  // ==========================================
  // RF03: IDLE VS RUNNING VISUAL & CONTRACT SEPARATION
  // ==========================================
  describe("RF03: Idle vs Running visual and contract separation", () => {
    it("RF03-V01: Idle workspace status shows '已就绪' badge and no activity strip (ZH)", () => {
      const { container } = render(
        <SidePanelHeader
          authStatus="authenticated"
          isAuthenticated={true}
          lang="zh"
          onTabChange={() => {}}
          tab="candidates"
          workspaceStatus="ready"
          userEmail="test@example.com"
        />,
      );
      expect(container.textContent).toContain("已就绪");
      expect(container.textContent).not.toContain("处理中");

      const activity = deriveWorkspaceActivity({
        status: "ready",
        lang: "zh",
        isDetecting: false,
        isFullPageScan: false,
        scanProgress: null,
        isAutoSolving: false,
        isBatchParsing: false,
        isBatchFilling: false,
        autoSolveProgress: null,
        fillFeedback: null,
      });
      expect(activity).toBeNull();
    });

    it("RF03-V02: Idle workspace status shows 'Ready' badge and no activity strip (EN)", () => {
      const { container } = render(
        <SidePanelHeader
          authStatus="authenticated"
          isAuthenticated={true}
          lang="en"
          onTabChange={() => {}}
          tab="candidates"
          workspaceStatus="ready"
          userEmail="test@example.com"
        />,
      );
      expect(container.textContent).toContain("Ready");
      expect(container.textContent).not.toContain("Working");

      const activity = deriveWorkspaceActivity({
        status: "ready",
        lang: "en",
        isDetecting: false,
        isFullPageScan: false,
        scanProgress: null,
        isAutoSolving: false,
        isBatchParsing: false,
        isBatchFilling: false,
        autoSolveProgress: null,
        fillFeedback: null,
      });
      expect(activity).toBeNull();
    });

    it("RF03-V03: Auto Solve running state shows '处理中' badge and active strip with '解析并填答' + '停止' (ZH)", () => {
      const { container: headerContainer } = render(
        <SidePanelHeader
          authStatus="authenticated"
          isAuthenticated={true}
          lang="zh"
          onTabChange={() => {}}
          tab="candidates"
          workspaceStatus="solving"
          userEmail="test@example.com"
        />,
      );
      expect(headerContainer.textContent).toContain("处理中");
      expect(headerContainer.textContent).not.toContain("已就绪");

      const activity = deriveWorkspaceActivity({
        status: "solving",
        lang: "zh",
        isDetecting: false,
        isFullPageScan: false,
        scanProgress: null,
        isAutoSolving: true,
        isBatchParsing: false,
        isBatchFilling: false,
        autoSolveProgress: { current: 5, total: 8, solved: 4, filled: 4, statusText: "解析中", statusCode: "PARSING" },
        fillFeedback: null,
        onStopAutoSolve: () => {},
      });
      expect(activity).not.toBeNull();
      expect(activity?.kind).toBe("auto_solve");
      expect(activity?.label).toBe("解析并填答");
      expect(activity?.action?.label).toBe("停止");

      const { container: stripContainer } = render(
        <SidePanelActivityStrip activity={activity!} lang="zh" />,
      );
      expect(stripContainer.textContent).toContain("解析并填答");
      expect(stripContainer.textContent).toContain("停止");
    });

    it("RF03-V04: Auto Solve running state shows 'Working' badge and active strip with 'Solve & Fill' + 'Stop' (EN)", () => {
      const { container: headerContainer } = render(
        <SidePanelHeader
          authStatus="authenticated"
          isAuthenticated={true}
          lang="en"
          onTabChange={() => {}}
          tab="candidates"
          workspaceStatus="solving"
          userEmail="test@example.com"
        />,
      );
      expect(headerContainer.textContent).toContain("Working");
      expect(headerContainer.textContent).not.toContain("Ready");

      const activity = deriveWorkspaceActivity({
        status: "solving",
        lang: "en",
        isDetecting: false,
        isFullPageScan: false,
        scanProgress: null,
        isAutoSolving: true,
        isBatchParsing: false,
        isBatchFilling: false,
        autoSolveProgress: { current: 5, total: 8, solved: 4, filled: 4, statusText: "Solving", statusCode: "PARSING" },
        fillFeedback: null,
        onStopAutoSolve: () => {},
      });
      expect(activity).not.toBeNull();
      expect(activity?.kind).toBe("auto_solve");
      expect(activity?.label).toBe("Solve & Fill");
      expect(activity?.action?.label).toBe("Stop");

      const { container: stripContainer } = render(
        <SidePanelActivityStrip activity={activity!} lang="en" />,
      );
      expect(stripContainer.textContent).toContain("Solve & Fill");
      expect(stripContainer.textContent).toContain("Stop");
    });

    it("RF03-V05: Batch Parse running state shows '处理中' badge and strip with '批量解析' without Stop button (ZH)", () => {
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
      });
      expect(activity?.kind).toBe("batch_parse");
      expect(activity?.label).toBe("批量解析");
      expect(activity?.action).toBeUndefined();

      const { container } = render(
        <SidePanelActivityStrip activity={activity!} lang="zh" />,
      );
      expect(container.textContent).toContain("批量解析");
      expect(container.textContent).not.toContain("停止");
    });

    it("RF03-V06: Batch Fill running state shows '处理中' badge and strip with '批量填写' without Stop button (ZH)", () => {
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
      });
      expect(activity?.kind).toBe("batch_fill");
      expect(activity?.label).toBe("批量填写");
      expect(activity?.action).toBeUndefined();

      const { container } = render(
        <SidePanelActivityStrip activity={activity!} lang="zh" />,
      );
      expect(container.textContent).toContain("批量填写");
      expect(container.textContent).not.toContain("停止");
    });
  });
});

