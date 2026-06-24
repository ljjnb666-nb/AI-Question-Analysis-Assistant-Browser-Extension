import type { BoundingBox } from "@/shared/types";
import { normalizeText } from "./domText";

export function bboxIntersectsRect(bbox: BoundingBox, rect: DOMRect): boolean {
  return !(
    rect.right <= bbox.x ||
    rect.left >= bbox.x + bbox.width ||
    rect.bottom <= bbox.y ||
    rect.top >= bbox.y + bbox.height
  );
}

export function isExtensionUiElement(el: Element): boolean {
  if ((el as HTMLElement).id?.startsWith("qs-")) return true;
  return !!el.closest?.("[id^='qs-']");
}

export function isLikelyControlPanelText(text: string): boolean {
  const t = normalizeText(text).toLowerCase();
  if (!t) return false;
  const keys = [
    "试题检索", "教材版本", "课本", "题型", "难易度", "知识点", "当前",
    "试题篮", "组卷预览", "登录", "注册", "首页", "按章节", "按知识点",
  ];
  const hit = keys.reduce((n, k) => n + (t.includes(k.toLowerCase()) ? 1 : 0), 0);
  if (hit >= 3) return true;
  if (t.includes("试题检索") && t.includes("题型")) return true;
  if (t.includes("教材版本") && t.includes("难易度")) return true;
  if ((t.match(/第\d+章/g) || []).length >= 2) return true;
  if ((t.match(/必修\d/g) || []).length >= 3) return true;
  return false;
}

export function isLikelyActionText(text: string): boolean {
  const t = normalizeText(text);
  if (!t) return false;
  return /提交作业|上一题|下一题|返回|标记此题|查看解析|收藏|试题篮|组卷预览|登录|注册|首页/.test(t);
}
