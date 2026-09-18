/**
 * lib/images/downscale.ts
 * Browser-only canvas downscaler for field copilot photo uploads.
 *
 * Client-side downscale normalizes HEIC / high-res camera shots before upload,
 * keeping payloads well under the 5 MB gateway cap (longest edge ≤ 1568 px, JPEG q0.8).
 *
 * The pure geometry helper (fitWithin) is exported separately so it can be
 * unit-tested without a DOM.
 */

// ---------------------------------------------------------------------------
// Pure geometry — unit-testable (no DOM dependency)
// ---------------------------------------------------------------------------

/**
 * Fit a rectangle within a maximum edge length while preserving aspect ratio.
 * Returns the same dimensions if both edges are already ≤ maxEdge.
 */
export function fitWithin(
  w: number,
  h: number,
  maxEdge: number,
): { width: number; height: number } {
  if (w <= maxEdge && h <= maxEdge) return { width: w, height: h };
  const scale = maxEdge / Math.max(w, h);
  return { width: Math.round(w * scale), height: Math.round(h * scale) };
}

// ---------------------------------------------------------------------------
// Canvas wrapper — browser-only
// ---------------------------------------------------------------------------

export interface DownscaleOptions {
  /** Longest edge cap in pixels (default 1568). */
  readonly maxEdge?: number;
  /** JPEG quality 0–1 (default 0.8). */
  readonly quality?: number;
}

/**
 * Downscale an image File to a JPEG Blob at ≤ maxEdge longest edge.
 * When the file is already within bounds, a fresh JPEG Blob is returned
 * (normalizes HEIC + any exotic format the camera app emits).
 *
 * @throws When the browser cannot decode the image or the canvas is unavailable.
 */
export async function downscaleImage(
  file: File,
  { maxEdge = 1568, quality = 0.8 }: DownscaleOptions = {},
): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const { width, height } = fitWithin(bitmap.width, bitmap.height, maxEdge);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new Error("downscaleImage: could not get canvas 2d context");
  }

  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("downscaleImage: canvas.toBlob returned null"));
      },
      "image/jpeg",
      quality,
    );
  });
}
