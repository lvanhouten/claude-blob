import { api, params } from './env.js';
import { cel } from './scene.js';
import { bodyMat } from './materials.js';
import { freckleMat } from './face.js';
import { paletteFrom, isHex } from './palette.js';

// His body color: one picked base (the shade side), the rest derived from it.
// Set live from the Color picker, or by ?color=<hex> (and ?lit=own) in previews.
const LIT = params.get('lit') === 'own' ? 'own' : 'warm';

function setColor(base) {
  const p = paletteFrom(base, { lit: LIT });
  cel.uShadeColor.value.set(p.shade);
  cel.uLitColor.value.set(p.lit);
  bodyMat.sheenColor.set(p.sheen);
  bodyMat.emissive.set(p.glow);
  freckleMat.color.set(p.freckle);
}

const preview = '#' + (params.get('color') ?? '').replace(/^#/, '');
if (isHex(preview)) setColor(preview);
else api.onColor(setColor); // a ?color= preview wins
