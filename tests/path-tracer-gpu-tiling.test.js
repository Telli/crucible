import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_TILE_PIXELS, MAX_TILE_WIDTH, createBandState, drawOneSample } from '../src/path-tracer-gpu.js';

function createMockGl() {
  const tiles = [];
  let currentScissor = null;
  let scissorEnabled = false;
  let drawCount = 0;
  return {
    BLEND: 1,
    ONE: 2,
    SCISSOR_TEST: 3,
    TRIANGLES: 4,
    viewport() {},
    enable(flag) {
      if (flag === 3) scissorEnabled = true;
    },
    disable(flag) {
      if (flag === 3) scissorEnabled = false;
    },
    blendFunc() {},
    getUniformLocation() {
      return 0;
    },
    uniform1i() {},
    scissor(x, y, w, h) {
      currentScissor = { x, y, w, h };
    },
    drawArrays() {
      drawCount++;
      assert.equal(scissorEnabled, true, 'SCISSOR_TEST must be enabled during draw');
      tiles.push({ ...currentScissor });
    },
    finish() {},
    get tiles() {
      return tiles;
    },
    get drawCount() {
      return drawCount;
    },
    get scissorEnabled() {
      return scissorEnabled;
    },
  };
}

function assertExactPixelCoverage(tiles, width, height) {
  const counts = new Uint8Array(width * height);
  for (const { x, y, w, h } of tiles) {
    assert.ok(w >= 1 && w <= MAX_TILE_WIDTH, `tile width ${w} must stay within 1..${MAX_TILE_WIDTH}`);
    assert.ok(w * h <= MAX_TILE_PIXELS, `tile pixel area ${w}x${h}=${w * h} exceeds ${MAX_TILE_PIXELS}`);
    assert.ok(x >= 0 && y >= 0 && x + w <= width && y + h <= height, `tile ${x},${y} ${w}x${h} out of ${width}x${height} bounds`);
    for (let row = y; row < y + h; row++) {
      for (let col = x; col < x + w; col++) {
        counts[row * width + col]++;
      }
    }
  }
  for (let pixel = 0; pixel < counts.length; pixel++) {
    assert.equal(counts[pixel], 1, `pixel ${pixel} covered ${counts[pixel]} times`);
  }
}

for (const [width, height] of [[1080, 1920], [720, 1280], [100, 50]]) {
  test(`drawOneSample tiles ${width}x${height} with disjoint coverage and bounded pixel area`, async () => {
    const gl = createMockGl();
    const band = createBandState(height);
    for (let sample = 0; sample < 3; sample++) {
      const startTile = gl.tiles.length;
      await drawOneSample(gl, {}, width, height, sample, band, () => {});
      assertExactPixelCoverage(gl.tiles.slice(startTile), width, height);
    }
    assert.equal(gl.scissorEnabled, false);
  });
}

test('drawOneSample checks shouldStop between tiles inside a band', async () => {
  const gl = createMockGl();
  const band = createBandState(64);
  let checks = 0;
  await assert.rejects(
    drawOneSample(gl, {}, 1080, 64, 0, band, () => {
      checks++;
      if (checks === 2) throw new Error('cancelled mid-band');
    }),
    /cancelled mid-band/,
  );
  assert.equal(gl.drawCount, 2);
  assert.equal(gl.scissorEnabled, false);
});
