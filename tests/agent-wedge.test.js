import test from 'node:test';
import assert from 'node:assert/strict';
import { wedgeOperation, wedgeLabel, wedgeColumns, parseWedgeField, WEDGE_LIMITS } from '../src/agent-wedge.js';
import { normalizeWedge } from '../scripts/agent-wedge.mjs';
import { createAgentRuntime } from '../scripts/agent-runtime.mjs';

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

const recipe = deepFreeze({
  materials: [{ id: 'brass', roughness: 0.25, subsurface: { radius: 0.2 } }],
  environment: { keyIntensity: 2, pointLights: [{ position: [0, 2, 0], intensity: 1 }] },
  effects: { exposure: 1 },
});
const validInput = { sessionId: 'scene-1', expectedRevision: 3, target: 'brass', field: 'roughness', values: [0.1, 0.5, 0.9] };

test('a material field becomes one set-material operation and the recipe is not changed', () => {
  assert.deepEqual(wedgeOperation({ target: 'brass', field: 'roughness', value: 0.7 }, recipe), { type: 'set-material', id: 'brass', roughness: 0.7 });
  assert.deepEqual(wedgeOperation({ target: 'brass', field: 'subsurface.radius', value: 0.5 }, recipe), { type: 'set-material', id: 'brass', subsurface: { radius: 0.5 } });
});

test('environment, effects and shadow targets become their section operations', () => {
  assert.deepEqual(wedgeOperation({ target: 'environment', field: 'lightDirection', value: [0, -1, 0] }, recipe), { type: 'set-environment', environment: { lightDirection: [0, -1, 0] } });
  assert.deepEqual(wedgeOperation({ target: 'effects', field: 'exposure', value: 2 }, recipe), { type: 'set-effects', effects: { exposure: 2 } });
  assert.deepEqual(wedgeOperation({ target: 'shadow', field: 'softness', value: 1 }, recipe), { type: 'set-shadow', shadow: { softness: 1 } });
});

test('a light is reached by a list index and the other lights and fields are kept', () => {
  const operation = wedgeOperation({ target: 'environment', field: 'pointLights.0.intensity', value: 9 }, recipe);
  assert.deepEqual(operation, { type: 'set-environment', environment: { pointLights: [{ position: [0, 2, 0], intensity: 9 }] } });
});

test('errors name what failed and what to pass', () => {
  assert.throws(() => wedgeOperation({ target: 'gold', field: 'roughness', value: 1 }, recipe), /target: got "gold"; expected environment, effects, shadow or an existing material ID \(brass\)/);
  assert.throws(() => wedgeOperation({ target: 'environment', field: 'fogColor.0', value: 1 }, recipe), /already a list or an object.*"fogColor" alone/);
  assert.throws(() => wedgeOperation({ target: 'environment', field: 'pointLights.4.intensity', value: 1 }, recipe), /"4" is not set here/);
  assert.throws(() => parseWedgeField('rough ness'), /field: got "rough ness"; expected a field name/);
  assert.throws(() => parseWedgeField('0.roughness'), /expected a field name/);
});

test('the grid grows its columns with the value count and a label shows field and value', () => {
  assert.deepEqual([2, 4, 5, 6, 7, 8].map(wedgeColumns), [2, 2, 3, 3, 4, 4]);
  assert.equal(wedgeLabel('roughness', 0.3), 'roughness=0.3');
  assert.equal(wedgeLabel('lightDirection', [-1, -0.3, -0.5]), 'lightDirection=[-1,-0.3,-0.5]');
  assert.ok(wedgeLabel('x', 'a'.repeat(200)).length <= WEDGE_LIMITS.maximumLabelLength);
  assert.equal(wedgeLabel('x', 'café'), 'x=caf?');
});

test('the value count is bounded from 2 to 8', () => {
  assert.equal(normalizeWedge({ ...validInput, values: [0.1, 0.9] }).shots.length, 2);
  assert.equal(normalizeWedge({ ...validInput, values: [1, 2, 3, 4, 5, 6, 7, 8] }).shots.length, 8);
  assert.throws(() => normalizeWedge({ ...validInput, values: [0.5] }), /values: got 1; expected a list of 2 to 8 values/);
  assert.throws(() => normalizeWedge({ ...validInput, values: [1, 2, 3, 4, 5, 6, 7, 8, 9] }), /values: got 9;/);
  assert.throws(() => normalizeWedge({ ...validInput, values: 'rough' }), /expected a list of 2 to 8 values/);
});

test('a value that is too large or not JSON is refused with its index', () => {
  assert.throws(() => normalizeWedge({ ...validInput, values: [0.1, 'x'.repeat(WEDGE_LIMITS.maximumValueBytes)] }), /values\[1\]/);
  assert.throws(() => normalizeWedge({ ...validInput, values: [0.1, undefined] }), /values\[1\]/);
});

test('the grid stays inside the pixel limits for every value count', () => {
  for (let count = 2; count <= 8; count++) {
    const values = Array.from({ length: count }, (_, index) => index);
    const settings = normalizeWedge({ ...validInput, values });
    assert.ok(settings.gridWidth <= WEDGE_LIMITS.maximumGridWidth, `width for ${count}`);
    assert.ok(settings.gridHeight <= WEDGE_LIMITS.maximumGridHeight, `height for ${count}`);
  }
  assert.throws(() => normalizeWedge({ ...validInput, values: [1, 2, 3, 4, 5, 6, 7, 8], width: 480 }), /width: got 480; expected an integer from 64 to 240/);
  assert.throws(() => normalizeWedge({ ...validInput, width: 63 }), /width: got 63/);
  assert.throws(() => normalizeWedge({ ...validInput, height: 2.5 }), /height: got 2.5/);
});

test('unknown fields, a missing revision and a bad shot are refused', () => {
  assert.throws(() => normalizeWedge({ ...validInput, branch: 'x' }), /not accepted: branch/);
  assert.throws(() => normalizeWedge({ ...validInput, expectedRevision: undefined }), /requires a sessionId and a safe nonnegative expectedRevision/);
  assert.throws(() => normalizeWedge({ ...validInput, target: '' }), /target: got ""/);
  assert.throws(() => normalizeWedge({ ...validInput, shot: { label: 'x' } }), /Wedge shot field not accepted: label/);
  assert.throws(() => normalizeWedge({ ...validInput, shot: { motionTime: 5000 } }), /shot.motionTime: got 5000/);
});

test('a wedge is one shot per value, each with its label, the shared camera and its own variant', () => {
  const camera = { eye: [0, 1, 5] };
  const settings = normalizeWedge({ ...validInput, shot: { camera, motionTime: 1.5 } });
  assert.deepEqual(settings.shots.map(shot => shot.label), ['roughness=0.1', 'roughness=0.5', 'roughness=0.9']);
  assert.deepEqual(settings.shots.map(shot => shot.branch), ['wedge-0', 'wedge-1', 'wedge-2']);
  assert.ok(settings.shots.every(shot => shot.motionTime === 1.5 && shot.camera.eye[2] === 5));
  assert.equal(settings.columns, 2);
  assert.deepEqual(settings.groups.map(group => group.shotIndexes), [[0], [1], [2]]);
});

test('the runtime refuses a bad wedge before it opens a browser', async () => {
  const runtime = createAgentRuntime({ backend: 'cpu' });
  await assert.rejects(runtime.wedge({ ...validInput, values: [0.5] }), /values: got 1;/);
  await runtime.close();
});
