# Claude Blob: handoff

Written at the end of a long build session. Read this first; it should be enough to pick up
without the old conversation. `README.md` covers user-facing setup and usage; this file covers
everything a developer needs that the README and commit history don't.

## Where we stopped

- **State:** everything below is built, working, committed and pushed. `main` = `origin/main`
  at `7690c01` ([lvanhouten/claude-blob](https://github.com/lvanhouten/claude-blob)). This
  `HANDOFF.md` is the only uncommitted file (ask the user before committing it).
- **The app is running** on the user's desktop (Windows 11), started detached (see
  "Restarting the app").
- **Next task:** the per-action animation pass, giving each Claude Code activity its own clearer
  animation, mostly by having props grow out of his arms. The plan and the user's ideas are in
  "Next: per-action animations". The user had agreed to work through it one action at a time,
  reviewing each in the gallery.
- **Not yet confirmed by the user on their real desktop:** the helper-blob gestures with a real
  subagent, and the dizzy gesture with a real mouse. Both were only tested in the browser preview
  with simulated events. Ask how they felt.

## What it is

An Electron desktop pet: a transparent, always-on-top, click-through window (300×380,
bottom-right of the primary screen) showing a 3D cel-shaded ghost blob (Three.js). Claude Code
hooks send events to a local HTTP server in the app, and the blob animates based on what the
user's most recently prompted session is doing. It shows speech bubbles for notifications,
turns into a Power-Star shape when a turn finishes, and spawns orbiting mini-me helpers for
subagents.

```
npm install
npm start       # run the app
npm run demo    # play a fake session through every state (needs the app running)
```

## File map

| File | Role |
|---|---|
| `main.js` | Electron main process: transparent frameless window, `setIgnoreMouseEvents(true, {forward:true})` click-through, cursor polling (50 ms) sent to the renderer for eye tracking, drag-to-move (polls the cursor at 10 ms while dragging), tray and right-click menu (Reset position, Test notification, Animation gallery, Quit), HTTP server on `127.0.0.1:7777` (`POST /event`, `GET /health`, `GET /recent` = last 20 events, for checking that hooks arrive). Remembers the window position in `%APPDATA%\claude-blob\window-position.json` (saved on drag end, Reset position and quit; falls back to bottom-right if the saved spot is no longer on any display). |
| `preload.js` | `window.blob` bridge: `onEvent`, `onCursor`, `setIgnore`, `dragStart`, `dragEnd`, `contextMenu`. |
| `index.html`, `style.css` | Canvas plus DOM overlays: `#bubble` (speech bubble), `#chip` (status label), `#shadow` (contact shadow), `#pulse` (attention ripples). An import map loads `three` from `node_modules`. `body.embed` hides the bubble and chip. |
| `renderer.js` | Everything visual and all behaviour (~1150 lines). Sections, in order: state tables → scene/camera/lights → `surface()` shape function → geometry → cel shading → halftone → eyes → decals (glint, freckles) → helpers (minions and gestures) → UI/bubble → event handling → mouse → frame loop. |
| `hook.js` | The Claude Code hook. Reads the hook JSON from stdin, POSTs a slim `{event, session, cwd, tool, message, type}` to the app, prints nothing, always exits 0 within 1.5 s. |
| `gallery.html` | Grid of iframes (`index.html?embed&state=<name>`), one per animation, each looping. Reachable from the tray menu "Animation gallery". |
| `demo.js` | Posts a scripted fake session to the app. |

`../.claude/launch.json` (in the **parent** folder `repos/`, not this repo) defines the
`blob-preview` server: `python -m http.server 5179 --directory claude-blob`, used for the
browser-pane preview.

## Hook wiring

User-level `~/.claude/settings.json` has the blob hook on **SessionStart, UserPromptSubmit,
PreToolUse, PostToolUse, Notification, Stop, SubagentStop, SessionEnd**. The command is
`node <absolute path to this repo>/hook.js` with `timeout: 5`. The user's other pre-existing
hooks there must be kept: an agent-relay PowerShell Notification hook, and a PostToolUse `Skill`
hook. Backups: `~/.claude/settings.json.bak-before-blob` and
`settings.json.bak-before-subagentstop`. Always ask before editing global settings, and diff
against a backup afterwards.

`SubagentStop` is the reliable "a subagent finished" signal. In the Claude desktop app,
subagents run in the background, so the Agent tool's `PostToolUse` fires immediately and does
**not** mean the subagent is done. `SubagentStop` doesn't say which subagent finished, so
helpers retire oldest-first, per session.

## Behaviour model (renderer.js)

- **Focus:** `focused` is the session that most recently had `UserPromptSubmit` (or the first
  session seen). Tool states only animate for the focused session. Notifications from any session
  show a bubble labelled with that session's folder. Helpers spawn for **every** session.
- **States** (`STATES` / `LABELS`): idle, thinking, running (Bash/PowerShell), building
  (Edit/Write), reading (Read/Grep/Glob), searching (WebSearch/WebFetch), delegating (Agent/Task),
  attention (permission Notification), done (Stop, shown as the star), sleeping (5 min idle),
  dizzy. An idle-prompt notification ("waiting for your input") is only a bubble, not the
  attention state.
- **Params:** every numeric field of `P` eases toward `target` (from `DEFAULTS` plus the state) at
  rate 4/s, so states blend. **Exception:** `star` runs on a timed tween (`starTween`,
  `easeInOutBack`, 1.1 s) because the user wanted a curve with wind-up and overshoot. Going back to
  the ghost ends with a squish kick.
- **Gallery mode:** `?state=X` locks a state; states that time out (done, dizzy) replay after
  1.5 s. Special values: `star`, `jiggle` (auto-pokes every 2.2 s), and `delegating` (keeps 3
  helpers cycling). `?embed` uses a lighter mesh (icosahedron detail 26 instead of 36).
- **Interactions:**
  - click → jello `poke()`
  - double-click → toggle star
  - drag → move the window
  - right-click → menu
  - idle plus circling the eyes 3 times (`trackCircles`) → dizzy: a two-turn spin in the circling
    direction, then the eyes roll in opposite circles

## Rendering systems and what we learned building them

**One shape function rules everything.** `surface(dx,dy,dz,out)` maps a unit-sphere direction to
the deformed body. It's applied per vertex every frame (CPU; geometry is `mergeVertices` on an
icosahedron, then `computeVertexNormals`). Eyes, decals, arm anchors, arm tips and helper bud
points all call `surface()` too, so they stick to the skin through every deformation. When adding
anything attached to the body, place it with `surface()` and don't hand-compute positions. A
hand-computed arm tip was about 50% too far out and pushed the bud off-screen.

**Ghost body** (`GHOST`, `SHAPE`): upper hemisphere = superellipse dome (`box` 2.2) with a gumdrop
`taper`. Lower hemisphere = straight walls, scalloped hem of `n`=5 bulbous feet, tucked underside.
Feet roll clockwise seen from above (`hemPhase`, faster when busy via `P.paddle`). Wobble noise is
weighted to the skirt; the dome stays smooth (user request).
- *Lesson:* derive wall height from **dy**, not from `1 - hl` (the width). Width barely changes
  near the equator, which bunched the mesh rows and caused a hard shading crease where the head
  meets the skirt. Fixed with `GHOST.wallDy` and `CAP_HL`.

**Star** (`STAR`, `starEdge`): a true straight-edged star outline averaged over ±`soft` radians to
round the tips and corners. Toward the middle of the face the outline fades into a round `core`
dome (`dome` exponent), and the body is thinner toward the points.
- *Lessons:* a pure cosine profile looked like a starfish, and too much rounding looked like a
  cookie. Applying the star outline right to the center put creases on the face. With too small a
  core, the eyes crowd together. The star must match the ghost's visual mass; the user noticed
  when it shrank. Eyes keep the same size in both forms, sitting 20% closer together on the star
  (`tmp2.x *= 1 - P.star*0.2`).
- The user explicitly rejected changing eye shape or color for the star: **shape only**.

**Cel shading** (`celShade`, uniforms `cel`): a smoothstep band against its own raking light
direction (-1, 0.8, 0.35), separate from the scene lights, with `uBand` 0.3. Lit side `#ffdc9c`
cream, shade side `#ff8642` orange. The cream/orange split must come from lighting, never from
painted vertex colors (user request).
- There are no state tints except sleeping. A leftover "done" tint made the star look yellow, and
  it was removed.

**Halftone** (patched into `bodyMat.onBeforeCompile`): **screen-space** dots
(`gl_FragCoord`), anchored to the body's projected center (`uCenter`), with spacing `uCell`
sized from the **unrotated root's** projected unit length / `HALFTONE_DOTS_PER_UNIT` (15). Dot
radius grows with shade and rim. A diagonal traveling wave (`uTime`) swells whole dots, faster
when busy.
- *Lessons:* object-space dots stretched on the skirt and on the star. Screen space fixed that
  ("looks so much better"). Measuring size from the rotating body made dots flicker during spins,
  so it's measured from the root. Helpers share `bodyMat`, so they get the same grid, which is a
  bit coarse at their size but accepted.

**Arms** (`ARMS`, `armRest`/`armDirs`/`armAnchors`/`armLift`/`reach`): not meshes. A round skin
patch (`radius`) around a fixed shoulder point (`armAnchors`, from `armRest` with arms disabled)
is pushed out along the arm direction. The `cap` fraction moves out as a solid, a quarter-circle
dome rounds the tip, and `bend` raises the tip more than the base when waving.
- *Lessons:* the first try (sphere meshes) looked "stuck on, like Kirby". Shaping in
  sphere-direction space made thin flaps, because the skirt mapping squashes vertically. Anchors
  must use the **rest** direction, or the shoulders slide up and down the sides when the arm
  lifts. A plain smoothstep profile pinches arms into points; the solid cap plus domed tip fixes
  that.
- `reach[i]` (0..1) stretches an arm for helper gestures. A reaching arm swings forward toward
  the camera (`ARMS.z + reach*1.6`) so it stays inside the 300 px window.

**Helpers** (`MINION`, `BUD`, `CATCH`, `gestures` queue): each is a group sharing `geo` and
`bodyMat`, plus small eyes, so it mirrors his current shape. They orbit a tilted ring (`tilt`
lifts them over his head in front, so they never cover his face). Gestures play one at a time
and alternate arms:
- **bud:** crouch and squint → arm reaches, bulb swells at `armTip()` → pinch-off recoil → the
  helper swoops on a curve that overshoots past the ring (`easeOutOvershoot`) and settles.
- **catch:** the helper backs up and squashes (wind-up) → charges in on an accelerating curve →
  impact absorb with a big jiggle and a content squint. He watches and braces; he doesn't reach.
  The user asked for exactly this.
- *Lesson:* without the deliberate wind-up and reach, spawning "looks like it's just randomly
  happening to him". Every action should read as **him** doing it.

**Other motion:**
- Hover bob (`P.hover`, off when asleep).
- Boop spring (`spring`).
- Jiggle: a ripple from the poke direction plus a body rock that decays (`JIGGLE`). Pokes stack
  up to 1.8×.
- Spin (`startSpin(turns, secs, dir)`).
- Dizzy gesture: `trackCircles` measures **only when the cursor actually moves** and ignores
  brief backward motion (`against` > 0.8 rad before treating it as a real reversal). His own bob
  and eye-follow jitter the angle, which kept resetting the count before that fix.

## Design preferences (from the user)

- References: a peach/orange gummy blob with glossy black oval eyes, a white highlight, a two-tone
  cream/orange split, nub arms, and **comic halftone dots** (pale cream dots, bigger on the shadow
  side). Sample frame: https://media.imaginativeprompting.com/e77683ac29fa3e6a5d2776bb1b91bd2a.avif
  (project: https://imaginativeprompting.com/wip/?project=i-can-make-anything). The user also
  shared frames, not saved, showing a blob that morphs into a star and back.
- Body: a Pac-Man-ghost silhouette, smooth on top, with stubby octopus feet on the bottom, slimmer
  than "stout". Hovers and bobs.
- Star: a Super Mario Galaxy **Power Star** shape (inflated, rounded points), same eyes and colors
  as the ghost.
- Motion: curves with wind-up and overshoot (easing, not linear); actions should look
  intentional; things should feel like jello and goo.
- Iterates fast from screenshots. Show before/after at the real 300×380 size, and keep moving
  while they send follow-up tweaks mid-turn.

## Preview and verify

1. Start the `blob-preview` server via the Browser pane (`preview_start` name `blob-preview`),
   then open `http://localhost:5179/gallery.html` or `index.html?state=<name>`.
2. **Real size:** the pane is about 700–1000 px wide, which distorts layout. Wrap the page in a
   300×380 iframe: navigate to `/package.json`, then replace `document.documentElement.innerHTML`
   with an `<iframe src="/?v=N">` and screenshot/zoom that region. Viewport emulation via
   `resize_window` gave blank screenshots, so don't rely on it. Add `?v=N` to bust the cache.
3. **Debug globals** on the page window (or `iframe.contentWindow`):
   - `__emit(evt)` feeds an event, e.g.
     `{event:'PreToolUse', session:'a', cwd:'C:/x/proj', tool:'Agent'}`
   - `__poke(x, y)` jiggles at client coordinates
   - `__toggleStar()`
   - `__minions` lists helper states (phase, position, scale)
   - `__circling` and `__eyesScreen` inspect the dizzy gesture
4. For timed sequences, capture several zooms with short `await`s in between. The bud and catch
   gestures were verified frame by frame this way.
5. **Restarting the app** after edits (PowerShell):
   ```powershell
   Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*claude-blob*' } | Stop-Process -Force -Confirm:$false
   Start-Process -FilePath "<repo>\node_modules\electron\dist\electron.exe" -ArgumentList "." -WorkingDirectory "<repo>"
   ```
   Then poll `http://127.0.0.1:7777/health`. Use `Start-Process` (detached) so the app outlives
   the session. Check that live hooks arrive with `curl http://127.0.0.1:7777/recent`.
6. There are no automated tests; verification is visual.

## Git

- Remote: `https://github.com/lvanhouten/claude-blob.git`, branch `main`.
- **Repo-local identity** (set with `git config` in this repo, not global): name "Lukas Van
  Houten", email `4269146+lvanhouten@users.noreply.github.com`. The global git identity is the
  user's **work** identity and must not be used here (the first push had to be rewritten for
  this). Check with `git config user.email` before committing.
- Commit only when asked. End commit messages with the Claude co-author line used in previous
  commits. Never force-push without explicit approval; the permission classifier blocks it
  anyway, so hand the user the exact command.
- `node_modules/` is ignored. Git prints LF→CRLF warnings on Windows; they're harmless.

## Next: per-action animations

Agreed direction: the **body acting carries the emotion**, and **props grow out of his arms**
(the arm stretches out and reshapes into the tool, then melts back), reusing the `reach` and
`armTip()` machinery. A few non-body items (page, screen, nightcap, thought dots) can pop in as
separate small objects in the same cel and halftone style. The user had said "not 100% sure"
about props in general, then embraced the helper-blob version, so confirm the first prop with
them before doing all of them. Work one action at a time; add or refresh its gallery card and
show it before moving on. Suggested order: reading → editing → the rest.

| Action (trigger) | Body | Prop idea |
|---|---|---|
| Thinking (UserPromptSubmit, PostToolUse) | Looks up, one arm to his "chin" | Three thought dots rising and popping above him |
| Running a command (Bash, PowerShell) | Leans in, quick taps | Tiny floating terminal with a blinking `>_`; arms tap at it |
| Editing (Edit, Write) | Focused squint, rhythmic squash | Arm becomes a pencil scribbling on a floating page (replaces today's hammering) |
| Reading (Read; Grep, Glob) | Settles low, eyes scan | Holds an open book; magnifying glass for Grep |
| Searching the web (WebSearch, WebFetch) | Turns and peers around | Arm becomes a little telescope or spyglass |
| Delegating (Agent, Task) | **Done:** helper blobs | — |
| Needs you (Notification) | Bounces, waves (exists) | "!" pops above his head; keep the ripples |
| Finished (Stop) | **Done:** star | — |
| Asleep (5 min idle) | Settles, eyes closed (exists) | Nightcap and floating Z's |
| Idle | Bob and sway (exists) | Occasional fidgets: a yawn, a look around |

New reactions to consider:
- **Tool error:** a sweat drop and a flinch. Needs `hook.js` to forward an error flag from
  `PostToolUse`'s `tool_response`; check the payload shape first.
- **PreCompact:** he gets squished like a trash compactor, then pops back out. Needs a
  `PreCompact` hook added to the user's settings (ask first).

Other ideas offered but not yet decided: auto-start on Windows login, and committing this
`HANDOFF.md`.

## Suggested skills

- `artifact-capabilities` / `artifact-design`: only if a shareable page (for example a hosted
  gallery) is wanted later.
- `update-config`: for any change to hooks in `~/.claude/settings.json` (always ask first).
- `anthropic-skills:built-in-browser`: before the first browser-pane step, for the preview and
  verify workflow above.
- `simplify` / `code-review`: `renderer.js` is large and was grown iteratively. Consider reviewing
  or splitting it (for example `shape.js`, `helpers.js`, `shading.js`) before adding props.
