// Issue 3082: the CPU and WebGL path tracers read COLOR_0 vertex alpha (geometry.colorAlpha). A blended material with vertex
// alpha is traced as a cutout at half, a masked material multiplies it into the alpha it tests against its cutoff, and an
// opaque material ignores it.
import assert from 'node:assert/strict';
import test from 'node:test';

import { box } from '../src/geometry.js';
import { buildTraceScene } from '../src/path-tracer-scene.js';
import { packVertexAlpha } from '../src/path-tracer-gpu-pack.js';
import { buildFragmentSource } from '../src/path-tracer-gpu-shader.js';
import { renderPathTracedImage } from '../src/path-tracer.js';

const RED = [1, 0, 0];
const BLUE = [0, 0, 1];

function placed(translation, scale) {
  return new Float32Array([scale[0], 0, 0, 0, 0, scale[1], 0, 0, 0, 0, scale[2], 0, translation[0], translation[1], translation[2], 1]);
}

function surface(color, extra = {}) {
  return { tag: 'surface', metallic: 0, roughness: 1, emission: 0, color, ...extra };
}

const environment = { keyColor: [3, 3, 3], lightDirection: [0, 1, 0] };
const camera = { eye: [0, 6, 0], target: [0, 0, 0], up: [0, 0, -1], fov: 30 };
const OPTIONS = { width: 16, height: 16, samples: 8, bounces: 1, denoise: false, threads: 1, backend: 'cpu' };

function floor() {
  return { name: 'floor', geometry: box(0, 1), matrix: placed([0, -0.05, 0], [20, 0.1, 20]), material: surface(RED) };
}

// A slab over the floor whose every vertex carries the given alpha, or none when `alpha` is null.
function slab(alpha, materialExtra) {
  const geometry = box(0, 1);
  const vertexCount = geometry.positions.length / 3;
  const withAlpha = alpha === null ? geometry : { ...geometry, colorAlpha: new Float32Array(vertexCount).fill(alpha) };
  return { name: 'slab', geometry: withAlpha, matrix: placed([0, 1.5, 0], [3, 0.2, 3]), material: surface(BLUE, materialExtra) };
}

// The centre pixel as [red, blue]: red is the floor seen through the slab, blue is the slab itself.
async function centre(parts) {
  const { linear } = await renderPathTracedImage({ parts, environment, camera }, OPTIONS);
  const pixel = (8 * 16 + 8) * 3;
  return { red: linear[pixel], blue: linear[pixel + 2] };
}

function seesFloor({ red, blue }) {
  return red > 0.2 && blue < 0.01;
}

function seesSlab({ red, blue }) {
  return blue > 0.2 && red < 0.01;
}

test('a blended slab with vertex alpha 0 lets the ray through and alpha 1 blocks it', async () => {
  assert.ok(seesFloor(await centre([floor(), slab(0, { alphaMode: 'blend' })])));
  assert.ok(seesSlab(await centre([floor(), slab(1, { alphaMode: 'blend' })])));
});

test('a blended slab with alpha at half cuts out where the alpha falls below 0.5', async () => {
  assert.ok(seesFloor(await centre([floor(), slab(0.4, { alphaMode: 'blend' })])));
  assert.ok(seesSlab(await centre([floor(), slab(0.6, { alphaMode: 'blend' })])));
});

test('a masked slab tests the vertex alpha against its cutoff', async () => {
  assert.ok(seesFloor(await centre([floor(), slab(0.3, { alphaMode: 'mask', alphaCutoff: 0.5 })])));
  assert.ok(seesSlab(await centre([floor(), slab(0.3, { alphaMode: 'mask', alphaCutoff: 0.2 })])));
  assert.ok(seesSlab(await centre([floor(), slab(1, { alphaMode: 'mask', alphaCutoff: 0.5 })])));
});

test('an opaque slab and a blended slab without vertex alpha ignore it', async () => {
  assert.ok(seesSlab(await centre([floor(), slab(0, {})])));
  assert.ok(seesSlab(await centre([floor(), slab(null, { alphaMode: 'blend' })])));
});

test('the trace scene keeps vertex alpha only for blended and masked parts that carry it', () => {
  assert.equal(buildTraceScene([floor(), slab(null, { alphaMode: 'blend' })], environment).vertexAlpha, null);
  assert.equal(buildTraceScene([floor(), slab(0, {})], environment).vertexAlpha, null);
  const blended = buildTraceScene([floor(), slab(0.25, { alphaMode: 'blend' })], environment);
  assert.equal(blended.vertexAlpha.length, blended.positions.length / 3);
  assert.equal(blended.materials[0].alphaCutoff, 0);
  assert.equal(blended.materials[1].alphaCutoff, 0.5);
});

test('a colorAlpha with the wrong length names the part and what to pass', () => {
  const part = slab(0.5, { alphaMode: 'blend' });
  part.geometry.colorAlpha = new Float32Array(3);
  assert.throws(() => buildTraceScene([part], environment), /needs one colorAlpha for every position/);
});

test('the WebGL tracer packs the three corner alphas of each triangle slot and builds its kernel only for them', () => {
  const scene = buildTraceScene([floor(), slab(0.25, { alphaMode: 'blend' })], environment);
  const table = packVertexAlpha(scene);
  const slabSlot = scene.bvh.triangleOrder.findIndex(triangle => scene.triangleMaterial[triangle] === 1);
  assert.deepEqual([...table.data.subarray(slabSlot * 4, slabSlot * 4 + 3)], [0.25, 0.25, 0.25]);
  const floorSlot = scene.bvh.triangleOrder.findIndex(triangle => scene.triangleMaterial[triangle] === 0);
  assert.deepEqual([...table.data.subarray(floorSlot * 4, floorSlot * 4 + 3)], [1, 1, 1]);
  assert.equal(packVertexAlpha(buildTraceScene([floor(), slab(null, {})], environment)), null);
  assert.match(buildFragmentSource({ vertexAlpha: true }), /uniform sampler2D uVertexAlpha;/);
  assert.doesNotMatch(buildFragmentSource(), /uVertexAlpha/);
});
