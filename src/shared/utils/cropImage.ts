import type { BoundingBox } from "../types";
import { scaleBBoxToScreenshot } from "./bbox";

/**
 * Crop a screenshot dataURL to the specified viewport-relative bbox.
 * Returns a new dataURL (PNG) of just the selected region.
 */
export async function cropScreenshot(
  screenshotDataUrl: string,
  viewportBBox: BoundingBox,
  devicePixelRatio: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scaled = scaleBBoxToScreenshot(viewportBBox, devicePixelRatio);

      // Guard against out-of-bound regions
      const sx = Math.max(0, scaled.x);
      const sy = Math.max(0, scaled.y);
      const sw = Math.min(scaled.width, img.naturalWidth - sx);
      const sh = Math.min(scaled.height, img.naturalHeight - sy);

      if (sw <= 0 || sh <= 0) {
        reject(new Error("Cropped region is empty"));
        return;
      }

      const canvas = document.createElement("canvas");
      canvas.width = sw;
      canvas.height = sh;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Cannot get canvas 2d context"));
        return;
      }

      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => reject(new Error("Failed to load screenshot image"));
    img.src = screenshotDataUrl;
  });
}
