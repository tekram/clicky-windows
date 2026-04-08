import { TTSProvider } from "./interface";

/**
 * OpenAI TTS — uses the /v1/audio/speech endpoint.
 * Voices: alloy, ash, ballad, coral, echo, fable, onyx, nova, sage, shimmer
 * Models: tts-1 (fast), tts-1-hd (higher quality)
 */
export class OpenAITTS implements TTSProvider {
  private apiKey: string;
  private voice: string;
  private abortController: AbortController | null = null;

  constructor(apiKey: string, voice: string = "alloy") {
    this.apiKey = apiKey;
    this.voice = voice;
  }

  async speak(text: string): Promise<void> {
    this.stop();
    this.abortController = new AbortController();

    const response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "tts-1",
        input: text,
        voice: this.voice,
        response_format: "mp3",
      }),
      signal: this.abortController.signal,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI TTS error (${response.status}): ${error}`);
    }

    // TODO: Send audio to renderer for playback via Web Audio API
    const audioBuffer = await response.arrayBuffer();
    console.log(
      `OpenAI TTS: generated ${audioBuffer.byteLength} bytes (voice: ${this.voice})`
    );
  }

  stop(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }
}
