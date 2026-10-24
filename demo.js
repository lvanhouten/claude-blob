// Plays a fake Claude Code session against the running blob so you can see every state.
const PORT = Number(process.env.BLOB_PORT) || 7777;
const base = { session: 'demo', cwd: process.cwd() };

const steps = [
  [{ event: 'UserPromptSubmit' }, 2500],
  [{ event: 'PreToolUse', tool: 'Read' }, 3000],
  [{ event: 'PreToolUse', tool: 'WebSearch' }, 3000],
  [{ event: 'PreToolUse', tool: 'Edit' }, 3000],
  [{ event: 'PreToolUse', tool: 'Bash' }, 1500],
  [{ event: 'Notification', message: 'Claude needs your permission to use Bash' }, 4000],
  [{ event: 'PostToolUse', tool: 'Bash' }, 2000],
  [{ event: 'PreToolUse', tool: 'Agent' }, 3000],
  [{ event: 'Stop' }, 0],
];

(async () => {
  for (const [evt, wait] of steps) {
    const label = evt.tool ? `${evt.event} (${evt.tool})` : evt.event;
    console.log(label);
    await fetch(`http://127.0.0.1:${PORT}/event`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...base, ...evt }),
    }).catch(() => { console.error('Blob app is not running (npm start).'); process.exit(1); });
    await new Promise((r) => setTimeout(r, wait));
  }
})();
