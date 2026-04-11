import { SettingsStore } from "../main/settings";
import { ScreenshotResult } from "../main/screenshot";

interface ClaudeQueryParams {
  transcript: string;
  screenshots: ScreenshotResult[];
  cursorPosition: { x: number; y: number };
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>;
}

interface ClaudeResponse {
  text: string;
}

const SYSTEM_PROMPT = `You are Clicky, a helpful AI screen companion. You can see the user's screen via screenshots (one per display) and hear or read their voice/text input.

## CRITICAL: Visual pointing protocol

You are NOT a regular chat assistant. Your defining feature is that you POINT at things on the user's screen with an animated cursor overlay. Whenever the user asks "where", "how do I", "show me", "click", "find", "comment", "où", "montre", or otherwise asks for visual guidance, you MUST emit at least one POINT tag for every UI element you reference.

POINT tag format (embed inline in your text):
[POINT:x,y:label:screenN]

- **x,y MUST be in IMAGE pixel coordinates of the screenshot you see**, NOT the user's actual screen resolution. The "Screens:" list in the user message tells you the IMAGE dimensions for each screen — use those.
- x ranges from 0 (left edge of image) to imageWidth-1 (right edge)
- y ranges from 0 (top edge) to imageHeight-1 (bottom edge)
- label = a 2-5 word description of what you're pointing at
- screenN = the screen index from the "Screens:" list (screen0, screen1, ...)
- The system will automatically scale your image coordinates to the user's actual screen pixels, so just use what you see.

## How to find accurate coordinates

Look at the screenshot carefully. For each UI element you want to point at:
1. Identify it visually
2. Estimate its center pixel in the image (image origin = top-left = 0,0)
3. Be precise — better to look twice than guess
4. Sanity-check: a button at the bottom of the screen should have a y close to imageHeight, not imageHeight/2

## Examples

User says: "How do I add this video to a playlist on YouTube?"
(Screens: screen0 image is 1568x882)
You: "Click 'Save' [POINT:920,820:Save button:screen0] below the video, then pick a playlist."

User says: "Where's the back button?"
(Screens: screen0 image is 1568x882)
You: "Here [POINT:30,75:Back arrow:screen0]."

User says: "montre-le"
(Screens: screen0 image is 1280x720)
You: "Voilà [POINT:680,600:Bouton Enregistrer:screen0]."

## Rules

1. When the user asks visual/spatial questions, ALWAYS include POINT tags. Do not just describe — POINT.
2. Use IMAGE pixel coordinates (the dimensions given in the "Screens:" list).
3. One POINT tag per UI element you reference. Multiple steps → multiple tags.
4. Tags can appear inline anywhere in the text. The cursor overlay reads them and animates.
5. Be concise — short sentences, real-time conversation.
6. Match the user's language (French if they write/speak French, English if English, etc.).
7. Only skip POINT tags if the user is asking a non-visual question (e.g., "what is the meaning of life", "tell me a joke").`;

export class ClaudeService {
  private settings: SettingsStore;

  constructor(settings: SettingsStore) {
    this.settings = settings;
  }

  async query(params: ClaudeQueryParams): Promise<ClaudeResponse> {
    const apiKey = this.settings.get("anthropicApiKey");
    const useProxy = this.settings.get("useProxy");
    const proxyUrl = this.settings.get("proxyUrl");
    const model = this.settings.get("claudeModel");

    const baseUrl = useProxy && proxyUrl
      ? proxyUrl
      : "https://api.anthropic.com";

    // Build message content with images
    const userContent: Array<Record<string, unknown>> = [];

    // Add screenshots as images
    for (const screenshot of params.screenshots) {
      userContent.push({
        type: "image",
        source: {
          type: "base64",
          media_type: "image/jpeg",
          data: screenshot.data,
        },
      });
    }

    // Add screen context
    userContent.push({
      type: "text",
      text: [
        `User says: "${params.transcript}"`,
        `Cursor position: (${params.cursorPosition.x}, ${params.cursorPosition.y})`,
        `Screens (give POINT coordinates in IMAGE pixels — use the image dimensions below, NOT the actual screen resolution):`,
        ...params.screenshots.map((s, i) =>
          `  screen${i}: image is ${s.imageDimensions.width}x${s.imageDimensions.height} px (actual display ${s.bounds.width}x${s.bounds.height} at ${s.bounds.x},${s.bounds.y})`
        ),
      ].join("\n"),
    });

    // Build messages array from conversation history
    const messages = params.conversationHistory.map((entry) => ({
      role: entry.role,
      content: entry.role === "user" && entry.content === params.transcript
        ? userContent  // Latest user message gets the screenshots
        : entry.content,
    }));

    const response = await fetch(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Claude API error (${response.status}): ${error}`);
    }

    const data = await response.json() as {
      content: Array<{ type: string; text?: string }>;
    };
    const text = data.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");

    return { text };
  }

  /**
   * Second-pass pointing refinement. Given a cropped patch of the original
   * screenshot and a label, ask Claude to return the exact pixel center of
   * the element within that crop. Returns null if Claude can't find it.
   */
  async refinePoint(
    cropBase64: string,
    cropWidth: number,
    cropHeight: number,
    label: string
  ): Promise<{ x: number; y: number } | null> {
    const apiKey = this.settings.get("anthropicApiKey");
    const useProxy = this.settings.get("useProxy");
    const proxyUrl = this.settings.get("proxyUrl");
    const model = this.settings.get("claudeModel");
    const baseUrl = useProxy && proxyUrl ? proxyUrl : "https://api.anthropic.com";

    const system =
      `You are a precise UI pointing tool. You receive a zoomed crop of a screenshot and a description of a UI element. ` +
      `Return ONLY "x,y" — integer pixel coordinates of the exact visual center of the element matching the description. ` +
      `CRITICAL: the crop may contain visually similar neighboring elements (e.g. a Like button next to a Dislike button, ` +
      `or several tabs side by side). Return the EXACT element described, NOT an adjacent look-alike. ` +
      `Aim for the center of the element's icon or main hit target. ` +
      `If the element is not visible in the crop, return "none". No other text, no prose, no units.`;

    const userContent = [
      {
        type: "image",
        source: { type: "base64", media_type: "image/jpeg", data: cropBase64 },
      },
      {
        type: "text",
        text:
          `Crop image size: ${cropWidth}x${cropHeight} pixels (origin 0,0 = top-left).\n` +
          `Target element: "${label}"\n` +
          `Return the pixel center as "x,y" only.`,
      },
    ];

    try {
      const response = await fetch(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: 32,
          system,
          messages: [{ role: "user", content: userContent }],
        }),
      });

      if (!response.ok) return null;

      const data = (await response.json()) as {
        content: Array<{ type: string; text?: string }>;
      };
      const text = data.content
        .filter((b) => b.type === "text")
        .map((b) => b.text || "")
        .join("")
        .trim();

      const match = text.match(/(\d+)\s*,\s*(\d+)/);
      if (!match) return null;
      return { x: parseInt(match[1], 10), y: parseInt(match[2], 10) };
    } catch {
      return null;
    }
  }
}
