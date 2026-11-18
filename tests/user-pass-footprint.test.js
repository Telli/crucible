// User passes can ask how big one pixel is on the surface (issue #2293): pixelFootprintAt, worldFootprintAt and bandLimitedLine.
// Each case draws a flat slab through a user pass that writes the helper's value into the colour, in headless Chrome
// (SwiftShader, no GPU) from the Vite dev server; it skips locally when Chrome cannot start and fails on CI.
import test from 'node:test';
import assert from 'node:assert/strict';
import { withDevServerPage } from './helpers/dev-server-browser.js';

const IMAGE_SIZE = 160;
const CAMERA = { eye: [0, 5, 8], target: [0, 2, -4], fov: 40, up: [0, 1, 0] };
// A pixel step is the distance between two depth samples read at 24 bits, so allow a little over the step and the one beside it.
const RELATIVE_TOLERANCE = 0.04;
const LINE_PITCH = 0.12;
const LINE_WIDTH_PIXELS = 1.5;

// Draws the scene with one pass whose `expression` is a float in [0, 1); returns the decoded value per pixel
// (0 for sky) and how many pixels reported a non-finite helper result.
async function drawExpression(page, expression, withBox) {
  const task = async ({ imageSize, camera, expression, withBox }) => {
    const { box } = await import('/src/geometry.js');
    const { CrucibleRenderer } = await import('/src/renderer.js');
    const { installUserPasses } = await import('/src/user-pass.js');
    const canvas = document.createElement('canvas');
    canvas.width = imageSize;
    canvas.height = imageSize;
    canvas.style.cssText = `width:${imageSize}px;height:${imageSize}px;display:block`;
    document.body.append(canvas);
    const copy = document.createElement('canvas');
    copy.width = imageSize;
    copy.height = imageSize;
    const copyContext = copy.getContext('2d', { willReadFrequently: true });
    const scaled = (sx, sy, sz, x, y, z) => new Float32Array([sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, sz, 0, x, y, z, 1]);
    const material = { id: 'slab-mat', tag: 'surface', color: [0.6, 0.7, 0.8], metallic: 0, roughness: 0.9 };
    const parts = [{ name: 'slab', geometry: box(0, 1), matrix: scaled(40, 0.2, 40, 0, -0.1, 0), material }];
    if (withBox) parts.push({ name: 'block', geometry: box(0, 1), matrix: scaled(2, 2, 2, 0, 1, 2), material: { ...material, id: 'block-mat' } });
    const renderer = new CrucibleRenderer(canvas, parts, { ground: false, world: true, samples: 1, pixelRatio: 1, depth: true });
    renderer.resize();
    installUserPasses(renderer);
    const fragment = `
      vec4 encode(float value) {
        float scaled = clamp(value, 0.0, 0.99999);
        float high = floor(scaled * 255.0);
        float low = floor(fract(scaled * 255.0) * 255.0);
        float broken = (isnan(value) || isinf(value)) ? 1.0 : 0.0;
        return vec4(high / 255.0, low / 255.0, broken, 1.0);
      }
      vec4 userPass(vec2 uv) { return encode(${expression}); }`;
    renderer.userPasses.set([{ name: 'probe', fragment }]);
    const frame = { ...camera, time: 0, wind: 0, exposure: 1 };
    renderer.render(frame);
    renderer.render(frame);
    copyContext.drawImage(canvas, 0, 0, imageSize, imageSize);
    const bytes = copyContext.getImageData(0, 0, imageSize, imageSize).data;
    const values = [];
    let brokenPixels = 0;
    for (let index = 0; index < imageSize * imageSize; index++) {
      const high = bytes[index * 4];
      const low = bytes[index * 4 + 1];
      if (bytes[index * 4 + 2] > 0) brokenPixels++;
      values.push(high / 255 + low / 255 / 255);
    }
    renderer.dispose();
    return { values, brokenPixels };
  };
  return page.evaluate(task, { imageSize: IMAGE_SIZE, camera: CAMERA, expression, withBox });
}

// World point where the ray through pixel (column, row from the top) meets the plane y = 0, from the camera numbers alone.
function groundPoint(column, row) {
  const [eye, target] = [CAMERA.eye, CAMERA.target];
  const subtract = (a, b) => a.map((value, axis) => value - b[axis]);
  const normalize = (vector) => vector.map(value => value / Math.hypot(...vector));
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const forward = normalize(subtract(target, eye));
  const right = normalize(cross(forward, CAMERA.up));
  const up = cross(right, forward);
  const reach = Math.tan(CAMERA.fov * Math.PI / 360);
  const horizontal = (2 * (column + 0.5) / IMAGE_SIZE - 1) * reach;
  const vertical = (1 - 2 * (row + 0.5) / IMAGE_SIZE) * reach;
  const direction = forward.map((value, axis) => value + right[axis] * horizontal + up[axis] * vertical);
  if (direction[1] >= 0) return null;
  const distance = -eye[1] / direction[1];
  return direction.map((value, axis) => eye[axis] + value * distance);
}

const distanceBetween = (a, b) => Math.hypot(...a.map((value, axis) => value - b[axis]));

// Slab pixels that have a ground neighbour on every side, away from the slab's far edge.
function interiorGroundPixels() {
  const pixels = [];
  for (let row = 40; row < IMAGE_SIZE - 2; row += 7) {
    for (let column = 20; column < IMAGE_SIZE - 20; column += 11) {
      const point = groundPoint(column, row);
      if (point && Math.abs(point[0]) < 19 && point[2] > -18 && point[2] < 7) pixels.push({ column, row });
    }
  }
  return pixels;
}

test('pixelFootprintAt is the world distance to the next pixel on a flat slab', async (context) => {
  await withDevServerPage(context, async (page) => {
    const [stepX, stepY] = await Promise.all([drawExpression(page, 'pixelFootprintAt(uv).x', false), drawExpression(page, 'pixelFootprintAt(uv).y', false)]);
    const pixels = interiorGroundPixels();
    assert.ok(pixels.length > 40, 'the camera sees the slab');
    for (const { column, row } of pixels) {
      const here = groundPoint(column, row);
      const sideways = [distanceBetween(here, groundPoint(column + 1, row)), distanceBetween(here, groundPoint(column - 1, row))];
      const lengthwise = [distanceBetween(here, groundPoint(column, row + 1)), distanceBetween(here, groundPoint(column, row - 1))];
      const measuredX = stepX.values[row * IMAGE_SIZE + column];
      const measuredY = stepY.values[row * IMAGE_SIZE + column];
      assert.ok(measuredX >= Math.min(...sideways) * (1 - RELATIVE_TOLERANCE) && measuredX <= Math.max(...sideways) * (1 + RELATIVE_TOLERANCE),
        `x footprint at (${column}, ${row}) is ${measuredX}, the neighbours are ${sideways}`);
      assert.ok(measuredY >= Math.min(...lengthwise) * (1 - RELATIVE_TOLERANCE) && measuredY <= Math.max(...lengthwise) * (1 + RELATIVE_TOLERANCE),
        `y footprint at (${column}, ${row}) is ${measuredY}, the neighbours are ${lengthwise}`);
    }
    assert.equal(stepX.brokenPixels + stepY.brokenPixels, 0);
  });
});

test('worldFootprintAt measures how far a height coordinate moves over one pixel', async (context) => {
  await withDevServerPage(context, async (page) => {
    const height = await drawExpression(page, 'worldFootprintAt(uv, vec3(0.0, 1.0, 0.0))', false);
    const alongZ = await drawExpression(page, 'worldFootprintAt(uv, vec3(0.0, 0.0, 1.0))', false);
    for (const { column, row } of interiorGroundPixels()) {
      // On the flat ground y never changes, so a height coordinate has a footprint of 0 and a depth coordinate does not.
      assert.ok(height.values[row * IMAGE_SIZE + column] < 1e-3, `height footprint at (${column}, ${row}) is ${height.values[row * IMAGE_SIZE + column]}`);
      const here = groundPoint(column, row);
      const lengthwise = Math.abs(groundPoint(column, row + 1)[2] - here[2]);
      const measured = alongZ.values[row * IMAGE_SIZE + column];
      assert.ok(Math.abs(measured - lengthwise) < 0.12 * lengthwise + 1e-3, `z footprint at (${column}, ${row}) is ${measured}, one row is ${lengthwise}`);
    }
  });
});

test('the footprint stays finite and small at a depth edge, a silhouette and in the sky', async (context) => {
  await withDevServerPage(context, async (page) => {
    const stepX = await drawExpression(page, 'pixelFootprintAt(uv).x', true);
    assert.equal(stepX.brokenPixels, 0, 'no pixel got a NaN or an infinity');
    // Pixels beside the block's edge and the slab's far edge must not take the gap to the surface behind as their footprint.
    // The widest pixel step on this slab, at the far edge, is about a tenth of a unit.
    assert.ok(Math.max(...stepX.values) < 0.3, `widest x footprint ${Math.max(...stepX.values)}`);
    // The same scene read by hand from one neighbour, as a pass without the helper would, is stretched across the edges.
    const byHand = await drawExpression(page, 'length(worldPointAt(uv + vec2(1.0 / resolution.x, 0.0)) - worldPointAt(uv))', true);
    assert.ok(Math.max(...byHand.values) > 0.9, `the scene has edges that stretch a hand-made footprint (widest ${Math.max(...byHand.values)})`);
    assert.equal(stepX.values[0], 0, 'the top-left pixel is sky and has no footprint');
    assert.ok(stepX.values.some(value => value > 0.01), 'the surfaces got a footprint');
  });
});

test('bandLimitedLine keeps the mean line coverage where lines are denser than a pixel, and draws crisp lines up close', async (context) => {
  await withDevServerPage(context, async (page) => {
    const footprint = 'worldFootprintAt(uv, vec3(0.0, 0.0, 1.0))';
    const expression = `bandLimitedLine(worldPointAt(uv).z, ${LINE_PITCH}, ${LINE_WIDTH_PIXELS} * ${footprint}, ${footprint})`;
    const coverage = await drawExpression(page, expression, false);
    const meanLineShare = (pixelFootprint) => Math.min(LINE_WIDTH_PIXELS * pixelFootprint / LINE_PITCH, 1);
    let denseRows = 0;
    for (let row = 40; row < IMAGE_SIZE - 2; row += 1) {
      const point = groundPoint(80, row);
      if (!point || point[2] < -18) continue;
      const pixelFootprint = distanceBetween(point, groundPoint(80, row + 1));
      if (pixelFootprint < LINE_PITCH) continue;
      // One pixel spans more than a whole pitch: the pass must write the mean coverage, not an aliased black or white.
      denseRows++;
      for (const column of [60, 70, 80, 90, 100]) {
        const value = coverage.values[row * IMAGE_SIZE + column];
        assert.ok(Math.abs(value - meanLineShare(pixelFootprint)) < 0.03, `row ${row} column ${column}: coverage ${value}, mean ${meanLineShare(pixelFootprint)}`);
      }
    }
    assert.ok(denseRows >= 3, `the camera shows ${denseRows} rows denser than a pixel`);
  });
});
