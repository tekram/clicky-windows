import { TranscriptionProvider } from "./interface";

/**
 * OpenAI Whisper API transcription.
 * Sends audio as a file to the /v1/audio/transcriptions endpoint.
 */
export class OpenAITranscriptionProvider implements TranscriptionProvider {
  private apiKey: string;
  private audioChunks: Buffer[] = [];
  private partialCallback: ((text: string) => void) | null = null;
  private finalCallback: ((text: string) => void) | null = null;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async start(): Promise<void> {
    this.audioChunks = [];
  }

  sendAudio(chunk: Buffer): void {
    this.audioChunks.push(chunk);
  }

  async stop(): Promise<string> {
    if (this.audioChunks.length === 0) return "";

    const audioBuffer = Buffer.concat(this.audioChunks);
    this.audioChunks = [];

    // Build WAV header for raw PCM16 mono 16kHz
    const wavBuffer = this.pcmToWav(audioBuffer, 16000, 1, 16);

    // Create form data manually for Node.js fetch
    const boundary = "----ClickyBoundary" + Date.now();
    const header = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="audio.wav"',
      "Content-Type: audio/wav",
      "",
      "",
    ].join("\r\n");
    const modelPart = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="model"',
      "",
      "whisper-1",
      `--${boundary}--`,
      "",
    ].join("\r\n");

    const body = Buffer.concat([
      Buffer.from(header),
      wavBuffer,
      Buffer.from("\r\n" + modelPart),
    ]);

    const response = await fetch(
      "https://api.openai.com/v1/audio/transcriptions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
        },
        body,
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI Whisper error (${response.status}): ${error}`);
    }

    const data = (await response.json()) as { text: string };
    this.finalCallback?.(data.text);
    return data.text;
  }

  onPartialTranscript(callback: (text: string) => void): void {
    this.partialCallback = callback;
  }

  onFinalTranscript(callback: (text: string) => void): void {
    this.finalCallback = callback;
  }

  private pcmToWav(
    pcm: Buffer,
    sampleRate: number,
    channels: number,
    bitsPerSample: number
  ): Buffer {
    const byteRate = (sampleRate * channels * bitsPerSample) / 8;
    const blockAlign = (channels * bitsPerSample) / 8;
    const dataSize = pcm.length;
    const header = Buffer.alloc(44);

    header.write("RIFF", 0);
    header.writeUInt32LE(36 + dataSize, 4);
    header.write("WAVE", 8);
    header.write("fmt ", 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20); // PCM
    header.writeUInt16LE(channels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitsPerSample, 34);
    header.write("data", 36);
    header.writeUInt32LE(dataSize, 40);

    return Buffer.concat([header, pcm]);
  }
}
