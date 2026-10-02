/**
 * UI-02 Action Readiness Contract
 *
 * Provides a pure presentation readiness model so that buttons do not ad-hoc
 * evaluate booleans inside JSX. Every disabled state carries a clear reasonCode
 * and localized user reason.
 */

export type PopupActionId =
  | "detect_current"
  | "manual_capture"
  | "scan_full_page"
  | "solve_fill"
  | "open_workspace";

export type PopupActionReadiness = {
  enabled: boolean;
  reason?: string;
  reasonCode?: string;
};

export interface PopupActionContext {
  isAuthenticated: boolean;
  isPageInjectable: boolean;
  hasApiKey: boolean;
  isRunning?: boolean;
  lang?: "zh" | "en";
}

export function derivePopupActionReadiness(
  actionId: PopupActionId,
  context: PopupActionContext,
): PopupActionReadiness {
  const {
    isAuthenticated,
    isPageInjectable,
    hasApiKey,
    isRunning = false,
    lang = "zh",
  } = context;

  const isZh = lang === "zh";

  // Open Workspace only requires authentication.
  if (actionId === "open_workspace") {
    if (!isAuthenticated) {
      return {
        enabled: false,
        reasonCode: "AUTH_REQUIRED",
        reason: isZh ? "登录后解锁工作台" : "Sign in to unlock workspace",
      };
    }
    return { enabled: true };
  }

  // All page-interacting actions require authentication first.
  if (!isAuthenticated) {
    return {
      enabled: false,
      reasonCode: "AUTH_REQUIRED",
      reason: isZh ? "请先登录账号" : "Sign in required",
    };
  }

  // Next, require an injectable/supported page.
  if (!isPageInjectable) {
    return {
      enabled: false,
      reasonCode: "PAGE_UNSUPPORTED",
      reason: isZh ? "当前页面不支持此操作" : "Page not supported for this action",
    };
  }

  // If a task is currently executing, other page actions are busy.
  if (isRunning) {
    return {
      enabled: false,
      reasonCode: "RUNNING",
      reason: isZh ? "正在执行任务..." : "Task in progress...",
    };
  }

  // Solve & Fill additionally requires AI provider to be configured.
  if (actionId === "solve_fill") {
    if (!hasApiKey) {
      return {
        enabled: false,
        reasonCode: "PROVIDER_REQUIRED",
        reason: isZh ? "未配置 AI 服务" : "AI provider not configured",
      };
    }
  }

  // Manual Capture, Detect Current, Scan Full Page do NOT require AI provider.
  return { enabled: true };
}
