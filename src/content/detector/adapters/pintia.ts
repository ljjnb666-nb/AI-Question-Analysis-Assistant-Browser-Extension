import { isElementVisible, isExtensionUiElement, isHtmlElementNode, isLikelyControlPanelText } from "../domDetectorShared";
import type { QuestionBlock, QuestionDisplaySegment } from "@/shared/types";
import { countOptionMarkersInText, hasStrongQuestionSignal, inferQuestionType, normalizeText, sanitizePreviewTextByType } from "../domText";
import { extractReadableNodeText } from "../domStructuredText";
import { isLikelyCompleteQuestionText } from "../domDetectorPostprocess";
import { bindDomQuestionBlockToOwner as attachDetectedQuestionIdentity } from "../../domQuestionBinding";
import { hasMeaningfulVisualContent, pickQuestionImageFromElement } from "../domDetectorVisual";
import {
  applyRightCutToRect,
  boundaryFromRawRect,
  clampRectToBbox,
  getVisibleVerticalRatio,
  inViewport,
} from "../domCandidateGeometry";
import type { SiteAdapter } from "./types";

/* Strangler step 1: Pintia adapters moved verbatim from domDetector.ts.
 * No behavior change — the generic engine calls them through the registry. */

export function buildPintiaCodeProblemCandidates(
  hostRightCutX: number | null,
  vw: number,
  vh: number,
): QuestionBlock[] {
  const selectors = ["main", "article", "section", "div"];
  const candidates: HTMLElement[] = [];
  const seen = new Set<HTMLElement>();

  for (const selector of selectors) {
    for (const node of document.querySelectorAll(selector)) {
if (!isHtmlElementNode(node)) continue;
      if (seen.has(node) || isExtensionUiElement(node)) continue;
      if (!isLikelyPintiaCodeProblemContainer(node, vw)) continue;
      seen.add(node);
      candidates.push(node);
    }
  }

  const rankedCandidates = candidates
    .map((candidate) => ({ candidate, score: scorePintiaCodeProblemContainer(candidate, vw) }))
    .sort((a, b) => b.score - a.score);
  const picked: HTMLElement[] = [];
  for (const entry of rankedCandidates) {
    if (picked.some((existing) => existing.contains(entry.candidate) || entry.candidate.contains(existing))) continue;
    picked.push(entry.candidate);
  }
  const out: QuestionBlock[] = [];

  for (const [index, el] of picked.entries()) {
    const rawRect = el.getBoundingClientRect();
    const rect = applyRightCutToRect(rawRect, hostRightCutX);
    if (!rect) continue;
    if (!inViewport(rect, vw, vh)) continue;
    if (rect.width < 360 || rect.height < 220) continue;
    if (getVisibleVerticalRatio(rawRect, vh) < 0.22) continue;

    const displaySegments = buildPintiaCodeProblemDisplaySegments(el);
    const text = buildPintiaPreviewText(displaySegments);
    if (!text || text.length < 120) continue;
    if (isLikelyControlPanelText(text) || !isLikelyCompleteQuestionText(text, "short_answer")) continue;

    out.push(attachDetectedQuestionIdentity({
      id: `auto-pintia-code-${Date.now()}-${index}`,
      bbox: clampRectToBbox(rect, vw, vh),
      previewText: sanitizePreviewTextByType(text, "short_answer").slice(0, 900),
      displaySegments,
      hasImage: hasMeaningfulVisualContent(el),
      questionImageUrl: pickQuestionImageFromElement(el) ?? undefined,
      questionTypeGuess: "short_answer",
      confidence: 0.91,
      source: "auto_dom",
      identitySourceText: text,
      runtimeOwnerKey: `pintia-code-${index}`,
      boundary: boundaryFromRawRect(rawRect, vh),
    }, el, { identityText: text }));
  }

  return out;
}

export function buildPintiaQuestionListCandidates(
  hostRightCutX: number | null,
  vw: number,
  vh: number,
): QuestionBlock[] {
  const roots = Array.from(document.querySelectorAll("div[id]"))
    .filter((node): node is HTMLElement =>isHtmlElementNode( node))
    .filter((el) => isLikelyPintiaQuestionListItem(el));
  const out: QuestionBlock[] = [];

  for (const [index, el] of roots.entries()) {
    const rawRect = el.getBoundingClientRect();
    const rect = applyRightCutToRect(rawRect, hostRightCutX);
    if (!rect) continue;
    if (!inViewport(rect, vw, vh)) continue;
    if (rect.width < 480 || rect.height < 96) continue;
    if (getVisibleVerticalRatio(rawRect, vh) < 0.18) continue;

    const text = normalizeText(extractReadableNodeText(el));
    if (!text || text.length < 24) continue;

    let candidateType = inferQuestionType(text);
    if (candidateType === "unknown" && /\bT\b[\s\n]*\bF\b/i.test(text)) {
      candidateType = "judge";
    }
    const previewText = sanitizePreviewTextByType(text, candidateType);
    if (!isLikelyCompleteQuestionText(previewText, candidateType)) continue;

    out.push(attachDetectedQuestionIdentity({
      id: `auto-pintia-list-${Date.now()}-${index}`,
      bbox: clampRectToBbox(rect, vw, vh),
      previewText: previewText.slice(0, 420),
      hasImage: hasMeaningfulVisualContent(el),
      questionImageUrl: pickQuestionImageFromElement(el) ?? undefined,
      questionTypeGuess: candidateType,
      confidence: 0.93,
      source: "auto_dom",
      identitySourceText: text,
      runtimeOwnerKey: `pintia-list-${index}`,
      boundary: boundaryFromRawRect(rawRect, vh),
    }, el, { identityText: text }));
  }

  return out;
}

function scorePintiaCodeProblemContainer(el: HTMLElement, vw: number): number {
  const rect = el.getBoundingClientRect();
  const text = normalizeText(extractReadableNodeText(el));
  const cls = (el.className || "").toString().toLowerCase();
  const markerCount = [
    "题目描述",
    "函数接口定义",
    "裁判测试程序样例",
    "输入格式",
    "输出格式",
    "输入样例",
    "输出样例",
    "代码长度限制",
    "时间限制",
    "内存限制",
    "栈限制",
  ].filter((marker) => text.includes(marker)).length;

  let score = markerCount * 10;
  if (el.querySelector("[class*='title'], [id*='title'], h1, h2, h3")) score += 40;
  if (text.includes("作者") && text.includes("单位")) score += 20;
  if (/left_|splitarea|problem-panel|problem-body/.test(cls)) score += 18;
  if (/rendered-markdown|bg-bg-base space-y-4|hyphens-auto/.test(cls)) score -= 10;
  if (rect.width > vw * 0.58) score -= 8;
  if (rect.width < 380) score -= 6;
  return score;
}

function isLikelyPintiaCodeProblemContainer(el: HTMLElement, vw: number): boolean {
  if (!isElementVisible(el)) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width < 360 || rect.height < 220) return false;
  if (rect.left > vw * 0.6) return false;

  const text = normalizeText(extractReadableNodeText(el));
  if (text.length < 120) return false;
  if (isLikelyControlPanelText(text)) return false;
  if (text.includes("考试公告")) return false;
  if (text.includes("题目总览") && text.includes("作答 / 题数")) return false;
  if (text.includes("提交代码")) return false;
  if ((text.match(/第\s*\d+\s*页/g) || []).length >= 3) return false;
  if ((text.match(/\b(?:1|2|3|4|5|6|7|8|9|10)\b/g) || []).length >= 8 && text.includes("图例")) return false;

  const normalizedClass = `${el.tagName.toLowerCase()} ${(el.className || "").toString().toLowerCase()}`;
  if (/(?:^|\\s)(?:cm-editor|cm-scroller|cm-content)(?:\\s|$)|codeeditor_|readonly_|right_/i.test(normalizedClass)) {
    return false;
  }
  const looksProblemPane = /(problem|description|content|statement|markdown|space-y-4|left_|splitarea)/.test(normalizedClass);
  const markerCount = [
    "题目描述",
    "函数接口定义",
    "裁判测试程序样例",
    "输入格式",
    "输出格式",
    "输入样例",
    "输出样例",
    "输入说明",
    "输出说明",
    "样例输入",
    "样例输出",
    "作者",
    "单位",
    "时间限制",
    "内存限制",
    "代码长度限制",
    "栈限制",
  ].filter((marker) => text.includes(marker)).length;
  const hasNarrative = /[A-Za-z]{4,}/.test(text) || /[。；：]/.test(text);
  const hasProblemTab = Array.from(el.querySelectorAll("button,span,div,h1,h2,h3")).some((node) => {
    const label = normalizeText(node.textContent || "");
    return label === "题目描述" || label === "输入格式" || label === "样例输入" || label === "函数接口定义";
  });
  const hasTitleLikeRow = !!el.querySelector("[class*='title'], [id*='title'], h1, h2, h3");
  const hasConstraintMeta = ["时间限制", "内存限制", "代码长度限制", "栈限制"].some((marker) => text.includes(marker));
  const hasCodeProblemMarker = ["函数接口定义", "裁判测试程序样例", "输入样例", "输出样例"].some((marker) => text.includes(marker));
  const hasMetaRow = text.includes("作者") && text.includes("单位");
  const isProblemShell = /left_|splitarea|problem|description/.test(normalizedClass);

  return hasNarrative && (
    (hasProblemTab && markerCount >= 2) ||
    (looksProblemPane && hasTitleLikeRow && markerCount >= 2) ||
    (hasConstraintMeta && hasTitleLikeRow) ||
    (isProblemShell && hasCodeProblemMarker && (hasTitleLikeRow || hasMetaRow)) ||
    (isProblemShell && markerCount >= 3 && (hasTitleLikeRow || hasMetaRow))
  );
}

function buildPintiaCodeProblemDisplaySegments(container: HTMLElement) {
  const segments: QuestionDisplaySegment[] = [];
  const pushSegment = (segment: QuestionDisplaySegment | null) => {
    if (!segment) return;
    if (segment.type === "image") {
      segments.push(segment);
      return;
    }
    const normalized = normalizePintiaDisplayText(segment.text);
    if (!normalized) return;
    const dedupeKey = `${segment.role || "text"}|${segment.label || ""}|${normalized}`;
    if (segments.some((existing) => existing.type === "text" && `${existing.role || "text"}|${existing.label || ""}|${existing.text}` === dedupeKey)) {
      return;
    }
    segments.push({ ...segment, text: normalized });
  };

  const titleNode = pickBestPintiaTitleNode(container);
if (isHtmlElementNode(titleNode)) {
    pushSegment({ type: "text", text: titleNode.innerText || titleNode.textContent || "", role: "title" });
  }

  const metaNode = pickBestPintiaMetaNode(container);
if (isHtmlElementNode(metaNode)) {
    pushSegment({ type: "text", text: metaNode.innerText || metaNode.textContent || "", role: "meta" });
  }

  const markdownRoot = getPintiaRenderedMarkdownRoot(container);
  if (markdownRoot) {
    let currentLabel = "题目描述";
    const sectionMap = new Map<string, string[]>();
    const appendToSection = (label: string, text: string) => {
      const normalized = normalizePintiaDisplayText(text);
      if (!normalized) return;
      const list = sectionMap.get(label) || [];
      if (!list.includes(normalized)) list.push(normalized);
      sectionMap.set(label, list);
    };

    for (const node of Array.from(markdownRoot.children)) {
if (!isHtmlElementNode(node)) continue;
      if (node.matches("h1,h2,h3,h4,h5,h6")) {
        currentLabel = normalizePintiaSectionLabel(node.innerText || node.textContent || "") || currentLabel;
        continue;
      }
      if (node.matches("table") || node.querySelector("table")) {
        appendToSection(currentLabel, formatPintiaTableText(node.matches("table") ? node : node.querySelector("table")));
        continue;
      }
      if (node.matches("[data-code]") || node.querySelector("[data-code], .cm-content, pre, code")) {
        appendToSection(currentLabel, extractPintiaCodeBlockText(node, { preserveNumericOnlyLines: /样例输入|输入样例|样例输出|输出样例/.test(currentLabel) }));
        continue;
      }
      appendToSection(currentLabel, extractReadableNodeText(node));
    }

    for (const [label, parts] of sectionMap.entries()) {
      const text = normalizePintiaDisplayText(parts.join("\n\n"));
      if (!text) continue;
      pushSegment({ type: "text", text, role: "section", label });
    }
  } else {
    const fallbackText = extractReadableNodeText(container);
    pushSegment({ type: "text", text: fallbackText, role: "section", label: "题目描述" });
  }

  if (segments.length === 0) {
    pushSegment({ type: "text", text: extractReadableNodeText(container), role: "section", label: "题目描述" });
  }

  return segments.length ? segments : undefined;
}

function buildPintiaPreviewText(segments?: QuestionDisplaySegment[]): string {
  if (!segments?.length) return "";
  const parts = segments.flatMap((segment) => {
    if (segment.type !== "text") return [];
    if (segment.role === "section") {
      const label = normalizePintiaDisplayText(segment.label || "");
      return label ? [`${label}\n${segment.text}`] : [segment.text];
    }
    return [segment.text];
  });
  return normalizeText(parts.join("\n\n"));
}

function normalizePintiaDisplayText(text: string): string {
  return String(text || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => normalizeText(line))
    .filter(Boolean)
    .join("\n")
    .trim();
}

function formatPintiaTableText(tableLike: Element | null): string {
if (!isHtmlElementNode(tableLike)) return "";
  const table = tableLike.matches("table") ? tableLike : tableLike.querySelector("table");
  if (!(table instanceof HTMLTableElement)) return normalizeText(extractReadableNodeText(tableLike));

  const rows = Array.from(table.querySelectorAll("tr"))
    .map((tr) =>
      Array.from(tr.querySelectorAll("th,td"))
        .map((cell) => normalizeText(cell.textContent || ""))
        .filter(Boolean),
    )
    .filter((cells) => cells.length > 0);

  if (rows.length === 0) return "";

  const lines = rows.map((cells) => cells.join(" | "));
  return lines.join("\n");
}

function getPintiaRenderedMarkdownRoot(container: HTMLElement): HTMLElement | null {
  const direct = container.querySelector(".rendered-markdown");
return isHtmlElementNode(direct) ? direct : null;
}

function normalizePintiaSectionLabel(text: string): string {
  const normalized = normalizePintiaDisplayText(text).replace(/[：:]\s*$/, "");
  if (!normalized) return "";
  if (normalized.startsWith("函数接口定义")) return "函数接口";
  if (normalized.startsWith("裁判测试程序样例")) return "裁判样例";
  if (normalized.startsWith("输入格式")) return "输入格式";
  if (normalized.startsWith("输出格式")) return "输出格式";
  if (normalized.startsWith("输入样例")) return normalized.replace(/[：:]\s*$/, "");
  if (normalized.startsWith("输出样例")) return normalized.replace(/[：:]\s*$/, "");
  if (normalized.startsWith("样例输入")) return normalized;
  if (normalized.startsWith("样例输出")) return normalized;
  return normalized;
}

function extractPintiaCodeBlockText(node: Element, options?: { preserveNumericOnlyLines?: boolean }): string {
  const editorLines = Array.from(node.querySelectorAll(".cm-content .cm-line"))
    .map((line) => normalizePintiaCodeLine((line.textContent || "").replace(/\u00a0/g, " "), options))
    .filter((line) => line !== null);
  if (editorLines.length > 0) {
    return editorLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  const pre = node.querySelector("pre");
if (isHtmlElementNode(pre)) {
    return String(pre.textContent || "")
      .replace(/\r\n?/g, "\n")
      .trim();
  }

  const text = normalizePintiaDisplayText(extractReadableNodeText(node))
    .replace(/^\[\s*(?:in|out|c\+\+)\s*\]\s*/gi, "")
    .replace(/^(?:复制内容|格式|全屏|收起)\s*/g, "")
    .replace(/\b(?:复制内容|格式|全屏|收起)\b/g, "")
    .replace(/(?:^|\n)\s*\d+(?=\s*$)/gm, "")
    .trim();
  return text;
}

function normalizePintiaCodeLine(text: string, options?: { preserveNumericOnlyLines?: boolean }): string | null {
  const normalized = String(text || "").replace(/\r\n?/g, "").trimEnd();
  if (!normalized) return "";
  if (/^(?:复制内容|格式|全屏|收起|\[\s*(?:in|out|c\+\+)\s*\])$/i.test(normalized)) return null;
  if (/^\d+$/.test(normalized) && !options?.preserveNumericOnlyLines) return null;
  if (/^[▸▾]+$/.test(normalized)) return null;
  return normalized;
}

function pickBestPintiaTitleNode(container: HTMLElement): HTMLElement | null {
  const candidates = Array.from(container.querySelectorAll(
    ".text-darkest.font-bold.text-lg,h1,h2,h3,[id='title'],[id$='-title'],[id*='question-title']",
  )).filter((node): node is HTMLElement =>isHtmlElementNode( node));
  if (candidates.length === 0) return null;
  const scored = candidates
    .map((node) => {
      const text = normalizeText(node.innerText || node.textContent || "");
      const cls = String(node.className || "");
      let score = 0;
      if (/^\d+-\d+\s+\S+/.test(text)) score += 100;
      if (/text-darkest font-bold text-lg/.test(cls)) score += 40;
      if (/title/i.test(node.id || "")) score += 10;
      score -= text.length / 200;
      return { node, text, score };
    })
    .filter((entry) => entry.text.length >= 4)
    .sort((a, b) => b.score - a.score);
  return scored[0]?.node ?? null;
}

function pickBestPintiaMetaNode(container: HTMLElement): HTMLElement | null {
  const candidates = Array.from(container.querySelectorAll("div,span"))
    .filter((node): node is HTMLElement =>isHtmlElementNode( node))
    .map((node) => ({ node, text: normalizeText(node.innerText || node.textContent || "") }))
    .filter((entry) => entry.text.includes("作者") && entry.text.includes("单位"))
    .filter((entry) => entry.text.length <= 80);
  if (candidates.length === 0) return null;
  return candidates.sort((a, b) => a.text.length - b.text.length)[0]?.node ?? null;
}

function isLikelyPintiaQuestionListItem(el: HTMLElement): boolean {
  if (!isElementVisible(el) || isExtensionUiElement(el)) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width < 480 || rect.height < 96) return false;

  const id = (el.id || "").trim();
  const cls = (el.className || "").toString().toLowerCase();
  if (!/^\d{8,}$/.test(id)) return false;
  if (!/(?:^|\s)pc-x(?:\s|$)/.test(cls) || !cls.includes("scroll-mt-0")) return false;

  const text = normalizeText(extractReadableNodeText(el));
  if (text.length < 24 || text.length > 900) return false;
  if (text.includes("考试公告")) return false;

  const hasHeader = /^\d+-\d+\s+分数\s*\d+/i.test(text);
  const hasJudgeChoices = /\bT\b[\s\n]*\bF\b/i.test(text);
  const hasChoiceSignals = countOptionMarkersInText(text) >= 2;

  return hasHeader && (hasJudgeChoices || hasChoiceSignals || hasStrongQuestionSignal(text));
}

function isPintiaHost(): boolean {
  return (window.location.hostname || "").toLowerCase().includes("pintia.cn");
}

function _isPintiaProgrammingProblemPage(): boolean {
  if (!isPintiaHost()) return false;
  return /\/exam\/problems\/type\/7(?:\/|$|\?)/.test(window.location.pathname);
}

export function isPintiaCodeProblemStatementPage(): boolean {
  if (!isPintiaHost()) return false;
  if (!/\/exam\/problems\/type\/[67](?:\/|$|\?)/.test(window.location.pathname)) return false;
  return new URLSearchParams(window.location.search).has("problemSetProblemId");
}

export function isPintiaQuestionListPage(): boolean {
  if (!isPintiaHost()) return false;
  return /\/exam\/problems\/type\/[1-6](?:\/|$|\?)/.test(window.location.pathname);
}


export const pintiaQuestionListAdapter: SiteAdapter = {
  id: "pintia-question-list",
  matches: isPintiaQuestionListPage,
  buildCandidates: ({ hostRightCutX, vw, vh }) =>
    buildPintiaQuestionListCandidates(hostRightCutX, vw, vh),
};

export const pintiaCodeProblemAdapter: SiteAdapter = {
  id: "pintia-code-problem",
  matches: isPintiaCodeProblemStatementPage,
  buildCandidates: ({ hostRightCutX, vw, vh }) =>
    buildPintiaCodeProblemCandidates(hostRightCutX, vw, vh),
  // Code-problem takeover only when the generic structured-container path
  // found nothing — mirrors the original branch condition verbatim.
  takesOver: ({ hasStructuredContainers }) => !hasStructuredContainers,
  phase: "post-structured",
};
