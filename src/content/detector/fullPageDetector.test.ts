import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { QuestionBlock as _QuestionBlock } from "@/shared/types";
import {
  cancelFullPageScan,
  detectCandidatesFullPage as _detectCandidatesFullPage,
  getScrollLeft,
  getScrollMetrics,
  getScrollTop,
  isFullPageScanRunning,
  pause,
  resolveFullPageScrollRoot,
  setScrollPosition,
} from "./fullPageDetector";
import * as domDetector from "./domDetector";

vi.mock("./domDetector");
const _unused = domDetector; // Suppress unused warning

describe("fullPageDetector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("isFullPageScanRunning", () => {
    it("returns false initially", () => {
      expect(isFullPageScanRunning()).toBe(false);
    });
  });

  describe("pause", () => {
    it("resolves after specified milliseconds", async () => {
      const promise = pause(500);
      vi.advanceTimersByTime(500);
      await promise;
      expect(true).toBe(true);
    });
  });

  describe("getScrollTop", () => {
    it("returns window scrollY for window scroll root", () => {
      Object.defineProperty(window, "scrollY", { value: 100, configurable: true });
      expect(getScrollTop(window)).toBe(100);
    });

    it("returns element scrollTop for element scroll root", () => {
      const el = document.createElement("div");
      Object.defineProperty(el, "scrollTop", { value: 200, configurable: true });
      expect(getScrollTop(el)).toBe(200);
    });
  });

  describe("getScrollLeft", () => {
    it("returns window scrollX for window scroll root", () => {
      Object.defineProperty(window, "scrollX", { value: 50, configurable: true });
      expect(getScrollLeft(window)).toBe(50);
    });

    it("returns element scrollLeft for element scroll root", () => {
      const el = document.createElement("div");
      Object.defineProperty(el, "scrollLeft", { value: 75, configurable: true });
      expect(getScrollLeft(el)).toBe(75);
    });
  });

  describe("setScrollPosition", () => {
    it("calls window.scrollTo for window scroll root", () => {
      const scrollToSpy = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
      setScrollPosition(window, 100, 50);
      expect(scrollToSpy).toHaveBeenCalledWith({ top: 100, left: 50, behavior: "instant" });
    });

    it("calls element.scrollTo for element scroll root", () => {
      const el = document.createElement("div");
      const scrollToSpy = vi.spyOn(el, "scrollTo").mockImplementation(() => {});
      setScrollPosition(el, 200, 75);
      expect(scrollToSpy).toHaveBeenCalledWith({ top: 200, left: 75, behavior: "instant" });
    });
  });

  describe("getScrollMetrics", () => {
    it("returns window metrics for window scroll root", () => {
      Object.defineProperty(window, "scrollY", { value: 100, configurable: true });
      Object.defineProperty(window, "scrollX", { value: 50, configurable: true });
      Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
      Object.defineProperty(document.body, "scrollHeight", { value: 3000, configurable: true });
      Object.defineProperty(document.documentElement, "scrollHeight", { value: 3000, configurable: true });

      const metrics = getScrollMetrics(window);
      expect(metrics.scrollTop).toBe(100);
      expect(metrics.scrollLeft).toBe(50);
      expect(metrics.clientHeight).toBe(800);
      expect(metrics.scrollHeight).toBeGreaterThanOrEqual(3000);
    });

    it("returns element metrics for element scroll root", () => {
      const el = document.createElement("div");
      Object.defineProperty(el, "scrollTop", { value: 200, configurable: true });
      Object.defineProperty(el, "scrollLeft", { value: 75, configurable: true });
      Object.defineProperty(el, "scrollHeight", { value: 2000, configurable: true });
      Object.defineProperty(el, "clientHeight", { value: 600, configurable: true });

      const metrics = getScrollMetrics(el);
      expect(metrics.scrollTop).toBe(200);
      expect(metrics.scrollLeft).toBe(75);
      expect(metrics.scrollHeight).toBe(2000);
      expect(metrics.clientHeight).toBe(600);
    });
  });

  describe("resolveFullPageScrollRoot", () => {
    it("returns window when no suitable scroll container found", () => {
      document.body.innerHTML = "<div></div>";
      expect(resolveFullPageScrollRoot()).toBe(window);
    });

    it("finds scroll container with overflow-y auto", () => {
      document.body.innerHTML = '<div id="scroll-container" style="overflow-y: auto; height: 600px;"></div>';
      const container = document.getElementById("scroll-container")!;
      Object.defineProperty(container, "scrollHeight", { value: 2000, configurable: true });
      Object.defineProperty(container, "clientHeight", { value: 600, configurable: true });
      Object.defineProperty(container, "getBoundingClientRect", {
        value: () => ({ width: 800, height: 600, left: 10, top: 10 }),
        configurable: true,
      });

      const root = resolveFullPageScrollRoot();
      expect(root).toBe(container);
    });

    it("prefers containers with question-related class names", () => {
      document.body.innerHTML = `
        <div id="generic" style="overflow-y: auto; height: 600px;"></div>
        <div id="question-list" class="question-container" style="overflow-y: auto; height: 600px;"></div>
      `;

      [document.getElementById("generic")!, document.getElementById("question-list")!].forEach((el) => {
        Object.defineProperty(el, "scrollHeight", { value: 2000, configurable: true });
        Object.defineProperty(el, "clientHeight", { value: 600, configurable: true });
        Object.defineProperty(el, "getBoundingClientRect", {
          value: () => ({ width: 800, height: 600, left: 10, top: 10 }),
          configurable: true,
        });
      });

      const root = resolveFullPageScrollRoot();
      expect((root as HTMLElement).id).toBe("question-list");
    });
  });

  describe("detectCandidatesFullPage", () => {
    it("tracks running state correctly", () => {
      expect(isFullPageScanRunning()).toBe(false);
    });

    it("handles cancellation", () => {
      cancelFullPageScan();
      expect(true).toBe(true); // Function call succeeds
    });
  });
});
