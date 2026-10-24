# Claude Blob

A little 3D gummy blob that sits on your desktop, reacts to what your Claude Code
session is doing, and pops up a speech bubble when Claude needs you.

```
npm install
npm start        # launch the blob (bottom-right of your primary screen)
npm run demo     # play a fake session to see every animation
```

- **Drag** the blob to move it, **click** to jiggle it like jello (or dismiss a bubble), **double-click** to transform it into a star (and back), **right-click** (or use the tray icon) for the menu.
- While it's idle, **circle your cursor around its eyes three times** and it spins itself dizzy.
- Clicks anywhere else pass straight through to the windows underneath.
- **Animation gallery** (tray or right-click menu, or open `gallery.html` through any local web server) shows every animation looping side by side.

## Wiring up Claude Code

Add these to `~/.claude/settings.json` under `"hooks"`, replacing `/path/to/claude-blob`
with where you cloned this repo. Merge them with any hooks you
already have: each event's array can hold several entries.

```json
"SessionStart":     [{ "hooks": [{ "type": "command", "command": "node /path/to/claude-blob/hook.js", "timeout": 5 }] }],
"UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "node /path/to/claude-blob/hook.js", "timeout": 5 }] }],
"PreToolUse":       [{ "hooks": [{ "type": "command", "command": "node /path/to/claude-blob/hook.js", "timeout": 5 }] }],
"PostToolUse":      [{ "hooks": [{ "type": "command", "command": "node /path/to/claude-blob/hook.js", "timeout": 5 }] }],
"Notification":     [{ "hooks": [{ "type": "command", "command": "node /path/to/claude-blob/hook.js", "timeout": 5 }] }],
"Stop":             [{ "hooks": [{ "type": "command", "command": "node /path/to/claude-blob/hook.js", "timeout": 5 }] }],
"SubagentStop":     [{ "hooks": [{ "type": "command", "command": "node /path/to/claude-blob/hook.js", "timeout": 5 }] }],
"SessionEnd":       [{ "hooks": [{ "type": "command", "command": "node /path/to/claude-blob/hook.js", "timeout": 5 }] }]
```

`hook.js` forwards only the event name, session id, folder, tool name and notification
message to `127.0.0.1:7777`. It prints nothing and always exits 0 within 1.5s, so it
can't change or stall a session, even when the blob isn't running.

## What it shows

The blob follows the session you most recently sent a prompt in.

| Claude Code is…                    | The blob…                              |
|------------------------------------|----------------------------------------|
| thinking                           | wobbles and looks up, pondering        |
| running a command (Bash)           | bounces quickly and jitters            |
| editing files                      | hammers, squashing rhythmically        |
| reading / searching files          | sways and scans side to side           |
| searching the web                  | turns and looks around                 |
| running subagents                  | buds off a mini-me per subagent that circles him until it finishes |
| waiting for permission             | jumps, waves, glows with ripples, shows the message |
| finished                           | spins and transforms into a star, then back |
| idle for 5 minutes                 | falls asleep                           |

Notifications from other sessions still show a bubble, labelled with that session's folder.

Set `BLOB_PORT` (for both the app and the hook) to use a port other than 7777.

To check the hooks are reaching the app, open `http://127.0.0.1:7777/recent` to see the last
20 events it received.
