// The HTML overlay around the canvas: speech bubble, status chip, contact
// shadow and attention ripples.
const bubbleEl = document.getElementById('bubble');
const bubbleLabel = document.getElementById('bubble-label');
const bubbleText = document.getElementById('bubble-text');
const chipEl = document.getElementById('chip');
const shadowEl = document.getElementById('shadow');
const pulseEl = document.getElementById('pulse');

let bubbleSession = null;
let bubbleTimer = null;

export function showBubble(text, label, { timeout = 0, attention = false, session = null } = {}) {
  bubbleText.textContent = text;
  bubbleLabel.textContent = label || '';
  bubbleEl.classList.toggle('attention', attention);
  bubbleEl.classList.remove('hidden');
  bubbleSession = session;
  clearTimeout(bubbleTimer);
  if (timeout) bubbleTimer = setTimeout(hideBubble, timeout);
}

export function hideBubble() {
  clearTimeout(bubbleTimer);
  bubbleEl.classList.add('hidden');
  bubbleSession = null;
}

export const bubbleShown = () => !bubbleEl.classList.contains('hidden');
export const bubbleAsks = () => bubbleEl.classList.contains('attention');
export const bubbleOwner = () => bubbleSession;

export function overBubble(x, y) {
  if (!bubbleShown()) return false;
  const r = bubbleEl.getBoundingClientRect();
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

export function updateChip(label, project) {
  chipEl.replaceChildren(...[[label, 'action'], [project, 'repo']]
    .filter(([text]) => text)
    .map(([text, cls]) => Object.assign(document.createElement('div'), { className: cls, textContent: text })));
  chipEl.classList.toggle('hidden', !label && !project);
}

// center: the blob's middle on screen; ground: the floor under him; lift:
// 0..0.8, how far off the floor he is.
export function placeOverlay(center, ground, lift, squash, glow) {
  pulseEl.style.left = `${center.x}px`;
  pulseEl.style.top = `${center.y}px`;
  pulseEl.classList.toggle('on', glow > 0.3);
  shadowEl.style.left = `${ground.x}px`;
  shadowEl.style.top = `${ground.y}px`;
  shadowEl.style.transform = `scale(${(1 - lift * 0.5) * (1 + squash * 0.5)})`;
  shadowEl.style.opacity = String(1 - lift);
}
