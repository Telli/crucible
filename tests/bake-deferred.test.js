// An edit of a baked scene shows before its bake is done, and the bake lands later exactly as a fresh build has it (issue 3052).
// Every bake here is the closed room at the lowest settings, so the whole file runs in a few seconds even under coverage.
import './support/load-agent-scene-modules.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { createAgentScene } from '../src/agent-scene.js';
import { createStudioController } from '../src/studio.js';
import { bakesTraced, clearBakeReuse, deferredBakeSteps, prepareDeferredBake } from '../src/agent-bake.js';
import { planLightmaps, traceLightmaps, traceLightmapsSteps } from '../src/light-bake.js';
import { drainSteps } from '../src/flush-search-runner.js';
import { closedRoom } from './support/agent-bake-rooms.mjs';

function bakedRoom() {
  return closedRoom({ bake: { preset: 'draft', samples: 2, bounces: 1, texelsPerUnit: 1, probes: false } });
}

function hashOf(typedArray) {
  return createHash('sha256').update(new Uint8Array(typedArray.buffer, typedArray.byteOffset, typedArray.byteLength)).digest('hex');
}

function bakedBytes(scene) {
  const bytes = {};
  for (const part of scene.parts) {
    for (const [field, value] of Object.entries(part.geometry)) {
      if (ArrayBuffer.isView(value)) {
        bytes[`${part.name}.geometry.${field}`] = hashOf(value);
      }
    }
    for (const field of ['emissiveMap', 'lightMap', 'occlusionMap', 'map']) {
      const image = part.material[field]?.image;
      if (image) {
        bytes[`${part.name}.${field}`] = hashOf(image.data ?? image.bytes);
      }
    }
  }
  return bytes;
}

function freshBytes(recipe) {
  clearBakeReuse();
  return bakedBytes(createAgentScene(structuredClone(recipe)));
}

function movedBlock(recipe) {
  const moved = structuredClone(recipe);
  moved.nodes.find(node => node.id === 'block').translation = [0.4, 0.6, -0.2];
  return moved;
}

function recoloured(recipe) {
  const changed = structuredClone(recipe);
  changed.materials.find(material => material.id === 'white').color = [0.8, 0.1, 0.1];
  return changed;
}

function reshapedRecipe(recipe) {
  const reshaped = structuredClone(recipe);
  reshaped.geometries.push({ id: 'ball', type: 'sphere' });
  reshaped.nodes.find(node => node.id === 'block').geometry = 'ball';
  return reshaped;
}

function controllerWith(mode, onChange) {
  clearBakeReuse();
  return createStudioController({ scene: createAgentScene(bakedRoom()), viewportWidth: 800, viewportHeight: 600, bakeWhileSettling: mode, onChange });
}

// The parts that carry a baked light texture (a lightmap, or the emissive map a part without its own emission gets).
function lightedPartNames(scene) {
  return scene.parts.filter(part => Object.keys(bakedBytes({ parts: [part] })).some(key => key.endsWith('.emissiveMap') || key.endsWith('.lightMap'))).map(part => part.name);
}

test('a load that moves a node returns before its bake and shows the last light on the parts it left alone', () => {
  const controller = controllerWith('previous');
  const before = new Map(controller.scene.parts.map(part => [part.name, part]));
  const tracedBefore = bakesTraced();
  controller.loadRecipe(movedBlock(controller.exportRecipe()));
  assert.equal(controller.bakePending, true);
  assert.equal(controller.scene.inspect().bake.pending, true);
  assert.equal(bakesTraced(), tracedBefore, 'the edit traced nothing before it returned');
  const unchanged = controller.scene.parts.filter(part => part.name !== 'block');
  assert.ok(unchanged.length > 0);
  for (const part of unchanged) {
    assert.equal(part, before.get(part.name), `${part.name} keeps the part it was drawn as, with its light`);
  }
  controller.settleBake();
  assert.equal(controller.bakePending, false);
  assert.equal(controller.scene.inspect().bake.pending, undefined);
});

function sceneWithBall(mode) {
  clearBakeReuse();
  const recipe = bakedRoom();
  recipe.geometries.push({ id: 'ball', type: 'sphere' });
  return createAgentScene(recipe, {}, { deferBake: mode });
}

const RESHAPE_BLOCK = [{ type: 'set-node', id: 'block', geometry: 'ball' }];

test('a part whose mesh changed is drawn unbaked while the rest keep their light, or nothing is lit when the last light is not kept', () => {
  const kept = sceneWithBall('previous');
  const lightedBefore = lightedPartNames(kept);
  assert.ok(lightedBefore.length > 1);
  kept.apply(RESHAPE_BLOCK, { expectedRevision: 0 });
  assert.equal(kept.bakePending, true);
  assert.deepEqual(lightedPartNames(kept), lightedBefore.filter(name => name !== 'block'));
  const dropped = sceneWithBall('none');
  dropped.apply(RESHAPE_BLOCK, { expectedRevision: 0 });
  assert.deepEqual(lightedPartNames(dropped), [], 'nothing is lit until the bake lands');
  assert.equal(kept.settleBake(), true);
  assert.equal(dropped.settleBake(), true);
  assert.deepEqual(bakedBytes(kept), bakedBytes(dropped));
  assert.deepEqual(bakedBytes(kept), freshBytes(kept.exportRecipe()));
});

test('a recolour draws the parts of that material unlit at once, because their old light has the old colour in it', () => {
  const controller = controllerWith('previous');
  assert.ok(lightedPartNames(controller.scene).length > 1);
  controller.loadRecipe(recoloured(controller.exportRecipe()));
  assert.equal(controller.bakePending, true);
  assert.deepEqual(lightedPartNames(controller.scene), ['bulb'], 'only the lamp, which is not the recoloured material, keeps its light');
  controller.settleBake();
  assert.deepEqual(bakedBytes(controller.scene), freshBytes(controller.exportRecipe()));
});

for (const mode of ['previous', 'none']) {
  test(`after it settles, a move and a recolour equal a fresh build byte for byte (${mode})`, () => {
    const controller = controllerWith(mode);
    for (const edit of [movedBlock, recoloured]) {
      controller.loadRecipe(edit(controller.exportRecipe()));
      assert.equal(controller.settleBake(), true);
      const settled = bakedBytes(controller.scene);
      assert.deepEqual(settled, freshBytes(controller.exportRecipe()), edit.name);
    }
  });
}

test('the bake lands by itself in slices, tells the viewport once and redraws the parts', async () => {
  const events = [];
  const controller = controllerWith('previous', detail => events.push(detail.kind));
  controller.loadRecipe(movedBlock(controller.exportRecipe()));
  const topologyBefore = controller.scene.topologyRevision;
  const settledParts = await new Promise(resolve => {
    const wait = () => (controller.bakePending ? setTimeout(wait, 5) : setTimeout(() => resolve(bakedBytes(controller.scene)), 100));
    wait();
  });
  assert.ok(controller.scene.topologyRevision > topologyBefore, 'the swap is a topology change the renderer regroups for');
  assert.equal(events.filter(kind => kind === 'flush').length, 1);
  assert.deepEqual(settledParts, freshBytes(controller.exportRecipe()));
});

test('a second edit drops the bake of the first and a camera move keeps the one running', () => {
  const controller = controllerWith('previous');
  const tracedBefore = bakesTraced();
  controller.loadRecipe(movedBlock(controller.exportRecipe()));
  const camera = structuredClone(controller.exportRecipe());
  camera.camera.fov = 50;
  controller.loadRecipe(camera);
  assert.equal(controller.bakePending, true, 'a camera edit changes nothing the bake reads');
  controller.loadRecipe(recoloured(controller.exportRecipe()));
  controller.settleBake();
  assert.equal(bakesTraced() - tracedBefore, 1, 'only the last edit was traced');
  assert.deepEqual(bakedBytes(controller.scene), freshBytes(controller.exportRecipe()));
});

test('a fresh scene and a scene that did not ask for it still bake before they return', () => {
  clearBakeReuse();
  const fresh = createAgentScene(bakedRoom());
  assert.equal(fresh.bakePending, false);
  assert.ok(lightedPartNames(fresh).length > 1);
  const waiting = createStudioController({ scene: createAgentScene(bakedRoom()), bakeWhileSettling: 'wait' });
  waiting.loadRecipe(movedBlock(waiting.exportRecipe()));
  assert.equal(waiting.bakePending, false);
  assert.deepEqual(bakedBytes(waiting.scene), freshBytes(waiting.exportRecipe()));
  const plain = createAgentScene(bakedRoom());
  plain.apply([{ type: 'set-effects', effects: { exposure: 1.2 } }], { expectedRevision: 0 });
  assert.equal(plain.bakePending, false);
});

test('the stepped trace is the trace, with a checkpoint between every few dozen texels', () => {
  const scene = createAgentScene(bakedRoom(), {}, { skipLightBake: true });
  const snapshots = scene.parts.map(part => ({ ...part, material: { ...part.material } }));
  const lighting = { pointLights: [], spotLights: [], areaLights: [], keyColor: [1, 1, 1], skyTop: [0.5, 0.6, 0.8], skyBottom: [0.3, 0.3, 0.3], lightDirection: [-0.3, -1, -0.2] };
  const options = { samples: 2, bounces: 1, texelsPerUnit: 1, maxSeconds: 60 };
  const stepped = traceLightmapsSteps(planLightmaps(snapshots, lighting, options), options);
  let checkpoints = 0;
  let step = stepped.next();
  while (!step.done) {
    checkpoints++;
    step = stepped.next();
  }
  assert.ok(checkpoints > 3, `${checkpoints} checkpoints`);
  const whole = traceLightmaps(planLightmaps(snapshots, lighting, options), options);
  assert.deepEqual(step.value.parts.map(part => part.name), whole.parts.map(part => part.name));
  step.value.parts.forEach((part, index) => {
    assert.equal(hashOf(part.geometry.positions), hashOf(whole.parts[index].geometry.positions));
  });
});

test('a bake a size limit stops comes back as a refusal, not an error nobody can read', () => {
  const environment = { keyColor: [1, 1, 1], keyIntensity: 1, skyTop: [0.5, 0.6, 0.8], skyBottom: [0.3, 0.3, 0.3], lightDirection: [0, -1, 0] };
  const prepared = prepareDeferredBake([], new Map(), environment, { samples: 2, bounces: 1, texelsPerUnit: 1 }, new Map());
  const outcome = drainSteps(deferredBakeSteps(prepared));
  assert.match(outcome.refusal, /takes from 1 to/);
  assert.equal(outcome.baked, undefined);
});

test('disposing the controller, or loading a scene that replaces it, drops the bake nobody draws any more', () => {
  const disposed = controllerWith('previous');
  const disposedScene = disposed.scene;
  disposed.loadRecipe(movedBlock(disposed.exportRecipe()));
  assert.equal(disposedScene.bakePending, true);
  disposed.dispose();
  assert.equal(disposedScene.bakePending, false);
  const replaced = controllerWith('previous');
  const replacedScene = replaced.scene;
  replaced.loadRecipe(movedBlock(replaced.exportRecipe()));
  replaced.loadRecipe(reshapedRecipe(replaced.exportRecipe()));
  assert.equal(replacedScene.bakePending, false, 'a recipe that needs a new scene builds it and drops the old one');
});
