import type { QuestionBlock, QuestionDisplaySegment } from "../types";

export function buildPreferredQuestionText(block: Pick<QuestionBlock, "previewText" | "displaySegments">): string {
  const structured = buildTextFromDisplaySegments(block.displaySegments);
  const preview = String(block.previewText || "").trim();
  if (!structured) return preview;
  if (!preview) return structured;

  const structuredCompact = normalizeForCompare(structured);
  const previewCompact = normalizeForCompare(preview);
  if (!previewCompact) return structured;
  if (structuredCompact.includes(previewCompact) || previewCompact.includes(structuredCompact)) {
    return structured.length >= preview.length ? structured : preview;
  }

  if (structured.length >= Math.max(80, Math.floor(preview.length * 0.6))) {
    return structured;
  }

  return preview;
}

export function buildTextFromDisplaySegments(segments?: QuestionDisplaySegment[]): string {
  if (!segments?.length) return "";

  const lines: string[] = [];
  for (const segment of segments) {
    if (segment.type !== "text") continue;
    const text = String(segment.text || "").trim();
    if (!text) continue;
    if (segment.role === "section") {
      const label = String(segment.label || "").trim();
      lines.push(label ? `${label}：\n${text}` : text);
      continue;
    }
    lines.push(text);
  }

  return dedupeLines(lines).join("\n\n").trim();
}

function dedupeLines(lines: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const normalized = normalizeForCompare(line);
    if (!normalized || seen.has(normalized)) continue;
    if (out.some((existing) => normalizeForCompare(existing).includes(normalized))) continue;
    const existingIndex = out.findIndex((existing) => normalized.includes(normalizeForCompare(existing)));
    if (existingIndex >= 0) {
      out[existingIndex] = line.trim();
      seen.add(normalized);
      continue;
    }
    out.push(line.trim());
    seen.add(normalized);
  }
  return out;
}

function normalizeForCompare(text: string): string {
  return String(text || "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
