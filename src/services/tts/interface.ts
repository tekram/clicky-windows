import { SettingsStore } from "../../main/settings";

export interface TTSProvider {
  speak(text: string): Promise<void>;
  stop(): void;
}

export function createTTSProvider(settings: SettingsStore): TTSProvider {
  const provider = settings.get("ttsProvider");

  switch (provider) {
    case "elevenlabs": {
      const { ElevenLabsTTS } = require("./elevenlabs");
      return new ElevenLabsTTS(
        settings.get("elevenlabsApiKey"),
        settings.get("elevenlabsVoiceId")
      );
    }
    case "openai": {
      const { OpenAITTS } = require("./openai");
      return new OpenAITTS(
        settings.get("openaiApiKey"),
        settings.get("openaiTtsVoice")
      );
    }
    case "local": {
      const { LocalTTS } = require("./local");
      return new LocalTTS();
    }
    default:
      throw new Error(`Unknown TTS provider: ${provider}`);
  }
}
