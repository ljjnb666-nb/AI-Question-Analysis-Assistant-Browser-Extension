import type { ManualChoiceStructure } from "../types/parse";

const REQUIRED_KEYS = ["A", "B", "C", "D"] as const;
const EXPLICIT_LABEL_RE = /(^|[\s?？。:：；;])([A-D])[.．、:：)）][ \t]*/g;

/**
 * Extract the model's EXPLICIT labeled text, never assign labels to fragments.
 * Text produced by a vision model is still unverified, so the DTO is only
 * suitable for display/review and cannot grant fill authority.
 */
export function extractExplicitManualChoiceStructure(recognizedText: string): ManualChoiceStructure | undefined {
  const source = String(recognizedText || "").replace(/\r\n?/g, "\n").trim();
  if (source.length < 20 || source.length > 4000) return undefined;
  const labels = Array.from(source.matchAll(EXPLICIT_LABEL_RE));
  if (labels.length !== REQUIRED_KEYS.length) return undefined;
  if (!labels.every((m, i) => m[2] === REQUIRED_KEYS[i])) return undefined;

  const stem = source.slice(0, labels[0]!.index! + labels[0]![1]!.length).trim();
  if (stem.length < 6 || stem.length > 1400) return undefined;

  const options: ManualChoiceStructure["options"] = [];
  for (let i = 0; i < labels.length; i++) {
    const current = labels[i]!;
    const start = current.index! + current[0].length;
    const next = labels[i + 1];
    const end = next ? next.index! + next[1]!.length : source.length;
    const value = source.slice(start, end).replace(/[ \t]+\n/g, "\n").trim();
    if (!value || value.length > 240) return undefined;
    options.push({ key: REQUIRED_KEYS[i], text: value });
  }
  return { version: 1, evidence: "vision_text_labels_unverified", stem, options };
}

/** Validate untrusted persisted/model-provided objects before displaying them. */
export function readManualChoiceStructure(value: unknown): ManualChoiceStructure | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  if (raw.version !== 1 || raw.evidence !== "vision_text_labels_unverified" ||
    typeof raw.stem !== "string" || !raw.stem.trim() || raw.stem.length > 1400 ||
    !Array.isArray(raw.options) || raw.options.length !== 4) return undefined;
  const options: ManualChoiceStructure["options"] = [];
  for (let i = 0; i < REQUIRED_KEYS.length; i++) {
    const part: unknown = raw.options[i];
    if (!part || typeof part !== "object" || Array.isArray(part)) return undefined;
    const entry = part as Record<string, unknown>;
    if (entry.key !== REQUIRED_KEYS[i] || typeof entry.text !== "string" ||
      !entry.text.trim() || entry.text.length > 240) return undefined;
    options.push({ key: REQUIRED_KEYS[i], text: entry.text });
  }
  return { version: 1, evidence: "vision_text_labels_unverified", stem: raw.stem, options };
}
