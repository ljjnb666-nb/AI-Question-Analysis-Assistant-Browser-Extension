import { describe, expect, it, vi } from "vitest";
import { createProtectedWorkRunAuthority } from "./protectedWorkRunAuthority";
import { stopAutoSolveAndReleaseRunning } from "./stopAutoSolveAndReleaseRunning";

const oldId = "18aabcde-0ee2-4e98-8e12-48fdce879112";
const nextId = "18aabcde-0ee2-4e98-8e12-48fdce879113";

describe("STOP then START running state handoff", () => {
  it("E3B2B2B1_RESTART releases the old running gate before the new generation", () => {
    const authority = createProtectedWorkRunAuthority();
    const oldLease = authority.begin("autoSolve", oldId);
    expect(oldLease).not.toBeNull();
    let running = true;
    let stopped = false;
    const abort = vi.fn();
    const effects = {
      requestStop: () => { stopped = true; },
      releaseRunning: () => { running = false; },
      abortCurrentAttempt: abort,
    };

    expect(stopAutoSolveAndReleaseRunning(authority, oldId, effects)).toBe(true);
    expect(authority.isCurrent("autoSolve", oldLease!)).toBe(false);
    expect(running).toBe(false);
    expect(stopped).toBe(true);
    expect(abort).toHaveBeenCalledOnce();

    const nextLease = authority.begin("autoSolve", nextId);
    expect(nextLease).not.toBeNull();
    expect(running).toBe(false);
    running = true;
    stopped = false;

    expect(stopAutoSolveAndReleaseRunning(authority, oldId, effects)).toBe(false);
    expect(stopAutoSolveAndReleaseRunning(authority, oldId, effects)).toBe(false);
    authority.finish("autoSolve", oldLease!);
    expect(authority.isCurrent("autoSolve", nextLease!)).toBe(true);
    expect(running).toBe(true);
    expect(stopped).toBe(false);
    expect(abort).toHaveBeenCalledOnce();
  });

  it("E3B2B2B1_STALE_STOP never clears or aborts a replacement run", () => {
    const authority = createProtectedWorkRunAuthority();
    const first = authority.begin("autoSolve", oldId)!;
    expect(authority.revoke("autoSolve", oldId)).toBe(true);
    const replacement = authority.begin("autoSolve", nextId)!;
    const requestStop = vi.fn();
    const releaseRunning = vi.fn();
    const abortCurrentAttempt = vi.fn();

    expect(stopAutoSolveAndReleaseRunning(authority, oldId, {
      requestStop, releaseRunning, abortCurrentAttempt,
    })).toBe(false);
    authority.finish("autoSolve", first);
    expect(authority.isCurrent("autoSolve", replacement)).toBe(true);
    expect(requestStop).not.toHaveBeenCalled();
    expect(releaseRunning).not.toHaveBeenCalled();
    expect(abortCurrentAttempt).not.toHaveBeenCalled();
  });
});
