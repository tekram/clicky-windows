import { BrowserWindow } from "electron";
import { ScreenCapture, ScreenshotResult } from "./screenshot";
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
  private overlayWindow: BrowserWindow | null = null;

  constructor(settings: SettingsStore, overlayWindow: BrowserWindow | null) {
    this.settings = settings;
    this.screenCapture = new ScreenCapture();
    this.transcription = createTranscriptionProvider(settings);
    this.overlayWindow = overlayWindow;
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

    // 3. Parse POINT tags and send to overlay
    const pointTags = this.parsePointTags(response.text);
    if (pointTags.length > 0 && this.overlayWindow) {
      this.overlayWindow.webContents.send("overlay:point", pointTags);
    }

    // 4. Speak response (strip POINT tags from spoken text) — non-blocking
    //    Re-read settings each time so chat toggle changes take effect immediately
    const spokenText = response.text.replace(/\[POINT:[^\]]+\]/g, "").trim();
    const ttsOn = this.settings.get("ttsEnabled");
    const ttsProv = this.settings.get("ttsProvider");
    console.log(`TTS check: enabled=${ttsOn}, provider=${ttsProv}, textLen=${spokenText.length}`);
    if (ttsOn && spokenText) {
      try {
        const tts = createTTSProvider(this.settings);
        console.log("TTS: speaking with", ttsProv);
        tts.speak(spokenText).catch((err) => {
          console.warn("TTS failed (non-fatal):", err.message);
        });
      } catch (err: unknown) {
        console.warn("TTS provider creation failed:", err instanceof Error ? err.message : err);
      }
    }

    return response.text;
  }

  private parsePointTags(
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
