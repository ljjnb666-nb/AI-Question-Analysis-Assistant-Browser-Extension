import type { BoundingBox, ExtMessage } from "@/shared/types";

type ImageCaptureDeps = {
  sendToBackgroundWithTimeout: <R>(message: ExtMessage, timeoutMs: number) => Promise<R | null>;
  cropScreenshot: (dataUrl: string, bbox: BoundingBox, scale: number) => Promise<string>;
};

export async function screenshotWithRetry(
  deps: ImageCaptureDeps,
  maxAttempts = 3,
): Promise<string | null> {
  let lastErr = "";
  for (let i = 0; i < maxAttempts; i++) {
    if (i > 0) await new Promise((resolve) => setTimeout(resolve, 500));
    const res = await deps.sendToBackgroundWithTimeout<{ dataUrl?: string; error?: string }>(
      { type: "CAPTURE_TAB_SCREENSHOT" },
      30_000,
    );
    if (res?.dataUrl) return res.dataUrl;
    if (res?.error) {
      lastErr = res.error;
      console.warn("[Capture] screenshot attempt failed:", res.error);
    } else if (!res) {
      lastErr = "timeout";
      console.warn("[Capture] screenshot attempt timed out");
    }
  }
  if (lastErr) {
    throw new Error(`截图失败：${lastErr}`);
  }
  return null;
}

export async function captureBlockImage(
  bbox: BoundingBox,
  deps: ImageCaptureDeps,
): Promise<string | null> {
  const dataUrl = await screenshotWithRetry(deps);
  if (!dataUrl) return null;
  return await deps.cropScreenshot(dataUrl, bbox, window.devicePixelRatio);
}

export async function tryCaptureBlockImageForAutoSolve(
  bbox: BoundingBox,
  deps: ImageCaptureDeps,
): Promise<string | null> {
  try {
    return await captureBlockImage(bbox, deps);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/activeTab/i.test(message) || /has not been in invoked/i.test(message)) {
      console.warn("[AutoSolve] capture skipped due to missing activeTab grant:", message);
      return null;
    }
    throw err;
  }
}
