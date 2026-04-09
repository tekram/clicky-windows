# PLAN: Smart Screenshot Re-capture

## Status: Ready
## Priority: Medium
## Effort: Small

---

## Overview

Skip unnecessary screenshot captures for follow-up questions, and optionally re-capture mid-conversation when the user references something visual. Saves latency and API cost on image tokens.

Credit: Combined insight from [m13v](https://github.com/farzaa/clicky/issues/26#issuecomment-) (mid-conversation recapture) and internal TODO.

## Tasks

- [ ] Track timestamp of last screenshot capture
- [ ] If last capture was < 10 seconds ago AND user message has no visual keywords, skip screenshot and send text-only
- [ ] Visual keyword list: `screen`, `see`, `look`, `show`, `what's on`, `describe`, `open`, `app`, `window`, `click`, `button`, `here`, `this`
- [ ] Add `/look` or "look at my screen" as explicit re-capture triggers
- [ ] Add a "refresh screen" button in the chat UI (camera icon)
- [ ] Log whether screenshot was skipped for debugging

## Files to Modify

- `src/main/companion.ts` — timestamp tracking + keyword detection in `processQuery()`
- `src/services/claude.ts` / `openai-chat.ts` / `openrouter-chat.ts` — make screenshots optional in query params
- `src/renderer/chat/index.html` — add refresh/camera button

## Notes

- Conservative approach: when in doubt, capture. False positives (unnecessary screenshots) are better than false negatives (missing context)
- First implementation should be simple keyword matching, not AI-based intent detection
