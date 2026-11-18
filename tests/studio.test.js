import './support/load-agent-scene-modules.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAgentScene } from '../src/agent-scene.js';
import {
  STUDIO_TABS,
  STUDIO_TOOLS,
  createStudioController,
} from '../src/studio.js';

function makeStudioRecipe({ animated = false, loop = true } = {}) {
  const recipe = {
    format: 'crucible.scene',
    schemaVersion: 1,
    geometries: [
      { id: 'floor', type: 'box', bevel: 0 },
      { id: 'cube', type: 'box', bevel: 0.04 },
      { id: 'sphere', type: 'sphere', segments: 16, rings: 12 },
    ],
    materials: [
      { id: 'stone', tag: 'surface', color: [0.3, 0.32, 0.35], roughness: 0.8, metallic: 0 },
      { id: 'paint', tag: 'surface', color: [0.8, 0.25, 0.2], roughness: 0.4, metallic: 0.1 },
    ],
    nodes: [
      { id: 'ground', geometry: 'floor', material: 'stone', translation: [0, -0.2, 0], scale: [10, 0.4, 10] },
      { id: 'hero', geometry: 'cube', material: 'paint', translation: [0, 0.5, 0] },
      { id: 'orb', geometry: 'sphere', material: 'paint', translation: [2.2, 0.5, 0], scale: [0.5, 0.5, 0.5] },
    ],
    camera: {
      eye: [0, 2, 6],
      target: [0, 0.5, 0],
      up: [0, 1, 0],
      fov: 45,
      near: 0.1,
      far: 100,
    },
    environment: {
      setup: 'studio',
      lightDirection: [-2, 5, 3],
    },
  };
  if (animated) {
    recipe.motion = {
      duration: 1.5,
      loop,
      tracks: [
        {
          kind: 'node',
          id: 'hero',
          property: 'translation',
          keyframes: [
            { time: 0, value: [0, 0.5, 0] },
            { time: 1.5, value: [0, 1.5, 0] },
          ],
        },
      ],
    };
  }
  return recipe;
}

test('createStudioController validates inputs and enforces tool, tab and node bounds', () => {
  assert.throws(() => createStudioController({}), /requires a scene/);
  const scene = createAgentScene(makeStudioRecipe());
  assert.throws(() => createStudioController({ scene, viewportWidth: 0 }), /viewportWidth/);
  assert.throws(() => createStudioController({ scene, maxHistory: 0 }), /maxHistory/);

  const controller = createStudioController({ scene, viewportWidth: 800, viewportHeight: 600 });
  assert.deepEqual(STUDIO_TOOLS, ['select', 'translate', 'rotate', 'scale', 'snap']);
  assert.deepEqual(STUDIO_TABS, ['node', 'material', 'look', 'camera']);
  assert.throws(() => controller.selectNode('missing-node'), /Unknown node/);
  assert.throws(() => controller.setTool('sculpt'), /Unknown Studio tool/);
  assert.throws(() => controller.setActiveTab('physics'), /Unknown Studio tab/);
  assert.throws(() => controller.saveBookmark('bad name!'), /Bookmark name/);
  assert.throws(() => controller.applyBookmark('missing'), /Unknown camera bookmark/);
  assert.throws(() => controller.removeBookmark('missing'), /Unknown camera bookmark/);
  assert.throws(() => controller.setMotionTime(9999), /Motion time/);
  controller.selectNode(null);
  assert.throws(() => controller.beginGizmoDrag('x', 100, 100), /Select a node/);
  controller.dispose();
});

test('viewport projection, unprojection and click picking select the frontmost node or clear on sky', () => {
  const scene = createAgentScene(makeStudioRecipe());
  const controller = createStudioController({ scene, viewportWidth: 800, viewportHeight: 600 });

  const heroScreen = controller.projectWorldPoint([0, 0.5, 0]);
  assert.equal(heroScreen.visible, true);
  assert.ok(Math.abs(heroScreen.x - 400) < 2);
  assert.ok(Math.abs(heroScreen.y - 300) < 2);

  const hitHero = controller.pickAt(heroScreen.x, heroScreen.y);
  assert.equal(hitHero?.id, 'hero');
  assert.equal(controller.selectedNodeId, 'hero');

  const orbScreen = controller.projectWorldPoint([2.2, 0.5, 0]);
  const hitOrb = controller.pickAt(orbScreen.x, orbScreen.y);
  assert.equal(hitOrb?.id, 'orb');
  assert.equal(controller.selectedNodeId, 'orb');

  const skyHit = controller.pickAt(15, 15);
  assert.equal(skyHit, null);
  assert.equal(controller.selectedNodeId, null);

  // Trigger a topology change via add-node and ensure pick still indexes the new geometry cleanly.
  scene.apply([
    { type: 'add-node', node: { id: 'extra', geometry: 'cube', material: 'paint', translation: [-2.2, 0.5, 0] } },
  ], { expectedRevision: scene.revision });
  const extraScreen = controller.projectWorldPoint([-2.2, 0.5, 0]);
  const hitExtra = controller.pickAt(extraScreen.x, extraScreen.y);
  assert.equal(hitExtra?.id, 'extra');
  controller.dispose();
});

test('gizmo handles and drags update translate, rotate with snap, scale and surface snap in the recipe', () => {
  const scene = createAgentScene(makeStudioRecipe());
  const controller = createStudioController({ scene, viewportWidth: 800, viewportHeight: 600 });
  controller.selectNode('hero');

  const heroNode = () => controller.exportRecipe().nodes.find(node => node.id === 'hero');
  const pointAlong = (handles, axis, distance) => controller.projectWorldPoint([
    handles.pivot[0] + handles.basis[axis][0] * distance,
    handles.pivot[1] + handles.basis[axis][1] * distance,
    handles.pivot[2] + handles.basis[axis][2] * distance,
  ]);

  let handles = controller.gizmoHandles();
  assert.ok(handles);
  assert.equal(handles.origin.visible, true);
  assert.deepEqual(handles.basis, { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] });

  // Translate along X: the object ends exactly where the pointer went along the axis.
  controller.setTool('translate');
  let grab = pointAlong(handles, 'x', handles.handleLength);
  let release = pointAlong(handles, 'x', handles.handleLength + 0.8);
  controller.beginGizmoDrag('x', grab.x, grab.y);
  controller.updateGizmoDrag(release.x, release.y);
  assert.equal(controller.endGizmoDrag(), true);
  assert.ok(Math.abs(heroNode().translation[0] - 0.8) < 0.01, `expected x near 0.8, got ${heroNode().translation[0]}`);
  assert.ok(Math.abs(heroNode().translation[1] - 0.5) < 1e-6);
  assert.ok(Math.abs(heroNode().translation[2]) < 1e-6);

  // Rotate around Y: the turn equals the angle the pointer swept on the ring, snapped to 15 degrees.
  controller.setTool('rotate');
  handles = controller.gizmoHandles();
  const ringPoint = degrees => controller.projectWorldPoint([
    handles.pivot[0] + Math.cos((degrees * Math.PI) / 180),
    handles.pivot[1],
    handles.pivot[2] - Math.sin((degrees * Math.PI) / 180),
  ]);
  grab = ringPoint(0);
  release = ringPoint(33);
  controller.beginGizmoDrag('y', grab.x, grab.y);
  controller.updateGizmoDrag(release.x, release.y, { shiftKey: true });
  controller.endGizmoDrag();
  const rotated = heroNode();
  assert.ok(Math.abs(Math.hypot(...rotated.rotation) - 1) < 1e-3);
  assert.ok(Math.abs(rotated.rotation[1] - Math.sin((15 * Math.PI) / 180)) < 1e-3, `expected a 30 degree turn, got ${rotated.rotation}`);

  // The handles now follow the turned object, and a drag along its X moves it along that turned axis.
  controller.setTool('translate');
  handles = controller.gizmoHandles();
  const turnedX = [Math.cos(Math.PI / 6), 0, -Math.sin(Math.PI / 6)];
  handles.basis.x.forEach((value, index) => assert.ok(Math.abs(value - turnedX[index]) < 1e-3));
  const beforeLocalMove = heroNode().translation;
  grab = pointAlong(handles, 'x', handles.handleLength);
  release = pointAlong(handles, 'x', handles.handleLength + 0.5);
  controller.beginGizmoDrag('x', grab.x, grab.y);
  controller.updateGizmoDrag(release.x, release.y);
  controller.endGizmoDrag();
  const afterLocalMove = heroNode().translation;
  turnedX.forEach((value, index) => {
    assert.ok(Math.abs(afterLocalMove[index] - beforeLocalMove[index] - value * 0.5) < 0.01);
  });

  // Axis scale: pulling the handle to twice its distance doubles that axis only.
  controller.setTool('scale');
  handles = controller.gizmoHandles();
  grab = pointAlong(handles, 'y', handles.handleLength);
  release = pointAlong(handles, 'y', handles.handleLength * 2);
  controller.beginGizmoDrag('y', grab.x, grab.y);
  controller.updateGizmoDrag(release.x, release.y);
  controller.endGizmoDrag();
  assert.ok(Math.abs(heroNode().scale[1] - 2) < 0.01, `expected y scale near 2, got ${heroNode().scale}`);
  assert.ok(Math.abs(heroNode().scale[0] - 1) < 1e-6);

  // Uniform scale: the factor is how far the pointer went from the pivot compared with where it grabbed.
  handles = controller.gizmoHandles();
  controller.beginGizmoDrag('uniform', handles.origin.x + 40, handles.origin.y);
  controller.updateGizmoDrag(handles.origin.x + 80, handles.origin.y);
  controller.endGizmoDrag();
  const scaled = heroNode();
  assert.ok(Math.abs(scaled.scale[0] - 2) < 0.01 && Math.abs(scaled.scale[1] - 4) < 0.02 && Math.abs(scaled.scale[2] - 2) < 0.01);

  // Move hero high up then surface-snap onto the floor top (y = 0 + half-height of scaled box)
  controller.updateNodeTransform('hero', { translation: [0, 5, 0], rotationDegrees: [0, 0, 0], scale: [1, 2, 1] });
  const floorScreen = controller.projectWorldPoint([0, 0, -2]);
  const snapped = controller.snapSelectedToAt(floorScreen.x, floorScreen.y);
  assert.ok(snapped);
  assert.ok(Math.abs(snapped[1] - 1.0) < 0.05, `expected snapped box center near y=1.0, got ${snapped[1]}`);
  controller.dispose();
});

test('material, sun, look, camera bookmarks and motion scrubbing persist cleanly in exported recipes', () => {
  const animatedRecipe = makeStudioRecipe({ animated: true, loop: false });
  const scene = createAgentScene(animatedRecipe);
  const controller = createStudioController({ scene, viewportWidth: 800, viewportHeight: 600 });

  controller.updateMaterial('paint', { hexColor: '#3399ff', roughness: 0.18, metallic: 0.85, emission: 1.5 });
  controller.setSunAngles({ azimuthDegrees: 45, elevationDegrees: 30, keyIntensity: 3.1 });
  controller.updateLook({ environment: { viewTransform: 'agx' }, effects: { exposure: 1.25 } });

  controller.orbitCamera({ deltaAzimuth: 0.4, deltaElevation: 0.1, zoomScale: 0.8 });
  const savedShot = controller.saveBookmark('AngleA');
  assert.equal(savedShot.name, 'AngleA');
  assert.equal(controller.listBookmarks().length, 1);

  controller.frameSelection();
  const framedEye = controller.scene.camera.eye;
  assert.notDeepEqual(framedEye, savedShot.camera.eye);

  controller.applyBookmark('AngleA');
  assert.deepEqual(controller.scene.camera.eye.map(value => Math.round(value * 100) / 100), savedShot.camera.eye.map(value => Math.round(value * 100) / 100));

  controller.setMotionTime(0.75);
  assert.equal(controller.motionTime, 0.75);

  const exported = controller.exportRecipe();
  const reloaded = createAgentScene(exported);
  assert.equal(reloaded.exportRecipe().timeline.shots[0].name, 'AngleA');
  assert.equal(reloaded.exportRecipe().environment.viewTransform, 'agx');
  assert.equal(reloaded.exportRecipe().effects.exposure, 1.25);

  controller.removeBookmark('AngleA');
  assert.equal(controller.exportRecipe().timeline, undefined);
  controller.dispose();
});

test('undo, redo and external loadRecipe handle more edits than agent REVISION_HISTORY_LIMIT', () => {
  const scene = createAgentScene(makeStudioRecipe());
  const controller = createStudioController({ scene, viewportWidth: 800, viewportHeight: 600, maxHistory: 16 });
  assert.equal(controller.canUndo, false);

  for (let step = 1; step <= 7; step += 1) {
    controller.updateNodeTransform('hero', { translation: [step, 0.5, 0] });
  }
  assert.equal(controller.exportRecipe().nodes.find(node => node.id === 'hero').translation[0], 7);
  assert.equal(controller.canUndo, true);

  for (let step = 7; step >= 1; step -= 1) {
    assert.equal(controller.undo(), true);
  }
  assert.equal(controller.canUndo, false);
  assert.equal(controller.exportRecipe().nodes.find(node => node.id === 'hero').translation[0], 0);
  assert.equal(controller.canRedo, true);

  assert.equal(controller.redo(), true);
  assert.equal(controller.exportRecipe().nodes.find(node => node.id === 'hero').translation[0], 1);

  const incoming = makeStudioRecipe();
  incoming.nodes[1].translation = [-3, 0.5, 1];
  controller.loadRecipe(incoming);
  assert.equal(controller.exportRecipe().nodes.find(node => node.id === 'hero').translation[0], -3);
  controller.undo();
  assert.equal(controller.exportRecipe().nodes.find(node => node.id === 'hero').translation[0], 1);
  controller.dispose();
});

test('pro studio operations add objects, drag planar gizmos, edit materials, lenses and keyframes', () => {
  const scene = createAgentScene(makeStudioRecipe());
  const controller = createStudioController({ scene, viewportWidth: 960, viewportHeight: 600 });
  controller.selectNode('hero');

  // Planar gizmo drag (XZ) and rotation rings check
  const handles = controller.gizmoHandles();
  assert.ok(handles.planes.xy.length === 4);
  assert.ok(handles.rings.x.length > 8);
  controller.setTool('translate');
  controller.beginGizmoDrag('xz', 480, 300);
  controller.updateGizmoDrag(540, 318);
  assert.equal(controller.endGizmoDrag(), true);
  const moved = controller.exportRecipe().nodes.find(node => node.id === 'hero');
  assert.ok(Math.abs(moved.translation[0]) > 0.05);

  // Add primitive + duplicate + reparent + metadata + delete
  const addedTorus = controller.addPrimitive('torus');
  assert.equal(controller.selectedNodeId, addedTorus.id);
  const pointCount = controller.addSceneLight('point');
  assert.equal(pointCount, 1);

  const duplicate = controller.duplicateSelected();
  assert.equal(controller.selectedNodeId, duplicate.id);
  controller.updateNodeTransform(duplicate.id, {
    label: 'Trim Ring',
    parent: addedTorus.id,
    castShadow: false,
    receiveShadow: true,
  });
  const duplicateAfter = controller.exportRecipe().nodes.find(node => node.id === duplicate.id);
  assert.equal(duplicateAfter.label, 'Trim Ring');
  assert.equal(duplicateAfter.parent, addedTorus.id);
  assert.equal(duplicateAfter.castShadow, false);
  assert.equal(duplicateAfter.receiveShadow, true);

  controller.selectNode(addedTorus.id);
  controller.deleteSelected();
  const afterDelete = controller.exportRecipe().nodes;
  assert.equal(afterDelete.some(node => node.id === addedTorus.id), false);
  assert.equal(afterDelete.some(node => node.id === duplicate.id), false);

  // Materials: create, assign, apply preset
  controller.selectNode('hero');
  const goldMaterial = controller.createMaterial({ roughness: 0.25, metallic: 0.9, assignToNodeId: 'hero' });
  controller.applyMaterialPreset(goldMaterial.id, 'gold');
  const assignedNode = controller.exportRecipe().nodes.find(node => node.id === 'hero');
  assert.equal(assignedNode.material, goldMaterial.id);
  const updatedMaterial = controller.exportRecipe().materials.find(item => item.id === goldMaterial.id);
  assert.ok(updatedMaterial.metallic >= 0.95);
  controller.assignNodeMaterial('orb', goldMaterial.id);
  assert.equal(controller.exportRecipe().nodes.find(node => node.id === 'orb').material, goldMaterial.id);

  // Camera view presets, ortho toggle, lens focal length & keyframe insertion
  controller.setCameraViewPreset('front');
  assert.ok(controller.scene.camera.eye[2] > controller.scene.camera.target[2]);
  controller.toggleCameraProjection();
  assert.equal(controller.scene.camera.projection, 'orthographic');
  controller.setCameraLensMillimetres(85);
  assert.equal(controller.scene.camera.projection, 'perspective');
  assert.equal(controller.scene.camera.focalLength, 85);

  const nextMotion = controller.insertNodeKeyframe('hero');
  assert.ok(nextMotion.tracks.length >= 3);
  controller.setMotionTime(1.5);
  controller.updateNodeTransform('hero', { translation: [1.5, 1.2, 0] });
  controller.insertNodeKeyframe('hero');
  controller.setMotionTime(0.75);
  assert.equal(controller.motionTime, 0.75);

  controller.dispose();
});

test('Studio undo groups one slider drag into one step and keeps the camera where it was left', () => {
  const controller = createStudioController({ scene: createAgentScene(makeStudioRecipe()) });
  const materialId = controller.exportRecipe().materials[0].id;
  const roughnessBefore = controller.exportRecipe().materials[0].roughness;

  controller.beginUndoGroup();
  for (let step = 1; step <= 40; step += 1) {
    controller.updateMaterial(materialId, { roughness: 0.1 + step * 0.01 });
  }
  controller.endUndoGroup();
  controller.updateMaterial(materialId, { roughness: 0.9 });

  controller.orbitCamera({ deltaAzimuth: 0.6 });
  const orbitedEye = [...controller.scene.camera.eye];
  assert.equal(controller.undo(), true);
  assert.ok(Math.abs(controller.exportRecipe().materials[0].roughness - 0.5) < 1e-6);
  assert.deepEqual([...controller.scene.camera.eye], orbitedEye);
  assert.equal(controller.undo(), true);
  assert.equal(controller.exportRecipe().materials[0].roughness, roughnessBefore);
  assert.equal(controller.canUndo, false);
  assert.deepEqual([...controller.scene.camera.eye], orbitedEye);

  assert.equal(controller.redo(), true);
  assert.ok(Math.abs(controller.exportRecipe().materials[0].roughness - 0.5) < 1e-6);
  assert.deepEqual([...controller.scene.camera.eye], orbitedEye);
  controller.dispose();
});

test('Studio undo restores the camera when the undone step was a camera edit', () => {
  const controller = createStudioController({ scene: createAgentScene(makeStudioRecipe()) });
  const eyeBefore = [...controller.scene.camera.eye];
  controller.setCameraViewPreset('top');
  assert.notDeepEqual([...controller.scene.camera.eye], eyeBefore);
  assert.equal(controller.undo(), true);
  assert.deepEqual([...controller.scene.camera.eye], eyeBefore);
  controller.dispose();
});
