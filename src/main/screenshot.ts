import { desktopCapturer, nativeImage, screen } from "electron";

export interface ScreenshotResult {
  /** Base64-encoded JPEG (downsampled for pass-1 Claude input) */
  data: string;
  /** Display index */
  displayIndex: number;
  /** Display bounds (actual screen pixels, including position offset) */
  bounds: { x: number; y: number; width: number; height: number };
  /** Pixel dimensions of the downsampled JPEG actually sent to the model */
  imageDimensions: { width: number; height: number };
  /**
   * Full-resolution source kept in-memory for second-pass refinement crops.
   * Not serialized over IPC — only used locally in the main process.
   */
  _source?: Electron.NativeImage;
}

// 1568 is Anthropic's recommended max edge for vision input — going higher on
// the pass-1 image triggers automatic API-side downscaling that confuses
// coordinate output. We still capture at native res so refinement crops have
// real pixel density.
const MAX_DIMENSION = 1568;
const JPEG_QUALITY = 85;

// Agent mode (computer_toolset_20260801) is not subject to the pass-1 pointing
// limit above — models supporting the toolset accept a 2576 px long edge and
// ~3.75 MP. Downsampling to 1568 here makes small UI (taskbar icons, tray)
// unidentifiable and sends the agent into repeated zoom loops.
export const AGENT_MAX_DIMENSION = 2576;
export const AGENT_MAX_PIXELS = 3_750_000;

export interface CaptureOptions {
  maxDimension?: number;
  maxPixels?: number;
}

export class ScreenCapture {
  /**
   * Capture all screens. Returns a downsampled JPEG for pass-1 AI input and
   * retains the native-resolution NativeImage on each result for refinement.
   */
  async captureAllScreens(options: CaptureOptions = {}): Promise<ScreenshotResult[]> {
    const maxDimension = options.maxDimension ?? MAX_DIMENSION;
    const maxPixels = options.maxPixels;
    const displays = screen.getAllDisplays();

    // Ask for the largest native-pixel edge across all displays. Electron will
    // clamp to what the OS provides, so oversized requests are safe.
    let maxNativeEdge = maxDimension;
    for (const d of displays) {
      const sf = d.scaleFactor || 1;
      maxNativeEdge = Math.max(
        maxNativeEdge,
        Math.ceil(d.bounds.width * sf),
        Math.ceil(d.bounds.height * sf)
      );
    }

    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width: maxNativeEdge, height: maxNativeEdge },
    });

    const results: ScreenshotResult[] = [];

    // Correlate desktopCapturer sources with Electron displays by id. The
    // order of `sources` is NOT guaranteed to match `displays` — on Windows
    // it usually does, but Electron docs explicitly warn against relying on
    // it. `source.display_id` is the stringified `display.id` on Win/Mac and
    // empty on Linux, so we fall back to positional matching there.
    // Whether any source exposes display_id. On Linux it's empty across the
    // board, so the warning below only fires on Win/Mac where we actually
    // expect id-based matching to succeed.
    const anyHasDisplayId = sources.some((s) => s.display_id);

    for (let i = 0; i < displays.length; i++) {
      const display = displays[i];
      const matchedById = sources.find(
        (s) => s.display_id && s.display_id === String(display.id)
      );
      if (!matchedById && anyHasDisplayId) {
        console.warn(
          `[screenshot] no desktopCapturer source matched display.id=${display.id} (index ${i}); falling back to positional match. Screenshot may be routed to the wrong monitor.`
        );
      }
      const source = matchedById || sources[i] || sources[0];
      if (!source) continue;
      const full = source.thumbnail;

      if (full.isEmpty()) continue;

      // Build a downsampled copy for AI input. Honour both the long-edge cap
      // and, when given, a total-pixel cap — a wide display can satisfy one
      // and blow the other.
      const fullSize = full.getSize();
      const maxEdge = Math.max(fullSize.width, fullSize.height);
      const scale = Math.min(
        1,
        maxDimension / maxEdge,
        maxPixels ? Math.sqrt(maxPixels / (fullSize.width * fullSize.height)) : 1
      );
      const downsampled =
        scale < 1
          ? full.resize({
              width: Math.round(fullSize.width * scale),
              height: Math.round(fullSize.height * scale),
            })
          : full;
      const downSize = downsampled.getSize();
      const jpeg = downsampled.toJPEG(JPEG_QUALITY);

      results.push({
        data: jpeg.toString("base64"),
        displayIndex: i,
        bounds: display.bounds,
        imageDimensions: { width: downSize.width, height: downSize.height },
        _source: full,
      });
    }

    // Ordering: stays aligned with `screen.getAllDisplays()` so that
    // `results[i]` corresponds to the same display as `overlayWindows[i]`
    // created from the same displays list in index.ts. Downstream code can
    // index into either array by the POINT tag's `screen` field.
    return results;
  }

  /**
   * Capture the primary screen only.
   */
  async capturePrimaryScreen(): Promise<ScreenshotResult | null> {
    const results = await this.captureAllScreens();
    return results[0] || null;
  }

  /**
   * Get cursor position relative to displays.
   */
  getCursorPosition(): { x: number; y: number } {
    return screen.getCursorScreenPoint();
  }
}

/**
 * Crop a square region around (cx, cy) for second-pass pointing refinement.
 *
 * (cx, cy) and `size` are expressed in the **downsampled imageDimensions
 * space** (same coordinate space Claude used in the first pass). Internally we
 * crop from the full-res NativeImage (if available) so Claude sees the patch
 * at native display DPI — which is what makes the refinement actually useful.
 *
 * Returns:
 *  - `data`              : base64 JPEG of the crop
 *  - `origin`            : top-left of the crop in imageDimensions space
 *  - `claudeSize`        : pixel size of the JPEG (what Claude will see)
 *  - `pxPerImageDim`     : scale factor from imageDimensions → JPEG pixels
 *                          (refined coords ÷ this = offset in imageDims space)
 */
export function cropScreenshotRegion(
  shot: ScreenshotResult,
  cx: number,
  cy: number,
  size: number
): {
  data: string;
  origin: { x: number; y: number };
  claudeSize: { w: number; h: number };
  pxPerImageDim: number;
} {
  const imgW = shot.imageDimensions.width;
  const imgH = shot.imageDimensions.height;

  if (!shot._source) {
    // Fallback: no native source — crop directly from the downsampled base64.
    const half = Math.floor(size / 2);
    const x = Math.max(0, Math.min(imgW - size, cx - half));
    const y = Math.max(0, Math.min(imgH - size, cy - half));
    const w = Math.min(size, imgW - x);
    const h = Math.min(size, imgH - y);
    const img = nativeImage.createFromBuffer(Buffer.from(shot.data, "base64"));
    const cropped = img.crop({ x, y, width: w, height: h });
    const jpeg = cropped.toJPEG(90);
    return {
      data: jpeg.toString("base64"),
      origin: { x, y },
      claudeSize: { w, h },
      pxPerImageDim: 1,
    };
  }

  const source = shot._source;
  const nativeSize = source.getSize();
  const ratio = nativeSize.width / imgW; // native px per imageDim px

  const nativeCx = cx * ratio;
  const nativeCy = cy * ratio;
  const nativeCropSize = size * ratio;
  const half = nativeCropSize / 2;

  const nx = Math.round(
    Math.max(0, Math.min(nativeSize.width - nativeCropSize, nativeCx - half))
  );
  const ny = Math.round(
    Math.max(0, Math.min(nativeSize.height - nativeCropSize, nativeCy - half))
  );
  const nw = Math.round(Math.min(nativeCropSize, nativeSize.width - nx));
  const nh = Math.round(Math.min(nativeCropSize, nativeSize.height - ny));

  const cropped = source.crop({ x: nx, y: ny, width: nw, height: nh });
  const sz = cropped.getSize();
  const jpeg = cropped.toJPEG(95);

  return {
    data: jpeg.toString("base64"),
    origin: { x: nx / ratio, y: ny / ratio },
    claudeSize: { w: sz.width, h: sz.height },
    pxPerImageDim: ratio,
  };
}
