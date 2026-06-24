import type { BoundingBox, ExtMessage } from "@/shared/types";
import {
  captureBlockImage as captureBlockImageCore,
  screenshotWithRetry as screenshotWithRetryCore,
  tryCaptureBlockImageForAutoSolve as tryCaptureBlockImageForAutoSolveCore,
} from "./imageCapture";
import { sendToBackgroundWithTimeout as sendToBackgroundWithTimeoutCore } from "./contentRuntime";

type CaptureImageDeps = {
  cropScreenshot: (dataUrl: string, bbox: BoundingBox, devicePixelRatio: number) => Promise<string>;
  sendToBackgroundWithTimeout: <R>(message: ExtMessage, timeoutMs: number) => Promise<R | null>;
};

export function createCaptureBridge(captureImageDeps: CaptureImageDeps) {
  return {
    captureBlockImage: (bbox: BoundingBox) => captureBlockImageCore(bbox, captureImageDeps),
    screenshotWithRetry: (maxAttempts = 3) => screenshotWithRetryCore(captureImageDeps, maxAttempts),
    tryCaptureBlockImageForAutoSolve: (bbox: BoundingBox) => tryCaptureBlockImageForAutoSolveCore(bbox, captureImageDeps),
  };
}

export async function sendToBackgroundWithTimeout<R>(message: ExtMessage, timeoutMs: number): Promise<R | null> {
  return sendToBackgroundWithTimeoutCore<R>(message, timeoutMs);
}
