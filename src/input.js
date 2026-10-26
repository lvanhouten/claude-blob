import { api } from './env.js';
import { mood, setState, toggleStar, spring, spin } from './mood.js';
import { blobScreen, eyesScreen } from './scene.js';
import { poke } from './surface.js';
import { hideBubble, overBubble, bubbleShown, bubbleAsks, bubbleOwner } from './ui.js';

// Mouse: click-through except over the blob/bubble, drag to move, click to boop
export const pointer = { cursor: null };
let interactive = false;
let press = null;
let lastClickAt = 0;
let dragging = false;

api.onCursor((p) => { pointer.cursor = p; });

function overBlob(x, y) {
  return Math.hypot(x - blobScreen.x, (y - blobScreen.y) * 1.15) < blobScreen.r;
}

function setInteractive(v) {
  if (v === interactive) return;
  interactive = v;
  api.setIgnore(!v);
  if (v) spring.v -= 0.8;
}

// dismissAsk(id): clicking a "needs you" bubble marks that session's ask handled.
export function initInput({ dismissAsk }) {
  window.addEventListener('mousemove', (e) => {
    pointer.cursor = { x: e.clientX, y: e.clientY };
    if (press && !dragging && Math.hypot(e.screenX - press.x, e.screenY - press.y) > 4) {
      dragging = true;
      api.dragStart();
    }
    if (!press && !dragging) setInteractive(overBlob(e.clientX, e.clientY) || overBubble(e.clientX, e.clientY));
  });

  window.addEventListener('mousedown', (e) => {
    if (e.button === 0 && interactive) press = { x: e.screenX, y: e.screenY };
  });

  window.addEventListener('mouseup', (e) => {
    if (dragging) {
      api.dragEnd();
      dragging = false;
    } else if (press) {
      if (bubbleOwner() && bubbleAsks()) dismissAsk(bubbleOwner());
      else if (overBubble(e.clientX, e.clientY) || bubbleShown()) hideBubble();
      poke(e.clientX, e.clientY);
      if (mood.state === 'sleeping') setState('idle');
      const now = performance.now();
      if (now - lastClickAt < 350) toggleStar();
      lastClickAt = now;
      mood.lastEventAt = now;
    }
    press = null;
  });

  window.addEventListener('mouseleave', () => { if (!press && !dragging) setInteractive(false); });

  window.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    api.contextMenu();
  });
}

// Dizzy gesture: while he's idle, circling the cursor around his eyes three
// whole times in one direction (without stopping for long) spins him dizzy.
// against: how far the cursor has gone backwards, so a brief wobble doesn't
// count as reversing direction.
export const circling = { last: null, total: 0, against: 0, at: 0, cursor: null };
const DIZZY_TURNS = 3;

export function trackCircles(now) {
  const { cursor } = pointer;
  if (mood.state !== 'idle' || mood.starMode || !cursor) {
    circling.last = null;
    circling.total = 0;
    return;
  }
  if (now - circling.at > 1200) circling.total = 0; // paused too long
  // Only measure when the cursor actually moves; his own bobbing would
  // otherwise jitter the angle.
  if (cursor === circling.cursor) return;
  circling.cursor = cursor;
  const dx = cursor.x - eyesScreen.x;
  const dy = cursor.y - eyesScreen.y;
  const dist = Math.hypot(dx, dy);
  // Too close to tell the direction, or too far away to be circling him.
  if (dist < 15 || dist > 260) {
    circling.last = null;
    return;
  }
  const a = Math.atan2(dy, dx);
  if (circling.last !== null) {
    let d = a - circling.last;
    d = ((d + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    if (circling.total === 0 || Math.sign(d) === Math.sign(circling.total)) {
      circling.total += d;
      circling.against = Math.max(0, circling.against - Math.abs(d));
    } else if ((circling.against += Math.abs(d)) > 0.8) {
      circling.total = d; // genuinely circling the other way now
      circling.against = 0;
    }
    circling.at = now;
  }
  circling.last = a;
  if (Math.abs(circling.total) >= Math.PI * 2 * DIZZY_TURNS) {
    spin.dir = Math.sign(circling.total);
    circling.total = 0;
    setState('dizzy');
  }
}
