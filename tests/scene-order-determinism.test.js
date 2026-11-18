import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createAgentScene } from '../src/agent-scene.js';
import { loadAgentSceneModules } from '../src/agent-scene-modules.js';
import { flushOrderOf } from '../src/depth-layer.js';
import { ROOM_CAMERA, ROOM_MATERIALS, roomNodes } from '../bench/reference/interior-room.mjs';

const CAMERA = { eye: [0, 2, 4], target: [0, 0.5, 0], up: [0, 1, 0], fov: 50, near: 0.1, far: 50 };

// Two boxes whose top and bottom faces lie on the same planes: the flush ranking has pairs to settle.
function flushRecipe(environment) {
  return {
    format: 'crucible.scene', schemaVersion: 1, camera: CAMERA,
    geometries: [{ id: 'block', type: 'box', bevel: 0 }],
    materials: [{ id: 'paint', color: [0.8, 0.8, 0.8] }],
    nodes: [
      { id: 'slab', geometry: 'block', material: 'paint', translation: [0, 0.5, 0] },
      { id: 'step', geometry: 'block', material: 'paint', translation: [0.4, 0.5, 0], scale: [1, 1, 0.5] },
    ],
    ...(environment ? { environment } : {}),
  };
}

function serialize(key, value) {
  return ArrayBuffer.isView(value) ? Array.from(value) : value;
}

function sceneHash(recipe) {
  const hash = createHash('sha256');
  for (const part of createAgentScene(recipe).parts) {
    for (const field of ['positions', 'normals', 'indices']) {
      const values = part.geometry[field];
      hash.update(Buffer.from(values.buffer, values.byteOffset, values.byteLength));
    }
    hash.update(JSON.stringify(flushOrderOf(part), serialize));
  }
  return hash.digest('hex');
}

test('a plain scene builds the same bytes after another scene loaded the flush ranking', async () => {
  const before = sceneHash(flushRecipe());
  await loadAgentSceneModules(flushRecipe({ resolveCoplanar: 'offset' }));
  assert.equal(sceneHash(flushRecipe()), before);
});

test('a scene that names resolveCoplanar still gets its faces ranked', async () => {
  await loadAgentSceneModules(flushRecipe({ resolveCoplanar: 'offset' }));
  const ranked = createAgentScene(flushRecipe({ resolveCoplanar: 'offset' })).parts.filter(part => flushOrderOf(part));
  assert.ok(ranked.length > 0, 'the recipe asked for the ranking, so flush faces get a draw order');
  assert.notEqual(sceneHash(flushRecipe({ resolveCoplanar: 'offset' })), sceneHash(flushRecipe()));
});

// A closed room with a sun: the floor sky trace changes it when that code is loaded.
function sealedRoomRecipe() {
  return {
    format: 'crucible.scene', schemaVersion: 1, camera: ROOM_CAMERA,
    geometries: [{ id: 'block', type: 'box', bevel: 0 }],
    materials: ROOM_MATERIALS,
    nodes: roomNodes({ sealed: true, withoutLawn: true }),
  };
}

test('a plain room builds the same bytes after another scene loaded the floor sky trace', async () => {
  const before = sceneHash(sealedRoomRecipe());
  await loadAgentSceneModules({ ...sealedRoomRecipe(), environment: { keyColor: [3, 3, 3] } });
  assert.equal(sceneHash(sealedRoomRecipe()), before);
});
