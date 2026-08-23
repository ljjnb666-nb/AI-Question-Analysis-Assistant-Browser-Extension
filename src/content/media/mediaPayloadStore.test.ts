import { describe, expect, it } from "vitest";
import { MediaPayloadStore } from "./mediaPayloadStore";

describe("MediaPayloadStore", () => {
  it("keeps payloads runtime-only within an LRU budget", () => {
    const store = new MediaPayloadStore(2, 100, 60);
    expect(store.put("a", { dataUrl: "data:image/png;base64,aaaa" })).toBe(true);
    expect(store.put("b", { dataUrl: "data:image/png;base64,bbbb" })).toBe(true);
    store.get("a");
    expect(store.put("c", { dataUrl: "data:image/png;base64,cccc" })).toBe(true);
    expect(store.has("a")).toBe(true);
    expect(store.has("b")).toBe(false);
    expect(store.put("oversize", { dataUrl: "x".repeat(70) })).toBe(false);
    store.clear();
    expect(store.size).toBe(0);
  });
});
