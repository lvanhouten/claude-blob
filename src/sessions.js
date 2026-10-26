import { TOOL_STATES, WORKING, STALE_MS } from './states.js';

export function projectOf(cwd) {
  return cwd ? cwd.split(/[\\/]/).filter(Boolean).pop() : '';
}

// Claude Code session tracking. One entry per live session; the blob shows a
// derived view of all of them, so no session's events can overwrite another's.
// It acts on the blob only through the injected effects, so it runs without a
// DOM or WebGL.
export function createSessions({ blob, bubble, helpers, publish, changed, now = () => performance.now(), locked = false }) {
  const sessions = new Map(); // id -> { id, project, activity, at, ask, askedAt, agents, awaitingAgents }
  let current = null; // id of the session the blob is showing
  let pinned = null; // id of the one session to follow, or null to follow whichever matters most

  function sessionFor(e) {
    let s = sessions.get(e.session);
    if (!s) sessions.set(e.session, s = { id: e.session, activity: 'idle', ask: null, askedAt: 0, agents: new Set() });
    s.project = projectOf(e.cwd) || s.project || '';
    s.at = now();
    return s;
  }

  function watched(id) {
    return !pinned || id === pinned;
  }

  function watchedSessions() {
    return [...sessions.values()].filter((s) => watched(s.id));
  }

  function pendingAsks() {
    return watchedSessions().filter((s) => s.ask).sort((a, b) => a.askedAt - b.askedAt);
  }

  function liveSession() {
    const t = now();
    let live = null;
    for (const s of watchedSessions()) {
      if (s.activity !== 'idle' && t - s.at < STALE_MS && (!live || s.at > live.at)) live = s;
    }
    return live;
  }

  function latestSession() {
    let latest = null;
    for (const s of watchedSessions()) if (!latest || s.at > latest.at) latest = s;
    return latest;
  }

  // Menu labels for the session picker: the project, plus a short id when two share one.
  function publishSessions() {
    const list = [...sessions.values()];
    const dupes = (p) => list.filter((s) => s.project === p).length > 1;
    publish({
      pinned,
      sessions: list.map((s) => ({
        id: s.id,
        label: (s.project || 'unknown') + (dupes(s.project) ? ` (${s.id.slice(0, 8)})` : ''),
      })),
    });
  }

  function pin(id) {
    pinned = sessions.has(id) ? id : null;
    if (bubble.owner() && !watched(bubble.owner())) bubble.hide();
    publishSessions();
    settle();
  }

  // Points the blob at whatever matters most: the oldest unanswered ask, else the
  // most recently active session, else stays on the last one shown. `release` lets a transient state (done, dizzy)
  // fall back to idle when nothing is going on.
  function settle({ release = false } = {}) {
    if (locked) return;
    const asks = pendingAsks();
    if (asks.length) {
      const ask = asks[0];
      const label = asks.length > 1 ? `${ask.project} · +${asks.length - 1} more` : ask.project;
      current = ask.id;
      blob.set('attention');
      bubble.show(ask.ask, label, { attention: true, session: ask.id });
    } else {
      if (bubble.asks()) bubble.hide();
      const live = liveSession();
      if (!sessions.has(current) || !watched(current)) current = latestSession()?.id ?? null;
      if (live) {
        current = live.id;
        blob.set(live.activity);
      } else if (release || WORKING.has(blob.state())) {
        blob.set('idle');
      }
    }
    changed();
  }

  function dismissAsk(id) {
    const s = sessions.get(id);
    if (s) s.ask = null;
    bubble.hide();
    settle();
  }

  function onEvent(e) {
    if (!e || !e.event) return;
    const isNew = !sessions.has(e.session);
    const s = sessionFor(e);
    const seen = watched(s.id);
    if (seen) blob.touch();

    // Anything a session does after asking means the ask was handled.
    if (e.event !== 'Notification') s.ask = null;
    if (!e.agent) s.awaitingAgents = false;
    if (e.agent && e.event !== 'SubagentStop') {
      s.agents.add(e.agent);
      if (seen) helpers.bind(e.session, e.agent);
    }

    switch (e.event) {
      case 'SessionStart':
        if (seen && blob.state() === 'sleeping') blob.set('idle');
        break;
      // Subagent tool calls (tagged with `agent`) belong to the minions, so the
      // session keeps showing what its main agent is doing.
      case 'UserPromptSubmit':
      case 'PostToolUse':
        if (!e.agent) s.activity = 'thinking';
        break;
      case 'PreToolUse':
        if (seen && (e.tool === 'Agent' || e.tool === 'Task')) helpers.spawn(e.session);
        if (!e.agent) s.activity = TOOL_STATES[e.tool] || 'thinking';
        break;
      case 'Notification': {
        const msg = e.message || 'Claude needs your attention';
        const idle = e.type === 'idle_prompt' || /waiting for your input/i.test(msg);
        if (!idle) {
          s.ask = msg;
          s.askedAt = now();
        } else if (seen && !pendingAsks().length) {
          bubble.show(msg, s.project, { timeout: 8000, session: e.session });
          blob.kick(2);
        }
        break;
      }
      case 'Stop':
        // Background subagents outlive the main agent's turn.
        s.agents = new Set(e.tasks || []);
        s.awaitingAgents = s.agents.size > 0;
        s.activity = s.awaitingAgents ? 'delegating' : 'idle';
        if (!seen || s.agents.size || pendingAsks().length) break;
        if (liveSession()) {
          bubble.show('Finished', s.project, { timeout: 5000 });
        } else {
          current = s.id;
          blob.set('done');
          bubble.show('All done ✓', s.project, { timeout: 5000 });
        }
        break;
      case 'SubagentStop':
        helpers.retire(e.session, e.agent);
        s.agents.delete(e.agent);
        if (s.awaitingAgents && !s.agents.size) {
          s.awaitingAgents = false;
          s.activity = 'idle';
        }
        break;
      case 'SessionEnd':
        helpers.retireAll(e.session);
        sessions.delete(e.session);
        if (pinned === e.session) pinned = null;
        publishSessions();
        break;
    }
    if (isNew && e.event !== 'SessionEnd') publishSessions();
    settle();
  }

  return {
    sessions,
    onEvent,
    settle,
    dismissAsk,
    pin,
    get current() { return current; },
    get pinned() { return pinned; },
    currentProject: () => sessions.get(current)?.project,
  };
}
