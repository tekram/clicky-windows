import { SettingsStore } from "../main/settings";

export interface ContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  toolset_name?: string;
  input?: unknown;
  [key: string]: unknown;
}

export interface AgentMessage {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

export interface AgentTurn {
  content: ContentBlock[];
  stopReason: string | null;
}

const COMPUTER_TOOLSET = "computer_toolset_20260801";

/** Models that support the GA computer toolset. */
export const AGENT_MODELS = [
  "claude-opus-5",
  "claude-sonnet-5",
  "claude-opus-4-8",
] as const;

const SYSTEM_PROMPT = `You are Clicky in agent mode, operating a real Windows 11 desktop on the user's behalf via the computer toolset.

## Operating rules

1. Always take a screenshot before your first action so you know what is on screen.
2. Work in small verified steps: act, screenshot, confirm the result matched your expectation, then continue.
3. You may batch several actions in one turn when they are certain to succeed in sequence (e.g. click a field, type into it, screenshot). Do not batch actions whose validity depends on what the previous action revealed.
4. Prefer keyboard shortcuts and typed paths over long chains of clicks — they are far more reliable.
5. If a click does not produce the expected result, take a screenshot and re-locate the element rather than clicking the same coordinates again.
6. When the task is complete, stop calling tools and reply with a short plain-text summary of what you did.

## Launching and switching applications

**To open an application, do NOT hunt for its icon on the desktop or taskbar.** Use the Start menu, which is deterministic:

1. \`key\` with "super", then \`wait\` 1 second, then \`screenshot\` — and STOP THERE.
2. Only once the screenshot confirms the Start menu is actually open, \`type\` the application name (e.g. "chrome"), \`wait\` 1 second, and \`screenshot\` again.
3. Confirm the intended app is the highlighted top result, then \`key\` with "Return".

**Never batch the "super" keypress together with typing.** They must be in separate turns with a screenshot between them. Keyboard input always goes to whatever currently has focus — so if Start did not open, your text gets typed into the user's active application (a chat box, a document, a terminal) and may be sent or saved. This is the single most damaging mistake you can make, so verify before typing every time.

If the screenshot shows Start did not open, do not type. Press "escape", take a screenshot, and try once more.

To switch to an app that is already running, the same Start-menu flow focuses the existing window — prefer it over clicking taskbar buttons.

Only fall back to clicking an icon if the Start-menu approach has already failed.

## Focus is not the same as what you can see

The user has multiple displays and you receive a screenshot of only one of them. Keyboard input goes to the focused window, which may be on a display you cannot see. Before typing into any text field, click it first and screenshot to confirm a cursor is in it.

## Do not get stuck looking

If you have taken more than two \`zoom\` actions in a row without acting, stop zooming. Either use the keyboard route above, or say plainly that you cannot find the element. Repeated zooming is never progress.

## Autonomy limits

You are running without per-action confirmation, so you are responsible for stopping yourself. Do NOT perform an action that is irreversible or affects other people without stopping first to report and ask. That includes: deleting files or emails, sending messages/email/posts, making purchases or transfers, changing passwords or security settings, installing or uninstalling software, and modifying system configuration.

If the task requires one of those, do everything up to that point, then stop and describe the exact single action you need approval for.

If you cannot complete the task — an element is not findable, a login is required, something is ambiguous — stop and say so plainly. Do not guess and do not keep retrying.

## Screen coordinates

Coordinates are in the pixel space of the screenshots you receive, origin at top-left. Use the zoom action to inspect a region closely before clicking small or densely packed targets.`;

export class ClaudeAgentService {
  constructor(private settings: SettingsStore) {}

  getModel(): string {
    const configured = this.settings.get("agentModel");
    return configured || AGENT_MODELS[0];
  }

  async runTurn(messages: AgentMessage[], signal: AbortSignal): Promise<AgentTurn> {
    const apiKey = this.settings.get("anthropicApiKey");
    if (!apiKey) throw new Error("Agent mode requires an Anthropic API key.");

    const useProxy = this.settings.get("useProxy");
    const proxyUrl = this.settings.get("proxyUrl");
    const baseUrl = useProxy && proxyUrl ? proxyUrl : "https://api.anthropic.com";

    const response = await fetch(`${baseUrl}/v1/messages`, {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.getModel(),
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        tools: [{ type: COMPUTER_TOOLSET }],
        messages,
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Claude API error (${response.status}): ${detail}`);
    }

    const data = (await response.json()) as {
      content: ContentBlock[];
      stop_reason: string | null;
    };

    return { content: data.content ?? [], stopReason: data.stop_reason ?? null };
  }
}
