import { beforeEach, describe, expect, it, vi } from "vitest";
import { installMemoryStorage, type MemoryStorageHandle } from "../test/memoryStorage";
import { DEFAULT_SETTINGS } from "../shared/types/settings";
import type { AIConnectionState } from "../shared/types/connection";
import type { AIConnectionValidationTicket } from "../shared/types/aiConnectionMessages";

const id = "test-connection";
const own = () => ({ id: chrome.runtime.id, url: chrome.runtime.getURL("sidepanel/sidepanel.html") });
let memory: MemoryStorageHandle;
let command: (message: unknown, sender: chrome.runtime.MessageSender) => Promise<unknown>;
const send = (message: unknown, sender: chrome.runtime.MessageSender = own()) => command(message, sender);
const state = () => memory.store.get("aiConnectionState") as AIConnectionState;
async function begin(): Promise<AIConnectionValidationTicket> {
  const response = await send({ type: "AI_CONNECTION_BEGIN_VALIDATION" }) as { ok: boolean; validationTicket?: AIConnectionValidationTicket };
  expect(response.ok).toBe(true);
  expect(response.validationTicket).toBeDefined();
  return response.validationTicket!;
}
const finish = (ticket: AIConnectionValidationTicket, outcome: "success" | "failed") =>
  send({ type: "AI_CONNECTION_FINISH_VALIDATION", ticket, outcome });

beforeEach(async () => {
  vi.resetModules();
  memory = installMemoryStorage();
  memory.store.set("appSettings", { ...DEFAULT_SETTINGS });
  memory.store.set("aiConnectionState", {
    schemaVersion: 1, revision: 1, activeConnectionId: id,
    credentials: {},
    connections: { [id]: {
      id, name: "Test", presetId: "ollama", authScheme: { kind: "none" },
      selectedModelId: "qwen-test", connectionRevision: 1,
      validation: { status: "never_tested", generation: 0 },
      createdAt: 1, updatedAt: 1
    } }
  } satisfies AIConnectionState);
  command = (await import("./aiConnectionAuthority")).handleAIConnectionCommand;
});

describe("RC-PILOT-03C single-writer validation lease", () => {
  it("03C-01 commits matching real-test success to persisted revision-bound metadata across readback", async () => {
    const ticket = await begin();
    expect(state().connections[id].validation).toMatchObject({ status: "testing", generation: 1 });
    expect(await finish(ticket, "success")).toMatchObject({ ok: true });
    const validation = state().connections[id].validation;
    expect(validation).toMatchObject({
      status: "validated", generation: 1,
      validatedConnectionRevision: 1
    });
    expect(validation.validatedCredentialRevision).toBeUndefined(); // Keyless provider: never persist invalid revision 0.
    expect(validation.validatedAt).toBeTypeOf("number");
    const read = await send({ type: "AI_CONNECTION_GET_ACTIVE_METADATA" });
    expect(read).toMatchObject({ ok: true, metadata: { validation } });
    expect(JSON.stringify(read)).not.toMatch(/encryptedValue|apiKey|qse:/i);
  });
  it("03C-02 failed test never becomes validated; failure code is bounded", async () => {
    const ticket = await begin();
    expect(await finish(ticket, "failed")).toMatchObject({ ok: true });
    expect(state().connections[id].validation).toEqual({ status: "failed", generation: 1, errorCode: "AI_CONNECTION_TEST_FAILED" });
  });
  it("03C-03 stale test after model change cannot overwrite new revision", async () => {
    const ticket = await begin();
    const patch = { selectedModelId: "new-model", credential: { action: "KEEP" } };
    expect(await send({ type: "AI_CONNECTION_UPDATE_ACTIVE", patch })).toMatchObject({ ok: true });
    const after = JSON.stringify(state());
    expect(await finish(ticket, "success")).toEqual({ ok: false, code: "AI_CONNECTION_VALIDATION_STALE" });
    expect(JSON.stringify(state())).toBe(after);
    expect(state().connections[id].validation.status).toBe("stale");
  });
  it("03C-04 later begin supersedes earlier test and rejects replay", async () => {
    const first = await begin();
    const second = await begin();
    expect(second.generation).toBe(first.generation + 1);
    expect(await finish(first, "success")).toEqual({ ok: false, code: "AI_CONNECTION_VALIDATION_STALE" });
    expect(await finish(second, "success")).toMatchObject({ ok: true });
    const after = JSON.stringify(state());
    expect(await finish(second, "success")).toEqual({ ok: false, code: "AI_CONNECTION_VALIDATION_STALE" });
    expect(JSON.stringify(state())).toBe(after);
  });
  it("03C-05 rejects injected fields, raw reasons and malformed generation with zero mutations", async () => {
    const ticket = await begin();
    const before = JSON.stringify(state());
    for (const payload of [
      { type: "AI_CONNECTION_FINISH_VALIDATION", ticket: { ...ticket, apiKey: "forbidden" }, outcome: "success" },
      { type: "AI_CONNECTION_FINISH_VALIDATION", ticket: { ...ticket, generation: -1 }, outcome: "success" },
      { type: "AI_CONNECTION_FINISH_VALIDATION", ticket, outcome: "success", errorMessage: "secret" },
      { type: "AI_CONNECTION_FINISH_VALIDATION", ticket, outcome: "unknown" },
      { type: "AI_CONNECTION_BEGIN_VALIDATION", payload: {} },
    ]) expect(await send(payload)).toMatchObject({ ok: false });
    expect(JSON.stringify(state())).toBe(before);
  });
  it("03C-06 content script, popup and foreign extension cannot begin/finish", async () => {
    const ticket = await begin();
    const before = JSON.stringify(state());
    for (const sender of [
      { id: chrome.runtime.id, url: "https://example.test", tab: { id: 1 } as chrome.tabs.Tab },
      { id: chrome.runtime.id, url: chrome.runtime.getURL("popup/popup.html") },
      { id: "other-extension", url: chrome.runtime.getURL("sidepanel/sidepanel.html") },
    ]) {
      expect(await send({ type: "AI_CONNECTION_BEGIN_VALIDATION" }, sender)).toEqual({ ok: false, code: "AI_CONNECTION_SENDER_FORBIDDEN" });
      expect(await send({ type: "AI_CONNECTION_FINISH_VALIDATION", ticket, outcome: "success" }, sender)).toEqual({ ok: false, code: "AI_CONNECTION_SENDER_FORBIDDEN" });
    }
    expect(JSON.stringify(state())).toBe(before);
  });
  it("03C-07 missing credential prevents beginning test for key-required provider", async () => {
    const initial = structuredClone(state());
    initial.connections[id].presetId = "deepseek";
    initial.connections[id].authScheme = { kind: "bearer" };
    memory.store.set("aiConnectionState", initial);
    expect(await send({ type: "AI_CONNECTION_BEGIN_VALIDATION" })).toEqual({ ok: false, code: "AI_CONNECTION_NOT_CONFIGURED" });
    expect(state().connections[id].validation.status).toBe("never_tested");
  });
});
