# CLAUDE.md

Electron desktop pet: a 3D blob (Three.js) that reacts to Claude Code hooks. `README.md` has setup
and usage.

## Notes for agents

Working notes, handoffs and scratch docs go in `.ai/` (gitignored). Read `.ai/HANDOFF.md` before
starting work. It covers the architecture, how each rendering system works and what was learned
tuning it, the owner's design references, and the planned next work.

## Rules

- **Git identity:** commit with the repo-local identity (`git config user.email` should be the
  `users.noreply.github.com` address), never the global work identity.
- **When to commit:** only when asked. Never force-push; give the owner the command instead.
- **Global hooks:** ask before editing `~/.claude/settings.json`, and keep the hooks already
  there.
- **Design:**
  - The star transform changes shape only (same eyes and colors).
  - The cream/orange split comes from lighting, not painted color.
  - Halftone dots stay in screen space.

## Verifying changes

There are no tests; verification is visual.

- **Preview:** start `blob-preview` (static server on :5179) and open:
  - `gallery.html` for every animation.
  - `looks.html` for light angles and the edge light.
  - `index.html?state=<name>&embed` for a single state. Other URL params: `light`, `rim=0`,
    `wave=old`.
- **Debug globals:** `__emit(evt)`, `__poke(x, y)`, `__toggleStar()`, `__minions`, `__circling`, `__sessions`.
- **Restarting the app:** the running app only picks up `main.js` and `preload.js` changes after
  a restart (see `.ai/HANDOFF.md`).
- **README clips:** after a visual change, regenerate them with `npm run capture` then
  `python tools/encode.py` (about 35 s).
