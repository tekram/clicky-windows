import { SettingsStore } from "../../main/settings";

export interface TranscriptionProvider {
  /** Start a transcription session (e.g., open websocket) */
  start(): Promise<void>;

  /** Send an audio chunk for transcription */
  sendAudio(chunk: Buffer): void;

  /** Stop the session and get final transcript */
  stop(): Promise<string>;

  /** Register callback for partial/streaming transcripts */
  onPartialTranscript(callback: (text: string) => void): void;

  /** Register callback for final transcript */
  onFinalTranscript(callback: (text: string) => void): void;
}

export function createTranscriptionProvider(
  settings: SettingsStore
): TranscriptionProvider {
  const provider = settings.get("transcriptionProvider");

  switch (provider) {
    case "assemblyai":
      // Dynamic import to avoid loading unused providers
      const { AssemblyAIProvider } = require("./assemblyai");
      return new AssemblyAIProvider(settings.get("assemblyaiApiKey"));

    case "openai":
      const { OpenAITranscriptionProvider } = require("./openai");
      return new OpenAITranscriptionProvider(settings.get("openaiApiKey"));

    case "whisper-local":
      const { WhisperLocalProvider } = require("./whisper-local");
      return new WhisperLocalProvider();

    default:
      throw new Error(`Unknown transcription provider: ${provider}`);
  }
}
