import { spawn, ChildProcessWithoutNullStreams } from "child_process";

/**
 * Windows input synthesis via a long-lived PowerShell process that P/Invokes
 * SendInput. Spawning powershell.exe per action would cost ~200ms of startup;
 * keeping one process alive and streaming newline-delimited JSON keeps a click
 * under ~5ms.
 */

const PS_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ClickyInput {
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] public struct HARDWAREINPUT { public uint uMsg; public ushort wParamL; public ushort wParamH; }
  [StructLayout(LayoutKind.Explicit)] public struct INPUTUNION {
    [FieldOffset(0)] public MOUSEINPUT mi;
    [FieldOffset(0)] public KEYBDINPUT ki;
    [FieldOffset(0)] public HARDWAREINPUT hi;
  }
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public INPUTUNION u; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }

  [DllImport("user32.dll", SetLastError=true)] static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);
  [DllImport("user32.dll", SetLastError=true)] static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);

  const uint INPUT_MOUSE = 0;
  const uint INPUT_KEYBOARD = 1;
  const uint KEYEVENTF_EXTENDEDKEY = 0x0001;
  const uint KEYEVENTF_KEYUP = 0x0002;
  const uint KEYEVENTF_UNICODE = 0x0004;
  const ushort VK_RETURN = 0x0D;
  const ushort VK_TAB = 0x09;

  static void Send(INPUT[] arr) {
    uint sent = SendInput((uint)arr.Length, arr, Marshal.SizeOf(typeof(INPUT)));
    if (sent != (uint)arr.Length) {
      throw new Exception("SendInput delivered " + sent + " of " + arr.Length + " events (win32 error " + Marshal.GetLastWin32Error() + ")");
    }
  }

  public static void Move(int x, int y) {
    if (!SetCursorPos(x, y)) throw new Exception("SetCursorPos failed (win32 error " + Marshal.GetLastWin32Error() + ")");
  }

  public static int[] Cursor() { POINT p; GetCursorPos(out p); return new int[] { p.X, p.Y }; }

  public static void Mouse(uint flags, int data) {
    INPUT[] a = new INPUT[1];
    a[0].type = INPUT_MOUSE;
    a[0].u.mi.dwFlags = flags;
    a[0].u.mi.mouseData = unchecked((uint)data);
    Send(a);
  }

  public static void Key(ushort vk, bool down, bool ext) {
    INPUT[] a = new INPUT[1];
    a[0].type = INPUT_KEYBOARD;
    a[0].u.ki.wVk = vk;
    a[0].u.ki.dwFlags = (down ? 0u : KEYEVENTF_KEYUP) | (ext ? KEYEVENTF_EXTENDEDKEY : 0u);
    Send(a);
  }

  static void Unit(ushort unit) {
    INPUT[] a = new INPUT[2];
    a[0].type = INPUT_KEYBOARD; a[0].u.ki.wScan = unit; a[0].u.ki.dwFlags = KEYEVENTF_UNICODE;
    a[1].type = INPUT_KEYBOARD; a[1].u.ki.wScan = unit; a[1].u.ki.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP;
    Send(a);
  }

  // Text arrives as UTF-16 code units so it never passes through the console
  // codepage. KEYEVENTF_UNICODE cannot express Enter or Tab — those use VKs.
  //
  // delayMs is not optional padding: with zero delay, characters injected
  // after a word boundary get coalesced by the target app and every one of
  // them arrives as the final character of the run.
  public static void TextUnits(int[] units, int delayMs) {
    foreach (int u in units) {
      if (u == 13) continue;
      if (u == 10) { Key(VK_RETURN, true, false); Key(VK_RETURN, false, false); }
      else if (u == 9) { Key(VK_TAB, true, false); Key(VK_TAB, false, false); }
      else Unit((ushort)u);
      if (delayMs > 0) System.Threading.Thread.Sleep(delayMs);
    }
  }
}
'@

try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
[Console]::Out.WriteLine('{"ready":true}')
[Console]::Out.Flush()

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if ($line.Trim() -eq '') { continue }
  $id = -1
  try {
    $c = $line | ConvertFrom-Json
    $id = [int]$c.id
    switch ($c.op) {
      'move'   { [ClickyInput]::Move([int]$c.x, [int]$c.y); $res = @{ id=$id; ok=$true } }
      'mouse'  { [ClickyInput]::Mouse([uint32]$c.flags, [int]$c.data); $res = @{ id=$id; ok=$true } }
      'key'    { [ClickyInput]::Key([uint16]$c.vk, [bool]$c.down, [bool]$c.ext); $res = @{ id=$id; ok=$true } }
      'text'   { [ClickyInput]::TextUnits([int[]]$c.u, [int]$c.d); $res = @{ id=$id; ok=$true } }
      'cursor' { $p = [ClickyInput]::Cursor(); $res = @{ id=$id; ok=$true; x=$p[0]; y=$p[1] } }
      'ping'   { $res = @{ id=$id; ok=$true } }
      default  { $res = @{ id=$id; ok=$false; error=("unknown op: " + $c.op) } }
    }
  } catch {
    $res = @{ id=$id; ok=$false; error=$_.Exception.Message }
  }
  [Console]::Out.WriteLine(($res | ConvertTo-Json -Compress))
  [Console]::Out.Flush()
}
`;

const MOUSEEVENTF = {
  leftDown: 0x0002,
  leftUp: 0x0004,
  rightDown: 0x0008,
  rightUp: 0x0010,
  middleDown: 0x0020,
  middleUp: 0x0040,
  wheel: 0x0800,
  hWheel: 0x1000,
} as const;

const WHEEL_DELTA = 120;

/** Measured floor for reliable delivery; below this, apps coalesce keystrokes. */
const KEYSTROKE_DELAY_MS = 15;

export type MouseButton = "left" | "right" | "middle";

interface Pending {
  resolve: (value: Record<string, unknown>) => void;
  reject: (reason: Error) => void;
}

export class WindowsInput {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private buffer = "";
  private ready: Promise<void> | null = null;

  async start(): Promise<void> {
    if (this.ready) return this.ready;

    this.ready = new Promise<void>((resolve, reject) => {
      const encoded = Buffer.from(PS_SCRIPT, "utf16le").toString("base64");
      const proc = spawn(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
        { windowsHide: true }
      );
      this.proc = proc;

      let settled = false;
      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        this.ready = null;
        reject(err);
      };

      proc.stdout.setEncoding("utf8");
      proc.stdout.on("data", (chunk: string) => {
        this.buffer += chunk;
        let idx: number;
        while ((idx = this.buffer.indexOf("\n")) >= 0) {
          const line = this.buffer.slice(0, idx).trim();
          this.buffer = this.buffer.slice(idx + 1);
          if (!line) continue;

          let msg: Record<string, unknown>;
          try {
            msg = JSON.parse(line);
          } catch {
            continue;
          }

          if (msg.ready === true) {
            if (!settled) {
              settled = true;
              resolve();
            }
            continue;
          }

          const waiter = this.pending.get(msg.id as number);
          if (!waiter) continue;
          this.pending.delete(msg.id as number);
          if (msg.ok) waiter.resolve(msg);
          else waiter.reject(new Error(String(msg.error ?? "input command failed")));
        }
      });

      proc.on("error", (err) => fail(err));
      proc.on("exit", (code) => {
        this.proc = null;
        this.ready = null;
        const err = new Error(`input helper exited (code ${code})`);
        for (const waiter of this.pending.values()) waiter.reject(err);
        this.pending.clear();
        fail(err);
      });
    });

    return this.ready;
  }

  stop(): void {
    this.proc?.kill();
    this.proc = null;
    this.ready = null;
  }

  private send(cmd: Record<string, unknown>): Promise<Record<string, unknown>> {
    const proc = this.proc;
    if (!proc) return Promise.reject(new Error("input helper is not running"));

    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      proc.stdin.write(JSON.stringify({ ...cmd, id }) + "\n", (err) => {
        if (err) {
          this.pending.delete(id);
          reject(err);
        }
      });
    });
  }

  async moveMouse(x: number, y: number): Promise<void> {
    await this.send({ op: "move", x: Math.round(x), y: Math.round(y) });
  }

  async cursorPosition(): Promise<{ x: number; y: number }> {
    const res = await this.send({ op: "cursor" });
    return { x: res.x as number, y: res.y as number };
  }

  async mouseDown(button: MouseButton): Promise<void> {
    await this.send({ op: "mouse", flags: MOUSEEVENTF[`${button}Down`], data: 0 });
  }

  async mouseUp(button: MouseButton): Promise<void> {
    await this.send({ op: "mouse", flags: MOUSEEVENTF[`${button}Up`], data: 0 });
  }

  async click(button: MouseButton, count = 1): Promise<void> {
    for (let i = 0; i < count; i++) {
      await this.mouseDown(button);
      await this.mouseUp(button);
    }
  }

  async scroll(direction: "up" | "down" | "left" | "right", clicks: number): Promise<void> {
    const horizontal = direction === "left" || direction === "right";
    const sign = direction === "down" || direction === "left" ? -1 : 1;
    await this.send({
      op: "mouse",
      flags: horizontal ? MOUSEEVENTF.hWheel : MOUSEEVENTF.wheel,
      data: sign * WHEEL_DELTA * clicks,
    });
  }

  async keyDown(vk: number, extended: boolean): Promise<void> {
    await this.send({ op: "key", vk, down: true, ext: extended });
  }

  async keyUp(vk: number, extended: boolean): Promise<void> {
    await this.send({ op: "key", vk, down: false, ext: extended });
  }

  async typeText(text: string, delayMs = KEYSTROKE_DELAY_MS): Promise<void> {
    const units: number[] = [];
    for (let i = 0; i < text.length; i++) units.push(text.charCodeAt(i));
    if (units.length === 0) return;
    await this.send({ op: "text", u: units, d: delayMs });
  }
}
