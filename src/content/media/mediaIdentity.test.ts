import { describe, expect, it } from "vitest";
import { buildQuestionIdentity, canonicalizeQuestionImageUrl } from "../questionIdentity";

const input = (mediaFingerprintHints: Parameters<typeof buildQuestionIdentity>[0]["mediaFingerprintHints"]) => ({ text: "1. 根据下图选择 A. a B. b C. c D. d", questionType: "single_choice" as const, mediaFingerprintHints });
describe("media identity", () => {
  it("is stable across hint ordering and changes when an option image changes", () => {
    const base = [{ role: "option" as const, optionKey: "A", contentFingerprint: "url_a", semanticOrder: 2 }, { role: "stem" as const, contentFingerprint: "url_stem", semanticOrder: 1 }];
    expect(buildQuestionIdentity(input(base)).contentFingerprint).toBe(buildQuestionIdentity(input([...base].reverse())).contentFingerprint);
    expect(buildQuestionIdentity(input([{ ...base[0], contentFingerprint: "url_changed" }, base[1]])).contentFingerprint).not.toBe(buildQuestionIdentity(input(base)).contentFingerprint);
  });
  it("normalizes query ordering and volatile signed/cache parameters without erasing semantic query", () => {
    expect(canonicalizeQuestionImageUrl("https://example.com/a.png?b=2&a=1")).toBe(canonicalizeQuestionImageUrl("https://example.com/a.png?a=1&b=2"));
    expect(canonicalizeQuestionImageUrl("https://example.com/a.png?X-Amz-Signature=one&Expires=2&id=3")).toBe(canonicalizeQuestionImageUrl("https://example.com/a.png?X-Amz-Signature=two&Expires=9&id=3"));
    expect(canonicalizeQuestionImageUrl("https://example.com/a.png?id=3")).not.toBe(canonicalizeQuestionImageUrl("https://example.com/a.png?id=4"));
  });
});
