import './support/load-agent-scene-modules.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { installCoplanarDiagnostics } from '../src/coplanar-overlap.js';
import { previewHarness } from './support/preview-harness.mjs';
import { createAgentScene } from '../src/agent-scene.js';
import { isLiveGeometry, isReindexedGeometry } from '../src/live-geometry.js';

// Issue 3038: every later frame of a render job rebuilt the renderer and searched the layout for coplanar faces again.

function seaWithTexturedBox() {
  return {
    format: 'crucible.scene', schemaVersion: 1,
    geometries: [
      { id: 'sea', type: 'mesh', base: { type: 'box', bevel: 0 }, stack: [{ op: 'subdivide', levels: 2 }, { op: 'ocean', coverage: 1, seed: 3, windSpeed: 4, size: 2, resolution: 4 }] },
      { id: 'cube', type: 'box' },
    ],
    materials: [{ id: 'water', color: [0.1, 0.3, 0.5] }, { id: 'bricks', color: [1, 1, 1], pattern: { type: 'bricks', size: 1 } }],
    nodes: [{ id: 'surface', geometry: 'sea', material: 'water' }, { id: 'wall', geometry: 'cube', material: 'bricks', translation: [0, 2, 0] }],
    camera: { eye: [30, 20, 30], target: [0, 0, 0] },
    motion: {
      duration: 4,
      tracks: [
        { kind: 'geometry', id: 'sea', property: 'oceanTime', keyframes: [{ time: 0, value: 0 }, { time: 4, value: 8 }] },
        { kind: 'camera', property: 'eye', keyframes: [{ time: 0, value: [30, 20, 30] }, { time: 4, value: [20, 20, 30] }] },
      ],
    },
  };
}

test('frames that move only the sea of a textured scene keep the renderer, its batches and its parts', () => {
  const harness = previewHarness();
  const sessionId = 'sea-frames';
  harness.preview.create({ recipe: seaWithTexturedBox(), sessionId, backend: 'cpu', memoryBudgetMiB: 192 });
  harness.preview.frame({ sessionId, motionTime: 0.5 });
  const renderersAfterFirstFrame = harness.rendererOptions.length;
  const replacementsAfterFirstFrame = harness.replacementCount();
  const uploadsAfterFirstFrame = harness.vertexUploads().length;
  for (const motionTime of [1, 2, 3]) harness.preview.frame({ sessionId, motionTime });
  assert.equal(harness.rendererOptions.length, renderersAfterFirstFrame, 'no frame builds a new renderer');
  assert.equal(harness.replacementCount(), replacementsAfterFirstFrame, 'no frame swaps the parts');
  assert.equal(harness.vertexUploads().length - uploadsAfterFirstFrame, 3, 'each new sea is uploaded in place');
  assert.ok(harness.vertexUploads().at(-1).indices, 'with its triangle indices, which follow the waves');
});

test('a sea part keeps its geometry across times and draws the values of a fresh scene', () => {
  const recipe = seaWithTexturedBox();
  recipe.materials[0].tag = 'water';
  const scene = createAgentScene(recipe);
  scene.sampleMotion(1);
  const part = scene.parts.find(candidate => candidate.name === 'surface');
  const geometry = part.geometry;
  const topology = scene.topologyRevision;
  assert.ok(isLiveGeometry(geometry) && isReindexedGeometry(geometry), 'the kept sea is marked live, with its indices');
  const heldPositions = Array.from(geometry.positions);
  scene.sampleMotion(2.5);
  assert.equal(scene.parts.find(candidate => candidate.name === 'surface'), part, 'the same part');
  assert.equal(scene.topologyRevision, topology, 'no topology change');
  assert.notDeepEqual(Array.from(geometry.positions), heldPositions, 'the sea moved');
  const fresh = createAgentScene(recipe);
  fresh.sampleMotion(2.5);
  const expected = fresh.parts.find(candidate => candidate.name === 'surface').geometry;
  for (const field of ['positions', 'normals', 'indices', 'skyVisibility']) {
    assert.ok(geometry[field], `the sea has ${field}`);
    assert.deepEqual(Array.from(geometry[field]), Array.from(expected[field]), `${field} equal a scene seeked straight there`);
  }
  assert.deepEqual(Array.from(geometry.vertexGroups.foam), Array.from(expected.vertexGroups.foam));
  scene.sampleMotion(1);
  assert.deepEqual(Array.from(geometry.positions), heldPositions, 'a seek back reproduces the earlier frame');
});

test('a sea whose vertex count changes replaces the kept sea and swaps the parts', () => {
  const recipe = seaWithTexturedBox();
  const scene = createAgentScene(recipe);
  scene.sampleMotion(1);
  const kept = scene.parts.find(candidate => candidate.name === 'surface');
  const topology = scene.topologyRevision;
  const finer = { ...recipe.geometries[0], stack: [{ op: 'subdivide', levels: 3 }, recipe.geometries[0].stack[1]] };
  scene.apply([{ type: 'remove-geometry', id: 'sea' }, { type: 'add-geometry', geometry: finer }], { expectedRevision: scene.revision });
  scene.sampleMotion(1);
  const replaced = scene.parts.find(candidate => candidate.name === 'surface');
  assert.notEqual(replaced, kept, 'a new part');
  assert.ok(replaced.geometry.positions.length > kept.geometry.positions.length, 'with more vertices');
  assert.ok(scene.topologyRevision > topology, 'the renderer is told to swap');
  const next = createAgentScene({ ...recipe, geometries: [finer, recipe.geometries[1]] });
  next.sampleMotion(1);
  assert.deepEqual(Array.from(replaced.geometry.positions), Array.from(next.parts.find(candidate => candidate.name === 'surface').geometry.positions));
});

test('a frame falls back to a new renderer when replaceParts refuses the change', () => {
  const harness = previewHarness();
  const sessionId = 'sea-refused';
  const recipe = seaWithTexturedBox();
  harness.preview.create({ recipe, sessionId, backend: 'cpu', memoryBudgetMiB: 192 });
  harness.preview.frame({ sessionId, motionTime: 1 });
  const renderersBefore = harness.rendererOptions.length;
  const finer = { ...recipe.geometries[0], stack: [{ op: 'subdivide', levels: 3 }, recipe.geometries[0].stack[1]] };
  harness.rejectReplacement(true);
  const revision = harness.scene().revision;
  harness.preview.applyLoaded({ sessionId, operations: [{ type: 'remove-geometry', id: 'sea' }, { type: 'add-geometry', geometry: finer }], expectedRevision: revision });
  harness.preview.frame({ sessionId, motionTime: 2 });
  assert.equal(harness.rendererOptions.length, renderersBefore + 1);
});

test('a kept renderer fits the cascades of each new sea time exactly, as the new renderer of a textured scene did', () => {
  const harness = previewHarness();
  const sessionId = 'sea-cascade-fits';
  const recipe = seaWithTexturedBox();
  recipe.environment = { shadowCascades: 3 };
  harness.preview.create({ recipe, sessionId, backend: 'cpu', memoryBudgetMiB: 192 });
  harness.preview.frame({ sessionId, motionTime: 0.5 });
  const cascades = harness.rendererOptions.at(-1).shadowCascades;
  const rendererCount = harness.rendererOptions.length;
  assert.ok(cascades, 'the scene draws with cascades');
  // A moving camera leaves a wider fit in a slice; a frame of the next time may not shade with it.
  cascades.holds = [{ fit: 'wider', tight: 'tight' }];
  harness.preview.frame({ sessionId, motionTime: 0.5 });
  assert.equal(cascades.holds.length, 1, 'the same time keeps the fits, as a draw that moves no sea did');
  harness.preview.frame({ sessionId, motionTime: 1.5 });
  assert.equal(harness.rendererOptions.length, rendererCount, 'the renderer is kept');
  assert.equal(cascades.holds.length, 0, 'a new sea time drops them');
});

function countingBatches(partCounter) {
  const part = { name: 'floor', geometry: { positions: new Float32Array(9), indices: new Uint32Array(3) }, matrix: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]) };
  return [{ get parts() { partCounter.searches++; return [part]; } }];
}

test('renderers of one moving scene search the coplanar layout once while the revision holds', () => {
  const searchCounter = { searches: 0 };
  const held = {};
  let revision = 4;
  const carry = { held, key: () => revision };
  const firstRenderer = installCoplanarDiagnostics({}, null, carry);
  firstRenderer.coplanarDiagnostics(countingBatches(searchCounter));
  const secondRenderer = installCoplanarDiagnostics({}, null, carry);
  secondRenderer.coplanarDiagnostics(countingBatches(searchCounter));
  secondRenderer.coplanarDiagnostics(countingBatches(searchCounter));
  assert.equal(searchCounter.searches, 1, 'later layouts take the held warnings');
  revision = 5;
  secondRenderer.coplanarDiagnostics(countingBatches(searchCounter));
  assert.equal(searchCounter.searches, 2, 'an edit searches again');
});

test('a scene with no sampled time never takes held coplanar warnings', () => {
  const searchCounter = { searches: 0 };
  const carry = { held: {}, key: () => undefined };
  installCoplanarDiagnostics({}, null, carry).coplanarDiagnostics(countingBatches(searchCounter));
  installCoplanarDiagnostics({}, null, carry).coplanarDiagnostics(countingBatches(searchCounter));
  assert.equal(searchCounter.searches, 2);
});
