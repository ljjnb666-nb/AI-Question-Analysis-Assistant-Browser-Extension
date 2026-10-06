/**
 * UI-00B user feedback contract.
 *
 * User-visible feedback is typed, never a bare string: `message` is the
 * natural primary copy, `code` is the stable machine code (secondary detail
 * only), and `technicalDetail` carries a raw error summary that the default
 * UI does not show. Raw exceptions and machine codes must never become the
 * primary user copy.
 */

export type UserFeedbackTone = "success" | "info" | "warning" | "error";

export type UserFeedback = {
  tone: UserFeedbackTone;
  message: string;
  code?: string;
  technicalDetail?: string;
};

export type FeedbackLang = "zh" | "en";

export function userFeedback(
  tone: UserFeedbackTone,
  message: string,
  opts: { code?: string; technicalDetail?: string } = {},
): UserFeedback {
  return { tone, message, code: opts.code, technicalDetail: opts.technicalDetail };
}

export const AUTHORITY_LOST = "AUTHORITY_LOST" as const;
export const CONFIGURATION_CHANGED = "CONFIGURATION_CHANGED" as const;

/**
 * Central known-code mapping (UI-00B PART B). Every entry gives the natural
 * primary copy per UI language; machine codes stay available as `code`.
 */
const KNOWN_CODE_COPY: Record<string, { zh: string; en: string; tone: UserFeedbackTone }> = {
  STALE_QUESTION_REVISION: {
    zh: "页面中的题目已经发生变化，请重新识别后再填写。",
    en: "The question on the page has changed. Re-detect it before filling.",
    tone: "warning",
  },
  STALE_ROOT_CONTEXT: {
    zh: "题目所在区域已经发生变化，请重新识别后再试。",
    en: "The region holding this question has changed. Re-detect and try again.",
    tone: "warning",
  },
  STALE_ACTION_PLAN: {
    zh: "页面中的题目已经发生变化，请重新识别后再填写。",
    en: "The question on the page has changed. Re-detect it before filling.",
    tone: "warning",
  },
  DEMO_RESULT_NOT_FILLABLE: {
    zh: "演示结果不能填入真实页面，请先配置 AI 服务并重新解析。",
    en: "Demo results cannot be filled into the page. Configure an AI provider and parse again.",
    tone: "warning",
  },
  UNVERIFIED_RESULT_SOURCE: {
    zh: "该结果来源无法验证，请重新解析后再填写。",
    en: "This result's source cannot be verified. Parse again to obtain a fillable result.",
    tone: "warning",
  },
  ANSWER_NOT_FILLABLE: {
    zh: "该解析结果没有可填写的结构化答案，请重新解析后再试。",
    en: "This result has no fillable structured answer. Parse again before filling.",
    tone: "warning",
  },
  PARTIAL_MUTATION_UNPROVABLE: {
    zh: "页面已经发生部分变化，无法确认填写结果。已停止后续操作，请人工检查当前题目。",
    en: "The page partially changed and the fill result cannot be confirmed. Later steps were stopped — please review this question manually.",
    tone: "error",
  },
  AUTHORITY_LOST: {
    zh: "登录状态已经失效，本次操作没有执行。请重新登录后再试。",
    en: "Your session has expired and the action was not performed. Please sign in again.",
    tone: "error",
  },
  PROVIDER_NOT_CONFIGURED: {
    zh: "请先配置 AI 服务，再进行解析。",
    en: "Configure an AI provider before parsing.",
    tone: "warning",
  },
  HISTORY_COMMIT_REJECTED: {
    zh: "解析结果未能安全保存，请重新解析后再试。",
    en: "The parse result could not be saved safely. Parse again before retrying.",
    tone: "error",
  },
  MEDIA_REQUIRES_VISION: {
    zh: "这道题需要图像识别，请切换到支持图片的模型。",
    en: "This question needs image recognition. Switch to a vision-capable model.",
    tone: "warning",
  },
  CANONICAL_MEDIA_REQUIRES_VISION: {
    zh: "这道题需要图像识别，请切换到支持图片的模型。",
    en: "This question needs image recognition. Switch to a vision-capable model.",
    tone: "warning",
  },
  MEDIA_SOURCE_UNAVAILABLE: {
    zh: "题目图片暂时无法获取，请重新识别后再试。",
    en: "The question image could not be captured. Re-detect and try again.",
    tone: "warning",
  },
  MEDIA_BLOCKED: {
    zh: "题目图片暂时无法获取，请重新识别后再试。",
    en: "The question image could not be captured. Re-detect and try again.",
    tone: "warning",
  },
  QUESTION_NOT_ELIGIBLE: {
    zh: "当前题目内容尚不完整，暂不自动处理。",
    en: "This question is not complete enough to process automatically.",
    tone: "info",
  },
  SKIPPED_WITHHOLD_INCOMPLETE: {
    zh: "题目尚未完整加载，本次已跳过。",
    en: "This question has not fully loaded and was skipped.",
    tone: "info",
  },
  SKIPPED_WITHHOLD_UNKNOWN: {
    zh: "暂时无法确认题目是否完整，本次已跳过。",
    en: "Could not confirm this question is complete, so it was skipped.",
    tone: "info",
  },
  FILL_VERIFICATION_FAILED: {
    zh: "填写结果未能通过校验，请人工检查当前题目。",
    en: "The fill could not be verified. Please review this question manually.",
    tone: "error",
  },
  USER_STATE_CHANGED: {
    zh: "页面中的题目已经发生变化，请重新识别后再填写。",
    en: "The question on the page has changed. Re-detect it before filling.",
    tone: "warning",
  },
  USER_STATE_SNAPSHOT_UNAVAILABLE: {
    zh: "无法获取题目当前状态，请重新识别后再填写。",
    en: "Could not read the question's current state. Re-detect it before filling.",
    tone: "warning",
  },
  CONFIGURATION_CHANGED: {
    zh: "测试期间配置已发生变化，请重新测试。",
    en: "Configuration changed during test. Please re-test.",
    tone: "warning",
  },
};

const TRANSPORT_ERROR_PATTERN =
  /Receiving end does not exist|Could not establish connection|unknown tabs\.sendMessage error|Extension context invalidated/i;

const TRANSPORT_COPY = {
  zh: "当前页面暂时无法连接插件，请刷新页面后重试。",
  en: "This page cannot reach the extension right now. Refresh the page and try again.",
};

const GENERIC_FAILURE_COPY = {
  zh: "操作失败，请稍后重试。",
  en: "The action failed. Please try again later.",
};

const CONNECTION_TEST_FAILURE_COPY = {
  zh: "连接测试失败，请检查服务地址、模型和 API Key 后重试。",
  en: "Connection test failed. Check the service URL, model, and API key, then try again.",
};

const CONNECTION_AUTH_FAILURE_COPY = {
  zh: "API Key 无效或没有权限，请检查后重试。",
  en: "The API key is invalid or unauthorized. Check it and try again.",
};

const CONNECTION_NOT_FOUND_COPY = {
  zh: "模型或服务地址不可用，请检查配置。",
  en: "The model or service URL is unavailable. Check your configuration.",
};

const CONNECTION_NETWORK_COPY = {
  zh: "暂时无法连接 AI 服务，请检查网络和服务地址。",
  en: "Cannot reach the AI service right now. Check your network and service URL.",
};

const CONNECTION_AUTH_FAILURE_PATTERN = /\b401\b|\b403\b|unauthorized|forbidden|invalid[_\s-]?api[_\s-]?key/i;
const CONNECTION_NOT_FOUND_PATTERN = /\b404\b|model_not_found|does not exist|not found/i;
const CONNECTION_NETWORK_PATTERN = /timed?\s*out|timeout|failed to fetch|networkerror|fetch failed|网络请求失败|getaddrinfo|econnrefused/i;

/** Connection-test-specific classification: known provider failure shapes. */
function mapConnectionTestFailure(rawMessage: string, lang: FeedbackLang): UserFeedback {
  if (CONNECTION_AUTH_FAILURE_PATTERN.test(rawMessage)) {
    return userFeedback("error", CONNECTION_AUTH_FAILURE_COPY[lang], { code: "CONNECTION_UNAUTHORIZED" });
  }
  if (CONNECTION_NOT_FOUND_PATTERN.test(rawMessage)) {
    return userFeedback("error", CONNECTION_NOT_FOUND_COPY[lang], { code: "CONNECTION_NOT_FOUND" });
  }
  if (CONNECTION_NETWORK_PATTERN.test(rawMessage)) {
    return userFeedback("error", CONNECTION_NETWORK_COPY[lang], { code: "CONNECTION_NETWORK" });
  }
  return userFeedback("error", CONNECTION_TEST_FAILURE_COPY[lang]);
}

/** Maps a stable machine code to natural user copy, or null when unknown. */
export function mapKnownCodeFeedback(code: string, lang: FeedbackLang): UserFeedback | null {
  const known = KNOWN_CODE_COPY[code];
  if (!known) return null;
  return userFeedback(known.tone, known[lang], { code });
}

/**
 * Maps any thrown value to safe, localized user feedback. Raw exception text
 * is demoted to `technicalDetail` — never the primary message.
 */
export function mapUserFacingError(
  error: unknown,
  lang: FeedbackLang,
  options: { context?: "general" | "connection-test"; code?: string } = {},
): UserFeedback {
  const rawMessage = error instanceof Error ? error.message : String(error ?? "");
  const codeCandidate = options.code
    ?? (typeof error === "object" && error !== null && "code" in error && typeof (error as { code?: unknown }).code === "string"
      ? (error as { code: string }).code
      : undefined);

  if (codeCandidate) {
    const known = mapKnownCodeFeedback(codeCandidate, lang);
    if (known) return { ...known, technicalDetail: rawMessage.slice(0, 200) || undefined };
  }
  if (TRANSPORT_ERROR_PATTERN.test(rawMessage)) {
    return userFeedback("error", TRANSPORT_COPY[lang], { technicalDetail: rawMessage.slice(0, 200) || undefined });
  }
  if (options.context === "connection-test") {
    const classified = mapConnectionTestFailure(rawMessage, lang);
    return { ...classified, technicalDetail: rawMessage.slice(0, 200) || undefined };
  }
  if (codeCandidate) {
    return userFeedback("error", GENERIC_FAILURE_COPY[lang], { code: codeCandidate, technicalDetail: rawMessage.slice(0, 200) || undefined });
  }
  return userFeedback("error", GENERIC_FAILURE_COPY[lang], { technicalDetail: rawMessage.slice(0, 200) || undefined });
}
