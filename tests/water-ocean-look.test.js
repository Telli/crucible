import './support/load-agent-scene-modules.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentScene } from '../src/agent-scene.js';
import { defaultSmoothAngle, OCEAN_SMOOTH_ANGLE_DEFAULT } from '../src/agent-mesh.js';
import { MESH_SMOOTH_ANGLE_DEFAULT } from '../src/agent-scene-capabilities.js';
import { createFragmentShader } from '../src/shaders.js';
import '../src/world-material-shader.js';
import { layerTextureSupport } from '../src/shader-registry.js';

function seaRecipe({ tag, smoothAngle, inStack = false }) {
  const edits = [
    { op: 'delete', select: { not: { normal: [0, 1, 0], maxAngle: 10 } } },
    { op: 'subdivide_edges', edges: { all: true }, cuts: 4 },
    { op: 'subdivide', levels: 2 },
    { op: 'set_position', position: { mul: [{ attr: 'position' }, [100, 1, 100]] } },
  ];
  const ocean = { op: 'ocean', windSpeed: 16, choppiness: 1.5, size: 50, seed: 3, resolution: 3, foamMemory: 2 };
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
  assert.ok(shader.includes("float foamBand = mix(0.13, 0.0, foamHard) + 1.5 * fwidth(foamDensity)"));
  assert.match(shader, /rippleTilt\.xz \+= detailSlope/);
  assert.match(shader, /terrainNoise\(position \* wavenumber \* 0\.09/);
  assert.match(shader, /1\.0 \/ \(1\.0 \/ 500\.0 \+ 0\.35 \* waterLostVariance\)/);
  assert.match(shader, /terrainNoise\(crestPosition \* vec2\(3\.1, 14\.0\)/);
});

test('a ripple stays whole down to five pixels per wave and is gone at the two-pixel limit of the sampling', () => {
  const shader = createFragmentShader(['water', 'vertexColors']);
  const fade = shader.match(/float visible = 1\.0 - smoothstep\(([\d.]+), ([\d.]+), footprint \* wavenumber/);
  assert.ok(fade, 'the detail slope fades each wave by its pixel footprint');
  const fadeStart = Number(fade[1]);
  const fadeEnd = Number(fade[2]);
  // footprint * wavenumber / 2pi is the pixel size in wavelengths: 0.2 is five pixels per wave, 0.5 is the Nyquist limit.
  assert.equal(fadeStart, 0.2, 'the fade starts at five pixels per wavelength');
  assert.equal(fadeEnd, 0.5, 'the fade ends at two pixels per wavelength, the sampling limit');
  assert.ok(fadeStart < fadeEnd, 'the fade runs from a smaller to a larger footprint');
});

test('a hard foam edge is a flat shape with a one pixel edge, and the soft default keeps its lace', () => {
  const shader = createFragmentShader(['water', 'vertexColors']);
  assert.match(shader, /uniform vec2 waterFoamStyle/);
  assert.match(shader, /float foamHard = waterFoamStyle.x/);
  assert.ok(shader.includes("waterFoam = mix(max(foamBody"));
});

function waterRecipe(fields) {
  const recipe = seaRecipe({ tag: 'water' });
  Object.assign(recipe.materials[0], fields);
  return recipe;
}

test('a water material takes foamEdge and foamWidth, and other materials refuse them', () => {
  const material = createAgentScene(waterRecipe({ foamEdge: 'hard', foamWidth: 2 })).parts[0].material;
  assert.equal(material.foamEdge, 'hard');
  assert.equal(material.foamWidth, 2);
  assert.equal(createAgentScene(waterRecipe({})).parts[0].material.foamEdge, undefined);
  for (const bad of [{ foamEdge: 'sharp' }, { foamWidth: 0 }, { foamWidth: 5 }, { foamWidth: 'wide' }]) {
    assert.throws(() => createAgentScene(waterRecipe(bad)), /foamEdge|foamWidth/, JSON.stringify(bad));
  }
  const plain = seaRecipe({});
  plain.materials[0].foamEdge = 'hard';
  assert.throws(() => createAgentScene(plain), /need the water tag/);
});

test('a water material takes foamVeins with defaults, and refuses bad values with what to pass', () => {
  const defaults = createAgentScene(waterRecipe({ foamVeins: {} })).parts[0].material.foamVeins;
  assert.deepEqual({ ...defaults }, { amount: 0.6, scale: 1 });
  const given = createAgentScene(waterRecipe({ foamVeins: { amount: 1, scale: 2 } })).parts[0].material.foamVeins;
  assert.deepEqual({ ...given }, { amount: 1, scale: 2 });
  assert.equal(createAgentScene(waterRecipe({})).parts[0].material.foamVeins, undefined);
  const refusals = [
    [{ foamVeins: 0.5 }, /foamVeins must be an object such as/],
    [{ foamVeins: { strength: 1 } }, /no field strength; pass amount or scale/],
    [{ foamVeins: { amount: 2 } }, /foamVeins\.amount must be a number from 0 to 1, such as 0\.6/],
    [{ foamVeins: { scale: 0.1 } }, /foamVeins\.scale must be a number from 0\.25 to 4/],
    [{ foamVeins: { stretch: 3 } }, /no field stretch; pass amount or scale/],
    [{ foamVeins: { scale: 'fine' } }, /foamVeins\.scale/],
  ];
  for (const [bad, message] of refusals) {
    assert.throws(() => createAgentScene(waterRecipe(bad)), message, JSON.stringify(bad));
  }
  const plain = seaRecipe({});
  plain.materials[0].foamVeins = {};
  assert.throws(() => createAgentScene(plain), /foamVeins need the water tag/);
});

test('foam veins are a ridged, warped streak mask gated on amount and the foam mask, so off draws nothing', () => {
  const shader = createFragmentShader(['water', 'vertexColors']);
  assert.match(shader, /uniform vec2 waterFoamVeins/);
  assert.ok(shader.includes('if (waterFoamVeins.x > 0.0) {'), 'amount 0 skips the veins');
  assert.ok(shader.includes('float veinRidge = 1.0 - abs(2.0 * terrainNoise('), 'ridged noise makes the lines');
  assert.ok(shader.includes('veinWarp'), 'a second noise warps them');
  assert.ok(shader.includes('float veinTrail = smoothstep(0.0, 0.8, clamp(1.0 - vertexSkyVisibility, 0.0, 1.0))'), 'the reach reads the whole foam group, not only the crest cap mask, so lace trails out');
  assert.ok(/float veinFade = smoothstep\(0\.0, 0\.6, veinTrail[^;]*veinPatch/.test(shader), 'a slow noise breaks the trail into patches as the foam weight falls');
  assert.ok(shader.includes('waterFoam = max(waterFoam, veinLine * veinFade * waterFoamVeins.x)'), 'veins only add foam');
  assert.ok(!/float veinReach/.test(shader), 'the reach is no longer gated by the crest cap mask');
  const veinPosition = shader.match(/vec2 veinPosition = ([^;]+);/)[1];
  assert.equal(veinPosition, 'worldPosition.xz * 4.0 * waterFoamVeins.y', 'one scalar step on the world position, the same in every direction');
  assert.ok(!veinPosition.includes('crestPosition'), 'no frame that turns with the surface normal, which smears the veins');
  assert.ok(!/vec2\(/.test(veinPosition), 'no per axis factor: veins are not stretched along one axis');
  assert.ok(!/veinPosition \* vec2\(|veinPosition\.[xy] \*|vec2\([^)]*\) \* veinPosition/.test(shader), 'the ridge noise is not scaled per axis either');
});

test('a water batch sends its veins, and a batch without foamVeins sends amount 0', () => {
  const sent = [];
  const renderer = {
    shaderFeatures: new Set(['water']),
    program: {},
    batches: [],
    context: new Proxy({}, {
      get: (_target, name) => {
        if (name === 'getUniformLocation') return (_program, uniform) => uniform;
        if (name === 'uniform2f') return (uniform, ...values) => uniform === 'waterFoamVeins' && sent.push(values);
        return () => null;
      },
    }),
  };
  const bind = (material) => layerTextureSupport.bind(renderer, {}, {}, { parts: [{ material }] });
  bind({ tag: 'water', foamVeins: { amount: 0.9, scale: 2 } });
  bind({ tag: 'water' });
  assert.deepEqual(sent, [[0.9, 2], [0, 1]]);
});
