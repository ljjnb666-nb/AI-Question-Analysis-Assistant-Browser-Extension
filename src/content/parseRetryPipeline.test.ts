import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, type ParseResult, type QuestionBlock } from "@/shared/types";
import { parseWithTieredRetries } from "./parseRetryPipeline";

const block: QuestionBlock = { id: "q", bbox: { x: 0, y: 0, width: 1, height: 1 }, previewText: "q", hasImage: false, questionTypeGuess: "single_choice", confidence: 1, source: "auto_dom" };
const result: ParseResult = { blockId: "q", questionType: "single_choice", answer: "A", confidence: 1, briefExplanation: "", detailedExplanation: "", recognizedText: "q", routeUsed: "hybrid" };
function deps(parseQuestion: (block: QuestionBlock) => Promise<ParseResult>) { return { logEvent: vi.fn(), parseQuestion, setStreamingText: vi.fn(), withTimeout: <T>(promise: Promise<T>) => promise }; }
describe("parseWithTieredRetries", () => {
  it.each(["MEDIA_SOURCE_UNAVAILABLE", "STALE_QUESTION_REVISION", "MEDIA_REQUIRES_VISION"])("RET deterministic %s only attempts once", async (message) => {
    const parseQuestion = vi.fn(async () => { throw new Error(message); });
    await expect(parseWithTieredRetries(block, DEFAULT_SETTINGS, true, () => {}, [1, 1, 1], deps(parseQuestion))).rejects.toThrow(message);
    expect(parseQuestion).toHaveBeenCalledTimes(1);
  });
  it("RET4 retries a transient error", async () => {
    const parseQuestion = vi.fn().mockRejectedValueOnce(new Error("network timeout")).mockResolvedValue(result);
    await expect(parseWithTieredRetries(block, DEFAULT_SETTINGS, true, () => {}, [1, 1, 1], deps(parseQuestion))).resolves.toMatchObject({ answer: "A" });
    expect(parseQuestion).toHaveBeenCalledTimes(2);
  });
});
