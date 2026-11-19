import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseGltf } from '../src/gltf.js';
import { createFileSceneClipPlayer } from '../src/file-scene-clip.js';
import { skinnedGeometry } from '../src/path-tracer-scene.js';

async function loadRobot() {
  const bytes = await readFile(new URL('fixtures/RobotExpressive.glb', import.meta.url));
  return parseGltf(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), { maxVertices: 500000 });
}

// What the page does before it builds the renderer: copies of the parts (dense levels of detail and water reflection do this)
// that share the originals' matrix and skin arrays.
function rendererCopiesOf(sceneParts) {
  return sceneParts.map(part => ({ ...part }));
}

function recordingRenderer() {
  const calls = [];
  return { calls, updateParts: (parts, options) => calls.push({ parts, options }) };
}

function poseOf(parts) {
  return parts.map(part => ({ matrix: [...part.matrix], palette: part.skin ? [...part.skin.jointMatrices] : null }));
}

async function playerForRobot({ stagedPart = null } = {}) {
  const asset = await loadRobot();
  const posedParts = [...asset.parts];
  const sceneParts = stagedPart ? [...posedParts, stagedPart] : posedParts;
  const rendererParts = rendererCopiesOf(sceneParts);
  const player = createFileSceneClipPlayer({ asset, posedParts, sceneParts, rendererParts });
  return { asset, player, rendererParts, posedParts };
}

test('the first clip poses the renderer parts: the pose at t=0 differs from the pose at half the clip', async () => {
  const { player, rendererParts } = await playerForRobot();
  const renderer = recordingRenderer();
  player.poseAt(renderer, 0);
  const atStart = poseOf(rendererParts);
  player.poseAt(renderer, player.clip.duration / 2);
  const atMiddle = poseOf(rendererParts);
  assert.notDeepEqual(atMiddle, atStart);
  assert.equal(renderer.calls.length, 2);
  assert.deepEqual(renderer.calls[0].options, { shadows: true });
});

test('the clip loops: a time past its length poses like the same time inside it', async () => {
  const { player, rendererParts } = await playerForRobot();
  const renderer = recordingRenderer();
  player.poseAt(renderer, 0.4);
  const inside = poseOf(rendererParts);
  player.poseAt(renderer, 0.4 + 3 * player.clip.duration);
  assert.deepEqual(poseOf(rendererParts), inside);
});

test('only the renderer copies of the posed parts go to updateParts, not parts that came from another file', async () => {
  const stagedPart = { name: 'staged', matrix: new Float32Array(16), geometry: {}, material: {} };
  const { player, rendererParts, posedParts } = await playerForRobot({ stagedPart });
  const renderer = recordingRenderer();
  player.poseAt(renderer, 0.2);
  const updated = renderer.calls[0].parts;
  assert.equal(updated.length, posedParts.length);
  assert.ok(updated.every((part, index) => part === rendererParts[index]));
  assert.ok(!updated.includes(rendererParts.at(-1)));
});

test('a GLB without a clip gets no player, so its frames are drawn as before', async () => {
  const asset = await loadRobot();
  const withoutClip = { ...asset, animations: [] };
  assert.equal(createFileSceneClipPlayer({ asset: withoutClip, posedParts: asset.parts, sceneParts: asset.parts, rendererParts: asset.parts }), null);
  assert.equal(createFileSceneClipPlayer({ asset: { parts: [] }, posedParts: [], sceneParts: [], rendererParts: [] }), null);
});

test('renderer parts that do not match the scene parts one for one are refused by count', async () => {
  const asset = await loadRobot();
  assert.throws(
    () => createFileSceneClipPlayer({ asset, posedParts: asset.parts, sceneParts: asset.parts, rendererParts: asset.parts.slice(1) }),
    /must match the scene parts/,
  );
});

// What the native tracer reads from a part: the skinned vertices at the part's current pose (src/path-tracer-scene.js).
function tracedPositionsOf(parts) {
  return parts.filter(part => part.skin).map(part => [...skinnedGeometry(part).positions]);
}

test('applyAt poses the parts handed to the native tracer: the traced vertices differ between t=0 and half the clip', async () => {
  const { asset, player } = await playerForRobot();
  player.applyAt(0);
  const atStart = tracedPositionsOf(asset.parts);
  player.applyAt(player.clip.duration / 2);
  const atMiddle = tracedPositionsOf(asset.parts);
  assert.ok(atStart.length > 0, 'the robot must have skinned parts, or this test does not cover the tracer input');
  assert.notDeepEqual(atMiddle, atStart);
  player.applyAt(player.clip.duration / 2 + 2 * player.clip.duration);
  assert.deepEqual(tracedPositionsOf(asset.parts), atMiddle);
});

test('a scene without a clip has no player, so the traced parts stay as loaded', async () => {
  const asset = await loadRobot();
  asset.animations = [];
  const before = tracedPositionsOf(asset.parts);
  const player = createFileSceneClipPlayer({ asset, posedParts: asset.parts, sceneParts: asset.parts, rendererParts: rendererCopiesOf(asset.parts) });
  assert.equal(player, null);
  assert.deepEqual(tracedPositionsOf(asset.parts), before);
});
