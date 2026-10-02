/**
 * UI-02 Commercial Recovery Contract
 *
 * Maps blocked states and safety stop codes to clear user-comprehensible
 * explanations and actionable recovery paths. No dead-end blocking states (CUX-04).
 */

import type { PopupViewState } from "./popupViewState";

export type RecoveryActionKind =
  | "login"
  | "open_settings"
  | "open_workspace"
  | "retry"
  | "logout"
  | "refresh_page"
  | "re_detect";

export interface PopupRecoveryPlan {
  title: string;
  explanation: string;
  primaryActionKind: RecoveryActionKind;
  primaryActionLabel: string;
  secondaryActionKind?: RecoveryActionKind;
  secondaryActionLabel?: string;
}

export function getRecoveryPlan(
  stateOrCode: PopupViewState | string,
  lang: "zh" | "en" = "zh",
): PopupRecoveryPlan | null {
  const isZh = lang === "zh";

  switch (stateOrCode) {
    case "signed_out":
    case "SIGNED_OUT":
      return {
        title: isZh ? "未登录" : "Signed Out",
        explanation: isZh ? "登录后才能使用插件核心功能。" : "Sign in to access extension features.",
        primaryActionKind: "login",
        primaryActionLabel: isZh ? "去登录" : "Sign In",
      };

    case "provider_setup_required":
    case "PROVIDER_NOT_CONFIGURED":
    case "PROVIDER_REQUIRED":
      return {
        title: isZh ? "AI 服务待配置" : "AI Provider Setup Required",
        explanation: isZh
          ? "请在工作台的设置页配置 AI 服务；页面识别仍可直接使用。"
          : "Configure an AI provider in the workspace Settings tab. Detection actions remain available.",
        primaryActionKind: "open_workspace",
        primaryActionLabel: isZh ? "打开工作台" : "Open Workspace",
      };

    case "service_unavailable":
    case "SERVICE_UNAVAILABLE":
      return {
        title: isZh ? "暂时无法验证登录状态" : "Authentication Unavailable",
        explanation: isZh
          ? "无法连接到认证服务，受保护功能暂时保持锁定。"
          : "Could not reach auth service. Protected features remain locked.",
        primaryActionKind: "retry",
        primaryActionLabel: isZh ? "重试验证" : "Retry Verification",
        secondaryActionKind: "logout",
        secondaryActionLabel: isZh ? "退出登录" : "Sign Out",
      };

    case "page_unavailable":
    case "PAGE_UNAVAILABLE":
    case "PAGE_INJECTION_FAILED":
      return {
        title: isZh ? "当前页面不支持" : "Page Not Supported",
        explanation: isZh
          ? "插件无法在浏览器受限页面（如扩展商店或设置页）运行。请切换到支持的网页或刷新重试。"
          : "Extension cannot run on restricted browser pages. Switch to a regular web page or refresh.",
        primaryActionKind: "refresh_page",
        primaryActionLabel: isZh ? "刷新页面" : "Refresh Page",
      };

    case "STALE_QUESTION_REVISION":
    case "STALE_ROOT_CONTEXT":
    case "stale_revision":
      return {
        title: isZh ? "页面题目已变化" : "Question Revision Changed",
        explanation: isZh
          ? "检测到页面内容或题目区域已发生变化，为避免误填，请重新识别。"
          : "Page contents changed. To avoid incorrect answers, please re-detect.",
        primaryActionKind: "re_detect",
        primaryActionLabel: isZh ? "重新识别" : "Re-Detect",
      };

    case "PARTIAL_MUTATION_UNPROVABLE":
    case "partial_mutation":
      return {
        title: isZh ? "填写状态需检查" : "Mutation Check Needed",
        explanation: isZh
          ? "部分选项填写状态不确定，请在完整工作台中查看并核对。"
          : "Some inputs could not be confirmed. Check in the workspace.",
        primaryActionKind: "open_workspace",
        primaryActionLabel: isZh ? "打开工作台检查" : "Open Workspace",
      };

    case "AUTHORITY_LOST":
    case "authority_lost":
      return {
        title: isZh ? "操作权限失效" : "Authority Lost",
        explanation: isZh
          ? "登录状态或操作授权已失效，请重新验证或重新识别。"
          : "Session or authorization expired. Please re-validate or re-detect.",
        primaryActionKind: "re_detect",
        primaryActionLabel: isZh ? "重新识别" : "Re-Detect",
      };

    case "recoverable_error":
    case "transport_failure":
    case "DISPATCH_FAILED":
      return {
        title: isZh ? "通信出现异常" : "Communication Error",
        explanation: isZh
          ? "与当前页面脚本通信中断，请刷新页面后重试。"
          : "Lost communication with page script. Please refresh the page and retry.",
        primaryActionKind: "refresh_page",
        primaryActionLabel: isZh ? "刷新页面" : "Refresh Page",
      };

    default:
      return null;
  }
}
