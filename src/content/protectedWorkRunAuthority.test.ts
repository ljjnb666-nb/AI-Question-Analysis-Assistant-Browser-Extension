import { describe, expect, it } from "vitest";
import { createProtectedWorkRunAuthority } from "./protectedWorkRunAuthority";

describe("Phase14B-02C-C runtime STOP/CANCEL generation authority", () => {
  const oldId = "18aabcde-0ee2-4e98-8e12-48fdce879012";
  const newId = "18aabcde-0ee2-4e98-8e12-48fdce879013";

  it("P14B02C_STOP_01 old Auto Solve STOP never kills a newer generation", () => {
    const a = createProtectedWorkRunAuthority();
    expect(a.begin("autoSolve", oldId)).toBe(true);
    expect(a.canStop("autoSolve", oldId)).toBe(true);
    a.finish("autoSolve", oldId);
    expect(a.begin("autoSolve", newId)).toBe(true);
    expect(a.canStop("autoSolve", oldId)).toBe(false);
    expect(a.canStop("autoSolve")).toBe(false);
    expect(a.canStop("autoSolve", newId)).toBe(true);
    a.finish("autoSolve", oldId);
    expect(a.canStop("autoSolve", newId)).toBe(true);
  });

  it("P14B02C_STOP_02 Full Page stale CANCEL or duplicate START cannot interfere", () => {
    const a = createProtectedWorkRunAuthority();
    expect(a.begin("fullPage", oldId)).toBe(true);
    expect(a.begin("fullPage", newId)).toBe(false);
    expect(a.canStop("fullPage", newId)).toBe(false);
    a.finish("fullPage", oldId);
    expect(a.begin("fullPage", newId)).toBe(true);
    expect(a.canStop("fullPage", oldId)).toBe(false);
    expect(a.canStop("fullPage", newId)).toBe(true);
  });

  it("P14B02C_STOP_03 legacy and token-aware STOP modes never cross over", () => {
    const a = createProtectedWorkRunAuthority();
    expect(a.begin("autoSolve")).toBe(true);
    expect(a.canStop("autoSolve")).toBe(true);
    expect(a.canStop("autoSolve", oldId)).toBe(false);
    a.finish("autoSolve");
    expect(a.begin("autoSolve", oldId)).toBe(true);
    expect(a.canStop("autoSolve")).toBe(false);
    a.reset();
    expect(a.canStop("autoSolve", oldId)).toBe(false);
  });

  it("P14B02C_STOP_04 different protected kinds have separate run identities", () => {
    const a = createProtectedWorkRunAuthority();
    expect(a.begin("autoSolve", oldId)).toBe(true);
    expect(a.begin("fullPage", newId)).toBe(true);
    a.finish("autoSolve", oldId);
    expect(a.canStop("fullPage", newId)).toBe(true);
    expect(a.canStop("autoSolve", oldId)).toBe(false);
  });
});
