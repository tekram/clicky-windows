# PLAN: Screenshot Capture at Push-to-Talk Release

## Status: Ready
## Priority: High
## Effort: Small

---

## Overview

Currently screenshots are captured when `processQuery()` is called. For push-to-talk, this should happen at key *release* (when the user stops speaking), not key *press* (when they start). The screen state 2-5 seconds after pressing is more relevant to what the user is asking about.

Credit: [m13v from Mediar AI](https://github.com/farzaa/clicky/issues/26#issuecomment-) shared this insight from their macOS implementation.

## Tasks

- [ ] Move screenshot capture timing to push-to-talk release event
- [ ] Ensure text input queries still capture at send time (no change needed)
- [ ] Test: press hotkey, change what's on screen while speaking, release — should capture the new state

## Files to Modify

- `src/main/hotkey.ts` — emit separate press/release events
- `src/main/companion.ts` — capture screenshot at query time (already correct for text, need to verify for voice)
- `src/main/audio.ts` — coordinate capture timing with recording stop

## Notes

- For text chat this is already correct — screenshot happens when you hit send
- This only matters once push-to-talk mic capture is fully wired up (see TODO.md)
- Low risk, no architecture changes needed
