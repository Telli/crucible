import './support/load-agent-scene-modules.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { mat3, mat4 } from 'gl-matrix';

import { createAgentScene } from '../src/agent-scene.js';
import { CrucibleRenderer } from '../src/renderer.js';
import { materialLayerState } from '../src/material-layers.js';
import { normalizeMaterialSnippet } from '../src/material-snippet.js';
import { layerTextureSupport } from '../src/shader-registry.js';

const FRAGMENT = 'void materialHook(inout vec3 color, inout float alpha, vec2 uv, vec3 worldPosition) { color *= amount; }';

function createUpdateRenderer(parts) {
  const renderer = Object.create(CrucibleRenderer.prototype);
  const batch = {
    instanceBuffer: {},
    instanceData: new Float32Array(parts.length * 42),
    castShadow: true,
    receivesShadow: true,
    compositeMode: 0,
    alphaMode: 'opaque',
    alphaCutoff: 0,
    opacity: 1,
    doubleSided: false,
    depthTest: true,
    pass: 'opaque',
  };
  renderer.context = { ARRAY_BUFFER: 34962, bindBuffer() {}, bufferSubData() {} };
  renderer.partLocations = new Map(parts.map((part, index) => [part, {
    batch,
    index,
    geometry: part.geometry,
    map: null,
    normalMatrix: mat3.create(),
    layerState: materialLayerState(part.material),
    skin: null,
    mapState: [null, null, null, null, null, 1, 1, 1, 0, 0.05, 0.085, 0.02],
  }]));
  renderer.updateBatches = new Set();
  renderer.updateSkins = new Set();
  renderer.shadowsDirty = false;
  return { renderer, batch };
}

test('set-material updating snippet uniforms with the same fragment keeps part identity for updateParts', () => {
  const scene = createAgentScene({
    format: 'crucible.scene',
    schemaVersion: 1,
    geometries: [{ id: 'box', type: 'box', bevel: 0 }],
    materials: [{ id: 'dissolve', color: [1, 1, 1], snippet: { fragment: FRAGMENT, uniforms: { amount: 0.2 } } }],
    nodes: [{ id: 'cube', geometry: 'box', material: 'dissolve' }],
  });
  const firstPart = scene.parts[0];
  const { renderer } = createUpdateRenderer(scene.parts);
  assert.equal(firstPart.material.snippet.uniforms.amount.value, 0.2);

  scene.apply(
    [{ type: 'set-material', id: 'dissolve', snippet: { fragment: FRAGMENT, uniforms: { amount: 0.75 } } }],
    { expectedRevision: scene.revision },
  );

  assert.equal(scene.parts[0], firstPart, 'same part identity stays intact across uniform-only snippet edits');
  assert.equal(renderer.updateParts(scene.parts), 1);
  assert.equal(scene.parts[0].material.snippet.uniforms.amount.value, 0.75);
});

test('in-place snippet uniform write is bound immediately on next draw', () => {
  const snippet = normalizeMaterialSnippet({ fragment: FRAGMENT, uniforms: { amount: 0.25 } });
  const material = { color: [1, 1, 1], snippet };

  snippet.uniforms.amount.value = 0.6;
  const recorded = {};
  const noop = () => {};
  const context = {
    getUniformLocation: (program, name) => name,
    uniform1f: (location, value) => { recorded[location] = value; },
    uniform2fv: noop,
    uniform3fv: noop,
    uniform4fv: noop,
    uniform1i: noop,
    activeTexture: noop,
    bindTexture: noop,
  };
  const renderer = {
    context,
    program: {},
    uniforms: {},
    shaderFeatures: new Set([snippet.feature]),
    whiteTexture: {},
  };
  layerTextureSupport.bind(renderer, new Float32Array(32), new Float32Array(32), {
    parts: [{ material }],
    layerState: new Float32Array(32),
    mapState: new Array(20).fill(null),
    wear: null,
  });
  assert.equal(recorded[`u67_${snippet.feature}_amount`], 0.6);
});
