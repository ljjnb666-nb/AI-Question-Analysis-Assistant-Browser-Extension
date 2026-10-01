import type { FillAnswerCode } from "@/content/answerTypes";
import { mapKnownCodeFeedback, mapUserFacingError, userFeedback, type UserFeedback } from "@/shared/ui/userFeedback";
import type { UILang } from "./displayUtils";

/**
 * UI-00B: every fill action surfaces typed feedback. Success and failure no
 * longer share copy paths, machine result codes are demoted to `code`, and
 * raw failure text is demoted to `technicalDetail`.
 */
export const getFillActionFeedback = (
  lang: UILang,
  response: { ok?: boolean; message?: string; code?: FillAnswerCode } | null | undefined,
): UserFeedback => {
  if (!response) {
    return userFeedback("error", lang === "en" ? "Fill failed" : "填写失败");
  }
  if (response.ok) {
    return userFeedback("success", lang === "en" ? "Fill completed" : "填写完成", { code: response.code });
  }
  if (response.code || response.message) {
    return mapUserFacingError(response.message || response.code, lang, { code: response.code });
  }
  return userFeedback("error", lang === "en" ? "Fill failed" : "填写失败");
};

/**
 * Batch fill result feedback. `filledQuestions` counts only candidates that
 * actually filled; `skippedCount` counts fill-ready selections that could not
 * be attempted, so a partial run never implies the skipped items succeeded.
 */
export const getBatchFillFeedback = (
  lang: UILang,
  filledQuestions: number,
  controlCount: number,
  skippedCount = 0,
): UserFeedback => {
  if (skippedCount > 0) {
    return userFeedback(
      "warning",
      lang === "en"
        ? `Filled ${filledQuestions} question(s); ${skippedCount} more need to be re-parsed.`
        : `已填写 ${filledQuestions} 题；另外 ${skippedCount} 题需要重新解析。`,
      { code: "BATCH_FILL_PARTIAL" },
    );
  }
  return userFeedback(
    "success",
    lang === "en"
      ? `Filled ${controlCount} fields across ${filledQuestions} question(s).`
      : `已填写 ${filledQuestions} 题（${controlCount} 个控件）。`,
  );
};
