// Animation states. Every numeric param is eased toward its target each frame,
// so switching states always blends smoothly.
export const DEFAULTS = {
  speed: 0.35, amp: 0.06, freq: 1.1,    // surface wobble (lower half)
  hop: 0, hopHz: 1, jitter: 0,          // bouncing
  sway: 0, wave: 0,                     // body/arm motions
  scan: 0, ponder: 0,                   // eye behaviors
  glow: 0, breath: 1, eyesClosed: 0,
  star: 0,                              // 0 = blob, 1 = star
  dizzy: 0,                             // woozy eye-rolling and swaying
  paddle: 0,                            // feet shuffling
  hover: 1,                             // floating off the desk
  lean: 0,                              // leaning over to reach an arm up high
  slump: 0,                             // arms hanging limp, asleep
  sheets: 0,                            // code sheets whizzing past to read
  write: 0,                             // conjuring code onto blank sheets
  term: 0,                              // a terminal running a command
  web: 0,                               // a browser window searching the web
};

export const STATES = {
  idle: {},
  thinking: { speed: 1.0, amp: 0.08, freq: 1.5, ponder: 1, breath: 0.6 },
  running: { speed: 2.4, amp: 0.08, freq: 2.4, hop: 0.05, hopHz: 2.8, jitter: 0.008, paddle: 1, term: 1 },
  building: { speed: 1.2, amp: 0.08, freq: 1.8, write: 1, paddle: 0.5 },
  reading: { speed: 0.6, amp: 0.05, scan: 1, sheets: 1 },
  searching: { speed: 0.9, amp: 0.06, web: 1 },
  delegating: { speed: 1.6, amp: 0.12, freq: 2.0, hop: 0.06, hopHz: 1.3, paddle: 0.7 },
  attention: { speed: 1.4, amp: 0.08, hopHz: 1.7, wave: 1, lean: 1, paddle: 0.5 },
  done: { speed: 0.7, amp: 0.03, star: 1 },
  sleeping: { speed: 0.15, amp: 0.025, breath: 2.2, eyesClosed: 1, hover: 0, slump: 1 },
  dizzy: { speed: 1.0, amp: 0.1, freq: 1.6, dizzy: 1 },
};

export const LABELS = {
  thinking: 'thinking…',
  running: 'running a command',
  building: 'editing files',
  reading: 'reading',
  searching: 'searching the web',
  delegating: 'delegating to an agent',
  attention: 'needs you!',
  done: 'done',
  sleeping: 'zzz',
  dizzy: 'dizzy…',
};

export const TINTS = { sleeping: '#bdb6dc' };

export const TOOL_STATES = {
  Bash: 'running', PowerShell: 'running', BashOutput: 'running',
  Edit: 'building', MultiEdit: 'building', Write: 'building', NotebookEdit: 'building',
  Read: 'reading', Grep: 'reading', Glob: 'reading', LS: 'reading',
  WebSearch: 'searching', WebFetch: 'searching',
  Task: 'delegating', Agent: 'delegating',
};

export const WORKING = new Set(['thinking', 'attention', ...Object.values(TOOL_STATES)]);

export const SLEEP_AFTER_MS = 5 * 60 * 1000;
export const DONE_HOLD_MS = 4500;
export const DIZZY_MS = 3200; // spin plus the woozy part
// A session silent this long is presumed dead (killed without a SessionEnd).
export const STALE_MS = 15 * 60 * 1000;
