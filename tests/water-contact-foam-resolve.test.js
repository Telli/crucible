import test from 'node:test';
import assert from 'node:assert/strict';
import { CrucibleRenderer, blendBatchDrawsCutoutFirst, materialReadsOpaqueScene } from '../src/renderer.js';

const INSTANCE_STRIDE = 42;
const OPACITY_OFFSET = 41;

function blendBatch(material, opacity) {
  const instanceData = new Float32Array(INSTANCE_STRIDE);
  instanceData[OPACITY_OFFSET] = opacity;
  return { alphaMode: 'blend', parts: [{ material }], instanceCount: 1, instanceData };
}

const contactWater = { tag: 'water', alphaMode: 'blend', opacity: 1, contactFoam: { width: 6 } };
const plainWater = { tag: 'water', alphaMode: 'blend', opacity: 1 };
const glass = { tag: 'surface', alphaMode: 'blend', opacity: 1 };

// The context only has to swallow calls: drawBlendBatches reads GL constants and calls GL functions without looking at results.
function recordingContext() {
  return new Proxy({}, { get: () => () => undefined });
}

// What drawBlendBatches draws for these batches, as the alpha mode of each draw: a 'mask' draw is the opaque cutout that runs
// before the opaque-scene resolve, a 'blend' draw is the blend pass that runs after it.
function drawnModes(batches) {
  const modes = [];
  const renderer = {
    batches,
    context: recordingContext(),
    canvas: { width: 8, height: 8 },
    uniforms: {},
    uploadSortedInstances() {},
    drawAlphaBatch(batch) { modes.push(batch.alphaMode); },
    applyDepthRank() {},
  };
  CrucibleRenderer.prototype.drawBlendBatches.call(renderer, { eye: [0, 0, 0] });
  return modes;
}

test('water with contact foam is a scene reader at any opacity, and nothing else is', () => {
  assert.equal(materialReadsOpaqueScene(contactWater), true);
  assert.equal(materialReadsOpaqueScene(plainWater), false);
  assert.equal(materialReadsOpaqueScene(glass), false);
  assert.equal(materialReadsOpaqueScene({ tag: 'surface', contactFoam: { width: 6 } }), false);
});

test('a fully opaque blended batch draws as a cutout first unless its shader reads the opaque scene', () => {
  assert.equal(blendBatchDrawsCutoutFirst(blendBatch(glass, 1)), true);
  assert.equal(blendBatchDrawsCutoutFirst(blendBatch(plainWater, 1)), true);
  assert.equal(blendBatchDrawsCutoutFirst(blendBatch(contactWater, 1)), false);
  assert.equal(blendBatchDrawsCutoutFirst(blendBatch(plainWater, 0.98)), false);
  assert.equal(blendBatchDrawsCutoutFirst(blendBatch(contactWater, 0.98)), false);
});

test('contact foam water at opacity 1 draws only in the blend pass, where the opaque scene is resolved; other batches keep their draws', () => {
  assert.deepEqual(drawnModes([blendBatch(contactWater, 1)]), ['blend']);
  assert.deepEqual(drawnModes([blendBatch(contactWater, 0.98)]), ['blend']);
  assert.deepEqual(drawnModes([blendBatch(plainWater, 1)]), ['mask', 'blend']);
  assert.deepEqual(drawnModes([blendBatch(glass, 1)]), ['mask', 'blend']);
});
