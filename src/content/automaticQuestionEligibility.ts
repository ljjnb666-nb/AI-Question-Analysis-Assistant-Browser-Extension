import type { QuestionBlock } from "@/shared/types";

export function getAutomaticQuestionEligibility(block: QuestionBlock): "eligible" | "withhold-incomplete" | "withhold-unknown" {
  if (!block.completeness) return "eligible";
  return block.completeness.state === "complete" ? "eligible" : block.completeness.state === "incomplete" ? "withhold-incomplete" : "withhold-unknown";
}
