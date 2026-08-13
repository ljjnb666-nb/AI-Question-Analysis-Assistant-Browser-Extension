import { describe, expect, it } from "vitest";
import { classifyViewportBoundary } from "./questionBoundary";
const viewport = { innerHeight: 100 } as Window;
describe("classifyViewportBoundary", () => {
  it("classifies visible and clipped states with a two pixel epsilon", () => {
    expect(classifyViewportBoundary({ y: 0, height: 100 }, viewport).state).toBe("fully-visible");
    expect(classifyViewportBoundary({ y: -3, height: 20 }, viewport).state).toBe("clipped-top");
    expect(classifyViewportBoundary({ y: 90, height: 13 }, viewport).state).toBe("clipped-bottom");
    expect(classifyViewportBoundary({ y: -3, height: 110 }, viewport).state).toBe("clipped-both");
    expect(classifyViewportBoundary({ y: -1, height: 101 }, viewport).state).toBe("fully-visible");
  });
});
