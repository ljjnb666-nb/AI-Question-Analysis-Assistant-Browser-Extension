import { afterEach, describe, expect, it, vi } from "vitest";
import { parseQuestion, parseQuestionPackage } from "@/shared/utils/parseRouter";
import { DEFAULT_SETTINGS, type MediaAssetRef, type QuestionBlock } from "@/shared/types";
import type { SolverQuestionPackage } from "./questionPackage";

const block: QuestionBlock = { id: "q", bbox: { x: 0, y: 0, width: 1, height: 1 }, previewText: "Which image is correct? A B C D", hasImage: true, questionTypeGuess: "single_choice", confidence: 1, source: "auto_dom" };
const pkg: SolverQuestionPackage = { schemaVersion: 1, questionId: "q", contentFingerprint: "fp", questionType: "single_choice", text: block.previewText, media: [
  { assetId: "stem", role: "stem", contentFingerprint: "s", mimeType: "image/jpeg", source: { kind: "data-url", dataUrl: "data:image/jpeg;base64,aGVsbG8=" } },
  ...["A", "B", "C", "D"].map((optionKey) => ({ assetId: optionKey, role: "option" as const, optionKey, contentFingerprint: optionKey, mimeType: "image/png", source: { kind: "data-url" as const, dataUrl: "data:image/png;base64,aGVsbG8=" } })),
] };
const response = () => new Response(JSON.stringify({ choices: [{ message: { content: '{"questionType":"single_choice","answer":"A","confidence":1}' } }] }), { status: 200 });
afterEach(() => vi.unstubAllGlobals());
describe("provider media adapters", () => {
  it("OpenAI sends every labeled image and preserves a remote URL", async () => {
    const fetchMock = vi.fn(async () => response()); vi.stubGlobal("fetch", fetchMock);
    await parseQuestionPackage({ ...pkg, media: [{ ...pkg.media[0], source: { kind: "remote-url", url: "https://example.test/diagram.jpg" } }, ...pkg.media.slice(1)] }, block, { ...DEFAULT_SETTINGS, providerId: "openai", apiKey: "key", preferredRoute: "vision" });
    const [, request] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]; const body = JSON.parse(String(request.body)); const content = body.messages[1].content;
    expect(content.filter((part: { type: string }) => part.type === "image_url")).toHaveLength(5);
    expect(content.map((part: { text?: string }) => part.text).filter(Boolean)).toEqual(expect.arrayContaining(["Option A image:", "Option B image:", "Option C image:", "Option D image:"]));
    expect(content.find((part: { image_url?: { url: string } }) => part.image_url)?.image_url.url).toBe("https://example.test/diagram.jpg");
  });
  it("Anthropic sends N image blocks with actual MIME", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ content: [{ type: "text", text: '{"questionType":"single_choice","answer":"A","confidence":1}' }] }), { status: 200 })); vi.stubGlobal("fetch", fetchMock);
    await parseQuestionPackage(pkg, block, { ...DEFAULT_SETTINGS, providerId: "anthropic", apiKey: "key", preferredRoute: "vision" });
    const [, request] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]; const content = JSON.parse(String(request.body)).messages[0].content;
    expect(content.filter((part: { type: string }) => part.type === "image")).toHaveLength(5);
    expect(content.find((part: { type: string }) => part.type === "image").source.media_type).toBe("image/jpeg");
  });
  it("Gemini sends N inline_data image parts", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"questionType":"single_choice","answer":"A","confidence":1}' }] } }] }), { status: 200 })); vi.stubGlobal("fetch", fetchMock);
    await parseQuestionPackage(pkg, block, { ...DEFAULT_SETTINGS, providerId: "gemini", apiKey: "key", preferredRoute: "vision" });
    const [, request] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]; const parts = JSON.parse(String(request.body)).contents[0].parts;
    expect(parts.filter((part: { inline_data?: unknown }) => part.inline_data)).toHaveLength(5);
    expect(parts.find((part: { inline_data?: { mime_type: string } }) => part.inline_data)?.inline_data.mime_type).toBe("image/jpeg");
  });
  it("P4-12/P4-13/G4 never calls a provider for blocked required canonical media", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const blocked: MediaAssetRef = { schemaVersion: 1, assetId: "blocked", contentFingerprint: "blocked", kind: "canvas", sourceKind: "canvas-snapshot", availability: "tainted", ownership: { role: "stem", confidence: 1, reasons: ["STEM_ANCESTRY"] } };
    await expect(parseQuestion({ ...block, mediaAssets: [blocked], completeness: { state: "complete", boundaryComplete: true, stemComplete: true, optionsComplete: true, visualComplete: true, controlsComplete: true, confidence: 1, reasons: [] } }, { ...DEFAULT_SETTINGS, providerId: "openai", apiKey: "key", preferredRoute: "vision" })).rejects.toThrow("MEDIA_BLOCKED");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
