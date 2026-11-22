import './support/load-agent-scene-modules.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAgentScene } from '../src/agent-scene.js';
import { closedRoom, freezeBakeClockForFile, lightmapBytes } from './support/agent-bake-rooms.mjs';

freezeBakeClockForFile();

// #2754: the light bake kept one lightmap texel for both faces of a two-sided part, so an opaque lampshade around a point
// light showed the light that falls on its inside on its outside too. Each face now bakes on its own.

const LAMP_POSITION = [0.9, 2.5, 0.6];
const SHADE_BASE = [LAMP_POSITION[0], LAMP_POSITION[1] - 0.15, LAMP_POSITION[2]];

function roomWithShade(doubleSided, baked = true, materialFields = {}) {
  const recipe = closedRoom();
  if (!baked) delete recipe.bake;
  recipe.environment.pointLights = [{ position: LAMP_POSITION, intensity: 14, radius: 0.05 }];
  recipe.nodes = recipe.nodes.filter(node => node.id !== 'bulb');
  recipe.geometries.push({ id: 'shade', type: 'lathe', profile: [[0.28, 0], [0.13, 0.3]], segments: 16 });
  recipe.materials.push({ id: 'shadeMaterial', color: [0.8, 0.8, 0.8], roughness: 0.9, doubleSided, ...materialFields });
  recipe.nodes.push({ id: 'shade', geometry: 'shade', material: 'shadeMaterial', translation: SHADE_BASE });
  return recipe;
}

function shadePart(recipe) {
  return createAgentScene(recipe).parts.find(candidate => candidate.name === 'shade');
}

/** The lightmap value (0 to 255) at the centre of a triangle, read through the part's own UVs. */
function lightmapValueAt(part, bytes, triangle) {
  const { width, height } = part.material.emissiveMap.image;
  const channelsPerPixel = bytes.length / (width * height);
  let u = 0;
  let v = 0;
  for (let corner = 0; corner < 3; corner++) {
    const vertex = part.geometry.indices[triangle * 3 + corner];
    u += part.geometry.uvs[vertex * 2] / 3;
    v += part.geometry.uvs[vertex * 2 + 1] / 3;
  }
  const column = Math.min(Math.floor(u * width), width - 1);
  const row = Math.min(Math.floor(v * height), height - 1);
  return bytes[(row * width + column) * channelsPerPixel];
}

/** Mean lightmap value of the faces a viewer can see that look toward the lamp, and of those that look away from it. */
function shadeFaceLuminance(recipe) {
  const part = shadePart(recipe);
  const bytes = lightmapBytes(part);
  const { positions, normals, indices } = part.geometry;
  const sums = { towardLamp: 0, awayFromLamp: 0 };
  const counts = { towardLamp: 0, awayFromLamp: 0 };
  for (let triangle = 0; triangle < indices.length / 3; triangle++) {
    const firstVertex = indices[triangle * 3];
    let facing = 0;
    for (let axis = 0; axis < 3; axis++) {
      const lampDirection = LAMP_POSITION[axis] - (positions[firstVertex * 3 + axis] + SHADE_BASE[axis]);
      facing += normals[firstVertex * 3 + axis] * lampDirection;
    }
    const value = lightmapValueAt(part, bytes, triangle);
    const visibleSides = part.material.doubleSided ? [facing, -facing] : [facing];
    for (const sideFacing of visibleSides) {
      const side = sideFacing > 0 ? 'towardLamp' : 'awayFromLamp';
      sums[side] += value;
      counts[side]++;
    }
  }
  return { towardLamp: sums.towardLamp / counts.towardLamp, awayFromLamp: sums.awayFromLamp / counts.awayFromLamp };
}

test('an opaque two-sided shade bakes a lit inside and an outside that only the room lights', () => {
  const { towardLamp, awayFromLamp } = shadeFaceLuminance(roomWithShade(true));
  assert.ok(towardLamp > 100, `the face toward the lamp is lit (${towardLamp})`);
  assert.ok(awayFromLamp < towardLamp * 0.3, `the face away from the lamp is not lit by the lamp it hides: ${awayFromLamp} against ${towardLamp}`);
});

test('a two-sided part bakes into a front and a back triangle per face and is no longer drawn two-sided', () => {
  const source = shadePart(roomWithShade(true, false));
  const baked = shadePart(roomWithShade(true));
  assert.equal(source.material.doubleSided, true);
  assert.equal(baked.material.doubleSided, false);
  assert.equal(baked.geometry.indices.length, source.geometry.indices.length * 2);
});

test('a one-sided part keeps its triangles and its single face', () => {
  const source = shadePart(roomWithShade(false, false));
  const baked = shadePart(roomWithShade(false));
  assert.equal(baked.material.doubleSided, false);
  assert.equal(baked.geometry.indices.length, source.geometry.indices.length);
});

/** Mean step in lightmap value between neighbouring outside faces around the shade, in 0 to 255. */
function outsideRingRoughness(part) {
  const bytes = lightmapBytes(part);
  const { positions, normals, indices } = part.geometry;
  const outside = [];
  for (let triangle = 0; triangle < indices.length / 3; triangle++) {
    const centre = [0, 0, 0];
    for (let corner = 0; corner < 3; corner++) {
      const vertex = indices[triangle * 3 + corner];
      for (let axis = 0; axis < 3; axis++) centre[axis] += positions[vertex * 3 + axis] / 3;
    }
    const firstVertex = indices[triangle * 3];
    let facing = 0;
    for (let axis = 0; axis < 3; axis++) facing += normals[firstVertex * 3 + axis] * (LAMP_POSITION[axis] - centre[axis] - SHADE_BASE[axis]);
    if (facing < 0) outside.push({ angle: Math.atan2(centre[2], centre[0]), value: lightmapValueAt(part, bytes, triangle) });
  }
  outside.sort((first, second) => first.angle - second.angle);
  let steps = 0;
  for (let index = 1; index < outside.length; index++) steps += Math.abs(outside[index].value - outside[index - 1].value);
  return steps / (outside.length - 1);
}

test('the outside of an opaque two-sided shade bakes smoothly around the ring, without strips', () => {
  // The back copy once unwrapped welded to the front, so the charts fell apart into vertical strips: steps near 38.
  const roughness = outsideRingRoughness(shadePart(roomWithShade(true)));
  assert.ok(roughness < 8, `neighbouring outside faces differ by ${roughness} on average`);
});

const LIGHT_THROUGH_MATERIALS = {
  transmission: { transmission: 0.5 },
  subsurface: { subsurface: { weight: 0.5 } },
};

for (const [label, fields] of Object.entries(LIGHT_THROUGH_MATERIALS)) {
  test(`a two-sided part with ${label} keeps one texel for both faces, so light still shows through`, () => {
    const source = shadePart(roomWithShade(true, false, fields));
    const baked = shadePart(roomWithShade(true, true, fields));
    assert.equal(baked.material.doubleSided, true);
    assert.equal(baked.geometry.indices.length, source.geometry.indices.length);
  });
}
