import { describe, expect, it, vi } from "vitest";
import { captureBlockImage, type ImageCaptureDeps } from "./imageCapture";

const bbox = { x: 100, y: 200, width: 300, height: 150 };
const captured: { bbox?: unknown } = {};

function deps(): ImageCaptureDeps {
  return {
    sendToBackgroundWithTimeout: async <R,>(message: unknown, timeoutMs: number): Promise<R | null> =>
      ({ dataUrl: "data:image/png;base64,xxx" }) as unknown as R,
    cropScreenshot: async (_url: string, b: unknown) => {
      captured.bbox = b;
      return "data:image/png;base64,cropped";
    },
  };
}

describe("VB-001 bbox re-anchor before screenshot crop", () => {
  it("uses the re-anchored bbox when the live element moved", async () => {
    const moved = { x: 100, y: 900, width: 300, height: 150 };
    captured.bbox = undefined;
    const d = deps();
    const out = await captureBlockImage(bbox, d, () => moved);
    expect(out).toBe("data:image/png;base64,cropped");
    expect(captured.bbox).toEqual(moved);
  });

  it("falls back to the detection-time bbox when re-anchor returns null", async () => {
    captured.bbox = undefined;
    const d = deps();
    await captureBlockImage(bbox, d, () => null);
    expect(captured.bbox).toEqual(bbox);
  });

  it("falls back to the detection-time bbox when no reanchor is provided", async () => {
    captured.bbox = undefined;
    const d = deps();
    await captureBlockImage(bbox, d);
    expect(captured.bbox).toEqual(bbox);
  });
});
