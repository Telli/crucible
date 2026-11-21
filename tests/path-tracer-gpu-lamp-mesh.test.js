import assert from 'node:assert/strict';
import test from 'node:test';
import { box } from '../src/geometry.js';
import { buildTraceScene } from '../src/path-tracer-scene.js';
import { LAMP_LIGHTS_SLOT, packMaterials } from '../src/path-tracer-gpu-pack.js';
import { MATERIAL_TEXELS } from '../src/path-tracer-gpu-shader.js';
import { POINT_FIRST_BIT } from '../src/light-link-bits.js';

// A glowing mesh drawn around its own point light is the lamp, not an obstacle to it (#2299): the GPU kernel marks, per part, which
// point lights' shadow rays pass through it. A shade that does not glow still blocks.

const LAMP_POSITION = [0, 2, 0];

function partAt(name, translation, scale, material) {
  const matrix = new Float32Array([scale, 0, 0, 0, 0, scale, 0, 0, 0, 0, scale, 0, ...translation, 1]);
  return { name, geometry: box(0, 1), matrix, material };
}

const bulb = partAt('bulb', LAMP_POSITION, 0.4, { color: [1, 0.8, 0.5], emission: 3 });
const shade = partAt('shade', LAMP_POSITION, 0.4, { color: [0.8, 0.8, 0.8], emission: 0 });
const glowAway = partAt('glow-away', [2, 2, 0], 0.4, { color: [1, 1, 1], emission: 3 });
const environment = { pointLights: [{ position: LAMP_POSITION, intensity: 8, radius: 0.05 }, { position: [5, 2, 0], intensity: 8 }] };

test('an emissive part whose bounds hold a point light is that light\'s own lamp mesh', () => {
  const scene = buildTraceScene([bulb, shade, glowAway], environment);
  assert.deepEqual(Array.from(scene.lampLightMasks), [1 << POINT_FIRST_BIT, 0, 0]);
});

test('a scene with no lamp mesh carries no mask', () => {
  assert.equal(buildTraceScene([shade, glowAway], environment).lampLightMasks, null);
});

test('the material table carries the lamp bits of each part for the kernel', () => {
  const scene = buildTraceScene([shade, bulb], environment);
  const table = packMaterials(scene.materials, { placements: new Map() }, scene.shadowOnlyParts, scene.lampLightMasks);
  assert.equal(table.data[0 * MATERIAL_TEXELS * 4 + LAMP_LIGHTS_SLOT], 0);
  assert.equal(table.data[1 * MATERIAL_TEXELS * 4 + LAMP_LIGHTS_SLOT], 1 << POINT_FIRST_BIT);
});
