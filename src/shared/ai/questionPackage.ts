import type { QuestionType } from "../types";

/** Runtime-only input to the solver. It is deliberately not a QuestionBlock. */
export interface SolverQuestionPackage {
  schemaVersion: 1;
  questionId: string;
  contentFingerprint: string;
  questionType: QuestionType;
  text: string;
  media: SolverMediaPart[];
  mediaFallbackUsed?: boolean;
}
/** Automatic fallbacks are revision-bound; manual capture intentionally does not use this path. */
export interface QuestionScreenshotFallback { dataUrl: string; questionId: string; contentFingerprint: string; }

export type SolverMediaRole = "stem" | "option";

export type SolverMediaSource =
  | { kind: "data-url"; dataUrl: string }
  | { kind: "remote-url"; url: string }
  | { kind: "serialized-svg"; svg: string }
  | { kind: "unavailable"; reason: string };

export interface SolverMediaPart {
  assetId: string;
  role: SolverMediaRole;
  optionKey?: string;
  contentFingerprint: string;
  mimeType?: string;
  source: SolverMediaSource;
}

export type SolverContentPart =
  | { type: "text"; text: string }
  | { type: "image"; assetId: string; role: SolverMediaRole; optionKey?: string; mimeType?: string; source: Exclude<SolverMediaSource, { kind: "unavailable" }> };

export type QuestionPackageBuildResult =
  | { ok: true; package: SolverQuestionPackage }
  | { ok: false; code: "MEDIA_SOURCE_UNAVAILABLE" | "MEDIA_BLOCKED" | "MEDIA_BUDGET_EXCEEDED" | "STALE_QUESTION_REVISION" | "MEDIA_REQUIRES_VISION" | "CANONICAL_MEDIA_REQUIRES_VISION"; assetId?: string };

/** Labels are extension-generated; page text never controls media ownership. */
export function buildSolverRequestContent(questionText: string, media: SolverMediaPart[]): SolverContentPart[] {
  // A legacy textual marker is not evidence of missing media once canonical
  // parts are present; the generated labels below carry the real semantics.
  const content: SolverContentPart[] = [{ type: "text", text: media.length ? questionText.replace(/\[图片\]/g, "").replace(/\n{3,}/g, "\n\n").trim() : questionText }];
  const stemCount = media.filter((part) => part.role === "stem").length;
  let stemIndex = 0;
  for (const part of media) {
    if (part.source.kind === "unavailable") continue;
    if (part.role === "stem") {
      stemIndex += 1;
      content.push({ type: "text", text: stemCount > 1 ? `Question stem image ${stemIndex}:` : "Question stem image:" });
    } else {
      content.push({ type: "text", text: `Option ${part.optionKey ?? "?"} image:` });
    }
    content.push({ type: "image", assetId: part.assetId, role: part.role, optionKey: part.optionKey, mimeType: part.mimeType, source: part.source });
  }
  return content;
}
