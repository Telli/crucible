// A hidden part that no volume names (#1793): the rasterizer does not draw it, so the CPU tracer must not trace it as a wall either.
// Before the fix it stood in the smoke as a black box and cut the soft volume with a hard edge.
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderPathTracedImage } from '../src/path-tracer.js';
import { buildTraceScene } from '../src/path-tracer-scene.js';
import { box } from '../src/geometry.js';

const UNLIT = { tag: 'unlit', color: [0, 0, 0], metallic: 0, roughness: 1, emission: 0 };
const IMAGE = { width: 48, height: 30, denoise: false, threads: 1, bounces: 1, samples: 4 };
const CAMERA = { eye: [0, 0, 5], target: [0, 0, 0], fov: 40 };
const SOFT_VOLUME = { shape: 'mesh', part: 'smoke', fit: 'bounds', noiseAmount: 1, falloff: 0.95, density: 4, emission: [1, 0.5, 0.25], emissionStrength: 1, steps: 24 };

function hiddenBox(name, x, z) {
  return { name, visible: false, geometry: box(0, 1), matrix: [2.4, 0, 0, 0, 0, 1.6, 0, 0, 0, 0, 1.5, 0, x, 0, z, 1], material: UNLIT };
}

const backdrop = { name: 'backdrop', geometry: box(0, 1), matrix: [20, 0, 0, 0, 0, 20, 0, 0, 0, 0, 0.1, 0, 0, 0, -8, 1], material: UNLIT };
const smoke = hiddenBox('smoke', -0.2, 0.3);
const idle = hiddenBox('idle', 0.4, -0.3);

test('the trace leaves out every hidden part of a scene with local volumes, named by a volume or not', () => {
  const withIdle = buildTraceScene([smoke, idle, backdrop], { localVolumes: [SOFT_VOLUME] });
  const withoutIdle = buildTraceScene([smoke, backdrop], { localVolumes: [SOFT_VOLUME] });
  assert.equal(withIdle.indices.length, withoutIdle.indices.length, "the idle part adds no triangles");
  assert.deepEqual(withIdle.localVolumes.map(volume => [volume.center, volume.size]), withoutIdle.localVolumes.map(volume => [volume.center, volume.size]), 'the volume keeps the bounds of its own part');
});

test('a hidden part without a volume does not cut the soft volume of the other one', async () => {
  const environment = { localVolumes: [SOFT_VOLUME] };
  const withIdle = await renderPathTracedImage({ parts: [smoke, idle, backdrop], environment, camera: CAMERA }, IMAGE);
  const withoutIdle = await renderPathTracedImage({ parts: [smoke, backdrop], environment, camera: CAMERA }, IMAGE);
  assert.deepEqual(Array.from(withIdle.linear), Array.from(withoutIdle.linear));
});

test('a hidden part is left out of a scene without local volumes too (#1806)', async () => {
  const lit = { ...idle, material: { ...UNLIT, color: [1, 1, 1], emission: 1 } };
  const withoutHidden = await renderPathTracedImage({ parts: [backdrop], environment: {}, camera: CAMERA }, IMAGE);
  const withHidden = await renderPathTracedImage({ parts: [lit, backdrop], environment: {}, camera: CAMERA }, IMAGE);
  assert.deepEqual(Array.from(withHidden.linear), Array.from(withoutHidden.linear));
});
