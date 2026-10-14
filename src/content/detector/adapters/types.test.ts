import { describe, expect, it } from "vitest";
import {
  listSiteAdapters,
  registerSiteAdapter,
  runSiteAdapters,
  type SiteAdapter,
  type SiteAdapterContext,
} from "./types";

const ctx: SiteAdapterContext = { hostRightCutX: null, vw: 1600, vh: 900 };
const takeover = { hasStructuredContainers: false, hasAcceptedDirectCard: false };

function fakeAdapter(partial: Partial<SiteAdapter> & { id: string }): SiteAdapter {
  return { matches: () => true, buildCandidates: () => [], ...partial };
}

// NOTE: the adapter registry is a module singleton; tests below run in file
// order and isolate by unique ids + phases.
describe("site adapter dispatch (strangler)", () => {
  it("returns null when no adapter matches", () => {
    registerSiteAdapter(fakeAdapter({ id: "d-nomatch", matches: () => false }));
    expect(runSiteAdapters(ctx, takeover)).toBeNull();
  });

  it("first matching adapter with blocks wins", () => {
    registerSiteAdapter(fakeAdapter({
      id: "d-first", phase: "pre-structured",
      buildCandidates: () => [{ id: "d-a" } as never],
    }));
    registerSiteAdapter(fakeAdapter({
      id: "d-second", phase: "pre-structured",
      buildCandidates: () => [{ id: "d-b" } as never],
    }));
    expect(runSiteAdapters(ctx, takeover, "pre-structured")?.[0]).toMatchObject({ id: "d-a" });
  });

  it("skips adapters whose takesOver declines", () => {
    registerSiteAdapter(fakeAdapter({
      id: "d-decline", phase: "post-structured",
      buildCandidates: () => [{ id: "d-declined" } as never],
      takesOver: () => false,
    }));
    registerSiteAdapter(fakeAdapter({
      id: "d-accept", phase: "post-structured",
      buildCandidates: () => [{ id: "d-accepted" } as never],
    }));
    expect(runSiteAdapters(ctx, takeover, "post-structured")?.[0]).toMatchObject({ id: "d-accepted" });
  });

  it("empty block lists do not take over", () => {
    registerSiteAdapter(fakeAdapter({
      id: "d-empty", phase: "post-structured",
      buildCandidates: () => [],
    }));
    expect(runSiteAdapters(ctx, takeover, "post-structured")?.[0]).toMatchObject({ id: "d-accepted" });
  });

  it("pintia adapters register with correct ids, phases and takeover rules", async () => {
    const { listSiteAdapters: list } = await import("./index");
    const byId = new Map(list().map((a) => [a.id, a]));
    expect(byId.get("pintia-question-list")).toBeDefined();
    expect(byId.get("pintia-code-problem")).toBeDefined();
    expect(byId.get("pintia-question-list")?.phase ?? "pre-structured").toBe("pre-structured");
    expect(byId.get("pintia-code-problem")?.phase).toBe("post-structured");
    const codeTakesOver = byId.get("pintia-code-problem")?.takesOver;
    expect(codeTakesOver?.({ hasStructuredContainers: true, hasAcceptedDirectCard: false })).toBe(false);
    expect(codeTakesOver?.({ hasStructuredContainers: false, hasAcceptedDirectCard: false })).toBe(true);
    // Question-list adapter takes over unconditionally (default).
    expect(byId.get("pintia-question-list")?.takesOver).toBeUndefined();
    expect(listSiteAdapters().length).toBeGreaterThan(0);
  });
});
