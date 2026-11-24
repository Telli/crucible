import assert from 'node:assert/strict';
import test from 'node:test';

import { sphere } from '../src/geometry.js';
import { renderPathTracedImage } from '../src/path-tracer.js';
import { buildTraceScene } from '../src/path-tracer-scene.js';

const MESH = sphere(12, 8);
const PARTS = [
  {
    name: 'ball',
    geometry: { positions: MESH.positions, normals: MESH.normals, indices: MESH.indices },
    matrix: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
    material: { tag: 'surface', color: [0.8, 0.4, 0.1], metallic: 0.5, roughness: 0.4 },
  },
];
const CAMERA = { eye: [0, 0, 4], target: [0, 0, 0], up: [0, 1, 0], fov: 30 };
const OPTIONS = { width: 16, height: 16, samples: 1, bounces: 1, seed: 1, denoise: false, threads: 1 };

test('buildTraceScene and renderPathTracedImage reject unknown environment fields with a suggestion', async () => {
  assert.throws(
    () => buildTraceScene(PARTS, { sunColor: [3, 3, 3] }),
    error => error instanceof RangeError && error.message.includes('sunColor') && error.message.includes('keyColor'),
  );
  await assert.rejects(
    () => renderPathTracedImage({ parts: PARTS, environment: { sunDirection: [0, 1, 0] }, camera: CAMERA }, OPTIONS),
    error => error instanceof RangeError && error.message.includes('sunDirection') && error.message.includes('lightDirection'),
  );
  await assert.rejects(
    () => renderPathTracedImage({ parts: PARTS, environment: { sunIntensity: 5 }, camera: CAMERA }, OPTIONS),
    error => error instanceof RangeError && error.message.includes('sunIntensity') && error.message.includes('keyIntensity'),
  );
  await assert.rejects(
    () => renderPathTracedImage({ parts: PARTS, environment: { keyColour: [1, 1, 1] }, camera: CAMERA }, OPTIONS),
    error => error instanceof RangeError && error.message.includes('keyColour') && error.message.includes('keyColor'),
  );
  await assert.rejects(
    () => renderPathTracedImage({ parts: PARTS, environment: { bogusKey: 1 }, camera: CAMERA }, { ...OPTIONS, backend: 'webgpu' }),
    error => error instanceof RangeError && error.message.includes('bogusKey') && error.message.includes('keyColor'),
  );
});

test('buildTraceScene accepts valid tracer and shared rasterizer environment fields', () => {
  const scene = buildTraceScene(PARTS, {
    keyColor: [2, 2, 2],
    keyIntensity: 1,
    lightDirection: [0, 1, 0],
    fillIntensity: 0.2,
    ambientIntensity: 0.3,
    world: false,
    groundBounce: true,
    daylight: true,
    wetness: 0.1,
  });
  assert.ok(scene.lights.sun);
});

test('report.ignored warns when no environment map and no sun are set', async () => {
  const dark = await renderPathTracedImage({ parts: PARTS, environment: {}, camera: CAMERA }, OPTIONS);
  assert.ok(
    dark.report.ignored.some(note => note.includes('keyColor') && note.includes('lightDirection') && note.includes('keyIntensity')),
    `Expected sun field hint in report.ignored, got: ${JSON.stringify(dark.report.ignored)}`,
  );

  const zeroSun = await renderPathTracedImage({ parts: PARTS, environment: { keyColor: [3, 3, 3], keyIntensity: 0 }, camera: CAMERA }, OPTIONS);
  assert.ok(zeroSun.report.ignored.some(note => note.includes('keyColor') && note.includes('lightDirection')));

  const lit = await renderPathTracedImage({ parts: PARTS, environment: { keyColor: [3, 3, 3], lightDirection: [-1, 1.5, 3] }, camera: CAMERA }, OPTIONS);
  assert.equal(lit.report.ignored.some(note => note.includes('No sun is set')), false);
});
