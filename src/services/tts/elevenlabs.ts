import { TTSProvider } from "./interface";
import { exec } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

/**
 * ElevenLabs TTS — matches macOS version's ElevenLabsTTSClient.
 * Uses eleven_flash_v2_5 for low-latency streaming.
 */
export class ElevenLabsTTS implements TTSProvider {
  private apiKey: string;
  private voiceId: string;
  private abortController: AbortController | null = null;
  private currentProcess: ReturnType<typeof exec> | null = null;

  constructor(apiKey: string, voiceId: string) {
    this.apiKey = apiKey;
    this.voiceId = voiceId;
  }

  async speak(text: string): Promise<void> {
    this.stop();
    this.abortController = new AbortController();

    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": this.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_flash_v2_5",
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
          },
        }),
        signal: this.abortController.signal,
      }
    );

    if (!response.ok) {
      throw new Error(`ElevenLabs error: ${response.status}`);
    }

    const audioBuffer = Buffer.from(await response.arrayBuffer());

    // Write to temp file and play via PowerShell
    const tmpFile = path.join(os.tmpdir(), `clicky-tts-${Date.now()}.mp3`);
    fs.writeFileSync(tmpFile, audioBuffer);

    return new Promise((resolve, reject) => {
      const psCmd = [
        "Add-Type -AssemblyName presentationCore",
        "$p = New-Object System.Windows.Media.MediaPlayer",
        `$p.Open([Uri]'${tmpFile}')`,
        "$p.Play()",
        "Start-Sleep -Seconds 8",
        "$p.Close()",
      ].join("; ");
      const cmd = `powershell -Command "${psCmd}"`;

      this.currentProcess = exec(cmd, { timeout: 60000 }, (error) => {
        this.currentProcess = null;
        try { fs.unlinkSync(tmpFile); } catch {}
        if (error && !error.killed) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  stop(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    if (this.currentProcess) {
      this.currentProcess.kill();
      this.currentProcess = null;
    }
  }
}
