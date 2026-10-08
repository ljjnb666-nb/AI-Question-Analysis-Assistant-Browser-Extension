import { describe, expect, it } from "vitest";
import { createProtectedWorkRunAuthority } from "./protectedWorkRunAuthority";

describe("Phase14B-02C-C runtime STOP/CANCEL generation authority", () => {
  const oldId = "18aabcde-0ee2-4e98-8e12-48fdce879012";
  const newId = "18aabcde-0ee2-4e98-8e12-48fdce879013";

  it("P14B02C_STOP_01 old Auto Solve STOP never kills a newer generation", () => {
    const a = createProtectedWorkRunAuthority();
    const old = a.begin("autoSolve", oldId)!;
    expect(old).toBeGreaterThan(0);
    expect(a.canStop("autoSolve", oldId)).toBe(true);
    a.finish("autoSolve", old);
    const next = a.begin("autoSolve", newId)!;
    expect(next).toBeGreaterThan(old);
    expect(a.canStop("autoSolve", oldId)).toBe(false);
    expect(a.canStop("autoSolve")).toBe(false);
    expect(a.canStop("autoSolve", newId)).toBe(true);
    a.finish("autoSolve", old);
    expect(a.canStop("autoSolve", newId)).toBe(true);
  });

  it("P14B02C_STOP_02 Full Page stale CANCEL or duplicate START cannot interfere", () => {
    const a = createProtectedWorkRunAuthority();
    const old = a.begin("fullPage", oldId)!;
    expect(a.begin("fullPage", newId)).toBeNull();
    expect(a.canStop("fullPage", newId)).toBe(false);
    a.finish("fullPage", old);
    const next = a.begin("fullPage", newId)!;
    expect(next).toBeGreaterThan(old);
    expect(a.canStop("fullPage", oldId)).toBe(false);
    expect(a.canStop("fullPage", newId)).toBe(true);
  });

  it("P14B02C_STOP_03 legacy and tagged STOP modes never cross over", () => {
    const a = createProtectedWorkRunAuthority();
    const old = a.begin("autoSolve")!;
    expect(a.canStop("autoSolve")).toBe(true);
    expect(a.canStop("autoSolve", oldId)).toBe(false);
    a.finish("autoSolve", old);
    a.begin("autoSolve", oldId);
    expect(a.canStop("autoSolve")).toBe(false);
    a.reset();
    expect(a.canStop("autoSolve", oldId)).toBe(false);
  });

  it("P14B02C_STOP_04 different protected kinds have separate run identities", () => {
    const a = createProtectedWorkRunAuthority();
    const first = a.begin("autoSolve", oldId)!;
    a.begin("fullPage", newId);
    a.finish("autoSolve", first);
    expect(a.canStop("fullPage", newId)).toBe(true);
    expect(a.canStop("autoSolve", oldId)).toBe(false);
  });

  it("P14B02C_STOP_09 old legacy finally after route reset cannot clear new legacy run", () => {
    const a = createProtectedWorkRunAuthority();
    const old = a.begin("autoSolve")!;
    a.reset();
    const current = a.begin("autoSolve")!;
    expect(current).not.toBe(old);
    a.finish("autoSolve", old);
    expect(a.canStop("autoSolve")).toBe(true);
    a.finish("autoSolve", current);
    expect(a.canStop("autoSolve")).toBe(false);
  });
});
