# Voice & Text-to-Speech

Clicky supports voice input (speech-to-text) and spoken responses (text-to-speech). Both are optional — you can use Clicky with just text input and silent responses.

## Voice Input (Transcription)

Voice input lets you ask questions by speaking instead of typing. Hold the push-to-talk hotkey, speak, and release.

### Providers

| Provider | Quality | Latency | Privacy | Key Required |
|----------|---------|---------|---------|-------------|
| **AssemblyAI** | Excellent | Low (real-time streaming) | Cloud — audio sent to AssemblyAI | Yes |
| **OpenAI Whisper API** | Excellent | Medium (batch) | Cloud — audio sent to OpenAI | Yes |
| **Whisper Local** | Good | Higher (depends on hardware) | Private — nothing leaves your device | No |

### Setting Up AssemblyAI (Recommended)

1. Sign up at [assemblyai.com](https://www.assemblyai.com/)
2. Copy your API key from the dashboard
3. In Clicky, open Settings (tray > Settings)
4. Paste the key in the **AssemblyAI API Key** field
5. Set **Transcription Provider** to "AssemblyAI"
6. Save

### Using Local Whisper (No Cloud)

Local Whisper runs transcription entirely on your machine via [whisper.cpp](https://github.com/ggml-org/whisper.cpp). No API key needed, no audio leaves your device.

**1. Download the whisper.cpp Windows binaries**

Grab a prebuilt release from [whisper.cpp releases](https://github.com/ggml-org/whisper.cpp/releases) (look for a `whisper-bin-x64.zip` or similar) and place the following files in `bin/Release/` at the repo root:

```
bin/Release/
├── whisper-cli.exe
├── whisper.dll
├── ggml.dll
├── ggml-base.dll
└── ggml-cpu.dll
```

**2. Download a Whisper model**

Download a GGML model from [huggingface.co/ggerganov/whisper.cpp](https://huggingface.co/ggerganov/whisper.cpp/tree/main) and place it in `models/`:

```
models/ggml-base.bin
```

`ggml-base.bin` (~142 MB, multilingual) is a good quality/speed trade-off. Smaller options: `ggml-tiny.bin` (fast, lower quality). Larger: `ggml-small.bin` / `ggml-medium.bin` (slower, better quality).

> Clicky currently hard-codes `ggml-base.bin` as the model filename — if you want to use a different model, either rename your file or update the path in `src/services/transcription/whisper-local.ts`.

**3. Enable in settings**

1. Open Settings from the tray icon
2. Set **Transcription Provider** to "Whisper Local"
3. Save

Performance depends on your CPU. On a modern laptop, `base` transcribes a ~5 second clip in ~1 second.

### Push-to-Talk

The default hotkey is `Ctrl+Alt+Space`. You can change this in Settings under the hotkey configuration.

1. Press and hold the hotkey
2. Speak your question
3. Release — Clicky transcribes and sends your question with a screenshot

## Text-to-Speech (TTS)

TTS makes Clicky speak its responses aloud.

### Providers

| Provider | Voice Quality | Latency | Privacy | Key Required |
|----------|-------------|---------|---------|-------------|
| **ElevenLabs** | Very natural | Low | Cloud — response text sent to ElevenLabs | Yes |
| **Windows SAPI** | Robotic but clear | Very low | Private — nothing leaves your device | No |

### Setting Up ElevenLabs

1. Sign up at [elevenlabs.io](https://elevenlabs.io/)
2. Go to your profile > API Keys
3. Copy your API key
4. In Clicky Settings, paste it in the **ElevenLabs API Key** field
5. Set **TTS Provider** to "ElevenLabs"
6. Save

The default voice is `kPzsL2i3teMYv0FxEYQ6`. You can change it in the full Settings panel by entering a different ElevenLabs voice ID.

### Using Windows SAPI (No Cloud)

Windows has built-in speech synthesis. It sounds robotic but works instantly with no setup.

1. Open Settings
2. Set **TTS Provider** to "Windows SAPI"
3. Save

### Disabling TTS

Toggle **Spoken responses** off in Settings if you prefer text-only responses.
