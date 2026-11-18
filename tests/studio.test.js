import './support/load-agent-scene-modules.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAgentScene } from '../src/agent-scene.js';
import { MAX_POINT_LIGHTS } from '../src/light-limits.js';
import { hexToLinearRgb } from '../src/studio-controller.js';
import {
  STUDIO_PRIMITIVES,
  STUDIO_TABS,
  STUDIO_TEMPLATES,
  STUDIO_TOOLS,
  buildTemplateRecipe,
  createStudioController,
} from '../src/studio.js';
import { STUDIO_ICON_NAMES, STUDIO_ICON_PATHS, studioIconPath } from '../src/studio-icons.js';
import { primitiveGeometrySpec } from '../src/studio-templates.js';

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

  // Shift snaps the travel to quarter-metre steps along the object's own axis.
  controller.setTool('translate');
  handles = controller.gizmoHandles();
  const beforeSnapMove = heroNode().translation;
  grab = pointAlong(handles, 'x', handles.handleLength);
  release = pointAlong(handles, 'x', handles.handleLength + 0.6);
  controller.beginGizmoDrag('x', grab.x, grab.y);
  controller.updateGizmoDrag(release.x, release.y, { shiftKey: true });
  controller.endGizmoDrag();
  turnedX.forEach((value, index) => {
    assert.ok(Math.abs(heroNode().translation[index] - beforeSnapMove[index] - value * 0.5) < 1e-3);
  });

  // Uniform scale from the centre handle: one handle length of drag doubles the size.
  controller.setTool('scale');
  handles = controller.gizmoHandles();
  controller.beginGizmoDrag('uniform', handles.origin.x, handles.origin.y);
  controller.updateGizmoDrag(handles.origin.x + 74, handles.origin.y);
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

test('selectionOutline wraps the selected object on screen and follows it', () => {
  const scene = createAgentScene(makeStudioRecipe());
  const controller = createStudioController({ scene, viewportWidth: 800, viewportHeight: 600 });
  controller.selectNode(null);
  assert.equal(controller.selectionOutline(), null);

  controller.selectNode('hero');
  const outline = controller.selectionOutline();
  assert.ok(outline.length >= 4);
  const centre = controller.projectWorldPoint([0, 0.5, 0]);
  const bounds = points => ({
    left: Math.min(...points.map(point => point[0])),
    right: Math.max(...points.map(point => point[0])),
    top: Math.min(...points.map(point => point[1])),
    bottom: Math.max(...points.map(point => point[1])),
  });
  const heroBounds = bounds(outline);
  assert.ok(heroBounds.left < centre.x && centre.x < heroBounds.right);
  assert.ok(heroBounds.top < centre.y && centre.y < heroBounds.bottom);
  const corner = controller.projectWorldPoint([0.5, 1, 0.5]);
  assert.ok(outline.some(point => Math.hypot(point[0] - corner.x, point[1] - corner.y) < 8), 'the outline passes by the near top corner of the bevelled box');

  controller.updateNodeTransform('hero', { translation: [1.5, 0.5, 0] });
  assert.ok(bounds(controller.selectionOutline()).left > heroBounds.left + 40);

  controller.selectNode('orb');
  const orbCentre = controller.projectWorldPoint([2.2, 0.5, 0]);
  const orbRadii = controller.selectionOutline().map(point => Math.hypot(point[0] - orbCentre.x, point[1] - orbCentre.y));
  assert.ok(Math.max(...orbRadii) - Math.min(...orbRadii) < 6, 'a sphere outline is round');
  controller.dispose();
});

test('every Studio template builds a scene the agent recipe accepts, and unknown names say what to pass', () => {
  for (const templateName of Object.keys(STUDIO_TEMPLATES)) {
    const recipe = buildTemplateRecipe(templateName);
    assert.equal(recipe.format, 'crucible.scene');
    const scene = createAgentScene(recipe);
    assert.ok(scene.parts.length >= 1, `${templateName} has no parts`);
    const controller = createStudioController({ scene, viewportWidth: 800, viewportHeight: 600 });
    assert.deepEqual(controller.exportRecipe().nodes.map(node => node.id), recipe.nodes.map(node => node.id));
  }
  assert.deepEqual(buildTemplateRecipe(), buildTemplateRecipe('showcase'));
  assert.throws(() => buildTemplateRecipe('castle'), /Unknown Studio template "castle"\. Use one of showcase, pedestal, courtyard, empty\./);
});

test('every Studio primitive has a starting shape that sits on the ground and builds', () => {
  for (const primitiveType of STUDIO_PRIMITIVES) {
    const spec = primitiveGeometrySpec(primitiveType);
    assert.ok(spec.labelPrefix.length > 0);
    assert.equal(spec.translation.length, 3);
    assert.equal(spec.rotation.length, 4);
    assert.equal(spec.scale.length, 3);
    const scene = createAgentScene({
      format: 'crucible.scene',
      schemaVersion: 1,
      geometries: [{ id: 'shape', ...spec.geometry }],
      materials: [{ id: 'paint', tag: 'surface', color: [0.5, 0.5, 0.5], roughness: 0.5, metallic: 0 }],
      nodes: [{ id: 'node', geometry: 'shape', material: 'paint', translation: spec.translation, rotation: spec.rotation, scale: spec.scale }],
    });
    assert.equal(scene.parts.length, 1, `${primitiveType} did not build one part`);
  }
});

test('every Studio tool and tab has an icon, and an unknown icon name lists the valid ones', () => {
  for (const name of [...STUDIO_TOOLS, ...STUDIO_TABS]) {
    assert.match(studioIconPath(name), /^M[\d.]/, `${name} has no path`);
  }
  assert.equal(new Set(Object.values(STUDIO_ICON_PATHS)).size, STUDIO_ICON_NAMES.length, 'two icons share one drawing');
  assert.throws(() => studioIconPath('rocket'), /Unknown Studio icon "rocket"\. Use one of: select, translate/);
});

test('the Studio controller says what to pass when a scene, a callback or a point is wrong', () => {
  assert.throws(() => createStudioController({ scene: {} }), /Studio scene must provide apply\(\)/);
  const incomplete = { apply() {}, exportRecipe() {}, inspect() {} };
  assert.throws(() => createStudioController({ scene: incomplete }), /must provide parts and camera/);
  const scene = createAgentScene(makeStudioRecipe());
  assert.throws(() => createStudioController({ scene, onChange: 'nope' }), /onChange must be a function/);

  const controller = createStudioController({ scene });
  assert.throws(() => controller.selectNode(7), /expects a node ID string or null/);
  assert.throws(() => controller.screenRay(Number.NaN, 4), /finite pixelX and pixelY/);
  assert.throws(() => controller.projectWorldPoint([1, 2]), /worldPoint must be an array of 3 finite numbers/);
  assert.throws(() => hexToLinearRgb('red'), /Color must be a #rrggbb hex string, got "red"/);
  assert.throws(() => controller.updateMaterial('paint', null), /expects a patch object/);
  assert.throws(() => controller.updateMaterial('paint', { roughness: 'rough' }), /Material roughness must be a finite number/);
  assert.throws(() => controller.updateNodeTransform('hero', null), /expects a patch object/);
  assert.throws(() => controller.updateNodeTransform('hero', { label: 4 }), /Node label must be a string/);
  assert.throws(() => controller.updateNodeTransform('hero', { parent: 'ghost' }), /Unknown parent node "ghost"/);
  assert.throws(() => controller.updateNodeTransform('hero', { parent: 'hero' }), /Cannot parent a node under itself/);
  assert.throws(() => controller.updateNodeTransform('hero', { scale: [1, 0, 1] }), /scale components must stay positive/);
  assert.throws(() => controller.updateNodeTransform('hero', { translation: [1, 2] }), /translation must be an array of 3/);
  assert.throws(() => controller.updateNodeTransform('hero', { visible: 'yes' }), /visible must be true or false/);
  assert.throws(() => controller.assignNodeMaterial('ghost', 'paint'), /has no geometry to paint/);
  assert.throws(() => controller.assignNodeMaterial('hero', 'ghost'), /Unknown material "ghost"/);
  assert.throws(() => controller.applyMaterialPreset('paint', 'lava'), /Unknown material preset "lava"/);
  assert.throws(() => controller.setSunAngles({ keyIntensity: -1 }), /keyIntensity must be a non-negative/);
  assert.throws(() => controller.updateCamera(null), /expects a camera patch object/);
  assert.throws(() => controller.setCameraViewPreset('under'), /Unknown camera view "under"/);
  assert.throws(() => controller.addSceneLight('laser'), /Unsupported light type "laser"\. Use point or spot/);
  assert.throws(() => controller.addPrimitive('torus-knot'), /torus-knot/);
  assert.throws(() => controller.insertNodeKeyframe('ghost'), /Unknown node "ghost"/);
  assert.throws(() => controller.setMotionTime(2), /Add a keyframe or motion track/);
  assert.equal(controller.setMotionTime(0), 0);
  controller.selectNode(null);
  assert.throws(() => controller.insertNodeKeyframe(), /Select a node before inserting a keyframe/);
  assert.throws(() => controller.duplicateSelected(), /Select a node before duplicating it/);
  assert.throws(() => controller.deleteSelected(), /Select a node before deleting it/);
  assert.throws(() => controller.snapSelectedToAt(10, 10), /Select a node before snapping it to a surface/);
  assert.equal(controller.undo(), false);
  assert.equal(controller.redo(), false);
  assert.equal(controller.endGizmoDrag(), false);
  assert.equal(controller.updateGizmoDrag(10, 10), null);
  const revisionBefore = controller.scene.revision;
  controller.updateLook({});
  assert.equal(controller.scene.revision, revisionBefore);
  controller.dispose();
});

test('the Studio controller stops lights when the shadow atlas is full and refuses a bad gizmo drag', () => {
  const controller = createStudioController({ scene: createAgentScene(makeStudioRecipe()), viewportWidth: 800, viewportHeight: 600 });
  let pointLights = 0;
  assert.throws(() => {
    for (let count = 1; count <= MAX_POINT_LIGHTS; count += 1) {
      pointLights = controller.addSceneLight('point');
    }
  }, /Shadow casting lights need [0-9]+ atlas tiles/);
  assert.equal(pointLights, 4, 'the shadow atlas holds four point lights');
  assert.equal(controller.exportRecipe().environment.pointLights.length, 4);
  assert.throws(() => controller.addSceneLight('spot'), /atlas tiles/);

  controller.selectNode('hero');
  assert.throws(() => controller.beginGizmoDrag('w', 10, 10), /Unsupported gizmo axis "w"/);
  assert.throws(() => controller.beginGizmoDrag('x', Number.NaN, 10), /finite pixel coordinates/);
  controller.setTool('select');
  controller.beginGizmoDrag('screen', 400, 300);
  assert.throws(() => controller.updateGizmoDrag(Number.NaN, 4), /finite pixel coordinates/);
  assert.ok(controller.updateGizmoDrag(420, 300).translation, 'a screen drag moves the node in the view plane');
  assert.equal(controller.endGizmoDrag(), true);
  controller.dispose();
});

test('the Studio controller reports unchanged drags as cancelled and keeps single-step history', () => {
  const kinds = [];
  const controller = createStudioController({ scene: createAgentScene(makeStudioRecipe()), viewportWidth: 800, viewportHeight: 600, onChange: detail => kinds.push(detail.kind) });
  controller.selectNode('hero');
  controller.setTool('translate');
  const handles = controller.gizmoHandles();
  const tip = controller.projectWorldPoint([handles.pivot[0] + handles.handleLength, handles.pivot[1], handles.pivot[2]]);
  controller.beginGizmoDrag('x', tip.x, tip.y);
  assert.equal(controller.endGizmoDrag(), false);
  assert.ok(kinds.includes('transformCancel'));
  assert.equal(controller.canUndo, false);
  controller.dispose();
});

test('rotate rings, move planes and surface snapping drag through every axis', () => {
  const controller = createStudioController({ scene: createAgentScene(makeStudioRecipe()), viewportWidth: 800, viewportHeight: 600 });
  controller.selectNode('hero');
  const heroNode = () => controller.exportRecipe().nodes.find(node => node.id === 'hero');

  controller.setTool('rotate');
  for (const axis of ['x', 'z']) {
    const handles = controller.gizmoHandles();
    assert.equal(handles.rings[axis].length > 8, true);
    const visibleRing = handles.rings[axis].filter(point => point.visible);
    const grab = visibleRing[0];
    const release = visibleRing[Math.floor(visibleRing.length / 4)];
    controller.beginGizmoDrag(axis, grab.x, grab.y);
    const result = controller.updateGizmoDrag(release.x, release.y);
    assert.ok(result, `${axis} ring drag returns the new rotation`);
    assert.equal(controller.endGizmoDrag(), true);
  }
  assert.notDeepEqual(heroNode().rotation, [0, 0, 0, 1]);

  controller.setTool('translate');
  controller.updateNodeTransform('hero', { translation: [0, 0.5, 0], rotationDegrees: [0, 0, 0] });
  controller.setCameraViewPreset('isometric');
  const handles = controller.gizmoHandles();
  for (const planeAxis of ['xy', 'xz', 'yz']) {
    const corners = handles.planes[planeAxis];
    assert.equal(corners.length, 4);
    assert.ok(corners.every(corner => corner.visible), planeAxis);
    const center = { x: corners.reduce((sum, corner) => sum + corner.x, 0) / 4, y: corners.reduce((sum, corner) => sum + corner.y, 0) / 4 };
    const before = heroNode().translation.slice();
    controller.beginGizmoDrag(planeAxis, center.x, center.y);
    controller.updateGizmoDrag(center.x + 25, center.y - 18);
    assert.equal(controller.endGizmoDrag(), true);
    assert.notDeepEqual(heroNode().translation, before, planeAxis);
    controller.updateNodeTransform('hero', { translation: [0, 0.5, 0] });
  }

  controller.setTool('snap');
  controller.updateNodeTransform('hero', { translation: [0, 4, 0] });
  const floorPoint = controller.projectWorldPoint([0, 0, -2]);
  controller.beginGizmoDrag('surface', floorPoint.x, floorPoint.y);
  const snapped = controller.updateGizmoDrag(floorPoint.x, floorPoint.y);
  assert.ok(snapped.translation[1] < 1.2);
  assert.equal(controller.updateGizmoDrag(5, 5), null, 'a pointer over the sky leaves the object where it is');
  assert.equal(controller.endGizmoDrag(), true);
  controller.undo();
  assert.deepEqual(heroNode().translation, [0, 4, 0]);

  assert.equal(controller.snapSelectedToAt(5, 5), null, 'nothing to land on under the sky');
  controller.dispose();
});

test('a child node moves along its own parent axes and snaps in its parent space', () => {
  const recipe = makeStudioRecipe();
  recipe.nodes.push({ id: 'rig', translation: [1, 0, 0], rotation: [0, 0.70710678, 0, 0.70710678], scale: [2, 2, 2] });
  recipe.nodes.find(node => node.id === 'hero').parent = 'rig';
  const controller = createStudioController({ scene: createAgentScene(recipe), viewportWidth: 800, viewportHeight: 600 });
  controller.selectNode('hero');
  controller.setTool('translate');
  const handles = controller.gizmoHandles();
  const along = (axis, distance) => controller.projectWorldPoint(handles.pivot.map((value, index) => value + handles.basis[axis][index] * distance));
  const grab = along('x', handles.handleLength);
  const release = along('x', handles.handleLength + 0.5);
  const before = controller.exportRecipe().nodes.find(node => node.id === 'hero').translation.slice();
  controller.beginGizmoDrag('x', grab.x, grab.y);
  controller.updateGizmoDrag(release.x, release.y);
  controller.endGizmoDrag();
  const after = controller.exportRecipe().nodes.find(node => node.id === 'hero').translation;
  assert.notDeepEqual(after, before);
  assert.ok(Math.abs(Math.hypot(...after.map((value, index) => value - before[index])) - 0.25) < 0.02, 'half a world metre is a quarter metre inside a parent scaled by two');

  controller.setTool('snap');
  const floorPoint = controller.projectWorldPoint([3, 0, 0]);
  const snapped = controller.snapSelectedToAt(floorPoint.x, floorPoint.y);
  assert.ok(snapped);

  controller.selectNode('rig');
  assert.equal(controller.selectionOutline().length > 2, true, 'a group outlines its children');
  controller.dispose();
});

test('selectionOutline is null without a selection, for a group without parts and when everything is off screen', () => {
  const recipe = makeStudioRecipe();
  recipe.nodes.push({ id: 'empty-group', translation: [0, 0, 0] });
  const controller = createStudioController({ scene: createAgentScene(recipe), viewportWidth: 800, viewportHeight: 600 });
  controller.selectNode(null);
  assert.equal(controller.selectionOutline(), null);
  assert.equal(controller.gizmoHandles(), null);
  controller.selectNode('empty-group');
  assert.equal(controller.selectionOutline(), null);
  assert.ok(controller.gizmoHandles());

  controller.selectNode('hero');
  controller.updateCamera({ eye: [0, 0.5, 20], target: [0, 0.5, 30] });
  assert.equal(controller.selectionOutline(), null, 'an object behind the camera has no outline');
  assert.equal(controller.gizmoHandles().origin.visible, false);
  controller.dispose();
});

test('the Studio controller loads a recipe under a playing time and clamps it to the new length', () => {
  const controller = createStudioController({ scene: createAgentScene(makeStudioRecipe({ animated: true })), viewportWidth: 800, viewportHeight: 600 });
  controller.setMotionTime(1.2);
  const shorter = controller.exportRecipe();
  shorter.motion.duration = 0.6;
  shorter.motion.tracks[0].keyframes[1].time = 0.6;
  controller.loadRecipe(shorter);
  assert.equal(controller.motionTime, 0.6);
  controller.insertNodeKeyframe('hero');
  assert.equal(controller.exportRecipe().motion.tracks.find(track => track.property === 'translation').keyframes.length >= 2, true);
  controller.setMotionTime(0.3);
  controller.insertNodeKeyframe('orb');
  controller.insertNodeKeyframe('orb');
  const orbTrack = controller.exportRecipe().motion.tracks.find(track => track.id === 'orb' && track.property === 'translation');
  assert.equal(orbTrack.keyframes.length, 1, 'a second keyframe at the same time replaces the first');
  controller.dispose();
});

test('deleting a node removes its animation and keeps tracks that belong to other nodes', () => {
  const recipe = makeStudioRecipe({ animated: true });
  recipe.motion.tracks.push({
    kind: 'node',
    id: 'orb',
    property: 'translation',
    keyframes: [
      { time: 0, value: [2.2, 0.5, 0] },
      { time: 1.5, value: [2.2, 1.5, 0] },
    ],
  });
  const controller = createStudioController({ scene: createAgentScene(recipe), viewportWidth: 800, viewportHeight: 600 });
  controller.selectNode('hero');
  controller.deleteSelected();
  assert.deepEqual(controller.exportRecipe().motion.tracks.map(track => track.id), ['orb']);
  controller.selectNode('orb');
  controller.deleteSelected();
  assert.equal(controller.exportRecipe().motion ?? null, null);
  controller.dispose();
});

test('orthographic zoom scales the view size and Studio history keeps only the newest edits', () => {
  const controller = createStudioController({ scene: createAgentScene(makeStudioRecipe()), viewportWidth: 800, viewportHeight: 600, maxHistory: 3 });
  controller.updateCamera({ projection: 'orthographic', orthoScale: 4 });
  controller.orbitCamera({ zoomScale: 2 });
  assert.equal(controller.scene.camera.orthoScale, 8);
  controller.selectNode('hero');
  for (let step = 1; step <= 6; step += 1) {
    controller.updateNodeTransform('hero', { translation: [step, 0.5, 0] });
  }
  let undone = 0;
  while (controller.undo()) undone += 1;
  assert.equal(undone, 3);
  controller.dispose();
});
