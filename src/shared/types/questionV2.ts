import type { BoundingBox } from "./capture";
import type { QuestionSource, QuestionType } from "./question";

export type QuestionIdentityStrategy = "native-id" | "content+ordinal" | "content+structure" | "content-only";

export interface QuestionIdentity {
  stableId: string;
  contentFingerprint: string;
  identityVersion: 1;
  strategy: QuestionIdentityStrategy;
  nativeQuestionId?: string;
  ordinalHint?: number;
  signals: {
    nativeId: boolean;
    content: boolean;
    options: boolean;
    media: boolean;
    structure: boolean;
  };
}

export type QuestionEvidenceKind = "text" | "image" | "formula" | "table" | "canvas" | "control";

export interface QuestionEvidenceRef {
  id: string;
  kind: QuestionEvidenceKind;
}

export interface QuestionProvenance {
  source: QuestionSource;
  frameKey?: string;
  observedAt: number;
}

export interface QuestionObservation {
  runtimeId: string;
  bbox: BoundingBox;
  identity: QuestionIdentity;
  provenance: QuestionProvenance;
}

export interface CanonicalQuestion {
  schemaVersion: 2;
  identity: QuestionIdentity;
  questionType: QuestionType;
  text: string;
  evidence: QuestionEvidenceRef[];
}
