import './support/load-agent-scene-modules.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentScene } from '../src/agent-scene.js';
import { defaultSmoothAngle, OCEAN_SMOOTH_ANGLE_DEFAULT } from '../src/agent-mesh.js';
import { MESH_SMOOTH_ANGLE_DEFAULT } from '../src/agent-scene-capabilities.js';
import { createFragmentShader } from '../src/shaders.js';
import '../src/world-material-shader.js';

function seaRecipe({ tag, smoothAngle, inStack = false }) {
  const edits = [
    { op: 'delete', select: { not: { normal: [0, 1, 0], maxAngle: 10 } } },
    { op: 'subdivide_edges', edges: { all: true }, cuts: 4 },
    { op: 'subdivide', levels: 2 },
    { op: 'set_position', position: { mul: [{ attr: 'position' }, [100, 1, 100]] } },
  ];
  const ocean = { op: 'ocean', windSpeed: 16, choppiness: 1.5, size: 50, seed: 3, resolution: 3 };
  return {
    format: 'crucible.scene', schemaVersion: 1,
    geometries: [{ id: 'sea', type: 'mesh', base: { type: 'box', bevel: 0 }, edits: inStack ? edits : [...edits, ocean], stack: inStack ? [ocean] : [], ...(smoothAngle === undefined ? {} : { smoothAngle }) }],
    materials: [{ id: 'surface', color: [0.1, 0.2, 0.3], ...(tag ? { tag } : {}) }],
    nodes: [{ id: 'sea', geometry: 'sea', material: 'surface' }],
  };
}

test('a water part of an ocean mesh carries 1 - foam in its sky visibility channel', () => {
  const water = createAgentScene(seaRecipe({ tag: 'water' })).parts[0].geometry;
  const foam = water.vertexGroups.foam;
  assert.ok(foam.some(weight => weight > 0.05), 'the sea folds somewhere');
  assert.equal(water.skyVisibility.length, foam.length);
  assert.ok(water.skyVisibility.every((value, index) => Math.abs(value - (1 - foam[index])) < 1e-6));
});

test('a part that is not water keeps its geometry untouched', () => {
  const plain = createAgentScene(seaRecipe({})).parts[0].geometry;
  assert.equal(plain.skyVisibility, undefined);
});

test('ocean output smooths over 180 degrees unless the recipe says otherwise', () => {
  assert.equal(defaultSmoothAngle([{ op: 'ocean' }], []), OCEAN_SMOOTH_ANGLE_DEFAULT);
  assert.equal(defaultSmoothAngle([], [{ op: 'ocean' }]), 180);
  assert.equal(defaultSmoothAngle([{ op: 'subdivide' }], []), MESH_SMOOTH_ANGLE_DEFAULT);
  const defaulted = createAgentScene(seaRecipe({ tag: 'water' })).parts[0].geometry;
  const stacked = createAgentScene(seaRecipe({ tag: 'water', inStack: true })).parts[0].geometry;
  const split = createAgentScene(seaRecipe({ tag: 'water', smoothAngle: 0 })).parts[0].geometry;
  assert.equal(defaulted.positions.length, stacked.positions.length, 'edit and stack give the same welded render mesh');
  assert.ok(split.positions.length > defaulted.positions.length, 'an explicit smoothAngle is still honoured');
});

test('the water shader reads the foam mask, a fresnel sky and a sun glint', () => {
  const shader = createFragmentShader(['water', 'vertexColors']);
  assert.match(shader, /float foamMask = clamp\(2\.0 \* \(1\.0 - vertexSkyVisibility\)/);
  assert.match(shader, /float reflectivity = \(0\.02 \+ 0\.98 \* pow\(1\.0 - cosine, 5\.0\)\)/);
  assert.match(shader, /pow\(max\(dot\(normal, halfVector\), 0\.0\), glintSharpness\)/);
  assert.match(shader, /normal = normalize\(normal \+ rippleTilt\)/);
});

test('the ocean foam of a rough sea reaches the water material as 1 - foam', () => {
  const water = createAgentScene(seaRecipe({ tag: 'water' })).parts[0].geometry;
  const foam = water.vertexGroups.foam;
  const whitecaps = foam.filter(weight => weight > 0.05).length;
  assert.ok(whitecaps > 0, 'a rough sea has vertices with foam');
  assert.ok(Math.min(...water.skyVisibility) < 0.95, 'the foam reaches the shader as a lower sky visibility');
  assert.equal(water.skyVisibility.filter(value => value < 0.95).length, whitecaps);
});

test('wind ripples break the glint into facets and the foam into streaks', () => {
  const shader = createFragmentShader(['water', 'vertexColors']);
  assert.match(shader, /vec2 waterDetailSlope\(/);
  assert.match(shader, /float foamBand = 0\.13 \+ 1\.5 \* fwidth\(foamDensity\)/);
  assert.match(shader, /rippleTilt\.xz \+= detailSlope/);
  assert.match(shader, /terrainNoise\(position \* wavenumber \* 0\.09/);
  assert.match(shader, /1\.0 \/ \(1\.0 \/ 500\.0 \+ 0\.35 \* waterLostVariance\)/);
  assert.match(shader, /terrainNoise\(crestPosition \* vec2\(3\.1, 14\.0\)/);
});

// The GLSL function is plain scalar math, so its text runs as JavaScript once the types and the three built-ins are renamed.
function waterWaveVisibilityOf(shader) {
  const source = shader.match(/float waterWaveVisibility\(float footprint, float wavenumber\) \{([^}]*)\}/);
  assert.ok(source, 'the shader has waterWaveVisibility(footprint, wavenumber)');
  const body = source[1].replace(/\bfloat\b/g, 'let').replace(/\bsin\(/g, 'Math.sin(');
  const clamp = (value, lowest, highest) => Math.min(Math.max(value, lowest), highest);
  return new Function('clamp', 'footprint', 'wavenumber', body).bind(null, clamp);
}

test('a pixel keeps a wave scaled by the average over its own width, the limit a supersampled render converges to (#853)', () => {
  const shader = createFragmentShader(['water', 'vertexColors']);
  const visibility = waterWaveVisibilityOf(shader);
  const wavenumber = 2.1;
  const wavelength = (2 * Math.PI) / wavenumber;
  const sinc = pixelsPerWave => Math.sin(Math.PI / pixelsPerWave) / (Math.PI / pixelsPerWave);
  assert.ok(Math.abs(visibility(0, wavenumber) - 1) < 1e-6, 'a pixel far narrower than the wave shows all of it');
  for (const pixelsPerWave of [8, 5, 3, 2, 1.25]) {
    const footprint = wavelength / pixelsPerWave;
    assert.ok(Math.abs(visibility(footprint, wavenumber) - sinc(pixelsPerWave)) < 1e-6, `${pixelsPerWave} pixels per wave keep sinc of its width`);
  }
  assert.ok(visibility(wavelength / 2, wavenumber) > 0.6, 'at the two-pixel sampling limit a wave still shows, as an averaged wave, not a cut-off');
  assert.ok(Math.abs(visibility(wavelength, wavenumber)) < 1e-6, 'one pixel per wavelength averages the wave to nothing');
  assert.ok(Math.abs(visibility(wavelength * 20, wavenumber)) < 1e-6, 'finer waves stay at nothing instead of coming back as the sinc side lobes');
});

test('each detail wave is filtered by the pixel size along its own direction, and so are the two fixed swells', () => {
  const shader = createFragmentShader(['water', 'vertexColors']);
  assert.match(shader, /float footprint = abs\(dot\(positionDx, direction\)\) \+ abs\(dot\(positionDy, direction\)\);\n\s+float visible = waterWaveVisibility\(footprint, wavenumber\);/);
  assert.match(shader, /lostVariance \+= 0\.5 \* amplitude \* amplitude \* \(1\.0 - visible \* visible\)/);
  assert.match(shader, /float swellVisibleX = waterWaveVisibility\(abs\(positionDx\.x\) \+ abs\(positionDy\.x\), 1\.4\)/);
  assert.match(shader, /float swellVisibleZ = waterWaveVisibility\(abs\(positionDx\.y\) \+ abs\(positionDy\.y\), 1\.8\)/);
});
