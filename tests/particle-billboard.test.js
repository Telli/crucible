import './support/load-agent-scene-modules.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentScene, loadPhysicsEngine } from '../src/agent-scene.js';
import * as shaders from '../src/shaders.js';

const { createFragmentShader, createVertexShader, SHADER_FEATURES } = shaders;

test.before(() => loadPhysicsEngine({ buoyancy: true }));

const CARD_COUNT = 6;

function cardRecipe({ system = {}, material = {}, eyeTrack = null, eye = [0, 1, 5] } = {}) {
  const recipe = {
    format: 'crucible.scene', schemaVersion: 1,
    geometries: [{ id: 'card', type: 'plane' }],
    materials: [{ id: 'mist', color: [1, 1, 1], ...material }],
    nodes: [{ id: 'spray', geometry: 'card', material: 'mist' }],
    camera: { eye, target: [0, 1, 0], up: [0, 1, 0] },
    particles: { gravity: [0, 0, 0], systems: [{ node: 'spray', seed: 5, count: 6, rate: 3, lifetime: 4, speed: 0, size: 1, drag: 0, emitter: { shape: 'box', halfExtents: [1, 0.25, 1], position: [0, 1, 0] }, ...system }] },
  };
  if (eyeTrack) recipe.motion = { duration: 4, tracks: [{ kind: 'camera', property: 'eye', keyframes: eyeTrack }] };
  return recipe;
}

function sprayGeometry(scene) {
  return scene.parts.find(part => part.name === 'spray').geometry;
}

// The card normal is the normalized cross of two edges of the card's first triangle, signed by its stored normal.
function cardFrames(geometry) {
  const perCard = geometry.positions.length / 3 / CARD_COUNT;
  const frames = [];
  for (let card = 0; card < CARD_COUNT; card++) {
    const center = [0, 0, 0];
    let farthest = 0;
    for (let vertex = 0; vertex < perCard; vertex++) {
      for (let axis = 0; axis < 3; axis++) center[axis] += geometry.positions[(card * perCard + vertex) * 3 + axis] / perCard;
    }
    for (let vertex = 0; vertex < perCard; vertex++) {
      farthest = Math.max(farthest, Math.hypot(...center.map((value, axis) => geometry.positions[(card * perCard + vertex) * 3 + axis] - value)));
    }
    const normal = Array.from(geometry.normals.subarray(card * perCard * 3, card * perCard * 3 + 3));
    frames.push({ center, normal, scaleProbe: farthest });
  }
  return frames;
}

function cosineToEye(frame, eye) {
  const toEye = eye.map((value, axis) => value - frame.center[axis]);
  const length = Math.hypot(...toEye);
  return toEye.reduce((sum, value, axis) => sum + value / length * frame.normal[axis], 0);
}

test('a billboard card faces the camera from several camera angles (#2830)', () => {
  for (const eye of [[0, 1, 5], [6, 1, 0], [-4, 3, -4], [1, 8, 1]]) {
    const scene = createAgentScene(cardRecipe({ system: { orient: 'billboard' }, eye }));
    scene.sampleMotion(2.5);
    const frames = cardFrames(sprayGeometry(scene)).filter(frame => frame.scaleProbe > 0);
    assert.ok(frames.length >= 6, 'six cards are alive');
    for (const frame of frames) assert.ok(cosineToEye(frame, eye) > 0.9999, `card normal toward ${eye}: cosine ${cosineToEye(frame, eye)}`);
  }
});

test('a billboard follows a camera that moves between frames, and a seek back repeats exactly', () => {
  const eyeTrack = [{ time: 0, value: [0, 1, 6] }, { time: 4, value: [6, 1, 0] }];
  const scene = createAgentScene(cardRecipe({ system: { orient: 'billboard' }, eyeTrack, eye: [0, 1, 6] }));
  scene.sampleMotion(1);
  const eyeAtOne = [1.5, 1, 4.5];
  for (const frame of cardFrames(sprayGeometry(scene)).filter(entry => entry.scaleProbe > 0)) assert.ok(cosineToEye(frame, eyeAtOne) > 0.9999);
  const first = Array.from(sprayGeometry(scene).normals);
  scene.sampleMotion(3);
  const eyeAtThree = [4.5, 1, 1.5];
  for (const frame of cardFrames(sprayGeometry(scene)).filter(entry => entry.scaleProbe > 0)) assert.ok(cosineToEye(frame, eyeAtThree) > 0.9999);
  scene.sampleMotion(1);
  assert.deepEqual(Array.from(sprayGeometry(scene).normals), first);
});

test('without billboard a card keeps its facing and the camera does not matter', () => {
  const normals = eye => {
    const scene = createAgentScene(cardRecipe({ eye }));
    scene.sampleMotion(2.5);
    return Array.from(sprayGeometry(scene).normals);
  };
  assert.deepEqual(normals([0, 1, 5]), normals([6, 1, 0]));
});

test('fade "opacity" on a blend material writes opacity and keeps the color; "darken" still darkens', () => {
  const blend = { alphaMode: 'blend' };
  const fading = createAgentScene(cardRecipe({ system: { alpha: [1, 0], fade: 'opacity' }, material: blend }));
  fading.sampleMotion(1.5);
  const faded = sprayGeometry(fading);
  const livePerCard = Array.from({ length: CARD_COUNT }, (_, card) => faded.vertexOpacity[card * faded.positions.length / 3 / CARD_COUNT]);
  assert.ok(livePerCard.some(value => value > 0.2 && value < 0.9), 'a live particle is partly transparent');
  assert.ok(faded.vertexOpacity.every(value => value >= 0 && value <= 1));
  for (let vertex = 0; vertex < faded.positions.length / 3; vertex++) assert.equal(faded.colors[vertex * 3], 1, 'color keeps its brightness');
  const darkening = createAgentScene(cardRecipe({ system: { alpha: [1, 0] }, material: blend }));
  darkening.sampleMotion(1.5);
  assert.equal(sprayGeometry(darkening).vertexOpacity, undefined);
  assert.ok(Array.from(sprayGeometry(darkening).colors).some(value => value > 0 && value < 0.9), 'the default fade darkens');
});

test('the options are checked at the boundary and the errors say what to pass', () => {
  assert.throws(() => createAgentScene(cardRecipe({ system: { orient: 'camera' } })), /orient[\s\S]*billboard/);
  assert.throws(() => createAgentScene(cardRecipe({ system: { fade: 'dim' } })), /fade[\s\S]*darken, opacity/);
  assert.throws(() => createAgentScene(cardRecipe({ system: { fade: 'opacity' }, material: { alphaMode: 'blend' } })), /fade[\s\S]*alpha \[1, 0\]/);
  assert.throws(() => createAgentScene(cardRecipe({ system: { fade: 'opacity', alpha: [1, 0] } })), /fade[\s\S]*alphaMode "blend"/);
});

test('the vertex opacity shader splices only when asked: the default sources keep their text', () => {
  const rigid = SHADER_FEATURES.filter(feature => !['crowd', 'skin', 'morph'].includes(feature));
  const plainFragment = createFragmentShader(rigid);
  const plainVertex = createVertexShader(rigid);
  // The glTF COLOR_0 alpha path (#2948) declares vertexOpacity behind VERTEX_ALPHA, a constant 1 otherwise; the particle feature replaces that declaration with an input.
  const constantOpacity = '#ifdef VERTEX_ALPHA\nin float vertexOpacity;\n#else\nconst float vertexOpacity = 1.0;\n#endif';
  assert.ok(plainFragment.includes(constantOpacity));
  assert.ok(!plainVertex.includes('vertexOpacity = vertexColor.a;'));
  assert.ok(!SHADER_FEATURES.includes(shaders.VERTEX_OPACITY_FEATURE));
  const features = [...rigid, shaders.VERTEX_OPACITY_FEATURE];
  const opacityFragment = createFragmentShader(features);
  assert.ok(opacityFragment.includes('textureAlpha * vertexOpacity;'));
  assert.ok(!opacityFragment.includes(constantOpacity) && opacityFragment.includes('in float vertexOpacity;'));
  assert.ok(createVertexShader(features).includes('vertexOpacity = vertexColor.a;'));
});
