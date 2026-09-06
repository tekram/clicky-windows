/**
 * Claude emits X11 keysym names ("Return", "ctrl+s", "alt+Tab", "Page_Down").
 * Translate those to Windows virtual-key codes.
 */

const VK: Record<string, number> = {
  backspace: 0x08,
  tab: 0x09,
  clear: 0x0c,
  return: 0x0d,
  enter: 0x0d,
  kp_enter: 0x0d,
  pause: 0x13,
  caps_lock: 0x14,
  escape: 0x1b,
  esc: 0x1b,
  space: 0x20,
  page_up: 0x21,
  prior: 0x21,
  page_down: 0x22,
  next: 0x22,
  end: 0x23,
  home: 0x24,
  left: 0x25,
  up: 0x26,
  right: 0x27,
  down: 0x28,
  print: 0x2c,
  print_screen: 0x2c,
  insert: 0x2d,
  delete: 0x2e,
  menu: 0x5d,
  num_lock: 0x90,
  scroll_lock: 0x91,
};

// Keys the Windows input stack requires KEYEVENTF_EXTENDEDKEY for.
const EXTENDED = new Set([
  0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x2c, 0x2d, 0x2e, 0x5b, 0x5c, 0x5d, 0x90,
]);

const PUNCTUATION: Record<string, number> = {
  minus: 0xbd,
  "-": 0xbd,
  equal: 0xbb,
  "=": 0xbb,
  plus: 0xbb,
  bracketleft: 0xdb,
  "[": 0xdb,
  bracketright: 0xdd,
  "]": 0xdd,
  backslash: 0xdc,
  "\\": 0xdc,
  semicolon: 0xba,
  ";": 0xba,
  apostrophe: 0xde,
  "'": 0xde,
  grave: 0xc0,
  "`": 0xc0,
  comma: 0xbc,
  ",": 0xbc,
  period: 0xbe,
  ".": 0xbe,
  slash: 0xbf,
  "/": 0xbf,
};

const MODIFIERS: Record<string, number> = {
  shift: 0x10,
  shift_l: 0xa0,
  shift_r: 0xa1,
  ctrl: 0x11,
  control: 0x11,
  control_l: 0xa2,
  control_r: 0xa3,
  alt: 0x12,
  alt_l: 0xa4,
  alt_r: 0xa5,
  super: 0x5b,
  super_l: 0x5b,
  super_r: 0x5c,
  meta: 0x5b,
  win: 0x5b,
  cmd: 0x5b,
};

export interface KeyStroke {
  modifiers: Array<{ vk: number; extended: boolean }>;
  key: { vk: number; extended: boolean } | null;
}

function lookup(token: string): number | null {
  const name = token.toLowerCase();

  if (VK[name] !== undefined) return VK[name];
  if (PUNCTUATION[name] !== undefined) return PUNCTUATION[name];

  const fn = name.match(/^f(\d{1,2})$/);
  if (fn) {
    const n = parseInt(fn[1], 10);
    if (n >= 1 && n <= 24) return 0x6f + n;
  }

  if (name.length === 1) {
    const code = name.charCodeAt(0);
    if (code >= 97 && code <= 122) return code - 32; // a-z -> VK_A..VK_Z
    if (code >= 48 && code <= 57) return code; // 0-9
  }

  return null;
}

/**
 * Parse a key expression such as "ctrl+shift+t" into modifier and key codes.
 * Returns null if any token is unrecognized, so the caller can report a tool
 * error rather than pressing something arbitrary.
 */
export function parseKeyCombo(combo: string): KeyStroke | null {
  const tokens = combo.split("+").map((t) => t.trim()).filter(Boolean);
  if (tokens.length === 0) return null;

  const stroke: KeyStroke = { modifiers: [], key: null };

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const name = token.toLowerCase();
    const isLast = i === tokens.length - 1;

    // A modifier name in the final position is a real keypress ("press ctrl"),
    // not a modifier for a following key.
    if (MODIFIERS[name] !== undefined && !(isLast && stroke.modifiers.length === 0)) {
      const vk = MODIFIERS[name];
      stroke.modifiers.push({ vk, extended: EXTENDED.has(vk) });
      continue;
    }

    const vk = MODIFIERS[name] ?? lookup(token);
    if (vk === null || vk === undefined) return null;
    if (stroke.key !== null) return null; // more than one non-modifier key
    stroke.key = { vk, extended: EXTENDED.has(vk) };
  }

  return stroke;
}
