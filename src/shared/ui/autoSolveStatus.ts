import { mapKnownCodeFeedback, userFeedback, type FeedbackLang, type UserFeedback, type UserFeedbackTone } from "./userFeedback";

/**
 * UI-00B Auto Solve status contract (PART F).
 *
 * The content runtime reports stable status codes plus data; only the Side
 * Panel turns them into user-visible copy for the active UI language. The
 * content script never decides UI language, and machine states such as
 * `SKIPPED_WITHHOLD-INCOMPLETE` never reach the user as primary text.
 */
export type AutoSolveStatusCode =
  | "STARTING"
  | "WAITING_FOR_QUESTIONS"
  | "PARSING"
  | "RETRYING_PARSE"
  | "ANSWERED_SKIP"
  | "ANSWERED_KEEP"
  | "REVIEWING_ANSWERED"
  | "REVIEWING_HISTORY"
  | "REUSING_HISTORY"
  | "REUSED_HISTORY"
  | "SKIPPED_INCOMPLETE"
  | "SKIPPED_UNKNOWN"
  | "SKIPPED_UNSTABLE"
  | "FILL_STOPPED_SAFETY"
  | "ADVANCING";

export type AutoSolveStatusData = {
  current?: number;
  solved?: number;
  filled?: number;
  total?: number;
  /** Stable sub-code (e.g. a fill result code) behind the status. */
  detail?: string;
};

const AUTO_SOLVE_STATUS_COPY: Record<AutoSolveStatusCode, { zh: string; en: string }> = {
  STARTING: { zh: "正在启动解析并填答...", en: "Starting solve & fill..." },
  WAITING_FOR_QUESTIONS: { zh: "未发现题目，等待页面内容出现...", en: "No questions found yet. Waiting for page content..." },
  PARSING: { zh: "正在解析第 {current} 题...", en: "Parsing question {current}..." },
  RETRYING_PARSE: { zh: "第 {current} 题解析未收敛，正在重试...", en: "Question {current} needs another parse attempt..." },
  ANSWERED_SKIP: { zh: "检测到本题已填写，已跳过", en: "Question already answered — skipped" },
  ANSWERED_KEEP: { zh: "本题已存在作答，保留当前选择并继续", en: "Question already answered — keeping the current answer" },
  REVIEWING_ANSWERED: { zh: "检测到本题已作答，正在复核并按需覆盖...", en: "Question already answered — reviewing and overriding if needed..." },
  REVIEWING_HISTORY: { zh: "本题已有历史结果但置信度较低，正在复核...", en: "Historical answer has low confidence — reviewing..." },
  REUSING_HISTORY: { zh: "正在复用历史解析结果填写第 {current} 题...", en: "Reusing the saved answer for question {current}..." },
  REUSED_HISTORY: { zh: "已复用历史答案", en: "Reused the saved answer" },
  SKIPPED_INCOMPLETE: { zh: "题目尚未完整加载，本次已跳过。", en: "This question has not fully loaded and was skipped." },
  SKIPPED_UNKNOWN: { zh: "暂时无法确认题目是否完整，本次已跳过。", en: "Could not confirm this question is complete, so it was skipped." },
  SKIPPED_UNSTABLE: { zh: "本题多次尝试仍未收敛，已跳过并继续下一题", en: "This question stayed unstable after retries — skipped" },
  FILL_STOPPED_SAFETY: { zh: "为安全起见已停止填写本题", en: "Filling stopped for safety on this question" },
  ADVANCING: { zh: "本题完成，正在进入下一题...", en: "Question complete — moving to the next one..." },
};

function fillTemplate(template: string, data: AutoSolveStatusData | undefined): string {
  return template.replace("{current}", String(data?.current ?? ""));
}

/** Localized primary copy for a runtime status code. */
export function autoSolveStatusLabel(code: string, lang: FeedbackLang, data?: AutoSolveStatusData): string {
  const entry = AUTO_SOLVE_STATUS_COPY[code as AutoSolveStatusCode];
  if (!entry) return NEUTRAL_WORKING_COPY[lang];
  return fillTemplate(entry[lang], data);
}

const NEUTRAL_WORKING_COPY = {
  zh: "正在处理...",
  en: "Working...",
};

/**
 * UI-00B review fix P1-03: the progress card visual follows the semantic
 * state — safety stops and skips must never wear the success/running look.
 */
export function autoSolveStatusTone(code: string | undefined): UserFeedbackTone {
  if (code === "FILL_STOPPED_SAFETY") return "error";
  if (code && code.startsWith("SKIPPED_")) return "warning";
  return "info";
}

/**
 * Safety-stop statuses surface their fill code through the shared error
 * mapper so the user never sees the raw machine token.
 */
export function autoSolveStatusFeedback(
  code: string,
  lang: FeedbackLang,
  data?: AutoSolveStatusData,
): { label: string; detail: UserFeedback | null } {
  const label = autoSolveStatusLabel(code, lang, data);
  if (code === "FILL_STOPPED_SAFETY" && data?.detail) {
    return { label, detail: mapKnownCodeFeedback(data.detail, lang) ?? userFeedback("warning", label, { code: data.detail }) };
  }
  return { label, detail: null };
}

/**
 * UI-00B review fix P1-04: legacy `statusText` is untrusted UI input. Only
 * explicitly recognized legacy machine states map to localized copy; every
 * other payload (hardcoded runtime sentences, raw exceptions, unknown
 * tokens) collapses to the neutral working copy. Never returns the input.
 */
export function sanitizeLegacyAutoSolveStatusText(statusText: string, lang: FeedbackLang): string {
  if (/^SKIPPED_WITHHOLD-INCOMPLETE$/i.test(statusText)) return autoSolveStatusLabel("SKIPPED_INCOMPLETE", lang);
  if (/^SKIPPED_WITHHOLD-UNKNOWN$/i.test(statusText)) return autoSolveStatusLabel("SKIPPED_UNKNOWN", lang);
  if (!statusText) return "";
  return NEUTRAL_WORKING_COPY[lang];
}

/**
 * UI-00B PART G: the DONE payload becomes typed feedback. Stable fields
 * drive the copy; the raw runtime message is demoted to technical detail.
 */
export function mapAutoSolveDoneFeedback(
  msg: { ok?: boolean; stopped?: boolean; solved?: number; filled?: number; total?: number; message?: string },
  lang: FeedbackLang,
): UserFeedback {
  const solved = Number(msg.solved ?? 0);
  const filled = Number(msg.filled ?? 0);
  const rawMessage = typeof msg.message === "string" ? msg.message : "";
  if (msg.ok && !msg.stopped) {
    return userFeedback(
      "success",
      lang === "en"
        ? `Auto solve finished: processed ${solved} question(s), filled ${filled}.`
        : `自动解析并填答完成，共处理 ${solved} 题，填写 ${filled}。`,
      { technicalDetail: rawMessage || undefined },
    );
  }
  if (msg.stopped) {
    return userFeedback(
      "info",
      lang === "en" ? "Auto solve was stopped." : "自动解析已停止。",
      { technicalDetail: rawMessage || undefined },
    );
  }
  return userFeedback(
    "error",
    lang === "en"
      ? "Auto solve stopped because of a problem. Check the page and try again."
      : "自动解析遇到问题已停止，请检查页面后重试。",
    { code: "AUTO_SOLVE_FAILED", technicalDetail: rawMessage.slice(0, 200) || undefined },
  );
}
