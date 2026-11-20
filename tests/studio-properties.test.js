import './support/load-agent-scene-modules.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAgentScene } from '../src/agent-scene.js';
import { createStudioController } from '../src/studio.js';
import { parseRadianceHdr } from '../src/hdri.js';
import { registerCatalogEnvironment } from '../src/look-catalog.js';
import { tinyHdrBytes } from './helpers/tiny-hdr.js';
import { PROPERTY_FIELDS, PROPERTY_SECTIONS_CLOSED_BY_DEFAULT, motionPropertyOf, propertyFieldsFor, propertyIsVisible, propertySectionsFor } from '../src/studio-properties.js';

const EXPECTED_FIELDS = {
  point: ['color', 'intensity', 'radius', 'range', 'castShadow', 'softFalloff', 'position'],
  spot: ['color', 'intensity', 'radius', 'range', 'angle', 'penumbra', 'castShadow', 'softFalloff', 'position', 'direction'],
  area: ['color', 'intensity', 'width', 'height', 'castShadow', 'portal', 'position', 'direction'],
  sun: ['direction', 'keyIntensity', 'keyColor', 'sunAngularRadius'],
  world: [
    'hdri', 'world', 'ground', 'environmentIntensity', 'environmentRotation', 'skyTop', 'skyBottom', 'daylight', 'fillIntensity', 'ambientIntensity',
    'fogDensity', 'fogColor', 'volumeFog.density', 'volumeFog.color', 'volumeFog.anisotropy', 'volumeFog.steps', 'volumeFog.noiseAmount', 'volumeFog.noiseScale', 'volumeFog.maxDistance',
  ],
  quality: ['objectReflections', 'floorSkyTrace', 'resolveCoplanar', 'shadowCascades', 'sunBounce', 'specularAntiAliasing'],
  effects: [
    'exposure', 'contrast', 'saturation', 'temperature', 'vignette', 'grain', 'ambientOcclusion', 'ambientOcclusionRadius',
    'bloom.strength', 'bloom.threshold', 'bloom.radius', 'depthOfField.blur', 'depthOfField.focusDistance', 'motionBlur.shutter', 'motionBlur.objects',
  ],
  shadow: ['target', 'extent', 'distance', 'near', 'far'],
  camera: ['projection', 'focalLength', 'sensorWidth', 'fov', 'orthoScale', 'near', 'far', 'shift', 'fStop', 'focusDistance', 'eye', 'target'],
};

const CONTEXT = { aspect: 16 / 9 };

registerCatalogEnvironment('sky-clouds', parseRadianceHdr(tinyHdrBytes()));
registerCatalogEnvironment('studio-softbox', parseRadianceHdr(tinyHdrBytes()));

function makeRecipe({ motion, effects } = {}) {
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
  if (effects) {
    recipe.effects = effects;
  }
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
    assert.ok(['select', 'number', 'slider', 'colour', 'toggle', 'vector', 'sunpad'].includes(field.control), `${field.id} control ${field.control}`);
    assert.ok(field.label.length > 0 && field.label.length <= 20, `${field.id} label is short`);
    if (field.control === 'number' || field.control === 'slider') {
      assert.ok(field.min < field.max && field.step > 0, `${field.id} range`);
    }
  }
  assert.deepEqual(propertySectionsFor('spot').map(section => section.title), ['Light', 'Shape', 'Shadows', 'Transform']);
  assert.deepEqual(propertySectionsFor('camera').map(section => section.title), ['Lens', 'Depth of field', 'Transform']);
  assert.deepEqual(propertySectionsFor('world').map(section => section.title), ['World', 'Fog']);
  assert.deepEqual(propertySectionsFor('effects').map(section => section.title), ['Film', 'Effects']);
  assert.deepEqual(propertySectionsFor('quality').map(section => section.title), ['Quality']);
  assert.deepEqual(propertySectionsFor('shadow').map(section => section.title), ['Shadows']);
  assert.deepEqual([...PROPERTY_SECTIONS_CLOSED_BY_DEFAULT], ['sceneShadow', 'quality']);
});

const SCENE_SAMPLE_VALUES = {
  hdri: 'sky-clouds', world: true, ground: false, environmentIntensity: 2, environmentRotation: 1.5, skyTop: [0.2, 0.3, 0.4], skyBottom: [0.5, 0.4, 0.3],
  daylight: 0.5, fillIntensity: 0.7, ambientIntensity: 0.6, fogDensity: 0.03, fogColor: [0.1, 0.2, 0.3],
  'volumeFog.density': 0.4, 'volumeFog.color': [0.5, 0.5, 0.6], 'volumeFog.anisotropy': 0.5, 'volumeFog.steps': 24,
  'volumeFog.noiseAmount': 0.8, 'volumeFog.noiseScale': 0.7, 'volumeFog.maxDistance': 50,
  objectReflections: false, floorSkyTrace: false, resolveCoplanar: false, shadowCascades: 3, sunBounce: 2, specularAntiAliasing: 2,
  exposure: 1.5, contrast: 1.2, saturation: 0.7, temperature: 0.2, vignette: 0.3, grain: 0.05, ambientOcclusion: 0.5, ambientOcclusionRadius: 2,
  'bloom.strength': 0.8, 'bloom.threshold': 2, 'bloom.radius': 2, 'depthOfField.blur': 0.4, 'depthOfField.focusDistance': 7,
  'motionBlur.shutter': 0.3, 'motionBlur.objects': 0.5,
  target: [1, 2, 3], extent: 6, distance: 10, near: 0.5, far: 30,
};

function writeSceneRecord(controller, kind, patch) {
  if (kind === 'effects') {
    controller.updateLook({ effects: patch });
  } else if (kind === 'shadow') {
    controller.updateSceneShadow(patch);
  } else {
    controller.updateLook({ environment: patch });
  }
}

test('every world, quality, effects and shadow row writes its recipe field in one undo step and reads it back', () => {
  const controller = makeController();
  for (const kind of ['world', 'quality', 'effects', 'shadow']) {
    for (const field of propertyFieldsFor(kind)) {
      assert.ok(Object.hasOwn(SCENE_SAMPLE_VALUES, field.id), `${kind} ${field.id} has a sample value`);
      const before = controller.exportRecipe();
      const description = controller.describeSceneObject(kind);
      assert.equal(description.kind, kind);
      writeSceneRecord(controller, kind, field.write(SCENE_SAMPLE_VALUES[field.id], description.source, CONTEXT));
      assert.deepEqual(field.read(controller.describeSceneObject(kind).source, CONTEXT), SCENE_SAMPLE_VALUES[field.id], `${kind} ${field.id}`);
      assert.equal(controller.undo(), true);
      assert.deepEqual(controller.exportRecipe(), before, `${kind} ${field.id} is one undo step`);
    }
  }
});

test('the depth of field rows keep the other fields of their group', () => {
  const controller = makeController();
  controller.updateLook({ effects: { depthOfField: { blur: 0.5, focusDistance: 9 } } });
  const blurRow = propertyFieldsFor('effects').find(field => field.id === 'depthOfField.blur');
  controller.updateLook({ effects: blurRow.write(0.2, controller.describeSceneObject('effects').source, CONTEXT) });
  assert.deepEqual(controller.exportRecipe().effects.depthOfField, { blur: 0.2, focusDistance: 9 });
});

test('the HDRI row clears the choice with None and offers the bundled names', () => {
  const controller = makeController();
  const hdriRow = propertyFieldsFor('world').find(field => field.id === 'hdri');
  assert.deepEqual(hdriRow.choices.map(choice => choice.value), [null, 'sky-clouds', 'studio-softbox']);
  controller.updateLook({ environment: hdriRow.write('studio-softbox') });
  assert.equal(hdriRow.read(controller.describeSceneObject('world').source), 'studio-softbox');
  controller.updateLook({ environment: hdriRow.write(null) });
  assert.equal(hdriRow.read(controller.describeSceneObject('world').source), null);
  const catalogId = 'a'.repeat(64);
  registerCatalogEnvironment(catalogId, parseRadianceHdr(tinyHdrBytes()));
  controller.updateLook({ environment: hdriRow.write(catalogId) });
  assert.equal(hdriRow.read(controller.describeSceneObject('world').source), catalogId, 'a catalog file the list lacks is still read');
});

test('a shadow box the renderer cannot use is refused and leaves the recipe alone', () => {
  const controller = makeController();
  const before = controller.exportRecipe();
  assert.throws(() => controller.updateSceneShadow({ near: 50, far: 10 }), /near/i);
  assert.throws(() => controller.updateSceneShadow('wide'), /patch object/);
  assert.deepEqual(controller.exportRecipe(), before);
  assert.equal(controller.canUndo, false);
});

test('fields an environment or effects track drives are reported per panel', () => {
  const controller = makeController({
    effects: { depthOfField: { blur: 0.5, focusDistance: 5 } },
    motion: {
      duration: 2,
      loop: false,
      tracks: [
        { kind: 'environment', property: 'fogDensity', interpolation: 'LINEAR', keyframes: [{ time: 0, value: 0 }, { time: 2, value: 0.05 }] },
        { kind: 'environment', property: 'volumeFogDensity', interpolation: 'LINEAR', keyframes: [{ time: 0, value: 0 }, { time: 2, value: 0.5 }] },
        { kind: 'environment', property: 'skyTop', interpolation: 'LINEAR', keyframes: [{ time: 0, value: [0.1, 0.2, 0.3] }, { time: 2, value: [0.3, 0.2, 0.1] }] },
        { kind: 'effects', property: 'exposure', interpolation: 'LINEAR', keyframes: [{ time: 0, value: 1 }, { time: 2, value: 2 }] },
        { kind: 'effects', property: 'focusDistance', interpolation: 'LINEAR', keyframes: [{ time: 0, value: 2 }, { time: 2, value: 8 }] },
      ],
    },
  });
  const drivenIds = kind => propertyFieldsFor(kind)
    .filter(field => controller.describeSceneObject(kind).drivenProperties.has(motionPropertyOf(field)))
    .map(field => field.id);
  assert.deepEqual(drivenIds('world'), ['skyTop', 'fogDensity', 'volumeFog.density']);
  assert.deepEqual(drivenIds('effects'), ['exposure', 'depthOfField.focusDistance']);
  assert.deepEqual(drivenIds('quality'), []);
  assert.deepEqual(drivenIds('shadow'), []);
});

test('an outside change to the environment, effects or shadow shows in what the rows read', () => {
  const controller = makeController();
  const outsideRecipe = controller.exportRecipe();
  outsideRecipe.environment.fogDensity = 0.07;
  outsideRecipe.effects.vignette = 0.4;
  outsideRecipe.shadow.extent = 9;
  controller.loadRecipe(outsideRecipe);
  const read = (kind, id) => propertyFieldsFor(kind).find(field => field.id === id).read(controller.describeSceneObject(kind).source, CONTEXT);
  assert.equal(read('world', 'fogDensity'), 0.07);
  assert.equal(read('effects', 'vignette'), 0.4);
  assert.equal(read('shadow', 'extent'), 9);
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
