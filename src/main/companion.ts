import { BrowserWindow } from "electron";
import { ScreenCapture, ScreenshotResult, cropScreenshotRegion } from "./screenshot";
import { SettingsStore } from "./settings";
import { ClaudeService } from "../services/claude";
import { OpenAIChatService } from "../services/openai-chat";
import { OpenRouterChatService } from "../services/openrouter-chat";
import {
  TranscriptionProvider,
  createTranscriptionProvider,
} from "../services/transcription/interface";
import { createTTSProvider } from "../services/tts/interface";

interface ConversationEntry {
  role: "user" | "assistant";
  content: string;
}

interface AIProvider {
  query(params: {
    transcript: string;
    screenshots: ScreenshotResult[];
    cursorPosition: { x: number; y: number };
    conversationHistory: ConversationEntry[];
  }): Promise<{ text: string }>;
}

const MAX_CONVERSATION_HISTORY = 10;

/**
 * Central orchestrator — mirrors CompanionManager.swift from macOS version.
 *
 * Flow: voice → screenshot → ai (anthropic or openai) → tts → overlay pointing
 */
export class CompanionManager {
  private settings: SettingsStore;
  private screenCapture: ScreenCapture;
  private transcription: TranscriptionProvider;
  private conversationHistory: ConversationEntry[] = [];
  private overlayWindows: BrowserWindow[] = [];

  constructor(settings: SettingsStore, overlayWindows: BrowserWindow[]) {
    this.settings = settings;
    this.screenCapture = new ScreenCapture();
    this.transcription = createTranscriptionProvider(settings);
    this.overlayWindows = overlayWindows;
  }

  private getAIProvider(): AIProvider {
    const provider = this.settings.get("aiProvider");
    if (provider === "openai") {
      return new OpenAIChatService(this.settings);
    }
    if (provider === "openrouter") {
      return new OpenRouterChatService(this.settings);
    }
    return new ClaudeService(this.settings);
  }

  /**
   * Process a user query: capture screen, send to AI, speak response.
   */
  async processQuery(transcript: string): Promise<string> {
    // 1. Capture screenshots
    const screenshots = await this.screenCapture.captureAllScreens();
    const cursorPos = this.screenCapture.getCursorPosition();

    // 2. Send to AI provider with conversation history
    this.conversationHistory.push({ role: "user", content: transcript });

    const ai = this.getAIProvider();
    const response = await ai.query({
      transcript,
      screenshots,
      cursorPosition: cursorPos,
      conversationHistory: this.conversationHistory,
    });

    this.conversationHistory.push({ role: "assistant", content: response.text });

    // Trim history
    if (this.conversationHistory.length > MAX_CONVERSATION_HISTORY * 2) {
      this.conversationHistory = this.conversationHistory.slice(-MAX_CONVERSATION_HISTORY * 2);
    }

    // 3a. Parse raw POINT tags (still in image-pixel space).
    const rawTags = this.parseRawPointTags(response.text);
    console.log("[Clicky] Claude response:", response.text);
    console.log("[Clicky] Raw POINT tags:", JSON.stringify(rawTags));

    // 3b. Second-pass refinement: only Claude for now.
    //     For each tag, crop ~400px around the estimated point and ask the
    //     model to return the precise pixel center. Falls back to the raw
    //     tag if anything goes wrong.
    const aiProviderName = this.settings.get("aiProvider");
    let refinedTags = rawTags;
    if (aiProviderName === "anthropic" && rawTags.length > 0) {
      const claude = new ClaudeService(this.settings);
      refinedTags = await Promise.all(
        rawTags.map(async (tag) => {
          const shot = screenshots[tag.screen] || screenshots[0];
          if (!shot) return tag;
          try {
            // 300 imageDim px — small enough to reduce ambiguity with
            // neighboring similar elements (e.g. like/dislike), large enough
            // to give context. At native DPI this is a much sharper patch
            // than cropping the downsampled pass-1 image.
            const crop = cropScreenshotRegion(shot, tag.x, tag.y, 300);
            const refined = await claude.refinePoint(
              crop.data,
              crop.claudeSize.w,
              crop.claudeSize.h,
              tag.label
            );
            if (refined) {
              // Refined coords live in native crop-pixel space. Map back to
              // imageDimensions (pass-1) space so later scaling to display
              // px works consistently.
              const imgX = crop.origin.x + refined.x / crop.pxPerImageDim;
              const imgY = crop.origin.y + refined.y / crop.pxPerImageDim;
              console.log(
                `[Clicky] Refined "${tag.label}": (${tag.x},${tag.y}) → (${Math.round(imgX)},${Math.round(imgY)})`
              );
              return { ...tag, x: Math.round(imgX), y: Math.round(imgY) };
            }
          } catch (err) {
            console.warn(
              `[Clicky] Refinement failed for "${tag.label}":`,
              err instanceof Error ? err.message : err
            );
          }
          return tag;
        })
      );
    }

    // 3c. Scale image-pixel coords to display-pixel coords for the overlay.
    const pointTags = refinedTags.map((tag) => {
      const shot = screenshots[tag.screen] || screenshots[0];
      if (!shot) return tag;
      const scaleX = shot.bounds.width / shot.imageDimensions.width;
      const scaleY = shot.bounds.height / shot.imageDimensions.height;
      return {
        ...tag,
        x: Math.round(tag.x * scaleX),
        y: Math.round(tag.y * scaleY),
      };
    });
    console.log("[Clicky] Final POINT tags:", JSON.stringify(pointTags));
    console.log("[Clicky] Overlay windows:", this.overlayWindows.length);
    if (pointTags.length > 0 && this.overlayWindows.length > 0) {
      // Route each tag to the overlay for its target display. Coordinates
      // are already in that display's local CSS space (0..bounds.width).
      const byScreen = new Map<number, typeof pointTags>();
      for (const tag of pointTags) {
        const list = byScreen.get(tag.screen) || [];
        list.push(tag);
        byScreen.set(tag.screen, list);
      }
      for (const [screenIdx, tags] of byScreen) {
        if (screenIdx < 0 || screenIdx >= this.overlayWindows.length) {
          console.warn(
            `[Clicky] POINT tag screen=${screenIdx} is out of range (have ${this.overlayWindows.length} overlay windows); routing to primary display.`
          );
        }
        const win = this.overlayWindows[screenIdx] || this.overlayWindows[0];
        if (win && !win.isDestroyed()) {
          win.webContents.send("overlay:point", tags);
        }
      }
    }

    // 4. Speak response (strip POINT tags from spoken text) — non-blocking
    //    Re-read settings each time so chat toggle changes take effect immediately
    const spokenText = response.text.replace(/\[POINT:[^\]]+\]/g, "").trim();
    const ttsOn = this.settings.get("ttsEnabled");
    const ttsProv = this.settings.get("ttsProvider");
    if (ttsOn && spokenText) {
      try {
        const tts = createTTSProvider(this.settings);
        tts.speak(spokenText).catch((err) => {
          console.warn("TTS failed (non-fatal):", err.message);
        });
      } catch (err: unknown) {
        console.warn("TTS provider creation failed:", err instanceof Error ? err.message : err);
      }
    }

    return response.text;
  }

  private parseRawPointTags(
    text: string
  ): Array<{ x: number; y: number; label: string; screen: number }> {
    const regex = /\[POINT:(\d+),(\d+):([^:]+):screen(\d+)\]/g;
    const tags: Array<{ x: number; y: number; label: string; screen: number }> = [];
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      tags.push({
        x: parseInt(match[1], 10),
        y: parseInt(match[2], 10),
        label: match[3],
        screen: parseInt(match[4], 10),
      });
    }

    return tags;
  }

  clearHistory(): void {
    this.conversationHistory = [];
  }
}
