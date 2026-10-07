export function formatAdminDateTime(
  isoString: string | null | undefined,
  fallback = "—",
): string {
  if (!isoString) return fallback;
  const time = Date.parse(isoString);
  if (Number.isNaN(time)) return fallback;

  const date = new Date(time);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");

  return `${year}/${month}/${day} ${hours}:${minutes}:${seconds}`;
}

export function formatUptimeDuration(seconds: number): string {
  if (
    typeof seconds !== "number" ||
    Number.isNaN(seconds) ||
    !Number.isFinite(seconds) ||
    seconds < 0
  ) {
    return "—";
  }
  const sec = Math.floor(seconds);

  if (sec < 60) {
    return `${sec} 秒`;
  }
  if (sec < 3600) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return s > 0 ? `${m} 分 ${s} 秒` : `${m} 分钟`;
  }
  if (sec < 86400) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return m > 0 ? `${h} 小时 ${m} 分` : `${h} 小时`;
  }
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  return h > 0 ? `${d} 天 ${h} 小时` : `${d} 天`;
}

export function getUsersErrorMessage(errorCodeOrError: unknown): string {
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
      return "用户数据暂时不可用";
    case "ADMIN_AUTH_NOT_CONFIGURED":
      return "管理后台认证尚未配置";
    case "INVALID_ADMIN_QUERY":
      return "请求参数无效";
    case "ADMIN_SESSION_REQUIRED":
      return "管理会话已失效，请重新登录";
    case "ADMIN_INTERNAL_ERROR":
    default:
      return "用户数据暂时不可用";
  }
}

export function getSystemErrorMessage(errorCodeOrError: unknown): string {
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
      return "系统状态暂时不可用";
    case "ADMIN_AUTH_NOT_CONFIGURED":
      return "管理后台认证尚未配置";
    case "INVALID_ADMIN_QUERY":
      return "请求参数无效";
    case "ADMIN_SESSION_REQUIRED":
      return "管理会话已失效，请重新登录";
    case "ADMIN_INTERNAL_ERROR":
    default:
      return "系统状态暂时不可用";
  }
}
