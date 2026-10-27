import { api, params } from './env.js';
import { cel } from './scene.js';
import { bodyMat } from './materials.js';
import { freckleMat } from './face.js';
import { paletteFrom, isHex } from './palette.js';

// His body color: a picked base (the shade side) and optionally a picked lit
// side; the rest is derived. Set live from the Color picker, or by
// ?color=<hex> (and ?lit=<hex>) in previews.
function setColor({ color, lit }) {
  const p = paletteFrom(color, lit);
  cel.uShadeColor.value.set(p.shade);
  cel.uLitColor.value.set(p.lit);
  bodyMat.sheenColor.set(p.sheen);
  bodyMat.emissive.set(p.glow);
  freckleMat.color.set(p.freckle);
}

const hexParam = (name) => '#' + (params.get(name) ?? '').replace(/^#/, '');
if (isHex(hexParam('color'))) setColor({ color: hexParam('color'), lit: hexParam('lit') });
else api.onColor(setColor); // a ?color= preview wins
