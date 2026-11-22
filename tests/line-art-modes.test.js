// Line art modes (#2956): body-coloured ink, 1 px silhouettes on the nearer surface, a guard for flat ground and convex rim
// highlights. They need real pixels, so each case draws in headless Chrome from the Vite dev server (SwiftShader, no GPU) and
// compares the frame with lines against the same frame without. Where Chrome is missing the tests skip locally and fail on CI.
import test from 'node:test';
import assert from 'node:assert/strict';
import { withDevServerPage } from './helpers/dev-server-browser.js';

const IMAGE_SIZE = 160;
const CENTER_ROW = IMAGE_SIZE / 2;
// Display levels. The anti-aliasing after the lines bleeds a few levels onto the pixel next to a line pixel, which is not a line.
const CHANGED_LEVELS = 30;

// Draws the parts once without lines and once per entry of `lineSets`; returns the 8-bit RGBA frames by name.
async function drawFrames(page, scene, lineSets) {
  const task = async ({ imageSize, scene, lineSets }) => {
    const { box } = await import('/src/geometry.js');
    const { CrucibleRenderer } = await import('/src/renderer.js');
    const { installRenderPasses } = await import('/src/render-passes.js');
    const { installLineArt, resolveLineArt } = await import('/src/line-art.js');
    const canvas = document.createElement('canvas');
    canvas.width = imageSize;
    canvas.height = imageSize;
    document.body.append(canvas);
    const copy = document.createElement('canvas');
    copy.width = imageSize;
    copy.height = imageSize;
    const copyContext = copy.getContext('2d', { willReadFrequently: true });
    const parts = scene.parts.map(part => {
      const [scaleX, scaleY, scaleZ] = part.scale;
      const [x, y, z] = part.at;
      const matrix = new Float32Array([scaleX, 0, 0, 0, 0, scaleY, 0, 0, 0, 0, scaleZ, 0, x, y, z, 1]);
      return { name: part.name, geometry: box(0, 1), matrix, material: { id: `${part.name}-material`, tag: 'surface', color: part.color, metallic: 0, roughness: 0.9 } };
    });
    const renderer = installLineArt(installRenderPasses(new CrucibleRenderer(canvas, parts, { ground: false, world: true, samples: 1, pixelRatio: 1, depth: true })));
    renderer.resize();
    const frames = {};
    for (const [name, lines] of [['plain', null], ...Object.entries(lineSets)]) {
      const frame = { ...scene.camera, up: [0, 1, 0], time: 0, wind: 0, exposure: 1, effects: {}, lines: lines ? resolveLineArt(lines) : undefined };
      renderer.render(frame);
      renderer.render(frame);
      copyContext.drawImage(canvas, 0, 0, imageSize, imageSize);
      frames[name] = Array.from(copyContext.getImageData(0, 0, imageSize, imageSize).data);
    }
    renderer.dispose();
    return frames;
  };
  return page.evaluate(task, { imageSize: IMAGE_SIZE, scene, lineSets });
}

function pixelAt(frame, column, row) {
  const index = (row * IMAGE_SIZE + column) * 4;
  return [frame[index], frame[index + 1], frame[index + 2]];
}

function levelsApart(first, second) {
  return Math.max(...first.map((value, channel) => Math.abs(value - second[channel])));
}

// The pixels where `frame` differs from the frame without lines by more than a few display levels.
function changedPixels(frame, plain, region = { left: 0, right: IMAGE_SIZE - 1, top: 0, bottom: IMAGE_SIZE - 1 }) {
  const changed = [];
  for (let row = region.top; row <= region.bottom; row++) {
    for (let column = region.left; column <= region.right; column++) {
      if (levelsApart(pixelAt(frame, column, row), pixelAt(plain, column, row)) > CHANGED_LEVELS) changed.push({ column, row });
    }
  }
  return changed;
}

function brightness(pixel) {
  return pixel[0] + pixel[1] + pixel[2];
}

function brighterPixels(frame, plain) {
  let count = 0;
  for (let row = 0; row < IMAGE_SIZE; row++) {
    for (let column = 0; column < IMAGE_SIZE; column++) {
      if (brightness(pixelAt(frame, column, row)) - brightness(pixelAt(plain, column, row)) > 2 * CHANGED_LEVELS) count++;
    }
  }
  return count;
}

// A small cube close to a big wall, seen straight on: the cube covers columns 66 to 93 (half width 0.25 at distance 3.95,
// field of view 40 degrees), and the wall behind it is flat.
const PROP_ON_WALL = {
  camera: { eye: [0, 0, 5], target: [0, 0, 0], fov: 40 },
  parts: [
    { name: 'wall', at: [0, 0, 0], scale: [20, 20, 0.1], color: [0.2, 0.3, 0.7] },
    { name: 'prop', at: [0, 0, 0.8], scale: [0.5, 0.5, 0.5], color: [0.8, 0.3, 0.05] },
  ],
};
const PROP_FIRST_COLUMN = 66;
const PROP_LAST_COLUMN = 93;
const SILHOUETTE_ONLY = { width: 2, creaseAngle: 0, depthJump: 0 };

// Two slabs with the same top at y = 0 seen from above at a slant: a road and a pavement that meet along x = 0.
const ROAD_AND_PAVEMENT = {
  camera: { eye: [0, 4, 6], target: [0, 0, 0], fov: 40 },
  parts: [
    { name: 'road', at: [-2, -0.1, 0], scale: [4, 0.2, 6], color: [0.3, 0.3, 0.32] },
    { name: 'pavement', at: [2, -0.1, 0], scale: [4, 0.2, 6], color: [0.6, 0.58, 0.5] },
  ],
};

const CUBE_AT_AN_ANGLE = {
  camera: { eye: [2.5, 2, 3.5], target: [0, 0, 0], fov: 40 },
  parts: [{ name: 'crate', at: [0, 0, 0], scale: [1.2, 1.2, 1.2], color: [0.8, 0.5, 0.2] }],
};

test('silhouetteSide front draws 1 px on the nearer surface only, and both sides draw 1 px on each', async (testContext) => {
  await withDevServerPage(testContext, async (page) => {
    const frames = await drawFrames(page, PROP_ON_WALL, {
      both: SILHOUETTE_ONLY,
      front: { ...SILHOUETTE_ONLY, silhouetteSide: 'front' },
    });
    const middleBand = { left: 0, right: IMAGE_SIZE - 1, top: CENTER_ROW, bottom: CENTER_ROW };
    const both = changedPixels(frames.both, frames.plain, middleBand).map(pixel => pixel.column);
    const front = changedPixels(frames.front, frames.plain, middleBand).map(pixel => pixel.column);
    assert.deepEqual(both, [PROP_FIRST_COLUMN - 1, PROP_FIRST_COLUMN, PROP_LAST_COLUMN, PROP_LAST_COLUMN + 1]);
    assert.deepEqual(front, [PROP_FIRST_COLUMN, PROP_LAST_COLUMN]);
  });
});

test('silhouetteSide front keeps the line off the far side of a depth step, not only of an object ID edge', async (testContext) => {
  await withDevServerPage(testContext, async (page) => {
    const frames = await drawFrames(page, PROP_ON_WALL, { front: { width: 2, creaseAngle: 0, silhouetteSide: 'front' } });
    const wallSide = changedPixels(frames.front, frames.plain, { left: 0, right: PROP_FIRST_COLUMN - 1, top: 0, bottom: IMAGE_SIZE - 1 });
    assert.deepEqual(wallSide, [], 'the wall next to the prop stays untouched');
    assert.ok(changedPixels(frames.front, frames.plain).length > 0, 'the prop still has its outline');
  });
});

test('silhouetteSide front draws no seam between two coplanar parts, and both sides do', async (testContext) => {
  await withDevServerPage(testContext, async (page) => {
    const frames = await drawFrames(page, ROAD_AND_PAVEMENT, {
      both: SILHOUETTE_ONLY,
      front: { ...SILHOUETTE_ONLY, silhouetteSide: 'front' },
    });
    // The rows between the slabs' far and near ends, where only the seam could draw a line.
    const seamBand = { left: IMAGE_SIZE / 2 - 3, right: IMAGE_SIZE / 2 + 2, top: 60, bottom: 140 };
    assert.ok(changedPixels(frames.both, frames.plain, seamBand).length > 20, 'both sides draw the seam');
    assert.deepEqual(changedPixels(frames.front, frames.plain, seamBand), []);
    assert.ok(changedPixels(frames.front, frames.plain).length > 20, 'the slabs keep their outer silhouettes');
  });
});

test('colorMode darken inks the line with the darkened body colour, solid ink stays neutral', async (testContext) => {
  await withDevServerPage(testContext, async (page) => {
    const frames = await drawFrames(page, PROP_ON_WALL, {
      solid: { ...SILHOUETTE_ONLY, silhouetteSide: 'front' },
      darken: { ...SILHOUETTE_ONLY, silhouetteSide: 'front', colorMode: 'darken', darkenFactor: 0.5 },
    });
    const solidInk = pixelAt(frames.solid, PROP_FIRST_COLUMN, CENTER_ROW);
    const darkenInk = pixelAt(frames.darken, PROP_FIRST_COLUMN, CENTER_ROW);
    const body = pixelAt(frames.plain, PROP_FIRST_COLUMN, CENTER_ROW);
    assert.ok(Math.max(...solidInk) - Math.min(...solidInk) < 20, `solid ink is neutral, got ${solidInk}`);
    assert.ok(darkenInk[0] > 2 * darkenInk[2] + 10, `darkened ink keeps the orange hue, got ${darkenInk}`);
    assert.ok(darkenInk[0] < body[0] && darkenInk[0] > solidInk[0], `darkened ink sits between the body ${body} and black ink ${solidInk}, got ${darkenInk}`);
  });
});

test('convexHighlight brightens convex creases and a plain crease stays dark', async (testContext) => {
  await withDevServerPage(testContext, async (page) => {
    const frames = await drawFrames(page, CUBE_AT_AN_ANGLE, {
      plainLines: { width: 2, boundaries: false, depthJump: 0 },
      highlight: { width: 2, boundaries: false, depthJump: 0, convexHighlight: 1 },
    });
    assert.equal(brighterPixels(frames.plainLines, frames.plain), 0);
    assert.ok(brighterPixels(frames.highlight, frames.plain) > 20, 'the cube edges are convex and show a rim');
    assert.ok(changedPixels(frames.plainLines, frames.plain).length > 20, 'the dark creases are drawn without the option');
  });
});

test('writing the default modes out draws the same frame as leaving them out', async (testContext) => {
  await withDevServerPage(testContext, async (page) => {
    const frames = await drawFrames(page, CUBE_AT_AN_ANGLE, {
      omitted: { width: 2 },
      written: { width: 2, colorMode: 'solid', darkenFactor: 0.3, silhouetteSide: 'both', convexHighlight: 0 },
    });
    assert.deepEqual(frames.written, frames.omitted);
    assert.ok(changedPixels(frames.omitted, frames.plain).length > 20);
  });
});
