// The pieces of a settling bake that used to run in one turn each (#3052): every one is a generator that hands the thread back
// before it finishes, and finishes with the bytes of the whole.
import './support/load-agent-scene-modules.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { createAgentScene } from '../src/agent-scene.js';
import { drainSteps } from '../src/flush-search-runner.js';
import { buildTriangleBvh, buildTriangleBvhSteps } from '../src/triangle-bvh.js';
import { buildWorld, buildWorldSteps, planLightmaps, planLightmapsSteps } from '../src/light-bake.js';
import { applyDefaultFloorSky, applyDefaultFloorSkySteps } from '../src/floor-sky-visibility.js';
import { deferredBakeSteps, prepareDeferredBake } from '../src/agent-bake-deferred.js';
import { clearBakeReuse } from '../src/agent-bake.js';
import { createStudio } from '../src/studio.js';
import { closedRoom, closedRoomWithoutBake } from './support/agent-bake-rooms.mjs';
import { createFakeRenderer, installStudioDom } from './support/studio-dom.mjs';

const SETTINGS = { preset: 'draft', samples: 2, bounces: 1, texelsPerUnit: 1, probes: false };

function hashOf(typedArray) {
  return createHash('sha256').update(new Uint8Array(typedArray.buffer, typedArray.byteOffset, typedArray.byteLength)).digest('hex');
}

// Runs the steps to their end and says how many times they handed the thread back.
function runCountingCheckpoints(steps) {
  let checkpoints = 0;
  let step = steps.next();
  while (!step.done) {
    checkpoints++;
    step = steps.next();
  }
  return { checkpoints, value: step.value };
}

function roomParts() {
  return createAgentScene(closedRoomWithoutBake()).parts;
}

function wavyGrid(cells) {
  const side = cells + 1;
  const positions = new Float32Array(side * side * 3);
  for (let row = 0; row < side; row++) {
    for (let column = 0; column < side; column++) {
      positions.set([column, Math.sin(column * 0.7) * Math.cos(row * 0.5), row], (row * side + column) * 3);
    }
  }
  const indices = new Uint32Array(cells * cells * 6);
  let slot = 0;
  for (let row = 0; row < cells; row++) {
    for (let column = 0; column < cells; column++) {
      const corner = row * side + column;
      indices.set([corner, corner + side, corner + 1, corner + 1, corner + side, corner + side + 1], slot);
      slot += 6;
    }
  }
  return { positions, indices };
}

test('the hierarchy build hands the thread back every few thousand triangles and builds the same hierarchy', () => {
  const { positions, indices } = wavyGrid(120);
  const { checkpoints, value: stepped } = runCountingCheckpoints(buildTriangleBvhSteps(positions, indices));
  assert.ok(checkpoints >= 3, `${checkpoints} checkpoints for ${indices.length / 3} triangles`);
  const whole = buildTriangleBvh(positions, indices);
  assert.equal(stepped.nodeCount, whole.nodeCount);
  for (const field of ['triangleOrder', 'nodeBounds', 'rightChild', 'rangeStart', 'rangeCount']) {
    assert.equal(hashOf(stepped[field]), hashOf(whole[field]), field);
  }
});

test('the world build and the unwrap plan hand the thread back before they finish', () => {
  const parts = roomParts();
  const world = runCountingCheckpoints(buildWorldSteps(parts));
  assert.ok(world.checkpoints >= parts.length, `${world.checkpoints} checkpoints for ${parts.length} parts`);
  assert.equal(hashOf(world.value.positions), hashOf(buildWorld(parts).positions));
  const lighting = { pointLights: [], spotLights: [], areaLights: [], keyColor: [1, 1, 1], skyTop: [0.5, 0.6, 0.8], skyBottom: [0.3, 0.3, 0.3], lightDirection: [-0.3, -1, -0.2] };
  const options = { samples: 2, bounces: 1, texelsPerUnit: 1, maxSeconds: 60 };
  const snapshots = parts.map(part => ({ ...part, material: { ...part.material } }));
  const plan = runCountingCheckpoints(planLightmapsSteps(snapshots, lighting, options));
  assert.ok(plan.checkpoints >= plan.value.entries.length, `${plan.checkpoints} checkpoints for ${plan.value.entries.length} parts`);
  assert.equal(plan.value.entries.length, planLightmaps(snapshots, lighting, options).entries.length);
});

test('the floor sky trace hands the thread back every few vertices and gives the bytes of the whole', () => {
  const environment = { keyColor: [1, 1, 1], keyIntensity: 1, lightDirection: [-0.3, -1, -0.2] };
  const parts = roomParts();
  const stepped = runCountingCheckpoints(applyDefaultFloorSkySteps(parts, environment));
  const whole = applyDefaultFloorSky(parts, environment);
  assert.ok(stepped.value.report.texels > 0, 'the closed room has a floor sky to trace');
  assert.ok(stepped.checkpoints >= stepped.value.report.texels / 8, `${stepped.checkpoints} checkpoints for ${stepped.value.report.texels} vertices`);
  assert.equal(stepped.value.parts.length, whole.parts.length);
  stepped.value.parts.forEach((part, index) => {
    assert.equal(hashOf(part.geometry.skyVisibility ?? new Float32Array(0)), hashOf(whole.parts[index].geometry.skyVisibility ?? new Float32Array(0)), part.name);
  });
});

test('a settling bake has many more checkpoints than parts, and the scene stages its own work on the baked parts inside them', () => {
  clearBakeReuse();
  const scene = createAgentScene(closedRoom({ bake: SETTINGS }), {}, { skipLightBake: true });
  const parts = scene.parts;
  const worldMatrices = new Map(parts.map(part => [part.name, part.matrix]));
  const prepared = prepareDeferredBake(parts, worldMatrices, scene.exportRecipe().environment, SETTINGS, new Map());
  let stagedParts = null;
  const { checkpoints, value } = runCountingCheckpoints(deferredBakeSteps(prepared, function* stageBakedParts(bakedParts) {
    stagedParts = bakedParts;
    yield;
  }));
  assert.ok(value.baked, 'the bake finished');
  assert.equal(stagedParts, value.baked.parts, 'the scene stages the parts that land');
  assert.ok(checkpoints > parts.length * 3, `${checkpoints} checkpoints for ${parts.length} parts`);
  drainSteps(deferredBakeSteps(prepared, function* nothingToStage() {}));
});

test('Studio shows the baking mark while an edit waits for its light, says it once, and clears it when the light lands', testContext => {
  clearBakeReuse();
  const dom = installStudioDom();
  const scene = createAgentScene(closedRoom({ bake: SETTINGS }));
  const studio = createStudio(dom.container, { scene, renderer: createFakeRenderer() });
  testContext.after(() => {
    studio.dispose();
    dom.uninstall();
  });
  const mark = dom.container.querySelector('.crucible-studio-bake-mark');
  assert.equal(mark.hidden, true, 'a scene with no bake pending shows nothing');
  const edited = studio.controller.exportRecipe();
  edited.nodes.find(node => node.id === 'block').translation = [0.4, 0.6, -0.2];
  studio.controller.loadRecipe(edited);
  assert.equal(studio.controller.bakePending, true);
  assert.equal(mark.hidden, false);
  assert.equal(mark.textContent, 'Baking light');
  assert.equal(mark.getAttribute('role'), 'status');
  for (let round = 0; round < 2000 && studio.controller.bakePending; round++) {
    dom.runTimers();
    if (studio.controller.bakePending) assert.equal(mark.textContent, 'Baking light', 'the label stays the same on every slice');
  }
  assert.equal(studio.controller.bakePending, false, 'the bake landed');
  for (let round = 0; round < 50 && !mark.hidden; round++) {
    dom.runTimers();
    dom.runAnimationFrames(round * 16);
  }
  assert.equal(mark.hidden, true);
  assert.equal(mark.textContent, '');
});
