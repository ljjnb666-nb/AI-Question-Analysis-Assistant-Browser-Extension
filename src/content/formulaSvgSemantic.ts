import { normalizeFormulaPlaceholderGlyphs, normalizeMathDisplayText } from "./formulaTextNormalization";

const SVG_TEXT_SELECTOR = "text,tspan,annotation,annotation-xml,title,desc";
const MATH_IDENTIFIER_RE = /[\p{Script=Latin}\p{Script=Greek}\u03b8\u03c9\u03c3\u03bc\u03bb\u03c6\u03c8\u03c0\u03c4\u03c7XYZxyz]/u;

export function extractSemanticSvgLikeText(node: Element): string {
  const explicit = normalizeMathDisplayText(
    node.getAttribute("aria-label")
    || node.getAttribute("alt")
    || node.getAttribute("title")
    || "",
  ).trim();

  const pieces: Array<{ text: string; x: number; y: number }> = [];
  const seen = new Set<string>();
  const textNodes = Array.from(node.querySelectorAll(SVG_TEXT_SELECTOR));
  for (const textNode of textNodes) {
    const raw = sanitizeSvgRawText(
      textNode.getAttribute("txt")
      || textNode.textContent
      || "",
    );
    if (!raw) continue;
    if (looksLikeSvgStyleNoise(raw)) continue;
    const normalized = normalizeMathDisplayText(raw).trim();
    const x = parseSvgCoord(textNode.getAttribute("x"));
    const y = parseSvgCoord(textNode.getAttribute("y"));
    const splitPieces = splitSvgTextNodeIntoPieces(textNode, normalized, x, y);
    for (const piece of splitPieces) {
      const dedupeKey = `${piece.text}@${Math.round(Number.isFinite(piece.x) ? piece.x : 0)}:${Math.round(Number.isFinite(piece.y) ? piece.y : 0)}`;
      if (!piece.text || seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      pieces.push(piece);
    }
  }

  if (pieces.length) {
    return joinSvgPiecesInReadingOrder(
      pieces,
      extractHorizontalFractionBars(node),
      extractRadicalDescriptors(node),
    );
  }

  if (explicit) return explicit;

  const textContent = normalizeMathDisplayText((node.textContent || "").replace(/\s+/g, " ").trim());
  return looksLikeSvgStyleNoise(textContent) ? "" : textContent;
}

export function findNearbySemanticFormulaTextForImage(
  img: Element,
  extractFormulaEmbedText: (embed: Element) => string,
): string {
  const scope = img.closest(
    ".markdown-latex-container,.ml-p,.option-content,.qeustion-content,.questionContent,.question-item,.base-question-component",
  ) || img.parentElement;
  if (!scope) return "";
  const imgRect = img.getBoundingClientRect();
  if (imgRect.width < 12 || imgRect.height < 12) return "";
  if (!isLikelyInlineFormulaCarrierImage(imgRect)) return "";

  const candidates = Array.from(
    scope.querySelectorAll("svg,math,mjx-container,.MathJax,.katex,embed"),
  ).filter((node) => node !== img);

  let bestText = "";
  let bestScore = -Infinity;
  for (const candidate of candidates) {
    const rect = candidate.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) continue;
    const text = candidate.tagName.toLowerCase() === "embed"
      ? extractFormulaEmbedText(candidate)
      : extractSemanticSvgLikeText(candidate);
    if (!text || looksLikeSvgStyleNoise(text)) continue;

    const dx = Math.abs((rect.left + rect.width / 2) - (imgRect.left + imgRect.width / 2));
    const dy = Math.abs((rect.top + rect.height / 2) - (imgRect.top + imgRect.height / 2));
    const xLimit = Math.max(imgRect.width * 0.8, rect.width * 0.8, 180);
    const yLimit = Math.max(imgRect.height * 1.8, rect.height * 1.8, 120);
    if (dx > xLimit || dy > yLimit) continue;

    const score = 1000 - dx - dy;
    if (score > bestScore) {
      bestScore = score;
      bestText = text;
    }
  }

  return bestText;
}

export function hasNearbyLargeVisualImageForSemanticNode(node: Element): boolean {
  const scope = node.closest(
    ".markdown-latex-container,.ml-p,.option-content,.qeustion-content,.questionContent,.question-item,.base-question-component",
  ) || node.parentElement;
  if (!scope) return false;

  const nodeRect = node.getBoundingClientRect();
  if (nodeRect.width < 8 || nodeRect.height < 8) return false;
  const semanticCueText = extractSemanticCueText(node);
  if (looksLikeQuestionTextContinuation(semanticCueText)) return false;

  const images = Array.from(scope.querySelectorAll("img"));
  for (const img of images) {
    if (img === node) continue;
    const rect = img.getBoundingClientRect();
    if (!isLikelyLargeVisualImage(rect)) continue;

    const centerDx = Math.abs((rect.left + rect.width / 2) - (nodeRect.left + nodeRect.width / 2));
    const verticalGap = nodeRect.top - rect.bottom;
    const overlapsOrNear =
      (verticalGap >= -24 && verticalGap <= 96)
      || (nodeRect.bottom >= rect.top - 12 && nodeRect.top <= rect.bottom + 12);
    const similarWidth = nodeRect.width >= rect.width * 0.55;

    if (centerDx <= Math.max(80, rect.width * 0.2) && overlapsOrNear && similarWidth) {
      return true;
    }
  }

  return false;
}

function extractSemanticCueText(node: Element): string {
  const explicit = normalizeMathDisplayText(
    node.getAttribute("aria-label")
    || node.getAttribute("alt")
    || node.getAttribute("title")
    || "",
  ).trim();
  if (explicit) return explicit;

  const parts = Array.from(node.querySelectorAll(SVG_TEXT_SELECTOR))
    .map((textNode) => normalizeMathDisplayText(
      sanitizeSvgRawText(textNode.getAttribute("txt") || textNode.textContent || ""),
    ))
    .filter(Boolean);

  if (parts.length) return parts.join(" ");
  return normalizeMathDisplayText((node.textContent || "").replace(/\s+/g, " ").trim());
}

function looksLikeQuestionTextContinuation(text: string): boolean {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) return false;
  if (/[\u4e00-\u9fa5]{4,}/.test(normalized)) return true;
  if (/(鍙栧緱鏍锋湰鍊紎鍒欏弬鏁皘鐭╀及璁″€紎浼肩劧鍑芥暟|鍏朵腑鏄瘄鍏朵腑涓簗宸茬煡|姹倈鑻褰搢鍒檤鏈嶄粠|鏍锋湰|鍙傛暟)/.test(normalized)) return true;
  return false;
}

function looksLikeSvgStyleNoise(text: string): boolean {
  const t = String(text || "").trim();
  if (!t) return true;
  if (/(?:\.brush\d+|\.pen\d+|\.font\d+|font-size|font-family|stroke:|fill:|rgb\(|viewBox|xmlns=|preserveAspectRatio|stroke-linecap)/i.test(t)) {
    return true;
  }
  return false;
}

function sanitizeSvgRawText(raw: string): string {
  let out = String(raw || "").replace(/\s+/g, " ").trim();
  if (!out) return "";

  out = out
    .replace(/<\/?text>/gi, "")
    .replace(/\/text>/gi, "")
    .replace(/[<>]/g, "")
    .replace(/閿焅?/g, "-")
    .replace(/鍒欏弬/g, "鍙欏弬")
    .replace(/閸掓瑥寮?/g, "閸欐瑥寮?")
    .trim();

  if (/[\u4e00-\u9fff]/u.test(out)) {
    out = out.replace(/[閿燂拷?]+$/g, "").trim();
  }

  if (/^(?:閿焅?|锟絴-)+$/u.test(out)) return "-";
  return out;
}

function parseSvgCoord(value: string | null): number {
  if (!value) return Number.NaN;
  const match = String(value).match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : Number.NaN;
}

function parseSvgCoordList(value: string | null): number[] {
  if (!value) return [];
  return String(value)
    .trim()
    .split(/[\s,]+/)
    .map((part) => Number(part))
    .filter((num) => Number.isFinite(num));
}

function splitSvgTextNodeIntoPieces(
  textNode: Element,
  normalized: string,
  fallbackX: number,
  y: number,
): Array<{ text: string; x: number; y: number }> {
  const xs = parseSvgCoordList(textNode.getAttribute("x"));
  const chars = Array.from(normalized);
  if (xs.length > 1 && chars.length === xs.length) {
    return chars.map((char, index) => ({
      text: char,
      x: xs[index] ?? fallbackX,
      y,
    }));
  }

  return [{
    text: normalized,
    x: Number.isFinite(fallbackX) ? fallbackX : (xs[0] ?? 0),
    y,
  }];
}

function extractHorizontalFractionBars(node: Element): Array<{ x1: number; x2: number; y: number }> {
  const lines = Array.from(node.querySelectorAll("line"));
  const bars: Array<{ x1: number; x2: number; y: number }> = [];
  for (const line of lines) {
    const x1 = parseSvgCoord(line.getAttribute("x1"));
    const x2 = parseSvgCoord(line.getAttribute("x2"));
    const y1 = parseSvgCoord(line.getAttribute("y1"));
    const y2 = parseSvgCoord(line.getAttribute("y2"));
    if (!Number.isFinite(x1) || !Number.isFinite(x2) || !Number.isFinite(y1) || !Number.isFinite(y2)) continue;
    if (Math.abs(y1 - y2) > 2) continue;
    if (Math.abs(x2 - x1) < 60) continue;
    bars.push({ x1: Math.min(x1, x2), x2: Math.max(x1, x2), y: (y1 + y2) / 2 });
  }
  return bars;
}

function isLikelyInlineFormulaCarrierImage(rect: DOMRect | { width: number; height: number }): boolean {
  return rect.width <= 240 && rect.height <= 48;
}

function isLikelyLargeVisualImage(rect: DOMRect | { width: number; height: number }): boolean {
  return rect.width >= 220 || rect.height >= 52;
}

function joinSvgPiecesInReadingOrder(
  pieces: Array<{ text: string; x: number; y: number }>,
  fractionBars: Array<{ x1: number; x2: number; y: number }> = [],
  radicals: Array<{ x1: number; x2: number; roofY: number; maxY: number }> = [],
): string {
  const validPieces = pieces.map((piece, index) => ({
    id: index,
    ...piece,
    x: Number.isFinite(piece.x) ? piece.x : 0,
    y: Number.isFinite(piece.y) ? piece.y : 0,
  }));
  const radicalPass = consumeRadicalTokens(validPieces, radicals);
  const radicalExpandedPieces = [...radicalPass.remainingPieces, ...radicalPass.syntheticPieces];
  const { remainingPieces, syntheticPieces } = consumeFractionTokens(radicalExpandedPieces, fractionBars);
  const baselineY = pickBaselineY(validPieces);
  const inlineSyntheticPieces = syntheticPieces.map((piece) => ({
    ...piece,
    y: baselineY,
  }));
  const baseline = [...remainingPieces, ...inlineSyntheticPieces]
    .filter((piece) => Math.abs(piece.y - baselineY) <= 18)
    .sort((a, b) => a.x - b.x);
  const lower = remainingPieces
    .filter((piece) => piece.y > baselineY + 18)
    .sort((a, b) => a.x - b.x);
  const upper = remainingPieces
    .filter((piece) => piece.y < baselineY - 18)
    .sort((a, b) => a.x - b.x);

  const merged = baseline.map((piece) => ({ ...piece, prefix: "", suffix: "" }));
  const attachedPieceIds = new Set<number>();

  for (const piece of upper) {
    const host = findNearestAttachTargetSmart(merged, piece.x);
    if (!host) continue;
    if (piece.x < host.x - 6) continue;
    host.suffix += `^{${piece.text}}`;
    attachedPieceIds.add(piece.id);
  }

  for (const piece of lower) {
    const host = findNearestAttachTargetSmart(merged, piece.x);
    if (!host || !shouldAttachAsSubscriptPiece(piece.text)) continue;
    if (piece.x < host.x - 6) continue;
    host.suffix += `_{${piece.text}}`;
    attachedPieceIds.add(piece.id);
  }

  const mergedText = merged
    .map((piece) => `${piece.prefix}${piece.text}${piece.suffix}`.trim())
    .filter(Boolean)
    .join(" ");

  const leftover = remainingPieces
    .filter((piece) => Math.abs(piece.y - baselineY) > 18)
    .filter((piece) => !attachedPieceIds.has(piece.id))
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((piece) => piece.text)
    .join(" ");

  return tightenMathTokenSpacing(`${mergedText} ${leftover}`.replace(/\s{2,}/g, " ").trim());
}

function consumeFractionTokens(
  pieces: Array<{ id: number; text: string; x: number; y: number }>,
  bars: Array<{ x1: number; x2: number; y: number }>,
): {
  remainingPieces: Array<{ id: number; text: string; x: number; y: number }>;
  syntheticPieces: Array<{ id: number; text: string; x: number; y: number }>;
} {
  if (!bars.length) {
    return { remainingPieces: pieces, syntheticPieces: [] };
  }

  const consumed = new Set<number>();
  const syntheticPieces: Array<{ id: number; text: string; x: number; y: number }> = [];

  for (const bar of bars.sort((a, b) => a.x1 - b.x1)) {
    const numerator = pieces
      .filter((piece) => !consumed.has(piece.id))
      .filter((piece) => piece.y < bar.y - 20 && piece.x >= bar.x1 - 24 && piece.x <= bar.x2 + 24)
      .sort((a, b) => a.x - b.x);
    const denominator = pieces
      .filter((piece) => !consumed.has(piece.id))
      .filter((piece) => piece.y > bar.y + 20 && piece.x >= bar.x1 - 24 && piece.x <= bar.x2 + 24)
      .sort((a, b) => a.x - b.x);

    if (!numerator.length || !denominator.length) continue;
    if (numerator.length > 12 || denominator.length > 12) continue;

    numerator.forEach((piece) => consumed.add(piece.id));
    denominator.forEach((piece) => consumed.add(piece.id));
    const numeratorText = composeMathSideText(numerator, "numerator");
    const denominatorText = composeMathSideText(denominator, "denominator");
    if (!numeratorText || !denominatorText) continue;
    syntheticPieces.push({
      id: 10_000 + syntheticPieces.length,
      text: `(${numeratorText})/(${denominatorText})`,
      x: bar.x1,
      y: bar.y,
    });
  }

  return {
    remainingPieces: pieces.filter((piece) => !consumed.has(piece.id)),
    syntheticPieces,
  };
}

function consumeRadicalTokens(
  pieces: Array<{ id: number; text: string; x: number; y: number }>,
  radicals: Array<{ x1: number; x2: number; roofY: number; maxY: number }>,
): {
  remainingPieces: Array<{ id: number; text: string; x: number; y: number }>;
  syntheticPieces: Array<{ id: number; text: string; x: number; y: number }>;
} {
  if (!radicals.length) return { remainingPieces: pieces, syntheticPieces: [] };

  const consumed = new Set<number>();
  const syntheticPieces: Array<{ id: number; text: string; x: number; y: number }> = [];
  const radicalPrefix = String.fromCharCode(8730);

  for (const radical of radicals.sort((a, b) => a.x1 - b.x1)) {
    const covered = pieces
      .filter((piece) => !consumed.has(piece.id))
      .filter((piece) => piece.x >= radical.x1 - 16 && piece.x <= radical.x2 + 24)
      .filter((piece) => piece.y >= radical.roofY - 12 && piece.y <= radical.maxY + 80)
      .sort((a, b) => a.x - b.x);
    if (!covered.length) continue;

    covered.forEach((piece) => consumed.add(piece.id));
    const inner = composeMathSideText(covered, "baseline");
    if (!inner) continue;
    syntheticPieces.push({
      id: 20_000 + syntheticPieces.length,
      text: `${radicalPrefix}(${inner})`,
      x: radical.x1,
      y: radical.maxY,
    });
  }

  return {
    remainingPieces: pieces.filter((piece) => !consumed.has(piece.id)),
    syntheticPieces,
  };
}

function composeMathSideText(
  pieces: Array<{ text: string; x: number; y: number }>,
  side: "numerator" | "denominator" | "baseline",
): string {
  if (!pieces.length) return "";
  const baselineY = pickBaselineY(pieces);
  const baseline = pieces
    .filter((piece) => Math.abs(piece.y - baselineY) <= 18)
    .sort((a, b) => a.x - b.x)
    .map((piece) => ({ ...piece, prefix: "", subscript: "", superscript: "", suffix: "" }));
  const upper = pieces
    .filter((piece) => piece.y < baselineY - 18)
    .sort((a, b) => a.x - b.x);
  const lower = pieces
    .filter((piece) => piece.y > baselineY + 18)
    .sort((a, b) => a.x - b.x);
  const attachedPieces = new Set<string>();

  const pieceKey = (piece: { text: string; x: number; y: number }) =>
    `${piece.x}:${piece.y}:${piece.text}`;

  for (const piece of upper) {
    const host = findNearestAttachTargetSmart(baseline, piece.x);
    if (host) {
      if (piece.x < host.x - 6) continue;
      host.superscript += piece.text;
      attachedPieces.add(pieceKey(piece));
    }
  }
  for (const piece of lower) {
    const host = findNearestAttachTargetSmart(baseline, piece.x);
    if (host && shouldAttachAsSubscriptPiece(piece.text)) {
      if (piece.x < host.x - 6) continue;
      host.subscript += piece.text;
      attachedPieces.add(pieceKey(piece));
    }
  }

  let text = baseline
    .map((piece) => {
      const subscript = piece.subscript ? `_{${piece.subscript}}` : "";
      const superscript = piece.superscript ? `^{${piece.superscript}}` : "";
      return `${piece.prefix}${piece.text}${subscript}${superscript}${piece.suffix}`.trim();
    })
    .filter(Boolean)
    .join(" ");

  let leftoverPieces = [...upper, ...lower]
    .filter((piece) => !attachedPieces.has(pieceKey(piece)))
    .sort((a, b) => a.x - b.x);

  if (side === "numerator" && baseline.length > 0) {
    leftoverPieces = leftoverPieces.filter((piece) => {
      const compact = String(piece.text || "").replace(/\s+/g, "");
      return !(
        /^[12]$/.test(compact) &&
        piece.x < baseline[0].x &&
        baseline[0].x - piece.x <= 80
      );
    });
  }

  const leftover = leftoverPieces.map((piece) => piece.text).join(" ");

  if (leftover) text = `${text} ${leftover}`.trim();
  text = tightenMathTokenSpacing(
    text
      .replace(/(\d)\s*\.\s*(\d)/g, "$1.$2")
      .replace(/\s{2,}/g, " ")
      .trim(),
  );

  if (side === "numerator") {
    text = text.replace(/^(?:1|2)\s+(?=[A-Za-zXx])/u, "");
  }
  return text;
}

function extractRadicalDescriptors(node: Element): Array<{ x1: number; x2: number; roofY: number; maxY: number }> {
  const lines = Array.from(node.querySelectorAll("line"))
    .map((line) => ({
      x1: parseSvgCoord(line.getAttribute("x1")),
      x2: parseSvgCoord(line.getAttribute("x2")),
      y1: parseSvgCoord(line.getAttribute("y1")),
      y2: parseSvgCoord(line.getAttribute("y2")),
    }))
    .filter((line) => [line.x1, line.x2, line.y1, line.y2].every((n) => Number.isFinite(n)));

  const out: Array<{ x1: number; x2: number; roofY: number; maxY: number }> = [];
  for (const roof of lines) {
    const isHorizontal = Math.abs(roof.y1 - roof.y2) <= 2;
    if (!isHorizontal) continue;
    if (Math.abs(roof.x2 - roof.x1) < 120) continue;

    const leftX = Math.min(roof.x1, roof.x2);
    const rightX = Math.max(roof.x1, roof.x2);
    const roofY = (roof.y1 + roof.y2) / 2;
    const slants = lines.filter((line) => {
      if (line === roof) return false;
      const nearLeft = Math.min(
        Math.abs(line.x1 - leftX) + Math.abs(line.y1 - roofY),
        Math.abs(line.x2 - leftX) + Math.abs(line.y2 - roofY),
      );
      const diagonal = Math.abs(line.y1 - line.y2) > 8 && Math.abs(line.x1 - line.x2) > 8;
      return diagonal && nearLeft <= 80;
    });
    const tailSegments = lines.filter((line) => {
      if (line === roof) return false;
      const diagonal = Math.abs(line.y1 - line.y2) > 8 && Math.abs(line.x1 - line.x2) > 8;
      if (!diagonal) return false;
      const withinTailX = Math.min(line.x1, line.x2) >= leftX - 240 && Math.max(line.x1, line.x2) <= leftX + 40;
      const belowRoof = Math.max(line.y1, line.y2) >= roofY + 40;
      return withinTailX && belowRoof;
    });
    if (slants.length < 1 || tailSegments.length < 2) continue;

    out.push({
      x1: leftX,
      x2: rightX,
      roofY,
      maxY: Math.max(roof.y1, roof.y2, ...slants.flatMap((line) => [line.y1, line.y2])),
    });
  }
  return out;
}

function tightenMathTokenSpacing(text: string): string {
  return normalizeFormulaPlaceholderGlyphs(String(text || ""))
    .replace(/[?]+/g, "-")
    .replace(/-\s*\?/g, "-")
    .replace(/\?\s*-/g, "-")
    .replace(/\s*-\s*/g, " - ")
    .replace(/\(\s*([^\s()]+)\s*\/\s*(√\([^()]+\))\s*\)/g, "($1)/($2)")
    .replace(/(\d\/\d+)\s+([\p{Script=Latin}\p{Script=Greek}\u03b8\u03c9\u03c3\u03bc\u03bb\u03c6\u03c8\u03c0\u03c4\u03c7XYZxyz])/gu, "$1$2")
    .replace(/([\p{Script=Latin}\p{Script=Greek}\u03b8\u03c9\u03c3\u03bc\u03bb\u03c6\u03c8\u03c0\u03c4\u03c7XYZxyz])\s+\^/gu, "$1^")
    .replace(/\)\s*\/\s*\(/g, ")/(")
    .replace(/\)\s+\(/g, ")*(")
    .replace(/([0-9}])\s+\(/g, "$1*(")
    .replace(/([0-9}])\s+([\p{Script=Latin}\p{Script=Greek}\u03b8\u03c9\u03c3\u03bc\u03bb\u03c6\u03c8\u03c0\u03c4\u03c7XYZxyz])/gu, "$1*$2")
    .replace(/\)\s+([\p{Script=Latin}\p{Script=Greek}\u03b8\u03c9\u03c3\u03bc\u03bb\u03c6\u03c8\u03c0\u03c4\u03c7XYZxyz])/gu, ")*$1")
    .replace(/([0-9}])\s+([\p{L}])/gu, "$1*$2")
    .replace(/\)\s+([\p{L}])/gu, ")*$1")
    .replace(/\+\s*\(([^()]+)\)\s+1\s+3\b/g, "+ (1)/(3)*($1)")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function shouldAttachAsSubscriptPiece(text: string): boolean {
  const compact = String(text || "").replace(/\s+/g, "");
  if (!compact) return false;
  return /^[0-9]+$/.test(compact);
}

function pickBaselineY(pieces: Array<{ x: number; y: number; text: string }>): number {
  if (!pieces.length) return 0;
  const equalsPiece = pieces.find((piece) => String(piece.text || "").replace(/\s+/g, "") === "=");
  if (equalsPiece) {
    return Math.round(equalsPiece.y / 12) * 12;
  }
  const buckets = new Map<number, number>();
  for (const piece of pieces) {
    const key = Math.round(piece.y / 12) * 12;
    buckets.set(key, (buckets.get(key) || 0) + baselineWeightForPiece(piece.text));
  }
  return [...buckets.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? pieces[0].y;
}

function baselineWeightForPiece(text: string): number {
  const compact = String(text || "").replace(/\s+/g, "");
  if (!compact) return 0;
  if (/^[0-9.,]+$/.test(compact)) return 0.75;
  if (/^[=+\-()]+$/.test(compact)) return 2.4;
  if (compact.includes("/")) return 2.8;
  if (/[\p{L}]/u.test(compact)) return Math.max(2.6, compact.length * 1.2);
  return Math.max(1, compact.length);
}

function findNearestAttachTargetSmart<T extends { x: number; text: string; suffix?: string }>(pieces: T[], x: number): T | null {
  const hosts = pieces.filter((piece) => {
    const compact = String(piece.text || "").replace(/\s+/g, "");
    return compact && isLikelyMathAttachHost(compact);
  });
  if (!hosts.length) return null;

  const sortedXs = hosts.map((piece) => piece.x).sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < sortedXs.length; i += 1) {
    const gap = sortedXs[i] - sortedXs[i - 1];
    if (gap > 0) gaps.push(gap);
  }
  const medianGap = gaps.length
    ? gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)]
    : 180;
  const maxAttachDx = hosts.length === 1
    ? 900
    : Math.max(300, Math.min(900, medianGap * 0.8));

  const leftHosts = hosts.filter((piece) => {
    const dx = x - piece.x;
    return dx >= -8 && dx <= maxAttachDx;
  });
  if (leftHosts.length) {
    let bestLeft: T | null = null;
    let bestLeftScore = Number.POSITIVE_INFINITY;
    for (const piece of leftHosts) {
      const dx = Math.max(0, x - piece.x);
      const compact = String(piece.text || "").replace(/\s+/g, "");
      const preferenceBias = /[\p{L}]/u.test(compact) ? 0 : 90;
      const score = dx + preferenceBias;
      if (score < bestLeftScore) {
        bestLeftScore = score;
        bestLeft = piece;
      }
    }
    if (bestLeft) return bestLeft;
  }

  let best: T | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const piece of hosts) {
    const dx = Math.abs(x - piece.x);
    if (dx > maxAttachDx) continue;
    if (dx < bestScore) {
      bestScore = dx;
      best = piece;
    }
  }
  return best;
}

function isLikelyMathAttachHost(text: string): boolean {
  if (!text) return false;
  if (/^[=+\-*/,:;\uFF0C\u3002\uFF0E\u3001]+$/u.test(text)) return false;
  if (/[)\]}]$/u.test(text)) return false;
  if (MATH_IDENTIFIER_RE.test(text)) return true;
  return /[0-9]/.test(text);
}
