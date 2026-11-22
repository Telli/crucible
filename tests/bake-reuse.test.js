// A recipe with a light bake reuses the light and the unwrap it already traced while what they read is unchanged (issue 3052).
import './support/load-agent-scene-modules.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { createAgentScene } from '../src/agent-scene.js';
import { createStudioController } from '../src/studio.js';
import { bakesTraced, bakeReuseStats, clearBakeReuse } from '../src/agent-bake.js';
import { unwrapsComputed } from '../src/light-bake.js';
import { closedRoom } from './support/agent-bake-rooms.mjs';

function bakedRoom() {
  return closedRoom({ bake: { preset: 'draft', texelsPerUnit: 1, probes: false } });
}

function controllerOn(recipe) {
  return createStudioController({ scene: createAgentScene(recipe), viewportWidth: 800, viewportHeight: 600 });
}

// Every texture a bake wrote, by part: the bytes the renderer would draw the baked light from.
function bakedTextureBytes(scene) {
  const bytes = {};
  for (const part of scene.parts) {
    for (const field of ['emissiveMap', 'lightMap', 'occlusionMap']) {
      const image = part.material[field]?.image;
      if (image) {
        bytes[`${part.name}.${field}`] = createHash('sha256').update(image.data ?? image.bytes).digest('hex');
      }
    }
  }
  return bytes;
}

function freshBakedBytes(recipe) {
  clearBakeReuse();
  return bakedTextureBytes(createAgentScene(structuredClone(recipe)));
}

function movedBlock(recipe) {
  const moved = structuredClone(recipe);
  moved.nodes.find(node => node.id === 'block').translation = [0.4, 0.6, -0.2];
  return moved;
}

test('loading a recipe through the Studio controller with nothing changed runs no bake', () => {
  const controller = controllerOn(bakedRoom());
  const tracedBefore = bakesTraced();
  controller.loadRecipe(structuredClone(controller.exportRecipe()));
  assert.equal(bakesTraced(), tracedBefore);
});

test('a one-node move through the controller bakes once, and unwraps nothing again', () => {
  const controller = controllerOn(bakedRoom());
  const tracedBefore = bakesTraced();
  const unwrapsBefore = unwrapsComputed();
  controller.loadRecipe(movedBlock(controller.exportRecipe()));
  assert.equal(bakesTraced() - tracedBefore, 1);
  assert.equal(unwrapsComputed(), unwrapsBefore);
});

test('a material colour edit traces again but does not unwrap again', () => {
  const controller = controllerOn(bakedRoom());
  const recoloured = structuredClone(controller.exportRecipe());
  recoloured.materials.find(material => material.id === 'white').color = [0.8, 0.1, 0.1];
  const tracedBefore = bakesTraced();
  const unwrapsBefore = unwrapsComputed();
  controller.loadRecipe(recoloured);
  assert.equal(bakesTraced() - tracedBefore, 1, 'the colour feeds the bounce, so the light is traced again');
  assert.equal(unwrapsComputed(), unwrapsBefore);
});

test('an unwrap of unchanged geometry is not computed again by a second bake of the same scene shape', () => {
  clearBakeReuse();
  createAgentScene(bakedRoom());
  const unwrapsBefore = unwrapsComputed();
  const lit = bakedRoom();
  lit.environment.pointLights[0].intensity = 20;
  createAgentScene(lit);
  assert.equal(unwrapsComputed(), unwrapsBefore);
});

test('reused light equals a fresh build byte for byte after a load, a move and a colour edit', () => {
  clearBakeReuse();
  const controller = controllerOn(bakedRoom());
  const cases = [];
  controller.loadRecipe(structuredClone(controller.exportRecipe()));
  cases.push(['unchanged', controller.exportRecipe(), bakedTextureBytes(controller.scene)]);
  controller.loadRecipe(movedBlock(controller.exportRecipe()));
  cases.push(['moved', controller.exportRecipe(), bakedTextureBytes(controller.scene)]);
  const recoloured = structuredClone(controller.exportRecipe());
  recoloured.materials.find(material => material.id === 'white').color = [0.8, 0.1, 0.1];
  controller.loadRecipe(recoloured);
  cases.push(['recoloured', controller.exportRecipe(), bakedTextureBytes(controller.scene)]);
  controller.loadRecipe(movedBlock(bakedRoom()));
  cases.push(['back to an earlier recipe', controller.exportRecipe(), bakedTextureBytes(controller.scene)]);
  for (const [name, recipe, reusedBytes] of cases) {
    assert.deepEqual(reusedBytes, freshBakedBytes(recipe), name);
  }
});

test('a changed light or a changed part never gets the light of another recipe', () => {
  clearBakeReuse();
  const base = bakedRoom();
  const baseBytes = bakedTextureBytes(createAgentScene(base));
  const brighter = bakedRoom();
  brighter.environment.pointLights[0].intensity = 30;
  const largerBlock = bakedRoom();
  largerBlock.nodes.find(node => node.id === 'block').scale = [1.6, 1.6, 1.6];
  for (const changed of [brighter, largerBlock]) {
    const reusedBytes = bakedTextureBytes(createAgentScene(structuredClone(changed)));
    assert.notDeepEqual(reusedBytes, baseBytes);
    assert.deepEqual(reusedBytes, freshBakedBytes(changed));
  }
});

test('the reuse caches stay inside their bounds', () => {
  clearBakeReuse();
  for (let step = 0; step < 6; step++) {
    const room = bakedRoom();
    room.environment.pointLights[0].intensity = 10 + step;
    createAgentScene(room);
  }
  const { entries, bytes, maximumEntries, maximumBytes } = bakeReuseStats();
  assert.ok(entries <= maximumEntries);
  assert.ok(bytes <= maximumBytes);
});
