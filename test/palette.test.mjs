import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paletteFrom, hexToOklch, L_MIN, L_MAX, DEFAULT_COLOR, DEFAULT_LIT } from '../src/palette.js';

const ORIGINAL = {
  shade: '#ff8642', lit: '#ffdc9c', sheen: '#ffd6b8', glow: '#ff6a20', freckle: '#d4572a',
  dot: '#e0703c', label: '#c2622c', ring: '#ff9a5c', halo: '#ff6e28', paper: '#fff4e0', ink: '#b58f6c', faint: '#c9a888',
};
const L = (hex) => hexToOklch(hex)[0];

test('the default orange and cream give back the original palette', () => {
  const p = paletteFrom(DEFAULT_COLOR, DEFAULT_LIT);
  assert.deepEqual({ ...p, sheen: ORIGINAL.sheen }, ORIGINAL);
  // The sheen is derived on the base's own hue now, a hair off the original.
  assert.ok(Math.abs(hexToOklch(p.sheen)[0] - hexToOklch(ORIGINAL.sheen)[0]) < 0.01);
});

test('the bubble label stays dark enough to read on light picks', () => {
  for (const base of ['#ffd23f', '#fff4e0', '#ffffff', '#ff6fa8']) assert.ok(L(paletteFrom(base).label) <= 0.63, base);
});

test('the thought bubble and Z paper follows the lit side', () => {
  const purple = paletteFrom('#9a5cff');
  assert.ok(Math.abs(hexToOklch(purple.paper)[2] - hexToOklch(purple.lit)[2]) < 5);
});

test('a picked lit side is used as is', () => {
  assert.equal(paletteFrom('#3a7bff', '#FFDC9C').lit, '#ffdc9c');
  assert.equal(paletteFrom('#3a7bff', 'nope').lit, paletteFrom('#3a7bff').lit);
});

test('a bad base falls back to the default', () => {
  assert.deepEqual(paletteFrom('orange'), paletteFrom(DEFAULT_COLOR));
});

test('the lit side stays clearly lighter than the shade, even on extreme picks', () => {
  for (const base of ['#ffffff', '#fff4e0', '#ffd23f', '#000000', '#1a1420', '#3a7bff', '#888888']) {
    const p = paletteFrom(base);
    assert.ok(L(p.shade) >= L_MIN - 0.01 && L(p.shade) <= L_MAX + 0.01, `${base} shade lightness`);
    assert.ok(L(p.lit) - L(p.shade) >= 0.11, `${base} lit/shade gap`);
  }
});

test('the derived lit side and sheen keep the base hue', () => {
  for (const base of ['#ff8642', '#e03040', '#ff6fa8', '#ffd23f', '#2fbf71', '#3a7bff', '#9a5cff']) {
    const p = paletteFrom(base);
    const h = hexToOklch(base)[2];
    for (const k of ['lit', 'sheen']) assert.ok(Math.abs(hexToOklch(p[k])[2] - h) < 3, `${base} ${k}`);
  }
});

test('freckles keep their color except where they would vanish', () => {
  assert.equal(paletteFrom('#3a7bff').freckle, ORIGINAL.freckle);
  for (const base of ['#d4572a', '#e03040', '#c85030']) assert.notEqual(paletteFrom(base).freckle, ORIGINAL.freckle, base);
});
