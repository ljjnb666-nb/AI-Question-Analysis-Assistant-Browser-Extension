import type {
  AdminErrorCategoryType,
  AdminProviderType,
} from "../types/adminAnalytics";

const numberFormatter = new Intl.NumberFormat("zh-CN");

export function formatNumber(
  value: number | null | undefined,
  fallback = "0",
): string {
  if (value == null || !Number.isFinite(value)) return fallback;
  return numberFormatter.format(value);
}

export function formatPercent(
  ratio: number | null | undefined,
  fallback = "—",
): string {
  if (ratio == null || !Number.isFinite(ratio)) return fallback;
  const percent = ratio * 100;
  if (percent === 0) return "0%";
  if (percent === 100) return "100%";
  const formatted = percent.toFixed(1);
  return formatted.endsWith(".0")
    ? `${formatted.slice(0, -2)}%`
    : `${formatted}%`;
}

export function formatDuration(
  ms: number | null | undefined,
  fallback = "—",
): string {
  if (ms == null || !Number.isFinite(ms)) return fallback;
  if (ms < 1000) {
    return `${Math.round(ms)} ms`;
  }
  const seconds = ms / 1000;
  return `${seconds.toFixed(2)} s`;
}

export function formatTime(isoString: string | null | undefined): string {
  if (!isoString) return "";
  try {
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return "";
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const seconds = String(date.getSeconds()).padStart(2, "0");
    return `${hours}:${minutes}:${seconds}`;
  } catch {
    return "";
  }
}

export function formatDateShort(dateStr: string): string {
  if (!dateStr) return "";
  // "YYYY-MM-DD" -> "MM-DD"
  const parts = dateStr.split("-");
  if (parts.length === 3) {
    return `${parts[1]}-${parts[2]}`;
  }
  return dateStr;
}

const PROVIDER_NAMES: Record<AdminProviderType, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  deepseek: "DeepSeek",
  gemini: "Gemini",
  qwen: "Qwen",
  moonshot: "Moonshot",
  zhipu: "智谱",
  minimax: "MiniMax",
  ollama: "Ollama",
  custom: "自定义",
};

export function formatProviderName(provider: string): string {
  return (
    PROVIDER_NAMES[provider as AdminProviderType] || provider || "未知提供商"
  );
}

const ERROR_CATEGORY_NAMES: Record<AdminErrorCategoryType, string> = {
  timeout: "超时",
  network: "网络错误",
  http_4xx: "请求错误（4xx）",
  http_5xx: "服务错误（5xx）",
  media_unavailable: "媒体不可用",
  unsupported: "不支持",
  unknown: "未知错误",
};

export function formatErrorCategory(category: string): string {
  return (
    ERROR_CATEGORY_NAMES[category as AdminErrorCategoryType] ||
    category ||
    "未知错误"
  );
}

export function getAdminErrorMessage(errorCodeOrError: unknown): string {
  const code =
    typeof errorCodeOrError === "string"
      ? errorCodeOrError
      : errorCodeOrError instanceof Error
        ? errorCodeOrError.message
        : "";

  switch (code) {
    case "ADMIN_RATE_LIMITED":
      return "请求过于频繁，请稍后重试";
    case "ADMIN_STORAGE_UNAVAILABLE":
      return "数据暂时不可用，请稍后重试";
    case "ADMIN_SESSION_REQUIRED":
      return "管理会话已失效，请重新登录";
    case "ADMIN_AUTH_NOT_CONFIGURED":
      return "管理后台认证未配置";
    case "INVALID_ADMIN_QUERY":
      return "查询参数不合法";
    case "ADMIN_RESOURCE_NOT_FOUND":
      return "请求的资源不存在";
    case "ADMIN_METHOD_NOT_ALLOWED":
      return "请求方式不被允许";
    case "ADMIN_INTERNAL_ERROR":
    default:
      return "数据加载失败，请稍后重试";
  }
}
