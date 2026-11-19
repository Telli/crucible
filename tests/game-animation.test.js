import './support/load-agent-scene-modules.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeWebBuild } from '../scripts/web-export.mjs';
import { createAgentScene } from '../src/agent-scene.js';
import { startGame } from '../src/game.js';
import { GAME_ANIMATION_LIMITS } from '../src/game-animation.js';
import { GAME_CAPABILITIES } from '../src/game-setup-notes.js';
import { gaitClip, standClip } from './fixtures/foot-slide.js';

// The animation graph and NPC paths from a recipe: validation at the boundary, then a started game whose planted feet hold
// still while the player walks and whose NPC walks a path and stops at its end.

const FRAME_MILLISECONDS = 1000 / 60;
const WALK_SPEED = 1.4;
const RUN_SPEED = 3.6;
const FOOT_DRIFT_BOUND = 1e-4;
const CONTACT_HEIGHT = 1e-6;
// The first frames pop from the standing pose into the walk once, which is not a sliding foot; contacts are measured after it.
const SETTLE_FRAMES = 10;

function plainClip(clip) {
  return {
    duration: clip.duration,
    loop: clip.loop,
    tracks: clip.tracks.map(track => ({
      target: track.target,
      property: track.property,
      keyframes: track.keyframes.map(({ time, value }) => ({ time, value: [...value] })),
    })),
  };
}

function locomotionAnimation(overrides = {}) {
  return {
    clips: {
      idle: plainClip(standClip()),
      walk: plainClip(gaitClip({ speed: WALK_SPEED, cycle: 1 })),
      run: plainClip(gaitClip({ speed: RUN_SPEED, cycle: 0.6 })),
    },
    parameters: { speed: { type: 'number' } },
    rootMotion: { bone: 'Root' },
    layers: [{
      name: 'base',
      states: [{
        name: 'move',
        blend: { parameter: 'speed', motions: [{ clip: 'idle', threshold: 0 }, { clip: 'walk', threshold: WALK_SPEED }, { clip: 'run', threshold: RUN_SPEED }] },
      }],
    }],
    ...overrides,
  };
}

function characterNodes(prefix = '') {
  const id = name => `${prefix}${name}`;
  return [
    { id: id('Walker') },
    { id: id('Root'), parent: id('Walker') },
    { id: id('FootL'), parent: id('Root'), translation: [0.1, 0, 0], geometry: 'block', material: 'paint' },
    { id: id('FootR'), parent: id('Root'), translation: [-0.1, 0, 0], geometry: 'block', material: 'paint' },
  ];
}

function sceneWith(nodes) {
  return createAgentScene({
    format: 'crucible.scene', schemaVersion: 1,
    geometries: [{ id: 'block', type: 'box' }], materials: [{ id: 'paint', color: [0.5, 0.5, 0.5] }],
    nodes,
  });
}

function setGame(scene, game) {
  scene.apply([{ type: 'set-game', game }], { expectedRevision: scene.revision });
  return scene.exportRecipe();
}

function prefixedAnimation(prefix) {
  const animation = locomotionAnimation();
  for (const clip of Object.values(animation.clips)) clip.tracks.forEach(track => { track.target = `${prefix}${track.target}`; });
  animation.rootMotion = { bone: `${prefix}Root` };
  return animation;
}

function rejection(game, nodes = characterNodes()) {
  const scene = sceneWith(nodes);
  return () => scene.apply([{ type: 'set-game', game }], { expectedRevision: scene.revision });
}

const standInRenderer = () => ({ render() {}, resize() {}, updateParts() {}, replaceParts() {}, dispose() {} });

async function startRecipe(recipe, replay) {
  const previous = { request: globalThis.requestAnimationFrame, cancel: globalThis.cancelAnimationFrame };
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  const game = await startGame({}, recipe, { replay, showStatus: false, createRenderer: standInRenderer });
  return {
    game,
    finish() {
      game.dispose();
      globalThis.requestAnimationFrame = previous.request;
      globalThis.cancelAnimationFrame = previous.cancel;
    },
  };
}

function nodeNamed(scene, id) {
  return scene.exportRecipe().nodes.find(node => node.id === id);
}

test('a recipe blends idle, walk and run by speed and a planted foot stays put while the player walks', async () => {
  const withAnimation = setGame(sceneWith(characterNodes()), { player: { node: 'Walker', walkSpeed: WALK_SPEED, runSpeed: RUN_SPEED, animation: locomotionAnimation() } });
  assert.deepEqual(withAnimation.game.player.animation.drive, { speed: 'intentSpeed' });
  const replay = { version: 1, samples: 600, events: [[1, 'keyboard/KeyW', 1]] };
  const { game, finish } = await startRecipe(withAnimation, replay);
  try {
    const contacts = new Map([['FootL', null], ['FootR', null]]);
    const drifts = [];
    for (let frame = 0; frame < 480; frame++) {
      game.runtime.step(FRAME_MILLISECONDS);
      if (frame < SETTLE_FRAMES) continue;
      for (const foot of contacts.keys()) {
        const local = nodeNamed(game.scene, foot).translation;
        const world = [game.controller.state.position[0] - local[0], game.controller.state.position[2] - local[2]];
        if (local[1] > CONTACT_HEIGHT) {
          contacts.set(foot, null);
          continue;
        }
        if (!contacts.get(foot)) contacts.set(foot, { anchor: world, drift: 0 });
        const contact = contacts.get(foot);
        contact.drift = Math.max(contact.drift, Math.hypot(world[0] - contact.anchor[0], world[1] - contact.anchor[1]));
        drifts.push(contact.drift);
      }
    }
    assert.ok(game.controller.state.position[2] < -5, `the player walked forward, z ${game.controller.state.position[2]}`);
    assert.ok(Math.abs(game.animation.get('speed') - WALK_SPEED) < 1e-9, 'speed parameter follows the controller intent');
    assert.ok(Math.max(0, ...drifts) < FOOT_DRIFT_BOUND, `worst planted foot drift ${Math.max(0, ...drifts)} m`);
  } finally {
    finish();
  }
});

test('an NPC follows a path from the recipe, blends into walk and stops at the end', async () => {
  const nodes = [...characterNodes(), ...characterNodes('Npc').map(node => ({ ...node, ...(node.id === 'NpcWalker' ? { translation: [4, 0, 0] } : {}) }))];
  const npc = { node: 'NpcWalker', path: [[4, -6], [8, -6]], cruiseSpeed: WALK_SPEED, animation: prefixedAnimation('Npc') };
  const recipe = setGame(sceneWith(nodes), { player: { node: 'Walker' }, npcs: [npc] });
  assert.equal(recipe.game.npcs[0].footOffset, 0);
  const { game, finish } = await startRecipe(recipe, { version: 1, samples: 1, events: [] });
  try {
    const [follower] = game.npcs.map(entry => entry.follower);
    for (let frame = 0; frame < 60 * 20 && follower.state.status !== 'arrived'; frame++) game.runtime.step(FRAME_MILLISECONDS);
    assert.equal(follower.state.status, 'arrived');
    assert.ok(Math.hypot(follower.state.position[0] - 8, follower.state.position[2] + 6) < 0.15, `NPC at ${follower.state.position}`);
    const placed = nodeNamed(game.scene, 'NpcWalker').translation;
    assert.deepEqual(placed.map(value => Number(value.toFixed(6))), follower.state.position.map(value => Number(value.toFixed(6))));
    game.runtime.step(250);
    assert.equal(game.npcs[0].graph.get('speed'), 0, 'the NPC returns to idle');
  } finally {
    finish();
  }
});

test('restart() resets the player animation graph to time 0', async () => {
  const recipe = setGame(sceneWith(characterNodes()), { player: { node: 'Walker', walkSpeed: WALK_SPEED, runSpeed: RUN_SPEED, animation: locomotionAnimation() } });
  const { game, finish } = await startRecipe(recipe, { version: 1, samples: 600, events: [[1, 'keyboard/KeyW', 1]] });
  try {
    for (let frame = 0; frame < 30; frame++) game.runtime.step(FRAME_MILLISECONDS);
    assert.ok(game.animation.time > 0, 'the graph advanced while the player walked');
    await game.restart();
    assert.equal(game.animation.time, 0);
  } finally {
    finish();
  }
});

test('restart() puts an NPC back at its start and sends it along its path again', async () => {
  const nodes = [...characterNodes(), ...characterNodes('Npc').map(node => ({ ...node, ...(node.id === 'NpcWalker' ? { translation: [4, 0, 0] } : {}) }))];
  const npc = { node: 'NpcWalker', path: [[4, -6], [8, -6]], cruiseSpeed: WALK_SPEED, animation: prefixedAnimation('Npc') };
  const recipe = setGame(sceneWith(nodes), { player: { node: 'Walker' }, npcs: [npc] });
  const { game, finish } = await startRecipe(recipe, { version: 1, samples: 1, events: [] });
  try {
    const follower = game.npcs[0].follower;
    for (let frame = 0; frame < 60 * 20 && follower.state.status !== 'arrived'; frame++) game.runtime.step(FRAME_MILLISECONDS);
    assert.equal(follower.state.status, 'arrived');
    await game.restart();
    assert.equal(follower.state.status, 'moving');
    assert.deepEqual(follower.state.position, [4, 0, 0]);
    assert.equal(game.npcs[0].graph.time, 0, 'the NPC graph starts from time 0');
    for (let frame = 0; frame < 60 * 20 && follower.state.status !== 'arrived'; frame++) game.runtime.step(FRAME_MILLISECONDS);
    assert.equal(follower.state.status, 'arrived', 'the NPC walks the path a second time');
  } finally {
    finish();
  }
});

test('an NPC under a translated parent is placed relative to it and stays put on the first frame', async () => {
  const nodes = [{ id: 'Platform', translation: [20, 0, 0] }, ...characterNodes(), ...characterNodes('Npc').map(node => (node.id === 'NpcWalker' ? { ...node, parent: 'Platform', translation: [0, 0, 0] } : node))];
  const npc = { node: 'NpcWalker', path: [[20, -6]], cruiseSpeed: WALK_SPEED, animation: prefixedAnimation('Npc') };
  const recipe = setGame(sceneWith(nodes), { player: { node: 'Walker' }, npcs: [npc] });
  const { game, finish } = await startRecipe(recipe, { version: 1, samples: 1, events: [] });
  try {
    game.runtime.step(FRAME_MILLISECONDS);
    assert.ok(Math.abs(nodeNamed(game.scene, 'NpcWalker').translation[0]) < 0.1, `local x ${nodeNamed(game.scene, 'NpcWalker').translation[0]}`);
  } finally {
    finish();
  }
});

test('an NPC under a rotated or scaled parent is refused by set-game, startGame and the web export, naming the parent and the fix', async () => {
  const nodesUnder = parentFields => [{ id: 'Platform', translation: [20, 0, 0], ...parentFields }, ...characterNodes(), ...characterNodes('Npc').map(node => (node.id === 'NpcWalker' ? { ...node, parent: 'Platform' } : node))];
  const npc = { node: 'NpcWalker', path: [[20, -6]], cruiseSpeed: WALK_SPEED, animation: prefixedAnimation('Npc') };
  const refusal = /game\.npcs\[\]\.node "NpcWalker" sits under the parent "Platform".*only a translation/;
  assert.throws(rejection({ player: { node: 'Walker' }, npcs: [npc] }, nodesUnder({ scale: [2, 2, 2] })), refusal);
  assert.throws(rejection({ player: { node: 'Walker' }, npcs: [npc] }, nodesUnder({ rotation: [0, 0.7071068, 0, 0.7071068] })), refusal);

  const recipe = setGame(sceneWith(nodesUnder({})), { player: { node: 'Walker' }, npcs: [npc] });
  recipe.nodes.find(node => node.id === 'Platform').scale = [2, 2, 2];
  const previous = { request: globalThis.requestAnimationFrame, cancel: globalThis.cancelAnimationFrame };
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  try {
    await assert.rejects(startGame({}, recipe, { replay: { version: 1, samples: 1, events: [] }, showStatus: false, createRenderer: standInRenderer }), refusal);
  } finally {
    globalThis.requestAnimationFrame = previous.request;
    globalThis.cancelAnimationFrame = previous.cancel;
  }
  const buildDirectory = await mkdtemp(join(tmpdir(), 'crucible-npc-build-'));
  const outputDirectory = await mkdtemp(join(tmpdir(), 'crucible-npc-output-'));
  try {
    await assert.rejects(writeWebBuild({ recipe, buildDirectory, outputDirectory }), refusal);
    assert.deepEqual(await readdir(outputDirectory), [], 'a refused export writes nothing');
  } finally {
    await rm(buildDirectory, { recursive: true, force: true });
    await rm(outputDirectory, { recursive: true, force: true });
  }
});

test('an animation names the field and the fix when it is wrong', () => {
  const player = animation => ({ player: { node: 'Walker', animation } });
  assert.throws(rejection(player(locomotionAnimation({ extra: 1 }))), /player\.animation\.extra is not a field\. Use one of: clips/);
  const missingTarget = locomotionAnimation();
  missingTarget.clips.walk.tracks[0].target = 'Ghost';
  assert.throws(rejection(player(missingTarget)), /player\.animation\.clips\.walk\.tracks\[0\]\.target names "Ghost", which is not a child node of the character\. Use one of: Root, FootL, FootR/);
  const onCharacter = locomotionAnimation();
  onCharacter.clips.walk.tracks[0].target = 'Walker';
  assert.throws(rejection(player(onCharacter)), /not a child node of the character/);
  const badProperty = locomotionAnimation();
  badProperty.clips.idle.tracks[0].property = 'scale';
  assert.throws(rejection(player(badProperty)), /property is "scale"\. Use one of: translation, rotation/);
  assert.throws(rejection(player(locomotionAnimation({ layers: [{ name: 'base', states: [{ name: 'move', clip: 'jog' }] }] }))), /player\.animation: .*jog/);
  assert.throws(rejection(player(locomotionAnimation({ drive: { speed: 'velocity' } }))), /drive\.speed is "velocity"\. Use one of: speed, intentSpeed, airborne/);
  assert.throws(rejection(player(locomotionAnimation({ drive: { airborne: 'airborne' } }))), /drive\.airborne needs a boolean parameter/);
  assert.throws(rejection(player(locomotionAnimation({ clips: {} }))), /clips needs 1 to 16 clips/);
  assert.throws(rejection({ player: { node: 'Root', animation: locomotionAnimation() } }), /has nothing to move|not a child node/);
});

test('animation counts are bounded', () => {
  const tooManyClips = locomotionAnimation();
  tooManyClips.clips = Object.fromEntries(Array.from({ length: GAME_ANIMATION_LIMITS.maxClips + 1 }, (_, index) => [`clip${index}`, plainClip(standClip())]));
  assert.throws(rejection({ player: { node: 'Walker', animation: tooManyClips } }), /needs 1 to 16 clips, got 17/);
  const tooManyKeys = locomotionAnimation();
  tooManyKeys.clips.idle.tracks[0].keyframes = Array.from({ length: GAME_ANIMATION_LIMITS.maxKeyframesPerTrack + 1 }, (_, index) => ({ time: index / 1000, value: [0.1, 0, 0] }));
  assert.throws(rejection({ player: { node: 'Walker', animation: tooManyKeys } }), /needs 1 to 256 keyframes/);
});

test('an NPC needs a node of its own, root motion, a speed parameter and a path', () => {
  const nodes = [...characterNodes(), ...characterNodes('Npc')];
  const npc = overrides => ({ player: { node: 'Walker' }, npcs: [{ node: 'NpcWalker', path: [[0, -4]], animation: prefixedAnimation('Npc'), ...overrides }].map(entry => Object.fromEntries(Object.entries(entry).filter(([, value]) => value !== undefined))) });
  assert.throws(rejection(npc({ animation: undefined }), nodes), /npcs\[0\]\.animation is required/);
  assert.throws(rejection(npc({ node: 'Walker', animation: locomotionAnimation() }), nodes), /overlaps the character "Walker"/);
  assert.throws(rejection(npc({ node: 'Ghost' }), nodes), /npcs\[0\]\.node names "Ghost"/);
  assert.throws(rejection(npc({ path: [] }), nodes), /npcs\[0\]\.path must be 1 to 256 waypoints, each \[x, z\]/);
  assert.throws(rejection(npc({ path: [[0, 'far']] }), nodes), /npcs\[0\]\.path must be/);
  assert.throws(rejection(npc({ cruiseSpeed: 500 }), nodes), /npcs\[0\]\.cruiseSpeed must be a number from 0\.01 to 100/);
  const noRootMotion = prefixedAnimation('Npc');
  delete noRootMotion.rootMotion;
  assert.throws(rejection(npc({ animation: noRootMotion }), nodes), /rootMotion is required for an NPC/);
  const noSpeed = prefixedAnimation('Npc');
  noSpeed.parameters = { pace: { type: 'number' } };
  noSpeed.layers[0].states[0].blend.parameter = 'pace';
  assert.throws(rejection(npc({ animation: noSpeed }), nodes), /parameters\.speed must be declared/);
  assert.throws(rejection(npc({ animation: { ...prefixedAnimation('Npc'), drive: { speed: 'speed' } } }), nodes), /drive is not allowed on an NPC/);
});

test('the scene_capabilities animation example is a valid operation', () => {
  const scene = sceneWith([{ id: 'walker' }, { id: 'body', parent: 'walker' }]);
  scene.apply([structuredClone(GAME_CAPABILITIES.animationExample)], { expectedRevision: scene.revision });
  assert.equal(scene.exportRecipe().game.player.animation.drive.speed, 'intentSpeed');
  assert.match(GAME_CAPABILITIES.animation, /never the character/);
});

test('clearing the game removes the animation with it', () => {
  const scene = sceneWith(characterNodes());
  setGame(scene, { player: { node: 'Walker', animation: locomotionAnimation() } });
  scene.apply([{ type: 'set-game', game: null }], { expectedRevision: scene.revision });
  assert.equal(scene.exportRecipe().game, undefined);
});

test('an asset character whose file has no clips says so instead of offering an index from 0 to -1', async () => {
  const { createGameAnimation } = await import('../src/game-animation.js');
  const { assetCopyKey } = await import('../src/agent-scene-assets.js');
  const assetId = 'ab'.repeat(32);
  const animation = { clips: { walk: { from: { clip: 0 } } }, layers: [{ name: 'base', states: [{ name: 'walk', clip: 'walk' }] }] };
  const nodes = [{ id: 'hero', asset: { id: assetId } }];
  for (const asset of [{ animations: [], nodes: [] }, { nodes: [] }]) {
    const assets = new Map([[assetCopyKey(assetId, 0), asset]]);
    assert.throws(() => createGameAnimation(animation, nodes, 'hero', { assets }), error => error instanceof RangeError && /has no animation clips/.test(error.message));
  }
});
