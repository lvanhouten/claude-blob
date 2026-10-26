import * as THREE from 'three';
import { P } from './mood.js';
import { body } from './scene.js';
import { easeOutOvershoot } from './easing.js';

// Props: small objects he works with. Each one appears as the matching
// state's param (P.sheets, ...) eases up, and shrinks away as it eases back
// down.

// Reading, editing and running commands: sheets of code (or a terminal) whizz
// in from the side one after another and hang in front of him. Reading, he
// reads down each one. Editing, it arrives blank and his arm passes down over
// it from top to bottom, the code filling in behind his hand. Running a
// command, a terminal types the command and prints its output while he taps
// away. Searching the web, a browser window types a query, thinks, and shows
// results that he skims. Then he flicks it away and the next arrives.
// in/read/write/run/web/out: seconds for each part of one sheet's visit
// at: where a sheet hangs in front of him; from: how far off to the side it
// flies in from and out to
const SHEET = { w: 0.62, h: 0.74, in: 0.45, read: 2.3, write: 2.4, run: 2.6, web: 2.8, out: 0.35, at: [0.05, -0.3, 1.3], tilt: -0.25, from: 3.2, lines: 7 };
const SHEET_PX = { w: 124, h: 148, fold: 26 };
// The writing pass: his arm winds up above the page (top), sweeps down to the
// bottom of it over the middle of the visit, then drops back to rest.
// windup/start/end: fractions of the writing time
const SWEEP = { top: 0.7, bottom: -0.1, windup: 0.12, start: 0.18, end: 0.85 };

// The code on a page: indented runs of colored "words", the same every time
// for a given seed.
const CODE_COLORS = ['#e0703c', '#3e7486', '#9a6bb0', '#c9a888', '#c9a888'];
function codeWords(seed) {
  let r = seed * 9301 + 49297;
  const rand = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
  const words = [];
  let indent = 0;
  for (let k = 0; k < SHEET.lines; k++) {
    const y = 18 + k * 18;
    indent = Math.max(0, Math.min(2, indent + Math.floor(rand() * 3) - 1));
    let x = 12 + indent * 12;
    const end = (k === 0 ? SHEET_PX.w - SHEET_PX.fold - 6 : 112) - rand() * 30;
    while (x < end) {
      const len = Math.min(end - x, 10 + rand() * 24);
      words.push({ line: k, x, y, len, color: CODE_COLORS[Math.floor(rand() * CODE_COLORS.length)] });
      x += len + 5;
    }
  }
  return words;
}
const writeWords = [11, 12, 13, 14].map(codeWords);

// Draws a page with the top-right corner folded and its code filled in down
// to `reveal` (0..1 from top to bottom). Each line runs in quickly from left
// to right as the fill reaches it.
function drawSheet(g, words, reveal = 1) {
  const { w, h, fold } = SHEET_PX;
  g.clearRect(0, 0, w, h);
  g.fillStyle = '#fff4e0';
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(w - fold, 0);
  g.lineTo(w, fold);
  g.lineTo(w, h);
  g.lineTo(0, h);
  g.fill();
  g.fillStyle = '#e8cfae';
  g.beginPath();
  g.moveTo(w - fold, 0);
  g.lineTo(w - fold, fold);
  g.lineTo(w, fold);
  g.fill();
  for (const wd of words) {
    const across = THREE.MathUtils.clamp(reveal * SHEET.lines - wd.line, 0, 1) * w;
    const len = Math.min(wd.len, across - wd.x);
    if (len <= 0) continue;
    g.fillStyle = wd.color;
    g.fillRect(wd.x, wd.y, len, 7);
  }
}

function sheetCanvas(w = SHEET_PX.w, h = SHEET_PX.h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  // Unlit, so the paper stays bright whichever way the light comes from.
  const mat = new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide });
  return { g: c.getContext('2d'), tex, mat };
}

// Finished pages to read, and one page that gets written on.
const readPages = [1, 2, 3, 4].map((seed) => {
  const page = sheetCanvas();
  drawSheet(page.g, codeWords(seed));
  return page;
});
const writePage = sheetCanvas();

// The terminal: a dark window with a title bar. A command types out after the
// prompt, then output prints line by line, scrolling up once the window is
// full, with a blinking cursor at the end.
// w/h: its size next to a sheet's; px: its canvas size (same aspect)
const TERM = { w: 0.74, h: 0.56, px: [148, 112], typeSecs: 0.55, lineSecs: 0.16, rows: 6 };
const termPage = sheetCanvas(...TERM.px);
function termLines(seed) {
  let r = seed * 7919 + 104729;
  const rand = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
  return Array.from({ length: 24 }, () => ({
    len: 30 + rand() * 90,
    color: rand() < 0.2 ? '#6fb3c4' : '#a99aa6',
  }));
}
const termOutput = [1, 2, 3, 4].map(termLines);

// The browser: a light window with a search bar. The query types in, a spinner
// turns while it loads, then result cards pop in one after another.
// typeSecs/loadSecs: how long the typing and the spinner take; resultSecs:
// the gap between results
const WEB = { w: 0.74, h: 0.6, px: [148, 120], typeSecs: 0.5, loadSecs: 0.45, resultSecs: 0.3, results: 3 };
const webPage = sheetCanvas(...WEB.px);
function drawBrowser(g, t, seed) {
  const [w, h] = WEB.px;
  g.clearRect(0, 0, w, h);
  g.fillStyle = '#fff4e0';
  g.beginPath();
  g.roundRect(0, 0, w, h, 10);
  g.fill();
  g.fillStyle = '#e8cfae';
  g.beginPath();
  g.roundRect(0, 0, w, 16, [10, 10, 0, 0]);
  g.fill();
  // An outline, so the pale window stands out against his cream side.
  g.strokeStyle = '#b58f6c';
  g.lineWidth = 3;
  g.beginPath();
  g.roundRect(1.5, 1.5, w - 3, h - 3, 9);
  g.stroke();
  ['#e0703c', '#f0b24a', '#6fae8a'].forEach((c, k) => {
    g.fillStyle = c;
    g.beginPath();
    g.arc(12 + k * 11, 8, 3.5, 0, Math.PI * 2);
    g.fill();
  });
  // Search bar, with a little magnifier and the query typing in.
  g.fillStyle = '#ffffff';
  g.strokeStyle = '#c9a888';
  g.lineWidth = 2;
  g.beginPath();
  g.roundRect(10, 24, w - 20, 16, 8);
  g.fill();
  g.stroke();
  g.strokeStyle = '#3e7486';
  g.beginPath();
  g.arc(20, 31, 3.5, 0, Math.PI * 2);
  g.moveTo(22.5, 33.5);
  g.lineTo(25.5, 36.5);
  g.stroke();
  const typed = THREE.MathUtils.clamp(t / WEB.typeSecs, 0, 1);
  g.fillStyle = '#9a6bb0';
  g.fillRect(31, 29, (60 + (seed % 3) * 12) * typed, 5);
  const loaded = t - WEB.typeSecs - WEB.loadSecs;
  if (t > WEB.typeSecs && loaded < 0) {
    // Loading: three dots chasing around.
    for (let k = 0; k < 3; k++) {
      const a = t * 9 + k * 2.1;
      g.fillStyle = k ? '#c9a888' : '#e0703c';
      g.beginPath();
      g.arc(w / 2 + Math.cos(a) * 8, 76 + Math.sin(a) * 8, 3, 0, Math.PI * 2);
      g.fill();
    }
    return;
  }
  for (let k = 0; k < WEB.results; k++) {
    const pop = THREE.MathUtils.clamp((loaded - k * WEB.resultSecs) / 0.15, 0, 1);
    if (pop <= 0) break;
    const y = 50 + k * 22;
    const slide = (1 - pop) * 10;
    g.globalAlpha = pop;
    g.fillStyle = '#3e7486';
    g.fillRect(12 + slide, y, 50 + ((seed + k) % 3) * 16, 6);
    g.fillStyle = '#c9a888';
    g.fillRect(12 + slide, y + 9, 110, 4);
    g.fillRect(12 + slide, y + 15, 80 + ((seed * 3 + k) % 4) * 8, 4);
    g.globalAlpha = 1;
  }
}
function drawTerminal(g, t, output) {
  const [w, h] = TERM.px;
  g.clearRect(0, 0, w, h);
  g.fillStyle = '#2b2230';
  g.beginPath();
  g.roundRect(0, 0, w, h, 10);
  g.fill();
  g.fillStyle = '#3d3243';
  g.beginPath();
  g.roundRect(0, 0, w, 16, [10, 10, 0, 0]);
  g.fill();
  ['#e0703c', '#f0b24a', '#6fae8a'].forEach((c, k) => {
    g.fillStyle = c;
    g.beginPath();
    g.arc(12 + k * 11, 8, 3.5, 0, Math.PI * 2);
    g.fill();
  });
  const rowH = 14;
  const top = 24;
  // The command line scrolls off the top with everything else once the
  // output fills the window.
  const printed = Math.max(0, Math.floor((t - TERM.typeSecs - 0.15) / TERM.lineSecs));
  const rows = [{ prompt: true }, ...output.slice(0, printed)];
  const first = Math.max(0, rows.length - TERM.rows);
  let y = top;
  let cursorX = 0;
  for (let k = first; k < rows.length; k++) {
    const row = rows[k];
    if (row.prompt) {
      g.fillStyle = '#e0703c';
      g.font = 'bold 13px monospace';
      g.fillText('>', 8, y + 5);
      const typed = THREE.MathUtils.clamp(t / TERM.typeSecs, 0, 1) * 70;
      g.fillStyle = '#ffe6bd';
      g.fillRect(22, y - 3, typed, 6);
      cursorX = 22 + typed + 3;
    } else {
      g.fillStyle = row.color;
      g.fillRect(8, y - 3, row.len, 6);
      cursorX = 8 + row.len + 3;
    }
    y += rowH;
  }
  if (Math.floor(t * 3) % 2 === 0) {
    g.fillStyle = '#ffe6bd';
    g.fillRect(cursorX, y - rowH - 5, 6, 10);
  }
}
const sheet = new THREE.Mesh(new THREE.PlaneGeometry(SHEET.w, SHEET.h), readPages[0].mat);
sheet.visible = false;
body.add(sheet);

let sheetT = 0;     // seconds into the current sheet's visit
let sheetCount = 0; // which sheet this is, to vary the page
let readLine = 0;   // 0..1 down the page, for his eyes while reading
let writeLine = 0;  // 0..1 down the page, how far the code has filled in
let webSkim = 0;    // 0..1 down the results, for his eyes
// What his arms do at the sheet. flick: 0..1, swatting it away; sweep: the
// writing arm, how far into the pass and its height; typing: 1 while a web
// query types.
export const hands = { flick: 0, sweep: { on: 0, lift: 0 }, typing: 0 };

// Where his eyes are while reading `lines` lines, `f` (0..1) of the way
// through: along runs 0..1 across the current line, then snaps back.
const reading = { along: 0, line: 0 };
function readAlong(f, lines) {
  const at = Math.min(f * lines, lines - 0.001);
  const u = at % 1;
  reading.along = u < 0.8 ? u / 0.8 : 1 - (u - 0.8) / 0.2;
  reading.line = Math.floor(at);
}

export function updateSheet(step, time) {
  const pick = { read: P.sheets, write: P.write, run: P.term, web: P.web };
  const mode = Object.keys(pick).reduce((a, b) => (pick[b] > pick[a] ? b : a));
  const writing = mode === 'write';
  const show = Math.max(P.sheets, P.write, P.term, P.web) * Math.max(0, 1 - P.star);
  sheet.visible = show > 0.02;
  hands.flick = 0;
  hands.sweep.on = 0;
  if (!sheet.visible) { sheetT = 0; return; }
  const hold = SHEET[mode];
  const cycle = SHEET.in + hold + SHEET.out;
  sheetT += step;
  if (sheetT > cycle) {
    sheetT -= cycle;
    sheetCount++;
  }
  const page = { run: termPage, web: webPage, write: writePage }[mode] ?? readPages[sheetCount % readPages.length];
  sheet.material = page.mat;
  let x = 0, lean = 0, stretch = 0, progress = 0;
  if (sheetT < SHEET.in) {
    // Whizzes in from the right, overshoots and settles.
    const u = sheetT / SHEET.in;
    x = (1 - easeOutOvershoot(u)) * SHEET.from;
    lean = (1 - u) * 0.5;
    stretch = (1 - u) * 0.6;
  } else if (sheetT < SHEET.in + hold) {
    progress = (sheetT - SHEET.in) / hold;
  } else {
    // A small pull back to the right as he winds up, then it zooms off left.
    const u = (sheetT - SHEET.in - hold) / SHEET.out;
    x = -(u * u * (1 + 2.2 * u) - 0.25 * Math.sin(u * Math.PI)) * SHEET.from / 3.2;
    lean = -u * 0.5;
    stretch = u * 0.8;
    hands.flick = Math.sin(Math.min(1, u * 1.4) * Math.PI);
    progress = 1;
  }
  readLine = progress;
  const bob = Math.sin(time * 1.6) * 0.02;
  sheet.position.set(SHEET.at[0] + x, SHEET.at[1] + bob, SHEET.at[2]);
  sheet.rotation.set(SHEET.tilt, 0, lean);
  const size = { run: TERM, web: WEB }[mode];
  const [sx, sy] = size ? [size.w / SHEET.w, size.h / SHEET.h] : [1, 1];
  sheet.scale.set((1 + stretch) * show * sx, (1 - stretch * 0.3) * show * sy, 1);
  const since = Math.max(0, sheetT - SHEET.in);
  if (mode === 'run') {
    drawTerminal(page.g, since, termOutput[sheetCount % termOutput.length]);
    page.tex.needsUpdate = true;
  }
  hands.typing = 0;
  if (mode === 'web') {
    drawBrowser(page.g, since, sheetCount);
    page.tex.needsUpdate = true;
    hands.typing = since > 0 && since < WEB.typeSecs && progress < 1 ? 1 : 0;
    const loadedAt = WEB.typeSecs + WEB.loadSecs;
    webSkim = THREE.MathUtils.clamp((since - loadedAt) / (SHEET.web - loadedAt), 0, 1);
  }
  if (!writing) return;

  // His arm rises to the top of the page, then passes down it with the code
  // filling in just behind, and drops back to rest at the end.
  const pass = THREE.MathUtils.clamp((progress - SWEEP.start) / (SWEEP.end - SWEEP.start), 0, 1);
  writeLine = pass * pass * (3 - 2 * pass);
  const raised = THREE.MathUtils.smoothstep(progress, 0, SWEEP.windup) * (1 - THREE.MathUtils.smoothstep(progress, SWEEP.end, 1));
  hands.sweep.on = raised * P.write;
  hands.sweep.lift = SWEEP.top + (SWEEP.bottom - SWEEP.top) * writeLine;
  drawSheet(page.g, writeWords[sheetCount % writeWords.length], Math.max(0, writeLine * 1.08 - 0.04));
  page.tex.needsUpdate = true;
}

// Where his eyes go at a sheet, blended over `look` by how much each prop shows.
export function lookAtSheet(look) {
  // Reading: eyes run along a line, snap back for the next one a bit lower,
  // and start again at the top of each new sheet.
  readAlong(readLine, 5);
  look.x = THREE.MathUtils.lerp(look.x, -0.6 + 1.2 * reading.along, P.scan);
  look.y = THREE.MathUtils.lerp(look.y, -0.2 - reading.line * 0.13, P.scan);
  // Searching: eyes on the search bar, then reading down the results once
  // they've loaded, one line per result.
  readAlong(webSkim, WEB.results);
  const loaded = webSkim > 0;
  look.x = THREE.MathUtils.lerp(look.x, loaded ? -0.6 + 1.2 * reading.along : -0.3, P.web);
  look.y = THREE.MathUtils.lerp(look.y, loaded ? -0.3 - reading.line * 0.15 : -0.15, P.web);
  // Running a command: eyes on the newest output at the bottom of the window.
  look.x = THREE.MathUtils.lerp(look.x, -0.2, P.term);
  look.y = THREE.MathUtils.lerp(look.y, -0.55, P.term);
  // Writing: eyes follow his hand down the page as the code fills in.
  look.x = THREE.MathUtils.lerp(look.x, -0.15, P.write);
  look.y = THREE.MathUtils.lerp(look.y, 0.1 - writeLine * 0.75, P.write);
}
