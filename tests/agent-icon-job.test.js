import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderIconJob } from '../scripts/agent-icon-job.mjs';
import { decodePng, encodePng } from '../scripts/agent-icon-png.mjs';
import { alphaBounds, normalizeIconSettings } from '../src/icon-sheet.js';
import { artifactNames, jobDeadlineMs, normalizeJobSettings } from '../scripts/agent-render-jobs.mjs';

const subtract = (a, b) => a.map((value, axis) => value - b[axis]);
const dot = (a, b) => a.reduce((sum, value, axis) => sum + value * b[axis], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normalize = a => a.map(value => value / Math.hypot(...a));

/** A stand-in for the page: draws an axis aligned box as the filled screen box of its eight corners, through its own orthographic projection. */
function boxItem(dimensions, size, centerOffset = [0, 0, 0]) {
  const bounds = { min: centerOffset.map((value, axis) => value - dimensions[axis] / 2), max: centerOffset.map((value, axis) => value + dimensions[axis] / 2) };
  return {
    bounds,
    async draw(camera, color = [200, 90, 40, 255]) {
      const forward = normalize(subtract(camera.target, camera.eye));
      const right = normalize(cross(forward, camera.up));
      const up = cross(right, forward);
      const corners = Array.from({ length: 8 }, (_, corner) => [0, 1, 2].map(axis => (corner & (1 << axis) ? bounds.max[axis] : bounds.min[axis])));
      const screen = corners.map(point => {
        const offset = subtract(point, camera.target);
        return [size / 2 + dot(offset, right) / camera.orthoScale * size, size / 2 - dot(offset, up) / camera.orthoScale * size];
      });
      const left = Math.min(...screen.map(point => point[0]));
      const right2 = Math.max(...screen.map(point => point[0]));
      const top = Math.min(...screen.map(point => point[1]));
      const bottom = Math.max(...screen.map(point => point[1]));
      const data = Buffer.alloc(size * size * 4);
      for (let row = 0; row < size; row++) {
        for (let column = 0; column < size; column++) {
          if (column + 0.5 < left || column + 0.5 > right2 || row + 0.5 < top || row + 0.5 > bottom) continue;
          data.set(color, (row * size + column) * 4);
        }
      }
      return encodePng({ width: size, height: size, data });
    },
    // A step of the sketch: the same silhouette in a colour of its own, so a test can tell the panels of a strip apart.
    async drawStep(camera, step) {
      return this.draw(camera, STEP_COLORS[step]);
    },
    async close() {},
  };
}

const STEP_COLORS = { shaded: [10, 20, 30, 255], outline: [40, 50, 60, 255], hatching: [70, 80, 90, 255] };
const SHAPES = { coin: [0.5, 0.04, 0.5], sword: [0.08, 1.6, 0.03], chest: [2.4, 1.8, 1.6] };

async function runJob(sources, overrides = {}) {
  const size = overrides.size ?? 128;
  const settings = normalizeIconSettings({ kind: 'icons', items: sources, size, ...overrides });
  const directory = await mkdtemp(join(tmpdir(), 'crucible-icons-test-'));
  const progressCalls = [];
  const openedViews = [];
  const result = await renderIconJob({
    settings, directory, signal: new AbortController().signal,
    progress: async update => { progressCalls.push(update.frames); },
    openItem: async (item, index, frame) => {
      openedViews.push([index, frame.view.azimuth]);
      return boxItem(SHAPES[item.source], size);
    },
  });
  const files = {};
  for (const artifact of result.artifacts) files[artifact.filename] = await readFile(join(directory, artifact.temporary));
  await rm(directory, { recursive: true, force: true });
  return { settings, result, files, progressCalls, openedViews };
}

function iconBox(png) {
  const image = decodePng(png);
  return alphaBounds(image.data, image.width, image.height);
}

test('a thin flat item fills its icon and no item is clipped, measured on the alpha box', async () => {
  const { files, settings } = await runJob(['coin', 'sword', 'chest']);
  for (const [index, name] of ['coin', 'sword', 'chest'].entries()) {
    const box = iconBox(files[`icon-${index}.png`]);
    const extent = Math.max(box.right - box.left, box.bottom - box.top);
    assert.ok(box.left >= 1 && box.top >= 1 && box.right <= settings.size - 1 && box.bottom <= settings.size - 1, `${name} is clipped: ${JSON.stringify(box)}`);
    assert.ok(extent >= settings.size * (1 - 2 * settings.padding) - 2, `${name} is drawn small: ${extent} px of ${settings.size}`);
    assert.ok(Math.abs((box.left + box.right) / 2 - settings.size / 2) <= 1, `${name} is off centre horizontally`);
    assert.ok(Math.abs((box.top + box.bottom) / 2 - settings.size / 2) <= 1, `${name} is off centre vertically`);
  }
});

test('every item uses the same padding at any size', async () => {
  for (const size of [64, 256]) {
    const { files, settings } = await runJob(['coin', 'sword'], { size, padding: 0.12 });
    for (const index of [0, 1]) {
      const box = iconBox(files[`icon-${index}.png`]);
      const extent = Math.max(box.right - box.left, box.bottom - box.top);
      assert.ok(Math.abs(extent - size * (1 - 2 * settings.padding)) <= 2, `size ${size} icon ${index} spans ${extent}`);
    }
  }
});

test('relative scale keeps the size order of the set: coin, then sword, then chest', async () => {
  const { files, result } = await runJob(['coin', 'sword', 'chest'], { scale: 'relative' });
  const extents = [0, 1, 2].map(index => {
    const box = iconBox(files[`icon-${index}.png`]);
    return Math.max(box.right - box.left, box.bottom - box.top);
  });
  const manifest = JSON.parse(files['icons.json']);
  assert.equal(new Set(manifest.icons.map(icon => icon.viewHeight)).size, 1, 'one view height for the whole set');
  assert.ok(extents[0] < extents[1], `coin ${extents[0]} px is smaller than sword ${extents[1]} px`);
  assert.ok(extents[1] < extents[2], `sword ${extents[1]} px is smaller than chest ${extents[2]} px`);
  assert.ok(extents[2] >= 128 * 0.84 - 2, 'the largest item still fills its icon');
  assert.equal(result.artifacts.length, 5);
});

test('relative scale names an item that is under one pixel next to the largest, and fit still draws it', async () => {
  SHAPES.speck = [0.001, 0.001, 0.001];
  try {
    await assert.rejects(runJob(['speck', 'chest'], { scale: 'relative' }), /items\[0\] \(speck\) is too small for scale "relative".*Use scale "fit"/);
    const fitted = await runJob(['speck', 'chest']);
    assert.ok(iconBox(fitted.files['icon-0.png']));
  } finally {
    delete SHAPES.speck;
  }
});

test('fit scale gives each item its own view height', async () => {
  const { files } = await runJob(['coin', 'sword', 'chest']);
  const manifest = JSON.parse(files['icons.json']);
  assert.equal(new Set(manifest.icons.map(icon => icon.viewHeight)).size, 3);
});

test('the atlas holds every icon at its rectangle, and icons.json describes the layout', async () => {
  const { files, settings, progressCalls } = await runJob(['coin', 'sword', 'chest']);
  const manifest = JSON.parse(files['icons.json']);
  const atlas = decodePng(files['atlas.png']);
  assert.deepEqual(manifest.atlas, { file: 'atlas.png', width: 256, height: 256, columns: 2, rows: 2 });
  assert.equal(atlas.width, 256);
  assert.equal(atlas.height, 256);
  assert.deepEqual(manifest.icons.map(icon => icon.name), ['coin', 'sword', 'chest']);
  assert.deepEqual(manifest.icons.map(icon => icon.rect), [{ x: 0, y: 0, width: 128, height: 128 }, { x: 128, y: 0, width: 128, height: 128 }, { x: 0, y: 128, width: 128, height: 128 }]);
  for (const [index, icon] of manifest.icons.entries()) {
    const picture = decodePng(files[icon.file]);
    for (let row = 0; row < settings.size; row++) {
      const fromAtlas = atlas.data.subarray(((icon.rect.y + row) * atlas.width + icon.rect.x) * 4, ((icon.rect.y + row) * atlas.width + icon.rect.x + settings.size) * 4);
      assert.ok(fromAtlas.equals(picture.data.subarray(row * settings.size * 4, (row + 1) * settings.size * 4)), `icon ${index} row ${row} differs in the atlas`);
    }
    assert.deepEqual(icon.bounds, (({ left, top, right, bottom }) => ({ x: left, y: top, width: right - left, height: bottom - top }))(iconBox(files[icon.file])));
  }
  assert.deepEqual(progressCalls, [1, 2, 3]);
  const cell = atlas.data.subarray((200 * atlas.width + 200) * 4, (200 * atlas.width + 200) * 4 + 4);
  assert.deepEqual([...cell], [0, 0, 0, 0], 'the unused fourth cell is transparent');
});

test('the same input writes byte-identical files', async () => {
  const first = await runJob(['coin', 'sword', 'chest'], { scale: 'relative' });
  const second = await runJob(['coin', 'sword', 'chest'], { scale: 'relative' });
  assert.deepEqual(Object.keys(first.files), Object.keys(second.files));
  for (const name of Object.keys(first.files)) assert.ok(first.files[name].equals(second.files[name]), `${name} differs between runs`);
});

test('an item that draws nothing fails naming the item', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'crucible-icons-test-'));
  const settings = normalizeIconSettings({ kind: 'icons', items: ['empty'], size: 64 });
  const openItem = async () => ({ bounds: { min: [0, 0, 0], max: [1, 1, 1] }, draw: async () => encodePng({ width: 64, height: 64, data: Buffer.alloc(64 * 64 * 4) }), close: async () => {} });
  await assert.rejects(renderIconJob({ settings, directory, signal: new AbortController().signal, progress: async () => {}, openItem }), /items\[0\] \(empty\) drew no pixels/);
  await rm(directory, { recursive: true, force: true });
});

test('the job store knows the icons settings and artifact names', () => {
  const settings = normalizeJobSettings({ kind: 'icons', items: ['a.glb', 'b.glb'], size: 64 }, [], {});
  assert.equal(settings.frameCount, 2);
  assert.equal(settings.width, 64);
  assert.deepEqual(artifactNames('icons', [], 'png', false, settings.frameCount), ['icon-0.png', 'icon-1.png', 'atlas.png', 'icons.json']);
  const { frameCount, ...stored } = settings;
  assert.deepEqual(normalizeJobSettings(stored, [], {}), settings, 'stored settings normalise to themselves');
});

test('a turnaround draws every item from each angle at one view height per item, one row per item in the atlas', async () => {
  const { files, settings, result, openedViews } = await runJob(['coin', 'chest'], { angles: 4, size: 64 });
  const manifest = JSON.parse(files['icons.json']);
  assert.equal(settings.frameCount, 8);
  assert.deepEqual(manifest.atlas, { file: 'atlas.png', width: 256, height: 128, columns: 4, rows: 2 });
  assert.deepEqual(manifest.icons.map(icon => [icon.item, icon.turn, icon.angle]), [[0, 0, 35], [0, 1, 125], [0, 2, -145], [0, 3, -55], [1, 0, 35], [1, 1, 125], [1, 2, -145], [1, 3, -55]]);
  const coinHeights = new Set(manifest.icons.slice(0, 4).map(icon => icon.viewHeight));
  const chestHeights = new Set(manifest.icons.slice(4).map(icon => icon.viewHeight));
  assert.equal(coinHeights.size, 1, 'the four views of the coin share one scale');
  assert.equal(chestHeights.size, 1, 'the four views of the chest share one scale');
  assert.notEqual([...coinHeights][0], [...chestHeights][0], 'each item keeps its own scale under fit');
  for (const icon of manifest.icons) {
    const box = iconBox(files[icon.file]);
    assert.ok(box.left >= 1 && box.top >= 1 && box.right <= 63 && box.bottom <= 63, `${icon.file} is clipped`);
    assert.ok(Math.abs((box.left + box.right) / 2 - 32) <= 1 && Math.abs((box.top + box.bottom) / 2 - 32) <= 1, `${icon.file} is off centre`);
  }
  assert.equal(result.artifacts.length, 10, 'eight icons, the atlas and icons.json');
  assert.deepEqual(openedViews.slice(0, 4), [[0, 35], [0, 125], [0, -145], [0, -55]], 'the first pass measures every angle of the first item');
});

test('a turnaround under relative scale keeps one scale for the whole set', async () => {
  const { files } = await runJob(['coin', 'chest'], { angles: 4, size: 64, scale: 'relative' });
  const manifest = JSON.parse(files['icons.json']);
  assert.equal(new Set(manifest.icons.map(icon => icon.viewHeight)).size, 1);
});

test('a breakdown strip shows shaded, outline, hatching and the final icon side by side, and is listed in icons.json', async () => {
  const { files, result, settings } = await runJob(['coin', 'chest'], { style: 'sketch', breakdown: true, size: 64, angles: 4 });
  const manifest = JSON.parse(files['icons.json']);
  assert.deepEqual(result.artifacts.map(artifact => artifact.filename).filter(name => name.startsWith('breakdown')), ['breakdown-0.png', 'breakdown-1.png']);
  assert.deepEqual(manifest.icons.filter(icon => icon.breakdown).map(icon => [icon.item, icon.turn, icon.breakdown]), [[0, 0, 'breakdown-0.png'], [1, 0, 'breakdown-1.png']]);
  assert.equal(result.artifacts.length, 8 + 2 + 2);
  for (const itemIndex of [0, 1]) {
    const strip = decodePng(files[`breakdown-${itemIndex}.png`]);
    assert.deepEqual([strip.width, strip.height], [settings.size * 4, settings.size]);
    const finalIcon = decodePng(files[`icon-${itemIndex * 4}.png`]);
    const colorOf = position => [...strip.data.subarray((32 * strip.width + position * settings.size + 32) * 4, (32 * strip.width + position * settings.size + 32) * 4 + 4)];
    assert.deepEqual([0, 1, 2].map(colorOf), [STEP_COLORS.shaded, STEP_COLORS.outline, STEP_COLORS.hatching], 'the first three panels are the steps in order');
    for (let row = 0; row < settings.size; row++) {
      const panel = strip.data.subarray((row * strip.width + 3 * settings.size) * 4, (row * strip.width + 4 * settings.size) * 4);
      assert.ok(panel.equals(finalIcon.data.subarray(row * settings.size * 4, (row + 1) * settings.size * 4)), `the last panel is the final icon (row ${row})`);
    }
  }
});

test('the same sketch job with a breakdown writes byte-identical files', async () => {
  const options = { style: 'sketch', breakdown: true, size: 64, angles: 4, seed: 3 };
  const first = await runJob(['coin', 'sword'], options);
  const second = await runJob(['coin', 'sword'], options);
  assert.deepEqual(Object.keys(first.files), Object.keys(second.files));
  for (const name of Object.keys(first.files)) assert.ok(first.files[name].equals(second.files[name]), `${name} differs between runs`);
});

test('the job store lists the breakdown strips among the artifacts it expects, and a longer deadline for icons', () => {
  const settings = normalizeJobSettings({ kind: 'icons', items: ['a.glb', 'b.glb'], size: 64, style: 'sketch', breakdown: true, angles: 4 }, [], {});
  assert.deepEqual(artifactNames('icons', [], 'png', false, settings.frameCount, settings).slice(8, 10), ['breakdown-0.png', 'breakdown-1.png']);
  assert.equal(artifactNames('icons', [], 'png', false, settings.frameCount, settings).length, 8 + 2 + 2);
  const { frameCount, ...stored } = settings;
  assert.deepEqual(normalizeJobSettings(stored, [], {}), settings);
  assert.ok(jobDeadlineMs(settings) > 60000 + 8 * 4000 * 2, 'two passes of eight frames and two strips fit the deadline');
  const plain = normalizeJobSettings({ kind: 'icons', items: ['a.glb'], size: 64 }, [], {});
  assert.equal(jobDeadlineMs(plain), 60000 + 4000);
  assert.equal(jobDeadlineMs(normalizeJobSettings({ kind: 'icons', items: Array.from({ length: 256 }, (_, index) => `i${index}.glb`), size: 64, scale: 'relative' }, [], {})), 30 * 60 * 1000);
});
