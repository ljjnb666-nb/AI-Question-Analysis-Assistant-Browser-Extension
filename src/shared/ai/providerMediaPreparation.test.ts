import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, type QuestionBlock } from "@/shared/types";
import { parseQuestionPackage } from "@/shared/utils/parseRouter";
import { getProvider } from "./providers";
import { prepareQuestionPackageForProvider } from "./providerMediaPreparation";
import type { SolverQuestionPackage } from "./questionPackage";

const png = "data:image/png;base64,aGVsbG8=";
const block: QuestionBlock = { id: "q", bbox: { x: 0, y: 0, width: 1, height: 1 }, previewText: "Which image is correct? A. cat B. dog C. bird D. fish. Please choose the correct image based on the visual choices.", hasImage: true, questionTypeGuess: "single_choice", confidence: 1, source: "auto_dom", completeness: { state: "complete", boundaryComplete: true, stemComplete: true, optionsComplete: true, visualComplete: true, controlsComplete: true, confidence: 1, reasons: [] } };
const pkg: SolverQuestionPackage = { schemaVersion: 1, questionId: "q", contentFingerprint: "fp", questionType: "single_choice", text: block.previewText, media: ["A", "B", "C", "D"].map((optionKey) => ({ assetId: optionKey, role: "option" as const, optionKey, contentFingerprint: optionKey, source: { kind: "remote-url" as const, url: `https://media.test/${optionKey}.png` } })) };
afterEach(() => vi.unstubAllGlobals());
describe("provider-aware canonical media preparation", () => {
  it("RT1/RT2 auto route never becomes text when canonical option or stem media exists", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"questionType":"single_choice","answer":"A","confidence":1}' } }] }), { status: 200 })); vi.stubGlobal("fetch", fetchMock);
    const canonicalBlock = { ...block, mediaAssets: pkg.media.map((m) => ({ schemaVersion: 1 as const, assetId: m.assetId, contentFingerprint: m.contentFingerprint, kind: "image" as const, sourceKind: "data-url" as const, availability: "available" as const, ownership: { role: "option" as const, optionKey: m.optionKey, confidence: 1, reasons: ["OPTION_ANCESTRY" as const] } })) };
    await parseQuestionPackage({ ...pkg, media: pkg.media.map((m) => ({ ...m, source: { kind: "data-url", dataUrl: png } })) }, canonicalBlock, { ...DEFAULT_SETTINGS, providerId: "openai", apiKey: "k", preferredRoute: "auto" });
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body)); expect(body.messages[1].content.filter((p: { type: string }) => p.type === "image_url")).toHaveLength(4);
  });
  it("RT3/RT4 fail before provider for explicit text and text-only provider", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    await expect(parseQuestionPackage(pkg, block, { ...DEFAULT_SETTINGS, providerId: "openai", apiKey: "k", preferredRoute: "text" })).rejects.toThrow("CANONICAL_MEDIA_REQUIRES_VISION");
    await expect(parseQuestionPackage(pkg, block, { ...DEFAULT_SETTINGS, providerId: "deepseek", apiKey: "k", preferredRoute: "auto" })).rejects.toThrow("MEDIA_REQUIRES_VISION"); expect(fetchMock).not.toHaveBeenCalled();
  });
  it("SF1/SF2/SF3 and REV1/REV2 fail closed before provider", async () => {
    const failFetch = vi.fn(async () => new Response("x", { status: 500 }));
    const fallback = { dataUrl: png, questionId: "q", contentFingerprint: "fp" };
    expect(await prepareQuestionPackageForProvider(pkg, getProvider("anthropic"), { fetch: failFetch, screenshotFallback: fallback })).toMatchObject({ ok: true, package: { mediaFallbackUsed: true } });
    expect(await prepareQuestionPackageForProvider(pkg, getProvider("anthropic"), { fetch: failFetch, screenshotFallback: { ...fallback, contentFingerprint: "stale" } })).toMatchObject({ ok: false, code: "MEDIA_SOURCE_UNAVAILABLE" });
    const abort = new AbortController(); abort.abort(); expect(await prepareQuestionPackageForProvider(pkg, getProvider("anthropic"), { signal: abort.signal })).toMatchObject({ ok: false, code: "STALE_QUESTION_REVISION" });
    expect(await prepareQuestionPackageForProvider(pkg, getProvider("anthropic"), { fetch: vi.fn(async () => new Response(new Blob(["x"], { type: "image/png" }))), isQuestionRevisionCurrent: () => false })).toMatchObject({ ok: false, code: "STALE_QUESTION_REVISION" });
  });
  it("BUD1/BUD2/BUD3 count remote inline bytes but leave remote-direct untouched", async () => {
    const body = new Uint8Array(1_900_000); const media = Array.from({ length: 4 }, (_, i) => ({ ...pkg.media[i], source: { kind: "remote-url" as const, url: `https://media.test/${i}` } })); const fetch = vi.fn(async () => new Response(new Blob([body], { type: "image/png" })));
    expect(await prepareQuestionPackageForProvider({ ...pkg, media }, getProvider("anthropic"), { fetch })).toMatchObject({ ok: false, code: "MEDIA_BUDGET_EXCEEDED" });
    fetch.mockClear(); expect(await prepareQuestionPackageForProvider({ ...pkg, media: media.slice(0, 3) }, getProvider("openai"), { fetch })).toMatchObject({ ok: true }); expect(fetch).not.toHaveBeenCalled();
  });
});
