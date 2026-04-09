# Clicky Windows — TODO

## Smart Screenshot Detection

**Priority:** Medium
**Context:** Currently every query captures a fresh screenshot, even for follow-up questions where the screen hasn't changed. This wastes latency and API cost on image tokens.

**Proposed approach:**
- Track timestamp of last screenshot
- If last response was < 10 seconds ago AND user's message doesn't contain screen-related keywords (`screen`, `see`, `look`, `show`, `what's on`, `describe`, `open`, `app`, `window`), skip the screenshot and send text-only
- Add a "rescan screen" button or keyword (e.g., `/look`) to force a fresh capture
- User can always type "look at my screen" to trigger a new screenshot

**Files to modify:**
- `src/main/companion.ts` — add keyword detection + timestamp logic in `processQuery()`
- `src/services/claude.ts` / `src/services/openai-chat.ts` — make screenshots optional in query params

## HIPAA Phase 2

See `PLAN-clicky-windows.md` in watson repo for full breakdown. Key items:
- [ ] Local Whisper integration (whisper.cpp native addon)
- [ ] Audit logging
- [ ] Self-hosted LLM endpoint support
- [ ] Data encryption at rest

## Voice Input (Push-to-Talk)

The hotkey + IPC wiring exists but renderer-side mic capture (Web Audio API / getUserMedia) is not built yet.
- [ ] Mic capture in renderer via getUserMedia
- [ ] Audio chunk streaming to transcription provider
- [ ] Wire up Ctrl+Alt+Space → mic → transcribe → query flow

## Future Enhancements

- [ ] Cross-platform (Linux) support via Electron
- [ ] Conversation export (save chat as markdown)
- [ ] Multi-monitor overlay improvements
- [ ] Custom hotkey configuration in chat UI
- [ ] Image paste support (paste screenshot instead of auto-capture)
