import './support/load-agent-scene-modules.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAgentScene } from '../src/agent-scene.js';
import { surfaceMap } from '../src/material-surface-map.js';
import { createFragmentShader, createVertexShader, fragmentShader, vertexShader } from '../src/shaders.js';

// Every module is imported inside the tests, so a build without src/surface-cover.js fails each test at an assertion.
const loadCover = () => import('../src/surface-cover.js');

const RESOLUTION = 64;
const TEXEL_TOLERANCE = 1.5 / 255;

function recipeWith(material = {}) {
  return {
    format: 'crucible.scene',
    schemaVersion: 1,
    geometries: [{ id: 'rock', type: 'mesh', base: { type: 'sphere', segments: 16, rings: 8 } }],
    materials: [{ id: 'stone', color: [0.1, 0.1, 0.1], roughness: 0.9, ...material }],
    nodes: [{ id: 'rock', geometry: 'rock', material: 'stone' }],
  };
}

// Four flat quads in a two by two UV grid, each tilted from straight up by its own angle about the X axis.
const TILT_DEGREES = [0, 30, 60, 90];
function tiltedQuads() {
  const positions = [];
  const uvs = [];
  const indices = [];
  TILT_DEGREES.forEach((degrees, quad) => {
    const angle = degrees * Math.PI / 180;
    const column = quad % 2;
    const row = Math.floor(quad / 2);
    const corners = [[0, 0], [1, 0], [1, 1], [0, 1]];
    for (const [along, across] of corners) {
      positions.push(quad * 3 + along, across * Math.sin(angle), -across * Math.cos(angle));
      uvs.push((column + along) / 2, (row + across) / 2);
    }
    indices.push(quad * 4, quad * 4 + 1, quad * 4 + 2, quad * 4, quad * 4 + 2, quad * 4 + 3);
  });
  return { positions: Float32Array.from(positions), uvs: Float32Array.from(uvs), indices: Uint32Array.from(indices) };
}

function texelAt(map, u, v) {
  const column = Math.floor(u * map.width);
  const row = Math.floor(v * map.height);
  return map.data[(row * map.width + column) * 4] / 255;
}

function quadCentre(quad) {
  return [((quad % 2) + 0.5) / 2, (Math.floor(quad / 2) + 0.5) / 2];
}

test('normalizeSurfaceCover fills the defaults and freezes the result', async () => {
  const { normalizeSurfaceCover } = await loadCover();
  const cover = normalizeSurfaceCover({});
  assert.equal(cover.output, 'slope');
  assert.equal(cover.edge, 0.5);
  assert.equal(cover.softness, 0.1);
  assert.deepEqual(cover.color, [0.9, 0.92, 0.95]);
  assert.equal(cover.noise, undefined);
  assert.ok(Object.isFrozen(cover));
  const noisy = normalizeSurfaceCover({ output: 'height', range: [0, 12], noise: { scale: 0.5 } });
  assert.deepEqual(noisy.noise, { scale: 0.5, amount: 0.4, seed: 0 });
  assert.deepEqual(noisy.range, [0, 12]);
});

test('normalizeSurfaceCover says what to pass for bad input', async () => {
  const { normalizeSurfaceCover } = await loadCover();
  assert.throws(() => normalizeSurfaceCover({ output: 'curvature' }), /surfaceCover\.output: .*one of slope, normalY, height/);
  assert.throws(() => normalizeSurfaceCover({ output: 'height' }), /surfaceCover\.range: .*\[low, high\] in metres.*no mesh bounds/);
  assert.throws(() => normalizeSurfaceCover({ output: 'height', range: [3, 3] }), /surfaceCover\.range: .*low below high/);
  assert.throws(() => normalizeSurfaceCover({ range: [0, 1] }), /surfaceCover\.range: .*only applies to output "height"/);
  assert.throws(() => normalizeSurfaceCover({ edge: 2 }), /surfaceCover\.edge: .*0 to 1/);
  assert.throws(() => normalizeSurfaceCover({ softness: 0 }), /surfaceCover\.softness: .*0\.001 to 0\.5/);
  assert.throws(() => normalizeSurfaceCover({ color: [1, 1] }), /surfaceCover\.color: .*three numbers/);
  assert.throws(() => normalizeSurfaceCover({ noise: { scale: 0 } }), /surfaceCover\.noise\.scale: .*0\.01 to 1000/);
  assert.throws(() => normalizeSurfaceCover({ noise: { octaves: 8 } }), /surfaceCover\.noise\.octaves: .*one of the fields scale, amount, seed/);
  assert.throws(() => normalizeSurfaceCover({ space: 'object' }), /surfaceCover\.space: .*one of the fields/);
  assert.throws(() => normalizeSurfaceCover(5), /surfaceCover: .*an object/);
});

test('a recipe material takes surfaceCover on the surface tag only', () => {
  const scene = createAgentScene(recipeWith({ surfaceCover: { edge: 0.4 } }));
  assert.equal(scene.parts[0].material.surfaceCover.edge, 0.4);
  assert.equal(createAgentScene(recipeWith()).parts[0].material.surfaceCover, undefined);
  assert.throws(() => createAgentScene(recipeWith({ tag: 'unlit', surfaceCover: {} })), /surfaceCover: .*surface tag/);
  assert.throws(() => createAgentScene(recipeWith({ surfaceCover: { output: 'height' } })), /surfaceCover\.range/);
});

test('the CPU signal matches the baked slope and normalY maps on flat faces', async () => {
  const { normalizeSurfaceCover, surfaceCoverSignal } = await loadCover();
  const geometry = tiltedQuads();
  for (const output of ['slope', 'normalY']) {
    const cover = normalizeSurfaceCover({ output });
    const map = surfaceMap(geometry, { output, space: 'world' }, RESOLUTION, 'quads');
    TILT_DEGREES.forEach((degrees, quad) => {
      const baked = texelAt(map, ...quadCentre(quad));
      const upNormal = Math.cos(degrees * Math.PI / 180);
      const signal = surfaceCoverSignal(cover, upNormal, 0);
      const expected = output === 'slope' ? 1 - baked : baked;
      assert.ok(Math.abs(signal - expected) <= TEXEL_TOLERANCE, `${output} at ${degrees} degrees: shader ${signal}, baked ${expected}`);
    });
  }
});

test('the CPU signal matches the baked height map between a range', async () => {
  const { normalizeSurfaceCover, surfaceCoverSignal } = await loadCover();
  const geometry = tiltedQuads();
  const range = [0, 1];
  const cover = normalizeSurfaceCover({ output: 'height', range });
  const map = surfaceMap(geometry, { output: 'height', space: 'world', range }, RESOLUTION, 'quads');
  const [u, v] = quadCentre(3);
  const height = 0.5 * Math.sin(Math.PI / 2);
  assert.ok(Math.abs(surfaceCoverSignal(cover, 0, height) - texelAt(map, u, v)) <= 2 / RESOLUTION, 'within one texel of the height gradient');
});

test('the cover amount is a smooth step over the edge, widened by the filter width', async () => {
  const { normalizeSurfaceCover, surfaceCoverAmount } = await loadCover();
  const cover = normalizeSurfaceCover({ output: 'normalY', edge: 0.5, softness: 0.1 });
  const up = [0, 1, 0];
  assert.equal(surfaceCoverAmount(cover, [0, 0, 0], up), 1);
  assert.equal(surfaceCoverAmount(cover, [0, 0, 0], [0, -1, 0]), 0);
  assert.equal(surfaceCoverAmount(cover, [0, 0, 0], [1, 0, 0]), 0.5);
  const slightlyAbove = [Math.sqrt(0.99), 0.1, 0];
  const exactAmount = surfaceCoverAmount(cover, [0, 0, 0], slightlyAbove);
  const widenedAmount = surfaceCoverAmount(cover, [0, 0, 0], slightlyAbove, 1);
  assert.ok(exactAmount > 0.8 && widenedAmount < exactAmount - 0.05, `${exactAmount} then ${widenedAmount}`);
});

test('the noise breaks the edge up by at most amount around the signal and repeats for a seed', async () => {
  const { normalizeSurfaceCover, surfaceCoverAmount, surfaceCoverNoise } = await loadCover();
  const cover = normalizeSurfaceCover({ output: 'normalY', noise: { scale: 2, amount: 0.4, seed: 3 } });
  const samples = [];
  for (let step = 0; step < 200; step++) samples.push(surfaceCoverNoise([step * 0.37, step * 0.11, step * 0.53], cover.noise));
  assert.ok(Math.min(...samples) >= 0 && Math.max(...samples) <= 1);
  assert.ok(Math.max(...samples) - Math.min(...samples) > 0.3, 'the noise varies');
  const wall = [1, 0, 0];
  const amounts = new Set();
  for (let step = 0; step < 40; step++) amounts.add(surfaceCoverAmount(cover, [step * 0.6, 0, step * 0.3], wall).toFixed(3));
  assert.ok(amounts.size > 10, 'a wall at the edge shows ragged cover');
  assert.equal(surfaceCoverAmount(cover, [1.5, 2, 3], wall), surfaceCoverAmount(cover, [1.5, 2, 3], wall));
});

test('the cover code compiles into a program only when a material uses it', async () => {
  await loadCover();
  const without = createFragmentShader(['baseMap']);
  const withCover = createFragmentShader(['baseMap', 'surfaceCover']);
  assert.ok(!without.includes('materialCoverShape'));
  assert.ok(!createFragmentShader().includes('materialCoverShape'));
  assert.ok(!fragmentShader.includes('materialCoverShape'));
  assert.ok(!vertexShader.includes('materialCover') && !createVertexShader([]).includes('materialCover'));
  assert.ok(withCover.includes('uniform vec4 materialCoverShape'));
  assert.ok(withCover.includes('fwidth(coverSignal)'));
  assert.equal(withCover.split('coverNoise(').length - 1, 3, 'one definition and two octaves, a bounded cost');
});

test('the uniform vectors carry the cover, and the off marker without one', async () => {
  const { surfaceCoverUniformValues, normalizeSurfaceCover } = await loadCover();
  assert.deepEqual(surfaceCoverUniformValues(undefined).shape, [-1, 0, 0, 0]);
  const values = surfaceCoverUniformValues(normalizeSurfaceCover({ output: 'height', range: [2, 10], edge: 0.3, softness: 0.05, noise: { scale: 4, amount: 0.2, seed: 2 } }));
  assert.deepEqual(values.shape, [2, 0.3, 0.05, 0.2]);
  assert.deepEqual(values.noise, [4, 62, 2, 10]);
  assert.equal(values.look[3], 0.85);
});

// ---- round 2: the mask against an independent CPU reference (#3147) ----

const referenceSmoothstep = (low, high, value) => {
  const unit = Math.min(1, Math.max(0, (value - low) / (high - low)));
  return unit * unit * (3 - 2 * unit);
};

test('surfaceCoverSignal gives the baked slope, normalY and height values for known normals and heights', async () => {
  const { normalizeSurfaceCover, surfaceCoverSignal } = await loadCover();
  const slope = normalizeSurfaceCover({ output: 'slope' });
  assert.ok(Math.abs(surfaceCoverSignal(slope, 1, 0) - 1) < 1e-9);
  assert.ok(Math.abs(surfaceCoverSignal(slope, Math.cos(Math.PI / 3), 0) - (1 - 60 / 90)) < 1e-9);
  assert.ok(Math.abs(surfaceCoverSignal(slope, 0, 0)) < 1e-9);
  assert.ok(surfaceCoverSignal(slope, -1, 0) < -0.99, 'an overhang is below zero, never covered');
  const normalY = normalizeSurfaceCover({ output: 'normalY' });
  assert.equal(surfaceCoverSignal(normalY, 0.5, 0), 0.75);
  const height = normalizeSurfaceCover({ output: 'height', range: [10, 20] });
  assert.equal(surfaceCoverSignal(height, 0, 12.5), 0.25);
});

test('surfaceCoverAmount matches a hand written smoothstep over many normals', async () => {
  const { normalizeSurfaceCover, surfaceCoverAmount } = await loadCover();
  const cover = normalizeSurfaceCover({ output: 'slope', edge: 0.33, softness: 0.05 });
  for (let degrees = 0; degrees <= 180; degrees += 7.5) {
    const angle = degrees * Math.PI / 180;
    const normal = [Math.sin(angle) * 3, Math.cos(angle) * 3, 0];
    const expected = referenceSmoothstep(0.28, 0.38, 1 - angle / (Math.PI / 2));
    assert.ok(Math.abs(surfaceCoverAmount(cover, [0, 0, 0], normal) - expected) < 1e-9, `normal at ${degrees} degrees`);
  }
});

test('the signal comes from the interpolated vertex normal, which is continuous where a flat face normal jumps', async () => {
  const { normalizeSurfaceCover, surfaceCoverAmount } = await loadCover();
  const cover = normalizeSurfaceCover({ output: 'slope', edge: 0.4, softness: 0.05 });
  const scene = createAgentScene(recipeWith());
  const { positions, normals, indices } = scene.parts[0].geometry;
  let largestFlatStep = 0;
  for (let triangle = 0; triangle < indices.length / 3; triangle++) {
    const corner = index => [0, 1, 2].map(axis => normals[indices[triangle * 3 + index] * 3 + axis]);
    const vertexAmounts = [0, 1, 2].map(index => surfaceCoverAmount(cover, [0, 0, 0], corner(index)));
    const point = index => [0, 1, 2].map(axis => positions[indices[triangle * 3 + index] * 3 + axis]);
    const [first, second, third] = [point(0), point(1), point(2)];
    const flat = [0, 1, 2].map(axis => (second[(axis + 1) % 3] - first[(axis + 1) % 3]) * (third[(axis + 2) % 3] - first[(axis + 2) % 3]) - (second[(axis + 2) % 3] - first[(axis + 2) % 3]) * (third[(axis + 1) % 3] - first[(axis + 1) % 3]));
    largestFlatStep = Math.max(largestFlatStep, Math.abs(surfaceCoverAmount(cover, [0, 0, 0], flat) - vertexAmounts[0]));
    // On a sphere each vertex normal is the direction of the vertex itself, the smooth normal the cover must read.
    const direction = point(0);
    const length = Math.hypot(...direction);
    const analytic = surfaceCoverAmount(cover, [0, 0, 0], direction.map(value => value / length));
    assert.ok(Math.abs(analytic - vertexAmounts[0]) < 0.02, 'a vertex normal of the sphere points along its position');
  }
  assert.ok(largestFlatStep > 0, 'the flat normal is a different signal');
});

test('the filter width widens the edge to about a pixel but never past the cap', async () => {
  const { surfaceCoverHalfWidth, SURFACE_COVER_FILTER_CAP } = await loadCover();
  assert.equal(surfaceCoverHalfWidth(0.02, 0.01), 0.02);
  assert.ok(Math.abs(surfaceCoverHalfWidth(0.02, 0.05) - 0.025) < 1e-12);
  assert.ok(Math.abs(surfaceCoverHalfWidth(0.02, 5) - SURFACE_COVER_FILTER_CAP * 0.02) < 1e-12, 'a crease in the normals must not smear a wide band');
});

test('surfaceCoverFromGraphMask makes the cover cover the same share as the graph mask plus layer gate', async () => {
  const { surfaceCoverFromGraphMask, normalizeSurfaceCover, surfaceCoverAmount } = await loadCover();
  const { edge, softness } = surfaceCoverFromGraphMask({ low: 0.2, high: 0.46 });
  assert.ok(Math.abs(edge - 0.33) < 1e-6);
  assert.ok(Math.abs(softness - 0.0174) < 0.001, `softness ${softness}`);
  const cover = normalizeSurfaceCover({ output: 'normalY', edge, softness });
  let graphShare = 0;
  let coverShare = 0;
  let largestGap = 0;
  const samples = 1000;
  for (let sample = 0; sample < samples; sample++) {
    const signal = sample / (samples - 1);
    const graph = referenceSmoothstep(0.4, 0.6, referenceSmoothstep(0.2, 0.46, signal));
    const normalY = 2 * signal - 1;
    const amount = surfaceCoverAmount(cover, [0, 0, 0], [Math.sqrt(1 - normalY * normalY), normalY, 0]);
    graphShare += graph / samples;
    coverShare += amount / samples;
    largestGap = Math.max(largestGap, Math.abs(graph - amount));
  }
  assert.ok(Math.abs(graphShare - coverShare) < 0.005, `share ${graphShare} against ${coverShare}`);
  assert.ok(largestGap < 0.15, `largest gap ${largestGap}`);
  const wrongReading = normalizeSurfaceCover({ output: 'normalY', edge: 0.33, softness: 0.13 });
  assert.ok(Math.abs(surfaceCoverAmount(wrongReading, [0, 0, 0], [Math.sqrt(1 - 0.09), -0.3, 0]) - referenceSmoothstep(0.4, 0.6, referenceSmoothstep(0.2, 0.46, 0.35))) > 0.05, 'the mask alone (softness 0.13) is a different edge');
});

test('the generated fragment shader caps the filter width and uses the world normal', async () => {
  await loadCover();
  const source = createFragmentShader(['surfaceCover']);
  assert.match(source, /min\(0\.5 \* fwidth\(coverSignal\), 1\.5 \* materialCoverShape\.z\)/);
  assert.match(source, /normalize\(worldNormal\)\.y/);
});
