import './support/load-agent-scene-modules.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentScene } from '../src/agent-scene.js';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startGame } from '../src/game.js';
import { writeWebBuild } from '../scripts/web-export.mjs';

const EMPTY_RECORDING = { version: 1, samples: 0, events: [] };
const HOLD_FORWARD = { version: 1, samples: 600, events: [[1, 'keyboard/KeyW', 1]] };
const STEP_MILLISECONDS = 1000 / 60;

function standInRenderer() {
  return { render() {}, resize() {}, updateParts() {}, replaceParts() {}, dispose() {} };
}

function withAnimationFrameStubs() {
  const previous = { request: globalThis.requestAnimationFrame, cancel: globalThis.cancelAnimationFrame };
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  return () => {
    globalThis.requestAnimationFrame = previous.request;
    globalThis.cancelAnimationFrame = previous.cancel;
  };
}

function sceneRecipe(nodes, game) {
  const scene = createAgentScene({
    format: 'crucible.scene', schemaVersion: 1,
    geometries: [{ id: 'block', type: 'box' }], materials: [{ id: 'paint', color: [0.5, 0.5, 0.5] }],
    nodes,
  });
  scene.apply([{ type: 'set-game', game }], { expectedRevision: scene.revision });
  return scene.exportRecipe();
}

function parentedRecipe(parentFields = {}) {
  return sceneRecipe([
    { id: 'rig', translation: [10, 0, 0], ...parentFields },
    { id: 'creature', parent: 'rig', geometry: 'block', material: 'paint' },
  ], { player: { node: 'creature' } });
}

function playerRecipe(rules) {
  const recipe = sceneRecipe([{ id: 'creature', geometry: 'block', material: 'paint' }], { player: { node: 'creature' } });
  recipe.game = { ...recipe.game, rules: { version: 1, parts: [{ id: 'creature', tags: ['player'] }], ...rules } };
  return recipe;
}

async function start(recipe, replay = EMPTY_RECORDING) {
  return startGame({}, recipe, { replay, showStatus: false, createRenderer: () => standInRenderer() });
}

function stepFrames(game, frames) {
  for (let frame = 0; frame < frames; frame++) game.runtime.step(STEP_MILLISECONDS);
}

function worldX(game, id) {
  const byId = new Map(game.scene.exportRecipe().nodes.map(node => [node.id, node]));
  let total = 0;
  for (let node = byId.get(id); node; node = byId.get(node.parent)) total += node.translation?.[0] ?? 0;
  return total;
}

test('a player under a translated parent stays where the recipe put it on the first frame', async () => {
  const restore = withAnimationFrameStubs();
  try {
    const game = await start(parentedRecipe());
    assert.equal(worldX(game, 'creature'), 10);
    stepFrames(game, 1);
    assert.equal(worldX(game, 'creature'), 10, 'the parent offset is not counted twice');
    game.dispose();
  } finally {
    restore();
  }
});

test('a player under a rotated or scaled parent is refused by set-game, with the parent and the fix', () => {
  assert.throws(() => parentedRecipe({ scale: [2, 2, 2] }), /game\.player\.node "creature" sits under the parent "rig".*only a translation/);
  assert.throws(() => parentedRecipe({ rotation: [0, 0.7071068, 0, 0.7071068] }), /parent "rig"/);
});

test('startGame still refuses a hand-written recipe whose player parent turns, and the web export does too', async () => {
  const recipe = parentedRecipe();
  recipe.nodes.find(node => node.id === 'rig').rotation = [0, 0.7071068, 0, 0.7071068];
  const restore = withAnimationFrameStubs();
  try {
    await assert.rejects(start(recipe), /game\.player\.node "creature" sits under the parent "rig"/);
  } finally {
    restore();
  }
  const buildDirectory = await mkdtemp(join(tmpdir(), 'crucible-restart-build-'));
  const outputDirectory = await mkdtemp(join(tmpdir(), 'crucible-restart-output-'));
  try {
    await assert.rejects(
      writeWebBuild({ recipe, buildDirectory, outputDirectory }),
      /game\.player\.node "creature" sits under the parent "rig".*only a translation/,
    );
    assert.deepEqual(await readdir(outputDirectory), [], 'a refused export writes nothing');
  } finally {
    await rm(buildDirectory, { recursive: true, force: true });
    await rm(outputDirectory, { recursive: true, force: true });
  }
});

test('the camera rig goes back to its start heading when the game restarts', async () => {
  const restore = withAnimationFrameStubs();
  const frames = [];
  const renderer = { ...standInRenderer(), render: frame => frames.push(frame.eye ? [...frame.eye] : JSON.stringify(frame.camera ?? frame)) };
  try {
    const turnThenStop = { version: 1, samples: 600, events: [[2, 'keyboard/ArrowRight', 1], [40, 'keyboard/ArrowRight', 0]] };
    const game = await startGame({}, playerRecipe({ rules: [] }), { replay: turnThenStop, showStatus: false, createRenderer: () => renderer });
    stepFrames(game, 1);
    const startPose = JSON.stringify(frames.at(-1));
    stepFrames(game, 60);
    assert.notEqual(JSON.stringify(frames.at(-1)), startPose, 'holding the arrow turned the camera');
    await game.restart();
    stepFrames(game, 1);
    assert.equal(JSON.stringify(frames.at(-1)), startPose, 'the camera is back at its start heading');
    game.dispose();
  } finally {
    restore();
  }
});

test('the restart hint names the key on a keyboard page, a tap on a touch page and nothing on a replay', async () => {
  const restore = withAnimationFrameStubs();
  const previous = { document: globalThis.document, add: globalThis.addEventListener, remove: globalThis.removeEventListener };
  globalThis.addEventListener = () => {};
  globalThis.removeEventListener = () => {};
  let label = '';
  globalThis.document = { addEventListener() {}, removeEventListener() {}, createElement: () => ({ style: {}, remove() {}, set textContent(value) { label = value; } }) };
  const taps = [];
  const canvas = { parentNode: { appendChild() {} }, addEventListener: (name, listener) => taps.push([name, listener]), removeEventListener() {} };
  const winRule = { rules: [{ id: 'done', when: { type: 'timer', seconds: 0.2 }, do: [{ type: 'win' }] }] };
  const labelAfterWin = async (recipe, options) => {
    const game = await startGame(canvas, recipe, { createRenderer: () => standInRenderer(), ...options });
    stepFrames(game, 30);
    const shown = label;
    game.dispose();
    return { shown, game };
  };
  try {
    const keyboard = await labelAfterWin(playerRecipe(winRule), {});
    assert.match(keyboard.shown, /YOU WIN\s+\(R to restart\)/);
    const replayed = await labelAfterWin(playerRecipe(winRule), { replay: EMPTY_RECORDING });
    assert.match(replayed.shown, /YOU WIN$/);
    const touchRecipe = playerRecipe(winRule);
    touchRecipe.game.input = 'touch';
    taps.length = 0;
    const game = await startGame(canvas, touchRecipe, { createRenderer: () => standInRenderer() });
    stepFrames(game, 30);
    assert.match(label, /\(tap to restart\)/);
    assert.equal(game.rules.state.status, 'won');
    taps.find(([name]) => name === 'pointerdown')[1]();
    assert.equal(game.rules.state.status, 'playing', 'a tap restarts a finished touch game');
    game.dispose();
  } finally {
    Object.assign(globalThis, { document: previous.document, addEventListener: previous.add, removeEventListener: previous.remove });
    restore();
  }
});

test('the restart rule action puts the player back at its start as well as resetting the rules', async () => {
  const restore = withAnimationFrameStubs();
  try {
    const game = await start(playerRecipe({
      variables: { score: 0 },
      rules: [
        { id: 'score', when: { type: 'timer', seconds: 1 }, do: [{ type: 'set', variable: 'score', value: 5 }] },
        { id: 'again', when: { type: 'variable', expression: ['>=', 'score', 5] }, do: [{ type: 'restart' }] },
      ],
    }), HOLD_FORWARD);
    stepFrames(game, 70);
    assert.equal(game.rules.state.variables.score, 0, 'the rules restarted');
    assert.ok(game.controller.state.position[2] > -0.6, `the player went back to its start, z ${game.controller.state.position[2]}`);
    game.dispose();
  } finally {
    restore();
  }
});

test('restart() on a lost game starts it again: status, player and the timer', async () => {
  const restore = withAnimationFrameStubs();
  try {
    const game = await start(playerRecipe({ rules: [{ id: 'out', when: { type: 'timer', seconds: 1 }, do: [{ type: 'lose' }] }] }), HOLD_FORWARD);
    stepFrames(game, 90);
    assert.equal(game.rules.state.status, 'lost');
    assert.ok(game.controller.state.position[2] < -1);
    await game.restart();
    assert.equal(game.rules.state.status, 'playing');
    assert.deepEqual(game.controller.state.position, [0, 0, 0]);
    stepFrames(game, 1);
    assert.ok(game.controller.state.position[2] > -0.1, 'the player starts from the start again');
    stepFrames(game, 70);
    assert.equal(game.rules.state.status, 'lost', 'the timer runs again from the restart');
    game.dispose();
  } finally {
    restore();
  }
});

test('R restarts a finished game that reads the keyboard, and a replay has no such key', async () => {
  const restore = withAnimationFrameStubs();
  const listeners = [];
  const previous = { add: globalThis.addEventListener, remove: globalThis.removeEventListener };
  globalThis.addEventListener = (name, listener) => listeners.push([name, listener]);
  globalThis.removeEventListener = (name, listener) => listeners.splice(listeners.findIndex(entry => entry[1] === listener), 1);
  const keyListeners = () => listeners.filter(([name]) => name === 'keydown');
  try {
    const recipe = playerRecipe({ rules: [{ id: 'done', when: { type: 'timer', seconds: 0.5 }, do: [{ type: 'win' }] }] });
    const replayed = await start(recipe);
    assert.equal(keyListeners().length, 0);
    replayed.dispose();
    const game = await startGame({}, recipe, { showStatus: false, createRenderer: () => standInRenderer() });
    const [, onKey] = keyListeners()[0];
    onKey({ code: 'KeyR', repeat: false });
    stepFrames(game, 40);
    assert.equal(game.rules.state.status, 'won');
    onKey({ code: 'KeyR', repeat: false });
    assert.equal(game.rules.state.status, 'playing');
    game.dispose();
    assert.equal(keyListeners().length, 0);
  } finally {
    globalThis.addEventListener = previous.add;
    globalThis.removeEventListener = previous.remove;
    restore();
  }
});

test('R and a tap do nothing while the game is playing, on a held key, on another key or in a game without rules', async () => {
  const restore = withAnimationFrameStubs();
  const previous = { add: globalThis.addEventListener, remove: globalThis.removeEventListener };
  const keyListeners = [];
  globalThis.addEventListener = (name, listener) => {
    if (name === 'keydown') keyListeners.push(listener);
  };
  // The keyboard input source also listens for keydown, so pick the restart handler by its name.
  const restartOnKeyOf = () => keyListeners.filter(listener => listener.name === 'restartOnKey').at(-1);
  globalThis.removeEventListener = () => {};
  const taps = [];
  const canvas = { addEventListener: (name, listener) => taps.push([name, listener]), removeEventListener() {} };
  // The score is set at 0.2 s and the game is won at 0.5 s; a restart anywhere in between would put the score back to 0.
  const scoringRecipe = () => playerRecipe({
    variables: { score: 0 },
    rules: [
      { id: 'score', when: { type: 'timer', seconds: 0.2 }, do: [{ type: 'set', variable: 'score', value: 5 }] },
      { id: 'done', when: { type: 'timer', seconds: 0.5 }, do: [{ type: 'win' }] },
    ],
  });
  try {
    const game = await startGame(canvas, scoringRecipe(), { showStatus: false, createRenderer: () => standInRenderer() });
    const onKey = restartOnKeyOf();
    assert.ok(onKey, 'the restart handler is registered');
    stepFrames(game, 20);
    assert.equal(game.rules.state.status, 'playing');
    assert.equal(game.rules.state.variables.score, 5);
    onKey({ code: 'KeyR', repeat: false });
    assert.equal(game.rules.state.variables.score, 5, 'R while playing does not restart');
    stepFrames(game, 20);
    assert.equal(game.rules.state.status, 'won');
    onKey({ code: 'KeyR', repeat: true });
    assert.equal(game.rules.state.status, 'won', 'a held R does not restart');
    onKey({ code: 'KeyW', repeat: false });
    assert.equal(game.rules.state.status, 'won', 'another key does not restart');
    game.dispose();

    const touchRecipe = scoringRecipe();
    touchRecipe.game.input = 'touch';
    taps.length = 0;
    const touchGame = await startGame(canvas, touchRecipe, { showStatus: false, createRenderer: () => standInRenderer() });
    const onTap = taps.find(([name]) => name === 'pointerdown')[1];
    stepFrames(touchGame, 20);
    onTap();
    assert.equal(touchGame.rules.state.variables.score, 5, 'a tap while playing does not restart');
    touchGame.dispose();

    const rulesFree = sceneRecipe([{ id: 'creature', geometry: 'block', material: 'paint' }], { player: { node: 'creature' } });
    const freeGame = await startGame(canvas, rulesFree, { showStatus: false, createRenderer: () => standInRenderer() });
    assert.equal(freeGame.rules, null);
    restartOnKeyOf()({ code: 'KeyR', repeat: false });
    stepFrames(freeGame, 1);
    freeGame.dispose();

    const touchFree = sceneRecipe([{ id: 'creature', geometry: 'block', material: 'paint' }], { player: { node: 'creature' }, input: 'touch' });
    taps.length = 0;
    const touchFreeGame = await startGame(canvas, touchFree, { showStatus: false, createRenderer: () => standInRenderer() });
    assert.equal(touchFreeGame.rules, null);
    const onFreeTap = taps.find(([name]) => name === 'pointerdown')[1];
    onFreeTap();
    stepFrames(touchFreeGame, 1);
    touchFreeGame.dispose();
  } finally {
    globalThis.addEventListener = previous.add;
    globalThis.removeEventListener = previous.remove;
    restore();
  }
});

test('touchControls draws the stick over a touch game only when asked, and removes it on dispose', async () => {
  const restore = withAnimationFrameStubs();
  const previous = { document: globalThis.document, add: globalThis.addEventListener, remove: globalThis.removeEventListener };
  globalThis.addEventListener = () => {};
  globalThis.removeEventListener = () => {};
  const documentOwner = { addEventListener() {}, removeEventListener() {}, createElement: () => fakeStickElement() };
  function fakeStickElement() {
    const element = { ownerDocument: documentOwner, style: {}, children: [], removed: false, setAttribute() {}, appendChild: child => element.children.push(child), remove() { element.removed = true; }, getBoundingClientRect: () => ({ left: 0, top: 0 }) };
    return element;
  }
  globalThis.document = documentOwner;
  const parent = fakeStickElement();
  const canvas = { parentNode: parent, addEventListener() {}, removeEventListener() {} };
  const touchRecipe = playerRecipe({ rules: [] });
  touchRecipe.game.input = 'touch';
  try {
    const plain = await startGame(canvas, touchRecipe, { showStatus: false, createRenderer: () => standInRenderer() });
    assert.equal(parent.children.length, 0, 'off by default');
    plain.dispose();
    const drawn = await startGame(canvas, touchRecipe, { showStatus: false, touchControls: true, createRenderer: () => standInRenderer() });
    assert.equal(parent.children.length, 1, 'one overlay container');
    drawn.dispose();
    assert.equal(parent.children[0].removed, true);
    const keyboardRecipe = playerRecipe({ rules: [] });
    const keyboard = await startGame(canvas, keyboardRecipe, { showStatus: false, touchControls: true, createRenderer: () => standInRenderer() });
    assert.equal(parent.children.length, 1, 'a keyboard game draws no stick');
    keyboard.dispose();
    await assert.rejects(startGame(canvas, touchRecipe, { showStatus: false, touchControls: 'yes', createRenderer: () => standInRenderer() }), /touchControls must be true or false, got string/);
  } finally {
    Object.assign(globalThis, { document: previous.document, addEventListener: previous.add, removeEventListener: previous.remove });
    restore();
  }
});
