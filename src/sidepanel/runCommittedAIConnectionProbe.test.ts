import { beforeEach, describe, expect, it, vi } from "vitest";
import { runCommittedAIConnectionProbe } from "./runCommittedAIConnectionProbe";
import { parseQuestion } from "@/shared/utils/parseRouter";
import { beginAIConnectionValidation, finishAIConnectionValidation, AIConnectionCommandError } from "@/shared/utils/aiConnectionClient";
import type { ConnectionMetadata } from "@/shared/types/connection";

vi.mock("@/shared/utils/parseRouter", () => ({ parseQuestion: vi.fn() }));
vi.mock("@/shared/utils/aiConnectionClient", async (actual) => {
  const original = await actual<typeof import("@/shared/utils/aiConnectionClient")>();
  return { ...original, beginAIConnectionValidation: vi.fn(), finishAIConnectionValidation: vi.fn() };
});
const expected = {
  id: "conn-a", presetId: "anthropic", selectedModelId: "claude-test",
  connectionRevision: 3, credentialRevision: 2, hasCredential: true,
  validation: { status: "never_tested", generation: 3 },
} as ConnectionMetadata;
const ticket = { connectionId: expected.id, connectionRevision: 3, credentialRevision: 2, generation: 4 };
const result = { resultSource: "provider", answer: "B", routeUsed: "text", confidence: 0.98 };
const verified = { ...expected, validation: { status: "validated", generation: 4, validatedConnectionRevision: 3, validatedCredentialRevision: 2 } } as ConnectionMetadata;
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(beginAIConnectionValidation).mockResolvedValue(ticket);
  vi.mocked(parseQuestion).mockResolvedValue(result as any);
  vi.mocked(finishAIConnectionValidation).mockResolvedValue({ ok: true, metadata: verified } as any);
});
describe("03C-B revision-fenced real provider connection test", () => {
  it("B-01 persists only a committed backend validated metadata and returns it to Home/Editor", async () => {
    expect(await runCommittedAIConnectionProbe(expected, "zh")).toMatchObject({ metadata: verified, result });
    expect(beginAIConnectionValidation).toHaveBeenCalledOnce();
    expect(finishAIConnectionValidation).toHaveBeenCalledWith(ticket, "success");
    expect(finishAIConnectionValidation).toHaveBeenCalledTimes(1);
  });
  it("B-02 rejects mocked/non-provider result and marks current lease failed", async () => {
    vi.mocked(parseQuestion).mockResolvedValue({ ...result, resultSource: "mock" } as any);
    await expect(runCommittedAIConnectionProbe(expected, "zh")).rejects.toMatchObject({ code: "AI_CONNECTION_TEST_NOT_PROVIDER" });
    expect(finishAIConnectionValidation).toHaveBeenCalledWith(ticket, "failed");
    expect(finishAIConnectionValidation).not.toHaveBeenCalledWith(ticket, "success");
  });
  it("B-03 provider exception marks failed; does not leak content into commit", async () => {
    vi.mocked(parseQuestion).mockRejectedValue(new Error("secret provider details"));
    await expect(runCommittedAIConnectionProbe(expected, "zh")).rejects.toThrow("secret provider details");
    expect(finishAIConnectionValidation).toHaveBeenCalledWith(ticket, "failed");
  });
  it("B-04 config changed between UI read and begin never executes request", async () => {
    vi.mocked(beginAIConnectionValidation).mockResolvedValue({ ...ticket, credentialRevision: 8 });
    await expect(runCommittedAIConnectionProbe(expected, "zh")).rejects.toMatchObject({ code: "AI_CONNECTION_VALIDATION_STALE" });
    expect(parseQuestion).not.toHaveBeenCalled();
    expect(finishAIConnectionValidation).toHaveBeenCalledWith({ ...ticket, credentialRevision: 8 }, "failed");
  });
  it("B-05 failed background compare-and-set never yields Ready and cannot clobber successor", async () => {
    vi.mocked(finishAIConnectionValidation).mockRejectedValueOnce(new AIConnectionCommandError("AI_CONNECTION_VALIDATION_STALE"));
    await expect(runCommittedAIConnectionProbe(expected, "zh")).rejects.toMatchObject({ code: "AI_CONNECTION_VALIDATION_STALE" });
    expect(finishAIConnectionValidation).toHaveBeenCalledWith(ticket, "success");
    expect(finishAIConnectionValidation).toHaveBeenCalledWith(ticket, "failed");
  });
  it("B-06 impossible successful response without matching persisted metadata fails closed", async () => {
    vi.mocked(finishAIConnectionValidation).mockResolvedValue({ ok: true, metadata: { ...verified, id: "other" } } as any);
    await expect(runCommittedAIConnectionProbe(expected, "zh")).rejects.toMatchObject({ code: "AI_CONNECTION_VALIDATION_STALE" });
    expect(finishAIConnectionValidation).toHaveBeenCalledTimes(1);
  });
  it("B-07 blank provider answer cannot turn config Ready", async () => {
    vi.mocked(parseQuestion).mockResolvedValue({ ...result, answer: " " } as any);
    await expect(runCommittedAIConnectionProbe(expected, "en")).rejects.toMatchObject({ code: "AI_CONNECTION_TEST_NOT_PROVIDER" });
    expect(finishAIConnectionValidation).toHaveBeenCalledWith(ticket, "failed");
  });
});
