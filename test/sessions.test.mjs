import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSessions, projectOf } from '../src/sessions.js';

// A tracker wired to fakes that record what it does to the blob.
function setup() {
  let clock = 0;
  const fx = { state: 'idle', bubble: null, spawned: [], retired: [], published: null };
  const tracker = createSessions({
    blob: { state: () => fx.state, set: (s) => { fx.state = s; }, touch() {}, kick() {} },
    bubble: {
      show: (text, label, { attention = false, session = null } = {}) => { fx.bubble = { text, label, attention, session }; },
      hide: () => { fx.bubble = null; },
      asks: () => Boolean(fx.bubble?.attention),
      owner: () => fx.bubble?.session ?? null,
    },
    helpers: {
      spawn: (s) => fx.spawned.push(s),
      bind() {},
      retire: (s, a) => fx.retired.push([s, a]),
      retireAll: (s) => fx.retired.push([s]),
    },
    publish: (list) => { fx.published = list; },
    changed() {},
    // Each event lands a millisecond after the last, so recency is unambiguous.
    now: () => ++clock,
  });
  const emit = (session, event, extra = {}) => tracker.onEvent({ session, event, cwd: `C:/x/${session}`, ...extra });
  return { tracker, fx, emit };
}

test('projectOf takes the last path segment', () => {
  assert.equal(projectOf('C:\\Users\\me\\repo'), 'repo');
  assert.equal(projectOf('/home/me/repo/'), 'repo');
  assert.equal(projectOf(undefined), '');
});

test('auto follows the most recently active session', () => {
  const { tracker, fx, emit } = setup();
  emit('alpha', 'PreToolUse', { tool: 'Bash' });
  emit('beta', 'PreToolUse', { tool: 'Edit' });
  assert.equal(tracker.current, 'beta');
  assert.equal(fx.state, 'building');
});

test('the oldest unanswered ask wins over activity', () => {
  const { tracker, fx, emit } = setup();
  emit('alpha', 'Notification', { message: 'alpha asks' });
  emit('beta', 'Notification', { message: 'beta asks' });
  emit('gamma', 'PreToolUse', { tool: 'Bash' });
  assert.equal(fx.state, 'attention');
  assert.equal(tracker.current, 'alpha');
  assert.deepEqual(fx.bubble, { text: 'alpha asks', label: 'alpha · +1 more', attention: true, session: 'alpha' });
});

test('any later event from a session clears its ask', () => {
  const { fx, emit } = setup();
  emit('alpha', 'Notification', { message: 'alpha asks' });
  emit('alpha', 'PostToolUse');
  assert.equal(fx.state, 'thinking');
  assert.equal(fx.bubble, null);
});

test('subagent tool calls do not change what the session shows', () => {
  const { fx, emit } = setup();
  emit('alpha', 'PreToolUse', { tool: 'Agent' });
  emit('alpha', 'PreToolUse', { tool: 'Bash', agent: 'a1' });
  assert.equal(fx.state, 'delegating');
  assert.deepEqual(fx.spawned, ['alpha']);
});

test('a session stays delegating while background subagents run', () => {
  const { fx, emit } = setup();
  emit('alpha', 'PreToolUse', { tool: 'Agent' });
  emit('alpha', 'Stop', { tasks: ['a1'] });
  assert.equal(fx.state, 'delegating');
  emit('alpha', 'SubagentStop', { agent: 'a1' });
  assert.deepEqual(fx.retired, [['alpha', 'a1']]);
  assert.equal(fx.state, 'idle');
});

test('stopping with nothing else live shows done', () => {
  const { fx, emit } = setup();
  emit('alpha', 'PreToolUse', { tool: 'Bash' });
  emit('alpha', 'Stop');
  assert.equal(fx.state, 'done');
  assert.equal(fx.bubble.text, 'All done ✓');
});

test('pinning shows only the pinned session', () => {
  const { tracker, fx, emit } = setup();
  emit('alpha', 'PreToolUse', { tool: 'Bash' });
  emit('beta', 'PreToolUse', { tool: 'Edit' });
  tracker.pin('alpha');
  assert.equal(tracker.current, 'alpha');
  assert.equal(fx.state, 'running');

  emit('beta', 'Notification', { message: 'beta asks' });
  emit('beta', 'PreToolUse', { tool: 'Agent' });
  emit('beta', 'Stop');
  assert.equal(fx.state, 'running');
  assert.equal(fx.bubble, null);
  assert.deepEqual(fx.spawned, []);

  emit('alpha', 'Notification', { message: 'alpha asks' });
  assert.equal(fx.state, 'attention');
  assert.equal(fx.bubble.session, 'alpha');
});

test('pinning hides a bubble from another session', () => {
  const { tracker, fx, emit } = setup();
  emit('alpha', 'PreToolUse', { tool: 'Bash' });
  emit('beta', 'Notification', { message: 'beta asks' });
  assert.equal(fx.bubble.session, 'beta');
  tracker.pin('alpha');
  assert.equal(fx.bubble, null);
  assert.equal(fx.state, 'running');
});

test('back to auto surfaces asks made while pinned', () => {
  const { tracker, fx, emit } = setup();
  emit('alpha', 'PreToolUse', { tool: 'Bash' });
  tracker.pin('alpha');
  emit('beta', 'Notification', { message: 'beta asks' });
  tracker.pin(null);
  assert.equal(fx.state, 'attention');
  assert.equal(tracker.current, 'beta');
});

test('the pin falls back to auto when its session ends', () => {
  const { tracker, fx, emit } = setup();
  emit('alpha', 'PreToolUse', { tool: 'Bash' });
  emit('beta', 'PreToolUse', { tool: 'Edit' });
  tracker.pin('beta');
  emit('beta', 'SessionEnd');
  assert.equal(tracker.pinned, null);
  assert.equal(tracker.current, 'alpha');
  assert.equal(fx.state, 'running');
  assert.deepEqual(fx.published.sessions.map((s) => s.id), ['alpha']);
});

test('pinning an unknown session means auto', () => {
  const { tracker, emit } = setup();
  emit('alpha', 'PreToolUse', { tool: 'Bash' });
  tracker.pin('nope');
  assert.equal(tracker.pinned, null);
});

test('the picker labels sessions by project, with an id when two share one', () => {
  const { fx, tracker } = setup();
  tracker.onEvent({ session: 'aaaaaaaa-1', event: 'SessionStart', cwd: 'C:/x/repo' });
  tracker.onEvent({ session: 'bbbbbbbb-2', event: 'SessionStart', cwd: 'C:/y/repo' });
  tracker.onEvent({ session: 'cccccccc-3', event: 'SessionStart', cwd: 'C:/x/other' });
  assert.deepEqual(fx.published.sessions.map((s) => s.label), ['repo (aaaaaaaa)', 'repo (bbbbbbbb)', 'other']);
});
