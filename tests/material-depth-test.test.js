import './support/load-agent-scene-modules.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { mat3, mat4 } from 'gl-matrix';

import { createAgentScene } from '../src/agent-scene.js';
import { CrucibleRenderer, groupParts } from '../src/renderer.js';
import { materialLayerState } from '../src/material-layers.js';
import { MaterialSnapshot, SNAPSHOT_VALUE_FIELDS } from '../src/material-snapshot.js';

const GEOMETRY = {
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
  normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
  indices: new Uint16Array([0, 1, 2]),
};

function part(name, material) {
  return { name, geometry: GEOMETRY, matrix: mat4.create(), material: { color: [1, 1, 1], metallic: 0, roughness: 0.5, emission: 0, ...material } };
}

test('material.depthTest validates booleans, splits batches, and updates MaterialSnapshot', () => {
  assert.ok(SNAPSHOT_VALUE_FIELDS.includes('depthTest'));
  const mat = { color: [1, 1, 1], metallic: 0, roughness: 0.5, alphaMode: 'add', depthTest: true };
  const snapshot = MaterialSnapshot.of(mat);
  assert.equal(snapshot.matches({ ...mat }), true);
  assert.equal(snapshot.matches({ ...mat, depthTest: false }), false);

  const depthAdd = part('depth-beam', { alphaMode: 'add' });
  const overlayAdd = part('overlay-beam', { alphaMode: 'add', depthTest: false });
  assert.equal(groupParts([depthAdd, overlayAdd]).length, 2, 'depthTest splits batches');

  assert.throws(() => groupParts([part('bad', { alphaMode: 'add', depthTest: 'no' })]), TypeError);

  // updateParts rejects flipping depthTest on an existing batch
  const renderer = Object.create(CrucibleRenderer.prototype);
  const batch = { instanceBuffer: {}, instanceData: new Float32Array(42), castShadow: false, receivesShadow: true, compositeMode: 0, alphaMode: 'add', alphaCutoff: 0, opacity: 1, doubleSided: false, depthTest: true, pass: 'opaque' };
  renderer.context = { ARRAY_BUFFER: 34962, bindBuffer() {}, bufferSubData() {} };
  renderer.partLocations = new Map([[depthAdd, {
    batch, index: 0, geometry: GEOMETRY, map: null, normalMatrix: mat3.create(),
    layerState: materialLayerState(depthAdd.material), skin: null, mapState: [null, null, null, null, null, 1, 1, 1, 0, 0.05, 0.085, 0.02],
  }]]);
  renderer.updateBatches = new Set();
  renderer.updateSkins = new Set();
  renderer.shadowsDirty = false;
  depthAdd.material.depthTest = false;
  assert.throws(() => renderer.updateParts([depthAdd]), /depthTest/);
});

test('drawBlendBatches disables DEPTH_TEST only for depthTest:false blend/add batches and re-enables it', () => {
  const events = [];
  const depthTestBatches = [];
  const DEPTH_TEST = 2929;
  const context = {
    DEPTH_TEST,
    FRAMEBUFFER: 36160,
    BLEND: 3042,
    CULL_FACE: 2884,
    SAMPLE_ALPHA_TO_COVERAGE: 32926,
    TEXTURE0: 33984,
    TEXTURE_2D: 3553,
    SRC_ALPHA: 770,
    ONE_MINUS_SRC_ALPHA: 771,
    ONE: 1,
    ZERO: 0,
    enable: flag => events.push(['enable', flag]),
    disable: flag => events.push(['disable', flag]),
    bindFramebuffer() {},
    viewport() {},
    useProgram() {},
    activeTexture() {},
    bindTexture() {},
    uniform1i() {},
    blendFuncSeparate() {},
    depthMask() {},
    bindVertexArray() {},
  };
  let depthEnabled = true;
  context.enable = flag => {
    if (flag === DEPTH_TEST) depthEnabled = true;
    events.push(['enable', flag]);
  };
  context.disable = flag => {
    if (flag === DEPTH_TEST) depthEnabled = false;
    events.push(['disable', flag]);
  };

  const makeBatch = (name, alphaMode, depthTest) => ({
    alphaMode,
    depthTest,
    pass: 'opaque',
    instanceCount: 1,
    instanceData: new Float32Array(42),
    parts: [{ name, material: { color: [1, 1, 1], metallic: 0, roughness: 1, alphaMode, depthTest } }],
  });

  const renderer = Object.create(CrucibleRenderer.prototype);
  renderer.context = context;
  renderer.canvas = { width: 64, height: 64 };
  renderer.multisampleFramebuffer = {};
  renderer.program = {};
  renderer.shadowTexture = {};
  renderer.uniforms = { shadowMap: null };
  renderer.batches = [
    makeBatch('normal-add', 'add', true),
    makeBatch('overlay-blend', 'blend', false),
    makeBatch('overlay-add', 'add', false),
  ];
  renderer.uploadSortedInstances = () => {};
  renderer.applyDepthRank = () => {};
  renderer.drawAlphaBatch = batch => depthTestBatches.push([batch.parts[0].name, depthEnabled]);

  renderer.drawBlendBatches({ eye: [0, 0, 5] });
  assert.deepEqual(depthTestBatches, [
    ['normal-add', true],
    ['overlay-blend', false],
    ['overlay-add', false],
  ]);
  assert.equal(depthEnabled, true, 'DEPTH_TEST is restored after overlay draws');
});

test('createAgentScene validates and propagates depthTest', () => {
  const scene = createAgentScene({
    format: 'crucible.scene',
    schemaVersion: 1,
    geometries: [{ id: 'box', type: 'box', bevel: 0 }],
    materials: [{ id: 'beam', color: [1, 0.2, 0.2], alphaMode: 'add', depthTest: false }],
    nodes: [{ id: 'laser', geometry: 'box', material: 'beam' }],
  });
  assert.equal(scene.parts[0].material.depthTest, false);
});
