import type { UILang } from "./displayUtils";

export const getSingleFillFeedback = (lang: UILang, success: boolean, message?: string) => {
  if (message) return message;
  if (lang === "en") return success ? "Fill completed" : "Fill failed";
  return success ? "填写完成" : "填写失败";
};

export const getBatchFillFeedback = (lang: UILang, totalFilled: number, totalQuestions: number) => {
  if (lang === "en") {
    return `Filled ${totalFilled} fields across ${totalQuestions} question(s)`;
  }
  return `已在 ${totalQuestions} 题中填写 ${totalFilled} 个控件`;
};
