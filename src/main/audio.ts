import { ipcMain, BrowserWindow } from "electron";
import { SettingsStore } from "./settings";
import { CompanionManager } from "./companion";

/**
 * Coordinates push-to-talk audio capture between renderer and main.
 *
 * Flow:
 * 1. Hotkey toggle → renderer starts/stops mic via getUserMedia + MediaRecorder
 * 2. On stop, renderer sends complete audio blob (webm) to main
 * 3. Main sends audio to OpenAI Whisper for transcription
 * 4. Transcript → CompanionManager.processQuery() → response back to chat
 */
export class AudioCapture {
  private settings: SettingsStore;
  private companion: CompanionManager | null = null;

  constructor(settings: SettingsStore) {
    this.settings = settings;
    this.setupIPC();
  }

  setCompanion(companion: CompanionManager): void {
    this.companion = companion;
  }

  private setupIPC(): void {
    // Renderer sends complete audio recording as ArrayBuffer
    ipcMain.handle(
      "audio:recording-complete",
      async (_event, audioData: ArrayBuffer) => {
        try {
          const transcript = await this.transcribe(Buffer.from(audioData));
          if (!transcript || !transcript.trim()) {
            return { error: "No speech detected" };
          }

          console.log("Transcript:", transcript);

          // Send transcript to chat UI immediately
          this.notifyChat("voice:transcript", transcript);

          // Process query through companion
          if (this.companion) {
            const response = await this.companion.processQuery(transcript);
            return { transcript, response };
          }

          return { transcript, error: "Companion not ready" };
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error("Voice pipeline error:", msg);
          return { error: msg };
        }
      }
    );
  }

  private async transcribe(audioBuffer: Buffer): Promise<string> {
    const provider = this.settings.get("transcriptionProvider");
    const openaiKey = this.settings.get("openaiApiKey");

    // Default to OpenAI Whisper for batch transcription
    if (
      (provider === "openai" || provider === "assemblyai") &&
      openaiKey
    ) {
      return this.transcribeWhisper(audioBuffer, openaiKey);
    }

    // Fallback: if they have an OpenAI key, use Whisper regardless of setting
    if (openaiKey) {
      return this.transcribeWhisper(audioBuffer, openaiKey);
    }

    throw new Error(
      "No transcription provider configured. Add an OpenAI API key for voice input."
    );
  }

  private async transcribeWhisper(
    audioBuffer: Buffer,
    apiKey: string
  ): Promise<string> {
    // Build multipart form data with the webm audio
    const boundary = "----ClickyAudio" + Date.now();

    const parts: Buffer[] = [];

    // File part
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="recording.webm"\r\nContent-Type: audio/webm\r\n\r\n`
      )
    );
    parts.push(audioBuffer);
    parts.push(Buffer.from("\r\n"));

    // Model part
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1\r\n`
      )
    );

    // End
    parts.push(Buffer.from(`--${boundary}--\r\n`));

    const body = Buffer.concat(parts);

    const response = await fetch(
      "https://api.openai.com/v1/audio/transcriptions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
        },
        body,
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Whisper API error (${response.status}): ${error}`);
    }

    const data = (await response.json()) as { text: string };
    return data.text;
  }

  private notifyChat(channel: string, data: unknown): void {
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, data);
      }
    });
  }
}
