import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { main } from '../scripts/evidence.mjs';
import { boxMargins, checkClipping, checkContinuity, checkFraming, clipBoxToFrame, findJumps, frameMetrics, projectBounds } from '../scripts/evidence-checks.mjs';

const WIDTH = 40;
const HEIGHT = 40;

/** A WIDTH by HEIGHT RGBA frame filled with one gray level, with `patch` ({ left, top, right, bottom, level }) painted over it. */
function grayFrame(level, patch = null) {
  const data = new Uint8Array(WIDTH * HEIGHT * 4);
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const inPatch = patch && x >= patch.left && x < patch.right && y >= patch.top && y < patch.bottom;
      const value = inPatch ? patch.level : level;
      data.set([value, value, value, 255], (y * WIDTH + x) * 4);
    }
  }
  return { data, width: WIDTH, height: HEIGHT };
}

const SUBJECT_REGION = { left: 10, top: 10, right: 30, bottom: 30 };

test('frame metrics report mean luma, saturation and the pure white and pure black shares', () => {
  const gray = frameMetrics(grayFrame(100));
  assert.equal(gray.meanLuma, 100);
  assert.equal(gray.meanSaturation, 0);
  assert.equal(gray.pixelCount, WIDTH * HEIGHT);
  const red = frameMetrics({ data: new Uint8Array([255, 0, 0, 255]), width: 1, height: 1 });
  assert.equal(red.meanSaturation, 255);
  const half = frameMetrics(grayFrame(100, { ...SUBJECT_REGION, level: 255 }), SUBJECT_REGION);
  assert.equal(half.blownShare, 1);
  assert.equal(half.crushedShare, 0);
  assert.throws(() => frameMetrics({ data: new Uint8Array(3), width: 1, height: 1 }), /4 bytes per pixel/);
});

test('a steady clip has no jump and a smooth ramp passes', () => {
  const steady = Array.from({ length: 30 }, () => 120);
  assert.deepEqual(findJumps(steady).jumps, []);
  const ramp = Array.from({ length: 30 }, (_, index) => 100 + index * 2);
  assert.deepEqual(findJumps(ramp).jumps, []);
});

test('a 2-frame dropout in the middle of a clip FAILS the continuity check and names the frames', () => {
  const frames = Array.from({ length: 20 }, (_, index) => {
    const dropped = index === 7 || index === 8;
    return frameMetrics(grayFrame(dropped ? 30 : 120), SUBJECT_REGION);
  });
  const result = checkContinuity(frames);
  assert.equal(result.pass, false);
  assert.deepEqual(result.luma.jumps.map(jump => jump.frame), [7, 9]);
  assert.deepEqual(result.dropouts, [{ firstFrame: 7, lastFrame: 8 }]);
  assert.match(result.detail, /luma frame 7/);
  assert.match(result.detail, /dropout frames 7-8/);
});

test('a step above 3 times the median step is a jump even under 5 levels', () => {
  const values = Array.from({ length: 20 }, (_, index) => index * 0.2);
  values[10] += 3;
  for (let index = 11; index < 20; index += 1) values[index] += 3;
  assert.deepEqual(findJumps(values).jumps.map(jump => jump.frame), [10]);
});

test('a subject cut by the frame edge FAILS the framing check with its margin', () => {
  const camera = { eye: [0, 0, 6], target: [0, 0, 0], fov: 45 };
  const inside = projectBounds({ min: [-1, -1, -0.1], max: [1, 1, 0.1] }, camera, 270, 480);
  const passing = checkFraming(inside, 270, 480);
  assert.equal(passing.pass, true);
  const wide = projectBounds({ min: [-3, -1, -0.1], max: [3, 1, 0.1] }, camera, 270, 480);
  const cut = checkFraming(wide, 270, 480);
  assert.equal(cut.pass, false);
  assert.ok(cut.margins.left < 0, `left margin ${cut.margins.left}`);
  assert.match(cut.detail, /leaves the frame at the left, right edge/);
});

test('a subject touching an edge or closer than the required margin FAILS and one behind the camera FAILS', () => {
  assert.equal(checkFraming({ left: 0, top: 50, right: 100, bottom: 100 }, 200, 200).pass, false);
  const near = checkFraming({ left: 5, top: 50, right: 100, bottom: 100 }, 200, 200, { minimumMargin: 8 });
  assert.equal(near.pass, false);
  assert.match(near.detail, /5 px from the left edge; needs at least 8 px/);
  assert.equal(checkFraming({ left: 8, top: 8, right: 192, bottom: 192 }, 200, 200).pass, true);
  const behind = projectBounds({ min: [-1, -1, 7], max: [1, 1, 8] }, { eye: [0, 0, 6], target: [0, 0, 0] }, 200, 200);
  assert.equal(checkFraming(behind, 200, 200).pass, false);
});

test('the projected box of a centred cube is centred and the margins add up', () => {
  const box = projectBounds({ min: [-1, -1, -1], max: [1, 1, 1] }, { eye: [0, 0, 10], target: [0, 0, 0], fov: 45 }, 200, 100);
  const margins = boxMargins(box, 200, 100);
  assert.ok(Math.abs(margins.left - margins.right) < 1e-6);
  assert.ok(Math.abs(margins.top - margins.bottom) < 1e-6);
});

test('blown highlights and crushed shadows over the share limit FAIL', () => {
  const clean = frameMetrics(grayFrame(120), SUBJECT_REGION);
  const blown = frameMetrics(grayFrame(120, { left: 10, top: 10, right: 30, bottom: 20, level: 255 }), SUBJECT_REGION);
  const crushed = frameMetrics(grayFrame(120, { left: 10, top: 10, right: 30, bottom: 20, level: 0 }), SUBJECT_REGION);
  assert.equal(checkClipping([clean, clean]).highlights.pass, true);
  const flagged = checkClipping([clean, blown, crushed], { firstFrame: 4 });
  assert.equal(flagged.highlights.pass, false);
  assert.equal(flagged.highlights.frame, 5);
  assert.equal(flagged.shadows.pass, false);
  assert.equal(flagged.shadows.frame, 6);
});

test('a box is clipped to the frame and one fully outside has no region', () => {
  assert.deepEqual(clipBoxToFrame({ left: -5.5, top: 2.2, right: 12.1, bottom: 50 }, 40, 40), { left: 0, top: 2, right: 13, bottom: 40 });
  assert.equal(clipBoxToFrame({ left: 50, top: 0, right: 60, bottom: 10 }, 40, 40), null);
});

test('--analyze exits 1 on a folder of frames with a 2-frame dropout and 0 on a steady one', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'evidence-analyze-'));
  const originalLog = console.log;
  console.log = () => {};
  try {
    for (const [name, dropped] of [['steady', []], ['dropout', [5, 6]]]) {
      await mkdir(join(folder, name));
      for (let frame = 0; frame < 12; frame += 1) {
        const level = dropped.includes(frame) ? 20 : 120;
        await sharp({ create: { width: 16, height: 16, channels: 3, background: { r: level, g: level, b: level } } }).png().toFile(join(folder, name, `frame-${String(frame).padStart(4, '0')}.png`));
      }
    }
    assert.equal(await main(['--issue', '1', '--analyze', join(folder, 'steady')]), 0);
    assert.equal(await main(['--issue', '1', '--analyze', join(folder, 'dropout')]), 1);
  } finally {
    console.log = originalLog;
    await rm(folder, { recursive: true, force: true });
  }
});
