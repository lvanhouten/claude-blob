import { test } from 'node:test';
import assert from 'node:assert/strict';
import hooks from '../claude-hooks.js';

const { EVENTS, hookCommand, connect, disconnect, isConnected } = hooks;
const CMD = hookCommand('C:\\Users\\me\\AppData\\Roaming\\claude-blob\\hook.js');
const other = { type: 'command', command: 'python ~/.claude/hooks/guard.py' };

test('hookCommand quotes the path and uses forward slashes', () => {
  assert.equal(CMD, 'node "C:/Users/me/AppData/Roaming/claude-blob/hook.js"');
});

test('connect adds one hook per event to empty settings', () => {
  const out = connect({}, CMD);
  assert.deepEqual(Object.keys(out.hooks), EVENTS);
  assert.ok(isConnected(out, CMD));
  for (const e of EVENTS) assert.equal(out.hooks[e].length, 1);
});

test('connect keeps other hooks and settings', () => {
  const before = { model: 'opus', hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [other] }] } };
  const out = connect(before, CMD);
  assert.equal(out.model, 'opus');
  assert.deepEqual(out.hooks.PreToolUse[0], { matcher: 'Bash', hooks: [other] });
  assert.equal(out.hooks.PreToolUse.length, 2);
  assert.deepEqual(before.hooks.PreToolUse.length, 1, 'input is not mutated');
});

test('connect replaces a hook wired by hand to a repo clone', () => {
  const clone = { type: 'command', command: 'node /home/me/code/claude-blob/hook.js', timeout: 5 };
  const out = connect({ hooks: { Stop: [{ hooks: [clone, other] }] } }, CMD);
  const commands = out.hooks.Stop.flatMap((e) => e.hooks.map((h) => h.command));
  assert.deepEqual(commands, [other.command, CMD]);
});

test('connecting twice does not double up', () => {
  const out = connect(connect({}, CMD), CMD);
  for (const e of EVENTS) assert.equal(out.hooks[e].length, 1);
});

test('disconnect removes only ours and prunes what is left empty', () => {
  const out = disconnect(connect({ hooks: { PreToolUse: [{ hooks: [other] }] } }, CMD));
  assert.deepEqual(out, { hooks: { PreToolUse: [{ hooks: [other] }] } });
  assert.deepEqual(disconnect(connect({}, CMD)), {});
});

test('isConnected needs every event', () => {
  const out = connect({}, CMD);
  delete out.hooks.SessionEnd;
  assert.equal(isConnected(out, CMD), false);
  assert.equal(isConnected({}, CMD), false);
});
