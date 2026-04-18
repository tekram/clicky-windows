# HIPAA Mode

Clicky includes a HIPAA compliance mode designed for use in healthcare environments where Protected Health Information (PHI) may appear on screen.

## What HIPAA Mode Does

When enabled, HIPAA mode enforces **local-only processing** for voice and speech:

| Feature | Normal Mode | HIPAA Mode |
|---------|-------------|------------|
| Transcription | AssemblyAI or OpenAI (cloud) | Whisper Local only |
| Text-to-Speech | ElevenLabs (cloud) | Windows SAPI only |
| Claude API | Cloud (Anthropic) | Cloud (Anthropic) |
| Analytics | None | None |

**Important:** Even in HIPAA mode, screenshots and text are still sent to Anthropic's Claude API. For full HIPAA compliance, your organization must have a **Business Associate Agreement (BAA)** with Anthropic.

## Enabling HIPAA Mode

1. Open Settings (tray icon > Settings)
2. Toggle **HIPAA Mode** on
3. Transcription and TTS automatically switch to local providers
4. Save

## What You Still Need for Full Compliance

HIPAA mode in Clicky is one piece of the puzzle. Full compliance requires:

### 1. Business Associate Agreement (BAA) with Anthropic

Since screenshots (which may contain PHI) are sent to Claude, you need a BAA with Anthropic. Contact [Anthropic sales](https://www.anthropic.com/contact-sales) to set this up.

### 2. Access Controls

- Use unique API keys per user or department
- Rotate keys on a schedule
- Use the optional proxy server to centralize key management and add authentication

### 3. Audit Logging

- Enable audit logging when available (coming in a future release)
- Log who accessed Clicky, when, and what type of queries were made
- Retain logs per your organization's retention policy (HIPAA requires minimum 6 years)

### 4. Data Handling

- Screenshots and transcripts are **not** written to disk; they exist in memory only
- When using **Whisper Local** transcription, a temporary WAV file is written to the OS temp directory during processing and deleted immediately after. Under normal operation this file is ephemeral; a hard crash between write and cleanup may leave it behind. Restart the app to trigger cleanup, or periodically clear your OS temp folder.
- Conversation history is in-memory only and cleared when the app closes
- No data persists between sessions

### 5. Network Security

- All API calls use TLS 1.2+
- If using a proxy, ensure it's deployed with HTTPS
- Consider network-level restrictions (firewall rules, VPN) for additional security

## Self-Hosted Alternative

For organizations that cannot send any data externally, Clicky supports pointing at a custom API endpoint:

1. Open Settings
2. Enable **Use API proxy**
3. Set the **Proxy URL** to your self-hosted LLM endpoint (e.g., a local instance running via Ollama)
4. Combined with local Whisper + local TTS, this keeps all data on-premise

## Compliance Checklist

- [ ] HIPAA mode enabled in Clicky
- [ ] BAA signed with Anthropic (if using Claude API)
- [ ] Per-user or per-department API keys
- [ ] Key rotation schedule in place
- [ ] Network security (TLS, VPN/firewall if needed)
- [ ] Staff training on appropriate use
- [ ] Incident response plan covers AI tool usage
- [ ] Audit logging configured (when available)

## Disclaimer

Clicky is a tool — enabling HIPAA mode does not make your organization HIPAA compliant on its own. Compliance requires organizational policies, technical safeguards, staff training, and BAAs with all service providers. Consult your compliance officer before deploying in a healthcare setting.
