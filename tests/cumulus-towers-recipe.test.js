import './support/load-agent-scene-modules.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { createAgentScene } from '../src/agent-scene.js';

const recipeText = readFileSync(new URL('../public/recipes/cumulus-towers.json', import.meta.url), 'utf8');
const TOWER_IDS = ['tower-left', 'tower-middle', 'tower-right'];

// The sea is plain mesh edits with their own tests; leaving it out keeps this test to the towers.
function withoutSea(recipe) {
  return { ...recipe, geometries: recipe.geometries.filter(geometry => geometry.id !== 'sea'), nodes: recipe.nodes.filter(node => node.id !== 'sea') };
}

function hashOf(mesh) {
  const hash = createHash('sha256');
  for (const array of [mesh.positions, mesh.normals, mesh.indices]) hash.update(Buffer.from(array.buffer, array.byteOffset, array.byteLength));
  return hash.digest('hex');
}

test('the cumulus towers recipe has three tall towers and three toon tones with their own colours', () => {
  const recipe = JSON.parse(recipeText);
  const towers = recipe.geometries.filter(geometry => geometry.type === 'cloud');
  assert.deepEqual(towers.map(tower => tower.id), TOWER_IDS);
  for (const tower of towers) {
    assert.ok(tower.height > tower.width, `${tower.id} must be taller than wide`);
    assert.equal(tower.levels.length, 3);
  }
  const cumulus = recipe.materials.find(material => material.id === 'cumulus');
  assert.equal(cumulus.toon, 3);
  assert.equal(cumulus.toonColors.length, 3);
});

test('the cumulus towers recipe builds the same towers byte for byte every time, each different from the others', () => {
  const first = createAgentScene(withoutSea(JSON.parse(recipeText)));
  const second = createAgentScene(withoutSea(JSON.parse(recipeText)));
  assert.equal(first.parts.length, 3);
  const firstHashes = first.parts.map(part => hashOf(part.geometry));
  assert.deepEqual(firstHashes, second.parts.map(part => hashOf(part.geometry)));
  assert.equal(new Set(firstHashes).size, firstHashes.length);
});

test('the cumulus towers recipe ships with the still that the clouds guide shows', () => {
  assert.ok(existsSync(new URL('../public/recipes/cumulus-towers.webp', import.meta.url)));
  assert.ok(readFileSync(new URL('../docs/modeling.md', import.meta.url), 'utf8').includes('https://crucible.codepawl.com/recipes/cumulus-towers.json'));
});
