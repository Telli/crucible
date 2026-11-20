import './support/load-agent-scene-modules.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAgentScene } from '../src/agent-scene.js';
import { closedRoom, freezeBakeClockForFile } from './support/agent-bake-rooms.mjs';

freezeBakeClockForFile();

// A lamp mesh drawn around its own point light is the lamp, not an obstacle to it (#2299): the bake used to shadow the light with
// the bulb, so the whole room came out about forty times darker than the same room without the bulb mesh.

const LAMP_POSITION = [0.9, 2.5, 0.6];

function roomWithLampAt(material, withLampMesh) {
  const recipe = closedRoom();
  recipe.environment.pointLights = [{ position: LAMP_POSITION, intensity: 14, radius: 0.05 }];
  recipe.nodes = recipe.nodes.filter(node => node.id !== 'bulb');
  if (withLampMesh) {
    recipe.materials.push({ id: 'lamp-surface', color: [1, 1, 1], ...material });
    recipe.nodes.push({ id: 'bulb', geometry: 'box', material: 'lamp-surface', translation: LAMP_POSITION, scale: [0.2, 0.2, 0.2] });
  }
  return recipe;
}

function lightOf(recipe, partName) {
  const part = createAgentScene(recipe).parts.find(candidate => candidate.name === partName);
  return part.material.emission;
}

test('an emissive bulb around the point light does not shadow the room it lights', () => {
  const withoutBulb = lightOf(roomWithLampAt({}, false), 'floor');
  const withBulb = lightOf(roomWithLampAt({ emission: 2 }, true), 'floor');
  assert.ok(withoutBulb > 0.1, `the room without a bulb mesh is lit (${withoutBulb})`);
  assert.ok(withBulb > withoutBulb * 0.5, `the bulb mesh around the light keeps the floor lit: ${withBulb} against ${withoutBulb} without it`);
});

test('a shade that does not glow still blocks the light inside it', () => {
  const withoutShade = lightOf(roomWithLampAt({}, false), 'floor');
  const withShade = lightOf(roomWithLampAt({}, true), 'floor');
  assert.ok(withShade < withoutShade * 0.5, `a plain box around the light shadows the floor: ${withShade} against ${withoutShade} without it`);
});
