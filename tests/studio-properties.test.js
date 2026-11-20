import './support/load-agent-scene-modules.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAgentScene } from '../src/agent-scene.js';
import { createStudioController } from '../src/studio.js';
import { PROPERTY_FIELDS, motionPropertyOf, propertyFieldsFor, propertyIsVisible, propertySectionsFor } from '../src/studio-properties.js';

const EXPECTED_FIELDS = {
  point: ['color', 'intensity', 'radius', 'range', 'castShadow', 'softFalloff', 'position'],
  spot: ['color', 'intensity', 'radius', 'range', 'angle', 'penumbra', 'castShadow', 'softFalloff', 'position', 'direction'],
  area: ['color', 'intensity', 'width', 'height', 'castShadow', 'portal', 'position', 'direction'],
  sun: ['direction', 'keyIntensity', 'keyColor', 'sunAngularRadius'],
  camera: ['projection', 'focalLength', 'sensorWidth', 'fov', 'orthoScale', 'near', 'far', 'shift', 'fStop', 'focusDistance', 'eye', 'target'],
};

const CONTEXT = { aspect: 16 / 9 };

function makeRecipe({ motion } = {}) {
  const recipe = {
    format: 'crucible.scene',
    schemaVersion: 1,
    geometries: [{ id: 'g_box', type: 'box' }],
    materials: [{ id: 'm_box', color: [0.5, 0.5, 0.5] }],
    nodes: [{ id: 'box', geometry: 'g_box', material: 'm_box' }],
    camera: { eye: [0, 2, 10], target: [0, 0, 0] },
    environment: {
      setup: 'studio',
      lightDirection: [0, 2, 0],
      pointLights: [{ position: [2.2, 3, 2.2], color: [1, 0.96, 0.9], intensity: 2.5, radius: 0.14, range: 14, castShadow: true }],
      spotLights: [{ position: [2.8, 3.8, 2.8], direction: [-2.8, -3.2, -2.8], angle: 0.65, penumbra: 0.25, color: [1, 0.96, 0.9], intensity: 4, radius: 0.12, range: 16, castShadow: true }],
      areaLights: [{ position: [0, 3.2, 0], direction: [0, -1, 0], width: 2, height: 2, color: [1, 0.96, 0.9], intensity: 4 }],
    },
  };
  if (motion) {
    recipe.motion = motion;
  }
  return recipe;
}

function makeController(options) {
  return createStudioController({ scene: createAgentScene(makeRecipe(options)) });
}

// One value per row that differs from what a fresh light or camera holds, and is valid for it.
const SAMPLE_VALUES = {
  color: [0.2, 0.4, 0.6],
  intensity: 7.5,
  radius: 0.4,
  range: 9,
  width: 3.5,
  height: 1.5,
  angle: 30,
  penumbra: 0.5,
  castShadow: false,
  softFalloff: true,
  portal: true,
  position: [1.5, 2.5, 3.5],
  direction: [0.5, -1, 0.25],
  keyIntensity: 3.2,
  keyColor: [0.9, 0.8, 0.7],
  sunAngularRadius: 0.02,
  projection: true,
  focalLength: 85,
  sensorWidth: 24,
  fov: 60,
  orthoScale: 12,
  near: 0.3,
  far: 250,
  shift: [0.1, -0.2],
  fStop: 4,
  focusDistance: 6,
  eye: [3, 2, 8],
  target: [0.5, 0.5, 0],
};

test('the property table has a row for every light, sun and camera field a person edits', () => {
  for (const [kind, expectedIds] of Object.entries(EXPECTED_FIELDS)) {
    const ids = propertyFieldsFor(kind).map(field => field.id);
    for (const id of expectedIds) {
      assert.ok(ids.includes(id), `${kind} has no ${id} row`);
    }
  }
  for (const field of PROPERTY_FIELDS) {
    assert.ok(['number', 'slider', 'colour', 'toggle', 'vector', 'sunpad'].includes(field.control), `${field.id} control ${field.control}`);
    assert.ok(field.label.length > 0 && field.label.length <= 20, `${field.id} label is short`);
    if (field.control === 'number' || field.control === 'slider') {
      assert.ok(field.min < field.max && field.step > 0, `${field.id} range`);
    }
  }
  assert.deepEqual(propertySectionsFor('spot').map(section => section.title), ['Light', 'Shape', 'Shadows', 'Transform']);
  assert.deepEqual(propertySectionsFor('camera').map(section => section.title), ['Lens', 'Depth of field', 'Transform']);
});

test('every light row writes its field in one undo step and reads it back', () => {
  const controller = makeController();
  for (const kind of ['point', 'spot', 'area']) {
    const key = `${kind}:0`;
    for (const field of propertyFieldsFor(kind)) {
      const before = controller.exportRecipe();
      const description = controller.describeSceneObject(key);
      const patch = field.write(SAMPLE_VALUES[field.id], description.source, CONTEXT);
      controller.updateSceneLight(key, patch);
      const after = controller.describeSceneObject(key);
      const shown = field.read(after.source, CONTEXT);
      if (field.id === 'angle') {
        assert.equal(shown, 30, `${key} ${field.id}`);
      } else {
        assert.deepEqual(shown, SAMPLE_VALUES[field.id], `${key} ${field.id}`);
      }
      controller.undo();
      assert.deepEqual(controller.exportRecipe(), before, `${key} ${field.id} is one undo step`);
      controller.updateSceneLight(key, patch);
    }
  }
});

test('the sun rows write the environment in one undo step', () => {
  const controller = makeController();
  for (const field of propertyFieldsFor('sun').filter(row => row.write)) {
    const before = controller.exportRecipe();
    controller.updateLook({ environment: field.write(SAMPLE_VALUES[field.id], controller.describeSceneObject('sun').source, CONTEXT) });
    assert.deepEqual(field.read(controller.describeSceneObject('sun').source, CONTEXT), SAMPLE_VALUES[field.id], field.id);
    controller.undo();
    assert.deepEqual(controller.exportRecipe(), before, `${field.id} is one undo step`);
  }
});

test('the camera rows write the recipe camera in one undo step', () => {
  const controller = makeController();
  for (const field of propertyFieldsFor('camera')) {
    const before = controller.exportRecipe();
    if (field.id === 'focusDistance') {
      controller.updateSceneCamera({ fStop: 2.8 });
    }
    const afterSetup = controller.exportRecipe();
    const description = controller.describeSceneObject('camera');
    controller.updateSceneCamera(field.write(field.id === 'orthoScale' ? 12 : SAMPLE_VALUES[field.id], description.source, CONTEXT));
    const camera = controller.exportRecipe().camera;
    if (field.id === 'projection') {
      assert.equal(camera.projection, 'orthographic');
      assert.ok(camera.orthoScale > 0, 'the switch gives the orthographic view a size');
    } else if (field.id === 'focalLength') {
      assert.equal(camera.focalLength, 85);
      assert.equal(camera.fov, undefined, 'a focal length replaces the field of view');
    } else {
      assert.deepEqual(camera[field.id], SAMPLE_VALUES[field.id] ?? 12, field.id);
    }
    controller.undo();
    assert.deepEqual(controller.exportRecipe(), afterSetup, `${field.id} is one undo step`);
    if (field.id === 'focusDistance') {
      controller.undo();
    }
    assert.deepEqual(controller.exportRecipe(), before);
  }
});

test('the projection row converts the lens, and a sensor width keeps the field of view of the focal length', () => {
  const controller = makeController();
  const orthographicRow = propertyFieldsFor('camera').find(field => field.id === 'projection');
  controller.updateSceneCamera(orthographicRow.write(true, controller.describeSceneObject('camera').source, CONTEXT));
  assert.equal(controller.exportRecipe().camera.projection, 'orthographic');
  assert.ok(controller.exportRecipe().camera.orthoScale > 0);
  assert.equal(propertyIsVisible(propertyFieldsFor('camera').find(field => field.id === 'focalLength'), controller.exportRecipe().camera), false);
  controller.updateSceneCamera(orthographicRow.write(false, controller.describeSceneObject('camera').source, CONTEXT));
  assert.equal(controller.exportRecipe().camera.projection, 'perspective');

  const focalRow = propertyFieldsFor('camera').find(field => field.id === 'focalLength');
  const derived = focalRow.read(controller.describeSceneObject('camera').source, CONTEXT);
  assert.ok(Math.abs(derived - 36 / CONTEXT.aspect / (2 * Math.tan((45 * Math.PI) / 360))) < 1e-9, 'a field of view shows as the focal length it equals');
  const sensorRow = propertyFieldsFor('camera').find(field => field.id === 'sensorWidth');
  controller.updateSceneCamera(sensorRow.write(24, controller.describeSceneObject('camera').source, CONTEXT));
  const camera = controller.exportRecipe().camera;
  assert.equal(camera.sensorWidth, 24);
  assert.ok(Math.abs(camera.focalLength - derived) < 1e-9);
});

test('clearing the f-stop removes it and its focus distance in one undo step', () => {
  const controller = makeController();
  controller.updateSceneCamera({ fStop: 2.8 });
  controller.updateSceneCamera({ focusDistance: 4 });
  const before = controller.exportRecipe();
  const fStopRow = propertyFieldsFor('camera').find(field => field.id === 'fStop');
  controller.updateSceneCamera(fStopRow.write(null, controller.describeSceneObject('camera').source, CONTEXT));
  assert.equal(controller.exportRecipe().camera.fStop, undefined);
  assert.equal(controller.exportRecipe().camera.focusDistance, undefined);
  controller.undo();
  assert.deepEqual(controller.exportRecipe(), before);
});

test('a far plane behind the near plane is refused and leaves the camera alone', () => {
  const controller = makeController();
  const before = controller.exportRecipe();
  assert.throws(() => controller.updateSceneCamera({ near: 2000 }), /near/);
  assert.deepEqual(controller.exportRecipe(), before);
  assert.throws(() => controller.updateSceneLight('point:0', { intensity: -1 }), /intensity/);
  assert.throws(() => controller.updateSceneLight('camera', { intensity: 1 }), /cannot be edited/);
  assert.throws(() => controller.updateSceneLight('point:0', 'bright'), /patch object/);
});

test('a drag of one slider is one undo step when the controller is told not to record each move', () => {
  const controller = makeController();
  const before = controller.exportRecipe();
  controller.beginUndoGroup();
  for (const intensity of [1, 2, 3, 4]) {
    controller.updateSceneLight('point:0', { intensity });
  }
  controller.endUndoGroup();
  assert.equal(controller.exportRecipe().environment.pointLights[0].intensity, 4);
  controller.undo();
  assert.deepEqual(controller.exportRecipe(), before);

  controller.updateSceneLight('point:0', { intensity: 9 }, { recordUndo: false });
  assert.equal(controller.canUndo, false, 'recordUndo false leaves the step to the caller');
});

test('fields a motion track drives are reported as driven and refuse a light edit', () => {
  const controller = makeController({
    motion: {
      duration: 2,
      loop: false,
      tracks: [
        { kind: 'light', id: 'point:0', property: 'intensity', interpolation: 'LINEAR', keyframes: [{ time: 0, value: 1 }, { time: 2, value: 3 }] },
        { kind: 'sun', property: 'intensity', interpolation: 'LINEAR', keyframes: [{ time: 0, value: 1 }, { time: 2, value: 2 }] },
        { kind: 'camera', property: 'fov', interpolation: 'LINEAR', keyframes: [{ time: 0, value: 40 }, { time: 2, value: 60 }] },
      ],
    },
  });
  const drivenIds = kind => propertyFieldsFor(kind)
    .filter(field => controller.describeSceneObject(kind === 'camera' || kind === 'sun' ? kind : `${kind}:0`).drivenProperties.has(motionPropertyOf(field)))
    .map(field => field.id);
  assert.deepEqual(drivenIds('point'), ['intensity']);
  assert.deepEqual(drivenIds('sun'), ['keyIntensity']);
  assert.deepEqual(drivenIds('camera'), ['fov', 'eye', 'target']);
  assert.deepEqual(drivenIds('spot'), []);
  assert.throws(() => controller.updateSceneLight('point:0', { intensity: 5 }), /point:0 light intensity is animated/);
  controller.updateSceneLight('point:0', { radius: 0.3 });
  assert.equal(controller.exportRecipe().environment.pointLights[0].radius, 0.3, 'a field the track leaves alone still edits');
});

test('an outside change to the recipe shows in what a row reads', () => {
  const controller = makeController();
  const intensityRow = propertyFieldsFor('point').find(field => field.id === 'intensity');
  assert.equal(intensityRow.read(controller.describeSceneObject('point:0').source, CONTEXT), 2.5);
  const outsideRecipe = controller.exportRecipe();
  outsideRecipe.environment.pointLights[0].intensity = 11;
  outsideRecipe.camera.fStop = 5;
  controller.loadRecipe(outsideRecipe);
  assert.equal(intensityRow.read(controller.describeSceneObject('point:0').source, CONTEXT), 11);
  assert.equal(propertyFieldsFor('camera').find(field => field.id === 'fStop').read(controller.describeSceneObject('camera').source, CONTEXT), 5);
});
