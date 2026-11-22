import './support/load-agent-scene-modules.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAgentScene } from '../src/agent-scene.js';
import { createStudioController } from '../src/studio.js';

function makeRecipe() {
  return {
    format: 'crucible.scene',
    schemaVersion: 1,
    geometries: [
      { id: 'floor', type: 'box', bevel: 0 },
      { id: 'cube', type: 'box', bevel: 0.04 },
    ],
    materials: [
      { id: 'stone', tag: 'surface', color: [0.3, 0.32, 0.35], roughness: 0.8, metallic: 0 },
      { id: 'paint', tag: 'surface', color: [0.8, 0.25, 0.2], roughness: 0.4, metallic: 0.1 },
    ],
    nodes: [
      { id: 'ground', geometry: 'floor', material: 'stone', translation: [0, -0.2, 0], scale: [10, 0.4, 10] },
      { id: 'hero', geometry: 'cube', material: 'paint', translation: [0, 0.5, 0] },
      { id: 'orb', geometry: 'cube', material: 'paint', translation: [2.2, 0.5, 0], scale: [0.5, 0.5, 0.5] },
    ],
    camera: { eye: [0, 2, 6], target: [0, 0.5, 0], up: [0, 1, 0], fov: 45, near: 0.1, far: 100 },
    environment: { setup: 'studio', lightDirection: [-2, 5, 3] },
  };
}

function makeController(recipe = makeRecipe()) {
  const scene = createAgentScene(recipe);
  return createStudioController({ scene, viewportWidth: 800, viewportHeight: 600 });
}

// A hero keyed at 0 s with its first pose: the starting point of nearly every case below.
function makeKeyedController() {
  const controller = makeController();
  controller.selectNode('hero');
  controller.insertNodeKeyframe('hero');
  return controller;
}

function nodeOf(controller, nodeId = 'hero') {
  return controller.exportRecipe().nodes.find(node => node.id === nodeId);
}

function trackOf(controller, property, nodeId = 'hero') {
  return controller.exportRecipe().motion?.tracks.find(track => track.id === nodeId && track.property === property);
}

function keyTimes(controller, property = 'translation') {
  return trackOf(controller, property)?.keyframes.map(keyframe => keyframe.time);
}

function partPositionX(scene, nodeId) {
  return scene.parts.find(part => part.name === nodeId).matrix[12];
}

function dragAlongX(controller, distance) {
  controller.setTool('translate');
  const handles = controller.gizmoHandles();
  const grab = controller.projectWorldPoint([handles.pivot[0] + handles.handleLength, handles.pivot[1], handles.pivot[2]]);
  const release = controller.projectWorldPoint([handles.pivot[0] + handles.handleLength + distance, handles.pivot[1], handles.pivot[2]]);
  controller.beginGizmoDrag('x', grab.x, grab.y);
  const live = controller.updateGizmoDrag(release.x, release.y);
  return { live, end: () => controller.endGizmoDrag() };
}

test('reproduction: a second pose at another time is keyed by a field edit', () => {
  const controller = makeKeyedController();
  controller.setMotionTime(2);
  controller.updateNodeTransform('hero', { translation: [3, 0.5, 0] });
  assert.deepEqual(keyTimes(controller), [0, 2], 'the edit at 2 s must write a key, not vanish into the authored pose');
  assert.deepEqual(trackOf(controller, 'translation').keyframes[1].value, [3, 0.5, 0]);
});

test('a gizmo drag writes the key once, at commit', () => {
  const controller = makeKeyedController();
  controller.setMotionTime(2);
  const drag = dragAlongX(controller, 1);
  assert.deepEqual(keyTimes(controller), [0], 'no key while the pointer is still moving');
  assert.equal(drag.end(), true);
  assert.deepEqual(keyTimes(controller), [0, 2]);
  assert.ok(Math.abs(trackOf(controller, 'translation').keyframes[1].value[0] - 1) < 0.01);
});

test('editing again at the same time updates that key instead of adding one', () => {
  const controller = makeKeyedController();
  controller.setMotionTime(2);
  controller.updateNodeTransform('hero', { translation: [3, 0.5, 0] });
  controller.updateNodeTransform('hero', { translation: [4, 0.5, 0] });
  assert.deepEqual(keyTimes(controller), [0, 2]);
  assert.equal(trackOf(controller, 'translation').keyframes[1].value[0], 4);
});

test('round trip: both poses survive export and load, and one second lies between them', () => {
  const controller = makeKeyedController();
  controller.setMotionTime(2);
  controller.updateNodeTransform('hero', { translation: [3, 0.5, 0] });
  const recipe = controller.exportRecipe();
  const scene = createAgentScene(recipe);
  const fresh = createStudioController({ scene, viewportWidth: 800, viewportHeight: 600 });
  fresh.setMotionTime(0);
  assert.ok(Math.abs(partPositionX(scene, 'hero') - 0) < 1e-6);
  fresh.setMotionTime(2);
  assert.ok(Math.abs(partPositionX(scene, 'hero') - 3) < 1e-6);
  fresh.setMotionTime(1);
  const middle = partPositionX(scene, 'hero');
  assert.ok(middle > 0.5 && middle < 2.5, `expected a pose between the keys, got ${middle}`);
});

test('a drag at 1 s starts from the pose shown there, not from the authored one', () => {
  const controller = makeKeyedController();
  controller.setMotionTime(2);
  controller.updateNodeTransform('hero', { translation: [3, 0.5, 0] });
  controller.setMotionTime(1);
  const shownX = controller.gizmoHandles().pivot[0];
  assert.ok(Math.abs(shownX - 1.5) < 0.01, `precondition: x shown at 1 s is ${shownX}`);
  const drag = dragAlongX(controller, 0.5);
  assert.ok(Math.abs(drag.live.translation[0] - 2) < 0.02, `drag started from ${drag.live.translation[0] - 0.5}, expected 1.5`);
  drag.end();
  const key = trackOf(controller, 'translation').keyframes.find(keyframe => keyframe.time === 1);
  assert.ok(Math.abs(key.value[0] - 2) < 0.02);
  assert.deepEqual(keyTimes(controller), [0, 1, 2]);
});

test('an object with no track never gains motion', () => {
  const controller = makeController();
  controller.selectNode('orb');
  controller.updateNodeTransform('orb', { translation: [1, 1, 1] });
  assert.equal(controller.exportRecipe().motion, undefined);
  const drag = dragAlongX(controller, 0.5);
  drag.end();
  assert.equal(controller.exportRecipe().motion, undefined);
});

test('only properties that already have a track get keys', () => {
  const controller = makeKeyedController();
  controller.setMotionTime(2);
  controller.updateNodeTransform('hero', { translation: [3, 0.5, 0], scale: [2, 2, 2] });
  assert.deepEqual(keyTimes(controller, 'translation'), [0, 2]);
  assert.deepEqual(keyTimes(controller, 'scale'), [0, 2]);
  assert.equal(controller.exportRecipe().motion.tracks.length, 3);
  const hand = makeRecipe();
  hand.motion = { duration: 2, loop: true, tracks: [{ kind: 'node', id: 'hero', property: 'translation', keyframes: [{ time: 0, value: [0, 0.5, 0] }] }] };
  const partial = makeController(hand);
  partial.setMotionTime(0);
  partial.updateNodeTransform('hero', { scale: [2, 2, 2], translation: [1, 0.5, 0] });
  assert.equal(trackOf(partial, 'scale'), undefined);
  assert.equal(trackOf(partial, 'translation').keyframes[0].value[0], 1);
});

test('a cancelled gizmo drag writes no key and restores the authored pose', () => {
  const controller = makeKeyedController();
  controller.setMotionTime(2);
  const before = controller.exportRecipe();
  dragAlongX(controller, 1);
  controller.cancelGizmoDrag();
  assert.deepEqual(controller.exportRecipe(), before);
});

test('moving a key changes its time and keeps one undo step', () => {
  const controller = makeKeyedController();
  controller.setMotionTime(2);
  controller.updateNodeTransform('hero', { translation: [3, 0.5, 0] });
  const keyedRecipe = controller.exportRecipe();
  controller.moveNodeKeyframe('hero', 2, 3);
  assert.deepEqual(controller.nodeKeyframeTimes('hero'), [0, 3]);
  assert.ok(controller.exportRecipe().motion.duration >= 3);
  controller.undo();
  assert.deepEqual(controller.exportRecipe(), keyedRecipe);
  controller.redo();
  assert.deepEqual(controller.nodeKeyframeTimes('hero'), [0, 3]);
});

test('moving a key onto an occupied time replaces the keys there', () => {
  const controller = makeKeyedController();
  controller.setMotionTime(2);
  controller.updateNodeTransform('hero', { translation: [3, 0.5, 0] });
  controller.moveNodeKeyframe('hero', 2, 0);
  assert.deepEqual(controller.nodeKeyframeTimes('hero'), [0]);
  assert.equal(trackOf(controller, 'translation').keyframes[0].value[0], 3);
});

test('a negative target time clamps to zero', () => {
  const controller = makeKeyedController();
  controller.setMotionTime(2);
  controller.updateNodeTransform('hero', { translation: [3, 0.5, 0] });
  controller.moveNodeKeyframe('hero', 2, -5);
  assert.deepEqual(controller.nodeKeyframeTimes('hero'), [0]);
});

test('deleting a key removes it, and deleting the last key removes the track and the empty motion', () => {
  const controller = makeKeyedController();
  controller.setMotionTime(2);
  controller.updateNodeTransform('hero', { translation: [3, 0.5, 0] });
  const keyedRecipe = controller.exportRecipe();
  controller.deleteNodeKeyframe('hero', 2);
  assert.deepEqual(controller.nodeKeyframeTimes('hero'), [0]);
  controller.deleteNodeKeyframe('hero', 0);
  assert.equal(controller.exportRecipe().motion ?? null, null);
  assert.equal(controller.motionTime, 0);
  controller.undo();
  controller.undo();
  assert.deepEqual(controller.exportRecipe(), keyedRecipe);
});

test('moving or deleting a missing key is refused', () => {
  const controller = makeKeyedController();
  assert.throws(() => controller.moveNodeKeyframe('hero', 1, 2), RangeError);
  assert.throws(() => controller.deleteNodeKeyframe('hero', 1), RangeError);
  assert.throws(() => controller.deleteNodeKeyframe('nobody', 0), RangeError);
});

test('an auto-keyed edit is one undo step, also when undone with the playhead elsewhere', () => {
  const controller = makeKeyedController();
  controller.setMotionTime(2);
  const before = controller.exportRecipe();
  controller.updateNodeTransform('hero', { translation: [3, 0.5, 0] });
  controller.setMotionTime(0.5);
  controller.undo();
  assert.deepEqual(controller.exportRecipe(), before);
  controller.redo();
  assert.deepEqual(keyTimes(controller), [0, 2]);
  controller.setMotionTime(2);
  const beforeDrag = controller.exportRecipe();
  dragAlongX(controller, 1).end();
  assert.notDeepEqual(controller.exportRecipe(), beforeDrag);
  controller.setMotionTime(0);
  controller.undo();
  assert.deepEqual(controller.exportRecipe(), beforeDrag);
});

test('the recipe is the same with auto-key on or off, and off leaves every edit as it was', () => {
  const run = enabled => {
    const controller = makeKeyedController();
    controller.setAutoKey(enabled);
    assert.equal(controller.autoKey, enabled);
    return controller.exportRecipe();
  };
  assert.deepEqual(run(true), run(false));
  const controller = makeKeyedController();
  controller.setAutoKey(false);
  controller.setMotionTime(2);
  controller.updateNodeTransform('hero', { translation: [3, 0.5, 0] });
  assert.deepEqual(keyTimes(controller), [0]);
  assert.equal(nodeOf(controller).translation[0], 3);
  assert.equal(JSON.stringify(controller.exportRecipe()).includes('autoKey'), false);
});

test('auto-key starts on and announces a change', () => {
  const changes = [];
  const controller = createStudioController({
    scene: createAgentScene(makeRecipe()),
    viewportWidth: 800,
    viewportHeight: 600,
    onChange: detail => changes.push(detail),
  });
  assert.equal(controller.autoKey, true);
  controller.setAutoKey(false);
  assert.equal(changes.at(-1).kind, 'autoKey');
  assert.equal(controller.autoKey, false);
  assert.throws(() => controller.setAutoKey('no'), TypeError);
});

test('extra track fields survive every key operation', () => {
  const recipe = makeRecipe();
  recipe.motion = {
    duration: 4,
    loop: true,
    tracks: [{
      kind: 'node',
      id: 'hero',
      property: 'translation',
      interpolation: 'STEP',
      keyframes: [{ time: 0, value: [0, 0.5, 0] }, { time: 1, value: [1, 0.5, 0] }],
    }],
  };
  const controller = makeController(recipe);
  controller.setMotionTime(2);
  controller.updateNodeTransform('hero', { translation: [2, 0.5, 0] });
  assert.equal(trackOf(controller, 'translation').interpolation, 'STEP');
  controller.moveNodeKeyframe('hero', 2, 3);
  assert.equal(trackOf(controller, 'translation').interpolation, 'STEP');
  controller.deleteNodeKeyframe('hero', 1);
  assert.equal(trackOf(controller, 'translation').interpolation, 'STEP');
  assert.deepEqual(keyTimes(controller), [0, 3]);
});
