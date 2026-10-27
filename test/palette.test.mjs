import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paletteFrom, hexToOklch, L_MIN, L_MAX, DEFAULT_COLOR } from '../src/palette.js';

const ORIGINAL = { shade: '#ff8642', lit: '#ffdc9c', sheen: '#ffd6b8', glow: '#ff6a20', freckle: '#d4572a' };
const L = (hex) => hexToOklch(hex)[0];

test('the default base gives back the original palette', () => {
  assert.deepEqual(paletteFrom(DEFAULT_COLOR), ORIGINAL);
});

test('a bad base falls back to the default', () => {
  assert.deepEqual(paletteFrom('orange'), ORIGINAL);
});

test('the lit side stays clearly lighter than the shade, even on extreme picks', () => {
  for (const base of ['#ffffff', '#fff4e0', '#ffd23f', '#000000', '#1a1420', '#3a7bff', '#888888']) {
    const p = paletteFrom(base);
    assert.ok(L(p.shade) >= L_MIN - 0.01 && L(p.shade) <= L_MAX + 0.01, `${base} shade lightness`);
    assert.ok(L(p.lit) - L(p.shade) >= 0.11, `${base} lit/shade gap`);
  }
});

test('the lit side leans toward yellow unless lit is own', () => {
  const blue = hexToOklch('#3a7bff')[2];
  assert.ok(hexToOklch(paletteFrom('#3a7bff').lit)[2] < blue - 10);
  assert.ok(Math.abs(hexToOklch(paletteFrom('#3a7bff', { lit: 'own' }).lit)[2] - blue) < 3);
});

test('freckles keep their color except where they would vanish', () => {
  assert.equal(paletteFrom('#3a7bff').freckle, ORIGINAL.freckle);
  for (const base of ['#d4572a', '#e03040', '#c85030']) assert.notEqual(paletteFrom(base).freckle, ORIGINAL.freckle, base);
});
