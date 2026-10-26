import * as THREE from 'three';
import { params } from './env.js';
import { body, cel } from './scene.js';
import { geo } from './surface.js';

function celShade(shader) {
  Object.assign(shader.uniforms, cel);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>
      uniform vec3 uLightDir;
      uniform vec3 uLitColor;
      uniform vec3 uShadeColor;
      uniform float uBand;`)
    .replace('#include <color_fragment>', `#include <color_fragment>
      {
        float lit = dot(normalize(vNormal), uLightDir);
        diffuseColor.rgb *= mix(uShadeColor, uLitColor, smoothstep(uBand - 0.06, uBand + 0.06, lit));
      }`);
}

export const bodyMat = new THREE.MeshPhysicalMaterial({
  roughness: 0.38,
  clearcoat: 1,
  clearcoatRoughness: 0.1,
  sheen: 0.35,
  sheenColor: new THREE.Color('#ffd6b8'),
  sheenRoughness: 0.45,
  emissive: new THREE.Color('#ff6a20'),
  emissiveIntensity: 0.06,
});
// Comic halftone: pale dots growing toward the shadowed side and the
// silhouette. The grid lives in screen space, centered on the blob and sized to
// it, so it follows the blob around but never stretches with its shape.
export const HALFTONE_DOTS_PER_UNIT = 15;
// width stretches the wave's crests apart, speed is how fast they sweep across
// the screen; both relative to the original wave (?wave=old).
export const HALFTONE_WAVE = params.get('wave') === 'old' ? { width: 1, speed: 1 } : { width: 1.6, speed: 1.8 };
// Edge light: a thin warm sheen along the silhouette, strongest on the side
// away from the key light. ?rim=0 turns it off.
const RIM = params.get('rim') === '0' ? 0 : 1;
export const halftone = {
  uHalftone: { value: 1 },
  uWaveK: { value: new THREE.Vector2(0.38, -0.26).divideScalar(HALFTONE_WAVE.width) },
  uRim: { value: RIM },
  uCenter: { value: new THREE.Vector2() }, // blob center, in drawing-buffer pixels
  uCell: { value: 6 },                     // dot spacing, in drawing-buffer pixels
  uTime: { value: 0 },
};
bodyMat.onBeforeCompile = (shader) => {
  celShade(shader);
  Object.assign(shader.uniforms, halftone);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>
      uniform float uHalftone;
      uniform vec2 uCenter;
      uniform float uCell;
      uniform float uTime;
      uniform vec2 uWaveK;
      uniform float uRim;`)
    .replace('#include <opaque_fragment>', `
      {
        vec2 p = (gl_FragCoord.xy - uCenter) / uCell;
        float d = length(fract(p) - 0.5);
        vec3 n = normalize(normal);
        float shade = 0.5 - 0.5 * dot(n, uLightDir);
        float rim = 1.0 - abs(dot(n, normalize(vViewPosition)));
        float amt = clamp(0.12 + shade * 0.85 + rim * 0.4, 0.0, 1.0) * uHalftone;
        // A wave washes diagonally over the grid; each dot swells as it passes.
        float wave = 0.5 + 0.5 * sin(dot(floor(p) + 0.5, uWaveK) - uTime);
        amt = clamp(amt * (0.3 + 1.1 * wave * wave), 0.0, 1.0);
        float r = 0.44 * sqrt(amt);
        float aa = fwidth(d);
        float dotMask = 1.0 - smoothstep(r - aa, r + aa, d);
        outgoingLight = mix(outgoingLight, vec3(0.95, 0.8, 0.6), dotMask * 0.8);
        float edge = smoothstep(0.5, 0.8, rim);
        float away = 0.5 - 0.5 * dot(normalize(n.xy + 1e-4), normalize(uLightDir.xy + 1e-4));
        outgoingLight = mix(outgoingLight, vec3(1.0, 0.95, 0.86), edge * mix(0.35, 1.0, away) * uRim);
      }
      #include <opaque_fragment>`);
};
body.add(new THREE.Mesh(geo, bodyMat));

// Matte, with no reflections of the room, so the only shine is the two painted
// catch-lights; glossy eyes picked up extra glints that cluttered them.
export const eyeMat = new THREE.MeshStandardMaterial({ color: '#0d0705', roughness: 0.9, envMapIntensity: 0 });
export const sparkleMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
