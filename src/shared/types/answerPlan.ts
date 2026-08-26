import type { QuestionType } from "./question";

export type AnswerPlanKind = "single-choice" | "multiple-choice" | "boolean" | "fill-blank" | "short-answer";

export interface AnswerPlanBase {
  schemaVersion: 1;
  questionId: string;
  contentFingerprint: string;
  questionType: QuestionType;
  confidence: number;
  source: "parse-result";
  answerSemanticHash: string;
}

export interface SingleChoiceAnswerPlan extends AnswerPlanBase { kind: "single-choice"; optionKeys: [string]; }
export interface MultipleChoiceAnswerPlan extends AnswerPlanBase { kind: "multiple-choice"; optionKeys: string[]; }
export interface BooleanAnswerPlan extends AnswerPlanBase { kind: "boolean"; value: boolean; optionKey?: string; }
export interface FillBlankAnswerPlan extends AnswerPlanBase { kind: "fill-blank"; blanks: Array<{ index: number; value: string }>; }
export interface ShortAnswerPlan extends AnswerPlanBase { kind: "short-answer"; value: string; }

export type AnswerPlan = SingleChoiceAnswerPlan | MultipleChoiceAnswerPlan | BooleanAnswerPlan | FillBlankAnswerPlan | ShortAnswerPlan;
export type AnswerPlanFailureCode = "INVALID_ANSWER_OPTION" | "INVALID_SINGLE_CHOICE_CARDINALITY" | "ANSWER_BLANK_COUNT_MISMATCH" | "INVALID_ANSWER" | "UNSUPPORTED_QUESTION_TYPE";
export type ValidatedAnswerPlan = { ok: true; plan: AnswerPlan } | { ok: false; code: AnswerPlanFailureCode; message: string };
