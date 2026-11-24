import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { AGENT_COLORS, agentColor, assertAgentName, createAgentPresence, describeAgentEdit, diffRecipeNodes } from '../src/studio-agent-presence.js';

function makeFakeDocument() {
  const fakeElement = () => ({
    dataset: {},
    style: { setProperty(name, value) { this[name] = value; } },
    children: [],
    setAttribute() {},
    append() {},
    set textContent(value) {},
  });
  return { createElement: fakeElement, createElementNS: fakeElement };
}

function makePresence(positions) {
  const controller = {
    viewportWidth: 800,
    viewportHeight: 600,
    nodeOutline: nodeId => {
      const [x, y] = positions[nodeId];
      return [[x, y], [x + 10, y], [x, y + 10]];
    },
  };
  return createAgentPresence(makeFakeDocument(), { controller, requestDraw() {} });
}

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
  const documentReference = makeFakeDocument();
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

test('a new target writes the pointer position in pixels and turns the travelling state on (#3223)', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const positions = { hero: [100, 200], orb: [400, 300] };
    const presence = makePresence(positions);
    presence.show({ name: 'Claude', nodeIds: ['hero', 'orb'] });
    const pointer = presence.element;
    assert.equal(pointer.dataset.travelling, undefined, 'the first appearance snaps in place');
    assert.equal(pointer.style['--studio-agent-x'], '103.3px');
    assert.equal(pointer.style['--studio-agent-y'], '203.3px');
    mock.timers.tick(1100);
    assert.equal(presence.activeNodeId, 'orb');
    assert.equal(pointer.dataset.travelling, 'true');
    assert.equal(pointer.style['--studio-agent-x'], '403.3px');
    mock.timers.tick(400);
    assert.equal(pointer.dataset.travelling, undefined, 'the travel state ends after the travel time');
    presence.dispose();
  } finally {
    mock.timers.reset();
  }
});

test('a camera follow update writes the position without the travelling state and ends a travel (#3223)', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const positions = { hero: [100, 200], orb: [400, 300] };
    const presence = makePresence(positions);
    presence.show({ name: 'Claude', nodeIds: ['hero', 'orb'] });
    const pointer = presence.element;
    presence.place();
    assert.equal(pointer.dataset.travelling, undefined, 'a frame with the camera still starts no travel');
    mock.timers.tick(1100);
    presence.place();
    assert.equal(pointer.dataset.travelling, 'true', 'a frame with the camera still keeps the travel going');
    positions.orb = [450, 320];
    presence.place();
    assert.equal(pointer.dataset.travelling, undefined, 'a moved camera ends the travel so the pointer stays glued');
    assert.equal(pointer.style['--studio-agent-x'], '453.3px');
    assert.equal(pointer.style['--studio-agent-y'], '323.3px');
    presence.dispose();
  } finally {
    mock.timers.reset();
  }
});

test('a second target during a travel keeps travelling and a walk shown while the pointer is up travels too (#3223)', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const positions = { hero: [100, 200], orb: [400, 300], lamp: [600, 100] };
    const presence = makePresence(positions);
    presence.show({ name: 'Claude', nodeIds: ['hero', 'orb', 'lamp'] });
    const pointer = presence.element;
    mock.timers.tick(1100);
    mock.timers.tick(200);
    assert.equal(pointer.dataset.travelling, 'true');
    mock.timers.tick(900);
    assert.equal(presence.activeNodeId, 'lamp');
    assert.equal(pointer.dataset.travelling, 'true', 'the next target keeps the travel state');
    assert.equal(pointer.style['--studio-agent-x'], '603.3px');
    presence.show({ name: 'Claude', nodeIds: ['hero'] });
    assert.equal(pointer.hidden, false, 'a new walk does not hide the pointer first');
    assert.equal(pointer.dataset.travelling, 'true', 'it travels from where it stands');
    assert.equal(pointer.style['--studio-agent-x'], '103.3px');
    presence.hide();
    assert.equal(pointer.dataset.travelling, undefined);
    presence.dispose();
  } finally {
    mock.timers.reset();
  }
});
