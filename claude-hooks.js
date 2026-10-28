// Adds and removes the blob's hooks in a Claude Code settings object. Pure, so
// main.js owns the file I/O and the tests can run without Electron.
const EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse',
  'Notification', 'Stop', 'SubagentStop', 'SessionEnd'];

// Any command running a claude-blob hook.js counts as ours, so connecting also
// replaces one wired by hand to a clone of the repo instead of doubling events.
const isOurs = (h) => typeof h?.command === 'string' && /claude-blob[\\/]+hook\.js/i.test(h.command);

const hookCommand = (hookPath) => `node "${hookPath.replace(/\\/g, '/')}"`;

// Drops our hooks, then any entry or event they leave empty.
function disconnect(settings) {
  const out = structuredClone(settings ?? {});
  for (const event of Object.keys(out.hooks ?? {})) {
    const entries = (out.hooks[event] ?? [])
      .map((e) => ({ ...e, hooks: (e.hooks ?? []).filter((h) => !isOurs(h)) }))
      .filter((e) => e.hooks.length);
    if (entries.length) out.hooks[event] = entries;
    else delete out.hooks[event];
  }
  if (out.hooks && !Object.keys(out.hooks).length) delete out.hooks;
  return out;
}

function connect(settings, command) {
  const out = disconnect(settings);
  out.hooks ??= {};
  for (const event of EVENTS) {
    (out.hooks[event] ??= []).push({ hooks: [{ type: 'command', command, timeout: 5 }] });
  }
  return out;
}

const isConnected = (settings, command) => EVENTS.every((event) =>
  (settings?.hooks?.[event] ?? []).some((e) => (e.hooks ?? []).some((h) => h.command === command)));

module.exports = { EVENTS, hookCommand, connect, disconnect, isConnected };
