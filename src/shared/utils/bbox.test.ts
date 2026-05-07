import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { clampToViewport } from "./bbox";

describe("bbox", () => {
  describe("clampToViewport", () => {
    // Mock window dimensions
    const originalInnerWidth = window.innerWidth;
    const originalInnerHeight = window.innerHeight;

    beforeEach(() => {
      Object.defineProperty(window, "innerWidth", { value: 1280, writable: true });
      Object.defineProperty(window, "innerHeight", { value: 800, writable: true });
    });

    afterEach(() => {
      Object.defineProperty(window, "innerWidth", { value: originalInnerWidth, writable: true });
      Object.defineProperty(window, "innerHeight", { value: originalInnerHeight, writable: true });
    });

    it("should not modify position when within viewport", () => {
      const result = clampToViewport(100, 100, 200, 150);
      expect(result).toEqual({ x: 100, y: 100 });
    });

    it("should clamp negative x to 0", () => {
      const result = clampToViewport(-50, 100, 200, 150);
      expect(result.x).toBe(0);
      expect(result.y).toBe(100);
    });

    it("should clamp negative y to 0", () => {
      const result = clampToViewport(100, -50, 200, 150);
      expect(result.x).toBe(100);
      expect(result.y).toBe(0);
    });

    it("should clamp x when window would overflow right edge", () => {
      const result = clampToViewport(1200, 100, 200, 150);
      expect(result.x).toBe(1080); // 1280 - 200
      expect(result.y).toBe(100);
    });

    it("should clamp y when window would overflow bottom edge", () => {
      const result = clampToViewport(100, 700, 200, 150);
      expect(result.x).toBe(100);
      expect(result.y).toBe(650); // 800 - 150
    });

    it("should clamp both x and y when necessary", () => {
      const result = clampToViewport(-10, -20, 200, 150);
      expect(result.x).toBe(0);
      expect(result.y).toBe(0);
    });

    it("should handle window larger than viewport", () => {
      const result = clampToViewport(100, 100, 1500, 1000);
      expect(result.x).toBe(0);
      expect(result.y).toBe(0);
    });
  });
});
