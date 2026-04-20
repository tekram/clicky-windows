import { app } from "electron";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawn } from "child_process";
import { TranscriptionProvider } from "./interface";
import { buildWavHeader } from "./wav";

/**
 * Local Whisper transcription — no audio leaves the device.
 * Required for HIPAA mode.
 *
 * Runs whisper.cpp's `whisper-cli.exe` as a child process against the
 * `ggml-base.bin` model. Expects raw 16-bit signed PCM mono 16 kHz audio
 * chunks (produced by the renderer via AudioContext.decodeAudioData). The
 * chunks are concatenated, wrapped in a WAV header, written to a temp file,
 * and passed to whisper-cli. The resulting `.txt` output is read and
 * returned as the final transcript.
 *
 * Binary + model layout (both downloaded separately — see docs/voice-and-tts.md):
 *   bin/Release/whisper-cli.exe (+ whisper.dll, ggml*.dll)
 *   models/ggml-base.bin
 */
const WHISPER_TIMEOUT_MS = 45_000;

export class WhisperLocalProvider implements TranscriptionProvider {
  private audioChunks: Buffer[] = [];
  private partialCallback: ((text: string) => void) | null = null;
  private finalCallback: ((text: string) => void) | null = null;

  async start(): Promise<void> {
    this.audioChunks = [];
  }

  sendAudio(chunk: Buffer): void {
    this.audioChunks.push(chunk);
  }

  async stop(): Promise<string> {
    if (this.audioChunks.length === 0) return "";

    const pcm = Buffer.concat(this.audioChunks);
    this.audioChunks = [];

    const transcript = await this.transcribePcm(pcm);
    this.finalCallback?.(transcript);
    return transcript;
  }

  onPartialTranscript(callback: (text: string) => void): void {
    this.partialCallback = callback;
  }

  onFinalTranscript(callback: (text: string) => void): void {
    this.finalCallback = callback;
  }

  /**
   * Wrap PCM in WAV, spawn whisper-cli, read back the .txt output.
   */
  private async transcribePcm(pcm: Buffer): Promise<string> {
    const appRoot = app.isPackaged
      ? process.resourcesPath
      : path.resolve(__dirname, "..", "..", "..");

    const whisperExe = path.join(appRoot, "bin", "Release", "whisper-cli.exe");
    const modelPath = path.join(appRoot, "models", "ggml-base.bin");

    if (!fs.existsSync(whisperExe)) {
      throw new Error(
        `whisper-cli.exe not found at ${whisperExe}. See docs/voice-and-tts.md for installation.`
      );
    }
    if (!fs.existsSync(modelPath)) {
      throw new Error(
        `Whisper model not found at ${modelPath}. See docs/voice-and-tts.md for installation.`
      );
    }

    const stamp = Date.now() + "-" + Math.random().toString(36).slice(2, 8);
    const wavPath = path.join(os.tmpdir(), `clicky-${stamp}.wav`);
    const outBase = wavPath.replace(/\.wav$/, "");
    const txtPath = outBase + ".txt";

    const header = buildWavHeader(pcm.length);
    fs.writeFileSync(wavPath, Buffer.concat([header, pcm]));

    return new Promise<string>((resolve, reject) => {
      const args = [
        "-m", modelPath,
        "-l", "auto",
        "-f", wavPath,
        "-otxt",
        "-of", outBase,
        "-np", // suppress progress output
      ];

      const proc = spawn(whisperExe, args, {
        cwd: path.dirname(whisperExe),
      });

      const cleanup = () => {
        try { fs.unlinkSync(wavPath); } catch { /* ignore */ }
        try { fs.unlinkSync(txtPath); } catch { /* ignore */ }
      };

      const timer = setTimeout(() => {
        proc.kill();
        cleanup();
        reject(new Error(`whisper-cli timed out after ${WHISPER_TIMEOUT_MS / 1000}s`));
      }, WHISPER_TIMEOUT_MS);

      let stderr = "";
      proc.stderr.on("data", (d: Buffer) => {
        stderr += d.toString();
      });
      proc.on("error", (err: Error) => {
        clearTimeout(timer);
        cleanup();
        reject(new Error(`whisper-cli spawn error: ${err.message}`));
      });
      proc.on("close", (code: number | null) => {
        clearTimeout(timer);
        if (code !== 0) {
          cleanup();
          reject(new Error(`whisper-cli exited with code ${code}: ${stderr}`));
          return;
        }
        try {
          const transcript = fs.readFileSync(txtPath, "utf-8").trim();
          cleanup();
          resolve(transcript);
        } catch (err: unknown) {
          cleanup();
          const msg = err instanceof Error ? err.message : String(err);
          reject(new Error(`Could not read whisper output: ${msg}`));
        }
      });
    });
  }
}

