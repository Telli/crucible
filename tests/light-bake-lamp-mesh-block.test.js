import './support/load-agent-scene-modules.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAgentScene } from '../src/agent-scene.js';
import { closedRoom, freezeBakeClockForFile, lightmapBytes } from './support/agent-bake-rooms.mjs';

freezeBakeClockForFile();

// #2299: a baked closed room with a bulb mesh around its point lamp rendered black on the sides of parts that face away from the
// lamp. The floor is pinned in light-bake-lamp-mesh.test.js; this pins the block, whose far sides only get light bounced off the walls.

const LAMP_POSITION = [0.9, 2.5, 0.6];

function roomWithLamp(withBulbMesh) {
  const recipe = closedRoom();
  recipe.environment.pointLights = [{ position: LAMP_POSITION, intensity: 14, radius: 0.05 }];
  recipe.nodes = recipe.nodes.filter(node => node.id !== 'bulb');
  if (withBulbMesh) {
    recipe.nodes.push({ id: 'bulb', geometry: 'box', material: 'lamp', translation: LAMP_POSITION, scale: [0.2, 0.2, 0.2] });
  }
  return recipe;
}

/** Mean of the colour channels of a part's baked lightmap, 0 to 255 (the alpha channel is left out). */
function meanLightmapLuminance(recipe, partName) {
  const part = createAgentScene(recipe).parts.find(candidate => candidate.name === partName);
  const bytes = lightmapBytes(part);
  const { width, height } = part.material.emissiveMap.image;
  const channelsPerPixel = bytes.length / (width * height);
  let sum = 0;
  let count = 0;
  for (let index = 0; index < bytes.length; index++) {
    if (channelsPerPixel === 4 && index % 4 === 3) continue;
    sum += bytes[index];
    count++;
  }
  return sum / count;
}

test('the block of a baked room keeps its light when a bulb mesh surrounds the lamp', () => {
  const withoutBulb = meanLightmapLuminance(roomWithLamp(false), 'block');
  const withBulb = meanLightmapLuminance(roomWithLamp(true), 'block');
  assert.ok(withoutBulb > 20, `the block of the room without a bulb mesh is lit (${withoutBulb})`);
  assert.ok(withBulb > withoutBulb * 0.9, `the block keeps its light with the bulb mesh around the lamp: ${withBulb} against ${withoutBulb} without it`);
});
