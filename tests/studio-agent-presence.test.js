import assert from 'node:assert/strict';
import test from 'node:test';
import { AGENT_COLORS, agentColor, assertAgentName, createAgentPresence, describeAgentEdit, diffRecipeNodes } from '../src/studio-agent-presence.js';

function makeRecipe() {
  return {
    format: 'crucible.scene',
    geometries: [{ id: 'cube', type: 'box' }, { id: 'ball', type: 'sphere', segments: 16 }],
    materials: [{ id: 'paint', color: [1, 0, 0] }, { id: 'stone', color: [0.5, 0.5, 0.5] }],
    nodes: [
      { id: 'ground', geometry: 'cube', material: 'stone' },
      { id: 'hero', geometry: 'cube', material: 'paint', translation: [0, 1, 0] },
      { id: 'orb', geometry: 'ball', material: 'stone' },
    ],
    environment: { setup: 'studio' },
  };
}

test('diffRecipeNodes lists moved, added and removed nodes', () => {
  const after = makeRecipe();
  after.nodes[1].translation = [2, 1, 0];
  after.nodes.push({ id: 'lamp', geometry: 'ball', material: 'paint' });
  after.nodes.shift();
  assert.deepEqual(diffRecipeNodes(makeRecipe(), after), { nodeIds: ['hero', 'lamp'], removedNodeIds: ['ground'], otherChange: false });
});

test('diffRecipeNodes points at every node that uses a changed material or geometry', () => {
  const recoloured = makeRecipe();
  recoloured.materials[1].color = [0, 0, 1];
  assert.deepEqual(diffRecipeNodes(makeRecipe(), recoloured).nodeIds, ['ground', 'orb']);
  const reshaped = makeRecipe();
  reshaped.geometries[1].segments = 32;
  assert.deepEqual(diffRecipeNodes(makeRecipe(), reshaped).nodeIds, ['orb']);
});

test('diffRecipeNodes reports a look change apart from the nodes, and nothing for the same recipe', () => {
  const relit = makeRecipe();
  relit.environment.setup = 'sunset';
  assert.deepEqual(diffRecipeNodes(makeRecipe(), relit), { nodeIds: [], removedNodeIds: [], otherChange: true });
  assert.deepEqual(diffRecipeNodes(makeRecipe(), makeRecipe()), { nodeIds: [], removedNodeIds: [], otherChange: false });
  assert.deepEqual(diffRecipeNodes({}, {}), { nodeIds: [], removedNodeIds: [], otherChange: false });
});

test('describeAgentEdit names up to two objects and counts the rest', () => {
  const none = { nodeIds: [], removedNodeIds: [], otherChange: false };
  assert.equal(describeAgentEdit('Claude', { ...none, nodeIds: ['hero'] }), 'Claude edited hero');
  assert.equal(describeAgentEdit('Claude', { ...none, nodeIds: ['hero', 'orb', 'lamp', 'ground'] }), 'Claude edited hero, orb and 2 more');
  assert.equal(describeAgentEdit('Claude', { ...none, removedNodeIds: ['orb'] }), 'Claude removed orb');
  assert.equal(describeAgentEdit('Claude', { ...none, otherChange: true }), 'Claude changed the scene look');
  assert.equal(describeAgentEdit('Claude', none), 'Claude saved without changes');
});

test('assertAgentName trims a name and rejects an empty, long or non-string one', () => {
  assert.equal(assertAgentName('  Claude '), 'Claude');
  for (const bad of ['', '   ', 'x'.repeat(41), 7, null]) {
    assert.throws(() => assertAgentName(bad), /agent name must be a string of 1 to 40 characters/);
  }
});

test('agentColor keeps one palette colour per name and spreads names over the palette', () => {
  assert.equal(agentColor('Claude'), agentColor(' Claude '));
  const names = ['Claude', 'Builder', 'Agent', 'Lighting', 'Layout', 'Rigger', 'Painter', 'Modeler'];
  const used = new Set(names.map(agentColor));
  for (const color of used) assert.ok(AGENT_COLORS.includes(color));
  assert.ok(used.size >= 3, `eight names share only ${used.size} colours`);
  assert.throws(() => agentColor(''), /agent name must be a string/);
});

test('the pointer asks for outlines only until it has its stops, and visits the same nodes as before (#2842)', () => {
  const fakeElement = () => ({ dataset: {}, style: {}, children: [], setAttribute() {}, append() {}, set textContent(value) {} });
  const documentReference = { createElement: fakeElement, createElementNS: fakeElement };
  const nodeIds = Array.from({ length: 120 }, (_, index) => `node-${index}`);
  const asked = [];
  const controller = {
    viewportWidth: 800,
    viewportHeight: 600,
    nodeOutline(nodeId) {
      asked.push(nodeId);
      const index = Number(nodeId.split('-')[1]);
      return index % 2 === 0 ? [[0, 0], [10, 0], [0, 10]] : null;
    },
  };
  const presence = createAgentPresence(documentReference, { controller, requestDraw() {} });
  const stopCount = presence.show({ name: 'Claude', nodeIds });
  assert.equal(stopCount, 8);
  assert.equal(presence.activeNodeId, 'node-0');
  assert.deepEqual(asked.slice(0, 15), nodeIds.slice(0, 15), 'outlines were asked in list order');
  assert.ok(!asked.some(nodeId => Number(nodeId.split('-')[1]) > 14), 'the search ended at the eighth visible node, not at the end of the list');
  presence.dispose();
});
