import { globalShortcut, screen } from "electron";
import { SettingsStore } from "../settings";
import { ScreenCapture } from "../screenshot";
import { ClaudeAgentService, AgentMessage, ContentBlock } from "../../services/claude-agent";
import { ComputerExecutor, ToolOutcome } from "./executor";
import { WindowsInput } from "./input";

const MAX_ITERATIONS = 40;
const MAX_RETAINED_SCREENSHOTS = 3;
const NUDGE_THRESHOLD_PX = 80;
const NUDGE_POLL_MS = 120;
const HALT_TEXT = "Not executed: an earlier computer action in this turn failed.";

export type StageEmitter = (stage: string, label: string) => void;

/**
 * One autonomous computer-use run.
 *
 * The user opted out of per-action confirmation, so the abort path is the only
 * guardrail and is deliberately redundant: a global hotkey, a mouse nudge, and
 * an explicit stop call all resolve to the same AbortSignal, which is checked
 * between every action and every API turn.
 */
export class AgentSession {
  private controller: AbortController | null = null;
  private input: WindowsInput | null = null;
  private nudgeTimer: ReturnType<typeof setInterval> | null = null;
  private executing = false;
  private cursorBaseline: { x: number; y: number } | null = null;
  private abortReason: string | null = null;
  private registeredHotkey: string | null = null;

  constructor(
    private settings: SettingsStore,
    private capture: ScreenCapture,
    private emit: StageEmitter
  ) {}

  get isRunning(): boolean {
    return this.controller !== null;
  }

  stop(reason = "Stopped."): void {
    if (!this.controller) return;
    this.abortReason = reason;
    this.controller.abort();
  }

  private startWatchdogs(): void {
    const hotkey = this.settings.get("agentAbortHotkey") || "Ctrl+Alt+Q";
    if (globalShortcut.register(hotkey, () => this.stop(`Stopped by ${hotkey}.`))) {
      this.registeredHotkey = hotkey;
    } else {
      console.warn(`[Clicky] Could not register agent abort hotkey "${hotkey}"`);
    }

    this.cursorBaseline = screen.getCursorScreenPoint();
    this.nudgeTimer = setInterval(() => {
      const current = screen.getCursorScreenPoint();
      if (this.executing || !this.cursorBaseline) {
        this.cursorBaseline = current;
        return;
      }
      const dx = current.x - this.cursorBaseline.x;
      const dy = current.y - this.cursorBaseline.y;
      this.cursorBaseline = current;
      if (Math.hypot(dx, dy) > NUDGE_THRESHOLD_PX) {
        this.stop("Stopped — you moved the mouse.");
      }
    }, NUDGE_POLL_MS);
  }

  private stopWatchdogs(): void {
    if (this.nudgeTimer) {
      clearInterval(this.nudgeTimer);
      this.nudgeTimer = null;
    }
    if (this.registeredHotkey) {
      globalShortcut.unregister(this.registeredHotkey);
      this.registeredHotkey = null;
    }
  }

  /** Keep the transcript small: old screenshots stop being useful once acted on. */
  private pruneScreenshots(messages: AgentMessage[]): void {
    const imageBlocks: ContentBlock[] = [];
    for (const message of messages) {
      if (typeof message.content === "string") continue;
      for (const block of message.content) {
        if (block.type !== "tool_result" || !Array.isArray(block.content)) continue;
        for (const inner of block.content as ContentBlock[]) {
          if (inner.type === "image") imageBlocks.push(inner);
        }
      }
    }

    for (const block of imageBlocks.slice(0, -MAX_RETAINED_SCREENSHOTS)) {
      delete block.source;
      block.type = "text";
      block.text = "[earlier screenshot omitted]";
    }
  }

  private toResultBlock(toolUseId: string, outcome: ToolOutcome): ContentBlock {
    const base = { type: "tool_result", tool_use_id: toolUseId, toolset_name: "computer" };

    if (outcome.kind === "error") {
      return { ...base, is_error: true, content: outcome.message };
    }
    if (outcome.kind === "image") {
      return {
        ...base,
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: outcome.mediaType, data: outcome.data },
          },
        ],
      };
    }
    return { ...base, content: [{ type: "text", text: outcome.text }] };
  }

  async run(task: string): Promise<string> {
    if (this.controller) throw new Error("An agent run is already in progress.");

    this.controller = new AbortController();
    this.abortReason = null;
    const signal = this.controller.signal;

    const input = new WindowsInput();
    this.input = input;

    try {
      this.emit("agent-starting", "Starting agent...");
      await input.start();

      const cursor = screen.getCursorScreenPoint();
      const displays = screen.getAllDisplays();
      const target = screen.getDisplayNearestPoint(cursor);
      const displayIndex = Math.max(0, displays.findIndex((d) => d.id === target.id));

      const executor = new ComputerExecutor(input, this.capture, displayIndex, signal);
      const service = new ClaudeAgentService(this.settings);

      this.startWatchdogs();

      const messages: AgentMessage[] = [{ role: "user", content: task }];
      let narration = "";

      for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
        if (signal.aborted) break;

        this.emit("agent-thinking", "Agent thinking...");
        const turn = await service.runTurn(messages, signal);
        messages.push({ role: "assistant", content: turn.content });

        const spoken = turn.content
          .filter((b) => b.type === "text" && b.text)
          .map((b) => b.text as string)
          .join("\n")
          .trim();
        if (spoken) narration = spoken;

        const toolUses = turn.content.filter(
          (b) => b.type === "tool_use" && b.toolset_name === "computer"
        );
        if (toolUses.length === 0) {
          return narration || "Agent finished with no summary.";
        }

        const results: ContentBlock[] = [];
        let halted = false;

        for (const call of toolUses) {
          if (signal.aborted) break;

          if (halted) {
            results.push({
              type: "tool_result",
              tool_use_id: call.id as string,
              toolset_name: "computer",
              is_error: true,
              content: HALT_TEXT,
            });
            continue;
          }

          this.emit("agent-acting", `Agent: ${call.name}`);
          this.executing = true;
          let outcome: ToolOutcome;
          try {
            outcome = await executor.execute(call.name as string, call.input);
          } finally {
            this.executing = false;
            this.cursorBaseline = screen.getCursorScreenPoint();
          }

          if (outcome.kind === "error") halted = true;
          results.push(this.toResultBlock(call.id as string, outcome));
        }

        if (signal.aborted) break;

        messages.push({ role: "user", content: results });
        this.pruneScreenshots(messages);
      }

      if (signal.aborted) {
        return this.abortReason ?? "Agent stopped.";
      }
      return `Agent stopped after ${MAX_ITERATIONS} steps without finishing. Last update: ${
        narration || "(none)"
      }`;
    } catch (err) {
      if (signal.aborted) return this.abortReason ?? "Agent stopped.";
      throw err;
    } finally {
      this.stopWatchdogs();
      input.stop();
      this.input = null;
      this.controller = null;
      this.executing = false;
      this.emit("done", "");
    }
  }
}
