import { screen, nativeImage } from "electron";
import {
  ScreenCapture,
  ScreenshotResult,
  AGENT_MAX_DIMENSION,
  AGENT_MAX_PIXELS,
} from "../screenshot";
import { WindowsInput, MouseButton } from "./input";
import { parseKeyCombo } from "./keymap";

export type ToolOutcome =
  | { kind: "text"; text: string }
  | { kind: "image"; data: string; mediaType: "image/jpeg" }
  | { kind: "error"; message: string };

const MAX_WAIT_SECONDS = 10;
const ABORT_POLL_MS = 100;

class Aborted extends Error {
  constructor() {
    super("aborted");
  }
}

/**
 * Executes Claude's `computer` toolset members against the real desktop.
 *
 * Claude works in screenshot-pixel space. Electron reports display bounds in
 * DIPs. Win32 SetCursorPos takes physical pixels. Every coordinate therefore
 * makes two hops: screenshot px -> DIP -> physical px.
 */
export class ComputerExecutor {
  private lastShot: ScreenshotResult | null = null;

  constructor(
    private input: WindowsInput,
    private capture: ScreenCapture,
    private displayIndex: number,
    private signal: AbortSignal
  ) {}

  private checkAbort(): void {
    if (this.signal.aborted) throw new Aborted();
  }

  private async sleep(ms: number): Promise<void> {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      this.checkAbort();
      await new Promise((r) => setTimeout(r, Math.min(ABORT_POLL_MS, deadline - Date.now())));
    }
    this.checkAbort();
  }

  async screenshot(): Promise<ToolOutcome> {
    this.checkAbort();
    const shots = await this.capture.captureAllScreens({
      maxDimension: AGENT_MAX_DIMENSION,
      maxPixels: AGENT_MAX_PIXELS,
    });
    const shot = shots[this.displayIndex] ?? shots[0];
    if (!shot) return { kind: "error", message: "No display available to capture." };
    this.lastShot = shot;
    return { kind: "image", data: shot.data, mediaType: "image/jpeg" };
  }

  /** screenshot px -> physical screen px */
  private toPhysical(coordinate: unknown): { x: number; y: number } | null {
    if (!Array.isArray(coordinate) || coordinate.length < 2) return null;
    const [cx, cy] = coordinate;
    if (typeof cx !== "number" || typeof cy !== "number") return null;

    const shot = this.lastShot;
    if (!shot) return null;

    const dip = {
      x: shot.bounds.x + cx * (shot.bounds.width / shot.imageDimensions.width),
      y: shot.bounds.y + cy * (shot.bounds.height / shot.imageDimensions.height),
    };
    return screen.dipToScreenPoint(dip);
  }

  /** physical screen px -> screenshot px */
  private toImageSpace(physical: { x: number; y: number }): { x: number; y: number } | null {
    const shot = this.lastShot;
    if (!shot) return null;
    const dip = screen.screenToDipPoint(physical);
    return {
      x: Math.round((dip.x - shot.bounds.x) * (shot.imageDimensions.width / shot.bounds.width)),
      y: Math.round((dip.y - shot.bounds.y) * (shot.imageDimensions.height / shot.bounds.height)),
    };
  }

  private async withModifiers(text: unknown, body: () => Promise<void>): Promise<string | null> {
    if (typeof text !== "string" || !text.trim()) {
      await body();
      return null;
    }

    const stroke = parseKeyCombo(text);
    if (!stroke) return `Unrecognized modifier keys: "${text}"`;

    const held = [...stroke.modifiers];
    if (stroke.key) held.push(stroke.key);

    for (const m of held) await this.input.keyDown(m.vk, m.extended);
    try {
      await body();
    } finally {
      for (const m of [...held].reverse()) await this.input.keyUp(m.vk, m.extended);
    }
    return null;
  }

  private async moveTo(coordinate: unknown): Promise<string | null> {
    if (coordinate === undefined) return null; // click at current position
    const point = this.toPhysical(coordinate);
    if (!point) {
      return this.lastShot
        ? `Invalid coordinate: ${JSON.stringify(coordinate)}`
        : "No screenshot has been taken yet — call screenshot first.";
    }
    await this.input.moveMouse(point.x, point.y);
    return null;
  }

  private async clickAction(
    button: MouseButton,
    count: number,
    input: Record<string, unknown>
  ): Promise<ToolOutcome> {
    const moveError = await this.moveTo(input.coordinate);
    if (moveError) return { kind: "error", message: moveError };

    const modError = await this.withModifiers(input.text, () => this.input.click(button, count));
    if (modError) return { kind: "error", message: modError };

    return { kind: "text", text: "OK" };
  }

  private zoom(input: Record<string, unknown>): ToolOutcome {
    const shot = this.lastShot;
    if (!shot) return { kind: "error", message: "No screenshot has been taken yet — call screenshot first." };

    const region = input.region;
    if (!Array.isArray(region) || region.length < 4 || region.some((v) => typeof v !== "number")) {
      return { kind: "error", message: `Invalid region: ${JSON.stringify(region)}` };
    }

    const source = shot._source ?? nativeImage.createFromBuffer(Buffer.from(shot.data, "base64"));
    const native = source.getSize();
    const ratio = native.width / shot.imageDimensions.width;

    const [x0, y0, x1, y1] = region as number[];
    const left = Math.max(0, Math.round(Math.min(x0, x1) * ratio));
    const top = Math.max(0, Math.round(Math.min(y0, y1) * ratio));
    const width = Math.min(native.width - left, Math.round(Math.abs(x1 - x0) * ratio));
    const height = Math.min(native.height - top, Math.round(Math.abs(y1 - y0) * ratio));

    if (width <= 0 || height <= 0) {
      return { kind: "error", message: `Region has no area: ${JSON.stringify(region)}` };
    }

    const cropped = source.crop({ x: left, y: top, width, height });
    return { kind: "image", data: cropped.toJPEG(95).toString("base64"), mediaType: "image/jpeg" };
  }

  async execute(name: string, rawInput: unknown): Promise<ToolOutcome> {
    this.checkAbort();
    const input = (rawInput ?? {}) as Record<string, unknown>;

    try {
      switch (name) {
        case "screenshot":
          return await this.screenshot();

        case "zoom":
          return this.zoom(input);

        case "left_click":
          return await this.clickAction("left", 1, input);
        case "right_click":
          return await this.clickAction("right", 1, input);
        case "middle_click":
          return await this.clickAction("middle", 1, input);
        case "double_click":
          return await this.clickAction("left", 2, input);
        case "triple_click":
          return await this.clickAction("left", 3, input);

        case "mouse_move": {
          const err = await this.moveTo(input.coordinate);
          return err ? { kind: "error", message: err } : { kind: "text", text: "OK" };
        }

        case "left_mouse_down":
          await this.input.mouseDown("left");
          return { kind: "text", text: "OK" };

        case "left_mouse_up":
          await this.input.mouseUp("left");
          return { kind: "text", text: "OK" };

        case "left_click_drag": {
          const startErr = await this.moveTo(input.start_coordinate);
          if (startErr) return { kind: "error", message: startErr };

          const modErr = await this.withModifiers(input.text, async () => {
            await this.input.mouseDown("left");
            await this.moveTo(input.coordinate);
            await this.input.mouseUp("left");
          });
          return modErr ? { kind: "error", message: modErr } : { kind: "text", text: "OK" };
        }

        case "cursor_position": {
          const physical = await this.input.cursorPosition();
          const imageSpace = this.toImageSpace(physical);
          if (!imageSpace) {
            return { kind: "error", message: "No screenshot has been taken yet — call screenshot first." };
          }
          return { kind: "text", text: `[${imageSpace.x}, ${imageSpace.y}]` };
        }

        case "scroll": {
          const direction = input.scroll_direction;
          if (direction !== "up" && direction !== "down" && direction !== "left" && direction !== "right") {
            return { kind: "error", message: `Invalid scroll_direction: ${JSON.stringify(direction)}` };
          }
          const amount = typeof input.scroll_amount === "number" ? input.scroll_amount : 3;

          const moveErr = await this.moveTo(input.coordinate);
          if (moveErr) return { kind: "error", message: moveErr };

          const modErr = await this.withModifiers(input.text, () => this.input.scroll(direction, amount));
          return modErr ? { kind: "error", message: modErr } : { kind: "text", text: "OK" };
        }

        case "type": {
          if (typeof input.text !== "string") {
            return { kind: "error", message: "type requires a `text` string." };
          }
          await this.input.typeText(input.text);
          return { kind: "text", text: "OK" };
        }

        case "key": {
          if (typeof input.text !== "string") {
            return { kind: "error", message: "key requires a `text` string." };
          }
          const stroke = parseKeyCombo(input.text);
          if (!stroke || !stroke.key) {
            return { kind: "error", message: `Unrecognized key combination: "${input.text}"` };
          }

          const repeat = Math.min(Math.max(Number(input.repeat) || 1, 1), 100);
          for (let i = 0; i < repeat; i++) {
            this.checkAbort();
            for (const m of stroke.modifiers) await this.input.keyDown(m.vk, m.extended);
            await this.input.keyDown(stroke.key.vk, stroke.key.extended);
            await this.input.keyUp(stroke.key.vk, stroke.key.extended);
            for (const m of [...stroke.modifiers].reverse()) await this.input.keyUp(m.vk, m.extended);
          }
          return { kind: "text", text: "OK" };
        }

        case "hold_key": {
          if (typeof input.text !== "string") {
            return { kind: "error", message: "hold_key requires a `text` string." };
          }
          const stroke = parseKeyCombo(input.text);
          if (!stroke || !stroke.key) {
            return { kind: "error", message: `Unrecognized key combination: "${input.text}"` };
          }
          const seconds = Math.min(Number(input.duration) || 0, MAX_WAIT_SECONDS);

          const all = [...stroke.modifiers, stroke.key];
          for (const k of all) await this.input.keyDown(k.vk, k.extended);
          try {
            await this.sleep(seconds * 1000);
          } finally {
            for (const k of [...all].reverse()) await this.input.keyUp(k.vk, k.extended);
          }
          return { kind: "text", text: "OK" };
        }

        case "wait": {
          const seconds = Math.min(Number(input.duration) || 0, MAX_WAIT_SECONDS);
          await this.sleep(seconds * 1000);
          return { kind: "text", text: "OK" };
        }

        default:
          return { kind: "error", message: `Unsupported computer action: ${name}` };
      }
    } catch (err) {
      if (err instanceof Aborted) throw err;
      return { kind: "error", message: err instanceof Error ? err.message : String(err) };
    }
  }
}
