import { BrowserWindow } from "electron";
import { ScreenCapture, ScreenshotResult } from "./screenshot";
import { SettingsStore } from "./settings";
import { ClaudeService } from "../services/claude";
import {
  TranscriptionProvider,
  createTranscriptionProvider,
} from "../services/transcription/interface";
import { TTSProvider, createTTSProvider } from "../services/tts/interface";

interface ConversationEntry {
  role: "user" | "assistant";
  content: string;
}

const MAX_CONVERSATION_HISTORY = 10;

/**
 * Central orchestrator — mirrors CompanionManager.swift from macOS version.
 *
 * Flow: voice → screenshot → claude → tts → overlay pointing
 */
export class CompanionManager {
  private settings: SettingsStore;
  private screenCapture: ScreenCapture;
  private claude: ClaudeService;
  private transcription: TranscriptionProvider;
  private tts: TTSProvider;
  private conversationHistory: ConversationEntry[] = [];
  private overlayWindow: BrowserWindow | null = null;

  constructor(settings: SettingsStore, overlayWindow: BrowserWindow | null) {
    this.settings = settings;
    this.screenCapture = new ScreenCapture();
    this.claude = new ClaudeService(settings);
    this.transcription = createTranscriptionProvider(settings);
    this.tts = createTTSProvider(settings);
    this.overlayWindow = overlayWindow;
  }

  /**
   * Process a user query: capture screen, send to Claude, speak response.
   */
  async processQuery(transcript: string): Promise<string> {
    // 1. Capture screenshots
    const screenshots = await this.screenCapture.captureAllScreens();
    const cursorPos = this.screenCapture.getCursorPosition();

    // 2. Send to Claude with conversation history
    this.conversationHistory.push({ role: "user", content: transcript });

    const response = await this.claude.query({
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
    const spokenText = response.text.replace(/\[POINT:[^\]]+\]/g, "").trim();
    if (this.settings.get("ttsEnabled") && spokenText) {
      this.tts.speak(spokenText).catch((err) => {
        console.warn("TTS failed (non-fatal):", err.message);
      });
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
