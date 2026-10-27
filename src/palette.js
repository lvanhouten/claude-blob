// Body colors from one picked base color. The base is the shade side; the lit
// side, sheen and glow are offsets from it, measured from the original orange
// palette, and stay on the base's own hue. The lit side can also be picked by
// hand; the default is the original orange with its cream lit side, as such a
// pick (DEFAULT_LIT). The math runs in
// OKLCH so lightness stays even across hues (in HSL a blue at the same
// "lightness" as an orange looks much darker). No three.js here, so it runs in
// the picker window and in node tests too.

export const DEFAULT_COLOR = '#ff8642';
export const DEFAULT_LIT = '#ffdc9c';

// The original palette, and the freckles, which stay this color wherever they can.
const ORIGINAL = { shade: DEFAULT_COLOR, lit: DEFAULT_LIT, sheen: '#ffd6b8', glow: '#ff6a20' };
const FRECKLE = '#d4572a';

// Lightness limits. The lit side sits as far above the base as in the original
// palette, but no higher than LIT_MAX; on light picks the gap shrinks to at
// least MIN_GAP, so the cream/shade split never collapses. L_MIN keeps very
// dark picks from going muddy.
export const L_MIN = 0.45;
const LIT_MAX = 0.97;
const MIN_GAP = 0.12;
export const L_MAX = LIT_MAX - MIN_GAP;
// Freckles must stay at least this far (OKLab distance) from the shade color.
const FRECKLE_MIN_DE = 0.1;

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
const wrap = (h) => ((h % 360) + 540) % 360 - 180; // to -180..180

function hexToOklab(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map((c) => toLinear(c / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

// Linear sRGB, possibly out of gamut.
function oklchToLinear([L, C, H]) {
  const a = C * Math.cos((H * Math.PI) / 180);
  const b = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const inGamut = (lch) => oklchToLinear(lch).every((c) => c >= -1e-4 && c <= 1 + 1e-4);

export function hexToOklch(hex) {
  const [L, a, b] = hexToOklab(hex);
  const C = Math.hypot(a, b);
  return [L, C, C < 1e-4 ? 0 : ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360];
}

// Out-of-gamut colors keep their lightness and hue and lose chroma until they fit.
export function oklchToHex([L, C, H]) {
  L = Math.min(1, Math.max(0, L));
  if (!inGamut([L, C, H])) {
    let lo = 0;
    for (let i = 0; i < 20; i++) {
      const mid = (lo + C) / 2;
      if (inGamut([L, mid, H])) lo = mid;
      else C = mid;
    }
    C = lo;
  }
  const rgb = oklchToLinear([L, C, H]).map((c) => Math.round(255 * toGamma(Math.min(1, Math.max(0, c)))));
  return '#' + rgb.map((c) => c.toString(16).padStart(2, '0')).join('');
}

export const isHex = (s) => typeof s === 'string' && /^#[0-9a-f]{6}$/i.test(s);

const base0 = hexToOklch(ORIGINAL.shade);
const OFFSETS = Object.fromEntries(['lit', 'sheen', 'glow'].map((k) => {
  const [L, C, H] = hexToOklch(ORIGINAL[k]);
  return [k, { dL: L - base0[0], kC: C / base0[1], dH: wrap(H - base0[2]) }];
}));

// The base as it will actually be used: lightness clamped to L_MIN..L_MAX.
export function clampBase(hex) {
  const [L, C, H] = hexToOklch(hex);
  const clamped = Math.min(L_MAX, Math.max(L_MIN, L));
  return clamped === L ? hex.toLowerCase() : oklchToHex([clamped, C, H]);
}

// Freckles keep their color, unless it's too close to the shade side (red or
// pink picks); then only their lightness moves, away from the shade's.
function freckleFor(shade) {
  const s = hexToOklab(shade);
  const [L, C, H] = hexToOklch(FRECKLE);
  const dir = s[0] > L ? -1 : 1;
  for (let dL = 0; dL <= 0.5; dL += 0.01) {
    const hex = oklchToHex([L + dir * dL, C, H]);
    const f = hexToOklab(hex);
    if (Math.hypot(f[0] - s[0], f[1] - s[1], f[2] - s[2]) >= FRECKLE_MIN_DE) return hex;
  }
  return FRECKLE;
}

// lit: a hand-picked lit side, used as is; leave it out to derive one. The
// derived lit side and sheen keep the base's hue (the original cream leaned
// toward yellow, which only suits oranges); the glow keeps its original slight
// shift toward red.
export function paletteFrom(base, lit = null) {
  const shade = clampBase(isHex(base) ? base : DEFAULT_COLOR);
  const [L, C, H] = hexToOklch(shade);
  const derive = ({ dL, kC, dH }, l = L + dL) => oklchToHex([l, C * kC, H + dH]);
  const litL = Math.max(L + MIN_GAP, Math.min(LIT_MAX, L + OFFSETS.lit.dL));
  return {
    shade,
    lit: isHex(lit) ? lit.toLowerCase() : derive({ ...OFFSETS.lit, dH: 0 }, litL),
    sheen: derive({ ...OFFSETS.sheen, dH: 0 }, Math.min(litL, L + OFFSETS.sheen.dL)),
    glow: derive(OFFSETS.glow),
    freckle: freckleFor(shade),
  };
}
