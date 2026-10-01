import type { FillAnswerCode } from "@/content/answerTypes";
import { DEMO_RESULT_NOT_FILLABLE, UNVERIFIED_RESULT_SOURCE } from "@/shared/ai/parseResultAuthority";
import type { UILang } from "./displayUtils";

export const getSingleFillFeedback = (lang: UILang, success: boolean, message?: string) => {
  if (message) return message;
  if (lang === "en") return success ? "Fill completed" : "Fill failed";
  return success ? "填写完成" : "填写失败";
};

/**
 * UI-00A: machine rejection codes are translated into natural user hints
 * instead of being surfaced as raw codes.
 */
const FILL_CODE_FEEDBACK: Partial<Record<FillAnswerCode, (lang: UILang) => string>> = {
  [DEMO_RESULT_NOT_FILLABLE]: (lang) => lang === "en"
    ? "Demo results cannot be filled into the page. Configure an AI provider and parse again."
    : "演示结果不能填入真实页面，请先配置 AI 服务并重新解析。",
  [UNVERIFIED_RESULT_SOURCE]: (lang) => lang === "en"
    ? "This result's source cannot be verified. Parse again to obtain a fillable result."
    : "该结果来源无法验证，请重新解析后再填写。",
};

export const getFillActionFeedback = (
  lang: UILang,
  response: { ok?: boolean; message?: string; code?: FillAnswerCode } | null | undefined,
): string => {
  const hint = response?.code ? FILL_CODE_FEEDBACK[response.code] : undefined;
  if (hint) return hint(lang);
  return getSingleFillFeedback(lang, !!response?.ok, response?.message);
};

export const getBatchFillFeedback = (lang: UILang, totalFilled: number, totalQuestions: number) => {
  if (lang === "en") {
    return `Filled ${totalFilled} fields across ${totalQuestions} question(s)`;
  }
  return `已在 ${totalQuestions} 题中填写 ${totalFilled} 个控件`;
};
