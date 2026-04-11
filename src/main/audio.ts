import { ipcMain, BrowserWindow } from "electron";
import { SettingsStore } from "./settings";
import { CompanionManager } from "./companion";
import { WhisperLocalProvider } from "../services/transcription/whisper-local";

/**
 * Coordinates push-to-talk audio capture between renderer and main.
 *
 * Flow:
 * 1. Hotkey toggle → renderer starts/stops mic via getUserMedia + MediaRecorder
 * 2. On stop, renderer decodes the webm blob to 16-bit signed PCM mono 16 kHz
 *    (via AudioContext.decodeAudioData) and sends the raw PCM buffer to main.
 * 3. Main dispatches the PCM to the configured transcription provider:
 *      - "whisper-local" → spawn whisper.cpp locally (nothing leaves the device)
 *      - "openai" / "assemblyai" → wrap PCM in a WAV header and POST to the
 *        OpenAI Whisper API
 * 4. Transcript → CompanionManager.processQuery() → response back to chat.
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
    // Renderer sends complete PCM recording as ArrayBuffer
    ipcMain.handle(
      "audio:recording-complete",
      async (_event, audioData: ArrayBuffer) => {
        try {
          const transcript = await this.transcribe(Buffer.from(audioData));
          if (!transcript || !transcript.trim()) {
            return { error: "No speech detected" };
          }

          console.log("Transcript received, length:", transcript.length);

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

  private async transcribe(pcmBuffer: Buffer): Promise<string> {
    const provider = this.settings.get("transcriptionProvider");
    const openaiKey = this.settings.get("openaiApiKey");

    // Local Whisper via whisper.cpp — no audio leaves the device.
    if (provider === "whisper-local") {
      const local = new WhisperLocalProvider();
      await local.start();
      local.sendAudio(pcmBuffer);
      return local.stop();
    }

    // Default to OpenAI Whisper API for batch transcription.
    if ((provider === "openai" || provider === "assemblyai") && openaiKey) {
      return this.transcribeWhisper(pcmBuffer, openaiKey);
    }

    // Fallback: if they have an OpenAI key, use Whisper regardless of setting.
    if (openaiKey) {
      return this.transcribeWhisper(pcmBuffer, openaiKey);
    }

    throw new Error(
      "No transcription provider configured. Set transcriptionProvider to 'whisper-local' or add an OpenAI API key."
    );
  }

  /**
   * Send raw PCM to the OpenAI Whisper API, wrapped in a WAV container.
   */
  private async transcribeWhisper(
    pcmBuffer: Buffer,
    apiKey: string
  ): Promise<string> {
    const wavBuffer = pcmToWav(pcmBuffer);
    const boundary = "----ClickyAudio" + Date.now();

    const parts: Buffer[] = [];
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="recording.wav"\r\nContent-Type: audio/wav\r\n\r\n`
      )
    );
    parts.push(wavBuffer);
    parts.push(Buffer.from("\r\n"));
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1\r\n`
      )
    );
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

/**
 * Wrap raw 16-bit signed PCM mono 16 kHz audio in a minimal WAV container.
 */
function pcmToWav(pcm: Buffer, sampleRate = 16000): Buffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = pcm.length;

  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcm]);
}
