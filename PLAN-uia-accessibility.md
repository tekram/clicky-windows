# PLAN: Windows UI Automation for Cursor Pointing

## Status: Research
## Priority: High
## Effort: Large

---

## Overview

Replace (or augment) pixel-coordinate-based POINT tags with Windows UI Automation (UIA) element targeting. Instead of `[POINT:450,320:Submit:screen0]`, the AI would output `[ELEMENT:Submit Button:screen0]` and we'd resolve the element's location via UIA at runtime. This is more robust across resolutions, DPI settings, and window positions.

Credit: [m13v from Mediar AI](https://github.com/farzaa/clicky/issues/26#issuecomment-) suggested this and shared their cross-platform implementation.

## Reference Implementations

- **macOS (Swift)**: [mediar-ai/mcp-server-macos-use](https://github.com/mediar-ai/mcp-server-macos-use/blob/main/Sources/MCPServer/main.swift) — accessibility-based element targeting
- **Windows (Rust/UIA)**: [mediar-ai/terminator](https://github.com/mediar-ai/terminator/blob/main/crates/terminator/src/element.rs) — cross-platform element abstraction using Windows UIA

## Approach Options

### Option A: Native Node Addon (node-gyp + C++)
- Use Windows UIA COM API directly via a C++ addon
- Pros: No extra dependencies, fast
- Cons: Complex build setup, C++ maintenance

### Option B: PowerShell UIA Bridge
- Shell out to PowerShell using `System.Windows.Automation` namespace
- Pros: No native compilation, works immediately
- Cons: Slower, process spawn overhead per query

### Option C: Rust Addon via NAPI-RS
- Port or wrap the `terminator` crate as a Node native module
- Pros: Leverages existing tested code, cross-platform potential
- Cons: Rust toolchain required for builds

### Option D: Edge WebDriver / Accessibility Insights
- Use existing accessibility tools as a subprocess
- Pros: Well-tested
- Cons: Heavy dependency, not designed for this use case

**Recommended: Option B first** (PowerShell, fast to prototype), then migrate to **Option C** (Rust/NAPI-RS) for production performance.

## Tasks

### Phase 1: PowerShell Prototype
- [ ] Build a PowerShell script that enumerates UIA elements on screen
- [ ] Return element name, role, bounding rect as JSON
- [ ] Send element list to AI alongside screenshot
- [ ] AI outputs `[ELEMENT:name:role]` tags instead of/alongside POINT tags
- [ ] Resolve element → screen coordinates at overlay render time
- [ ] Fall back to POINT coordinates if element not found

### Phase 2: Rust Native Module (Future)
- [ ] Evaluate wrapping `terminator` crate via NAPI-RS
- [ ] Build Windows UIA element enumeration as native addon
- [ ] Replace PowerShell bridge with native calls
- [ ] Benchmark: latency, element count, accuracy

## System Prompt Changes

Current:
```
When you want to point at something, use: [POINT:x,y:label:screenN]
```

New (hybrid):
```
When you want to point at a UI element, prefer: [ELEMENT:element_name:element_role:screenN]
Fall back to coordinates if no matching element: [POINT:x,y:label:screenN]

Available UI elements on screen:
- "Submit" (Button) at (450, 320)
- "Search" (Edit) at (200, 50)
- ...
```

## Risks

- UIA enumeration can be slow on complex UIs (100ms+)
- Some apps don't expose proper UIA elements (games, custom renderers)
- Element names may not be unique — need disambiguation strategy
- DPI-aware coordinate mapping needed

## Files to Create/Modify

- `src/services/uia.ts` — new: UIA enumeration service
- `src/main/companion.ts` — add UIA context to AI queries
- `src/services/claude.ts` / `openai-chat.ts` / `openrouter-chat.ts` — update system prompt
- `src/renderer/overlay/index.html` — resolve ELEMENT tags to coordinates
