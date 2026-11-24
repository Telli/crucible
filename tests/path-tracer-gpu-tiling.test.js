import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_TILE_PIXELS, MAX_TILE_WIDTH, createBandState, drawOneSample, waitForDraw } from '../src/path-tracer-gpu.js';

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
    SYNC_GPU_COMMANDS_COMPLETE: 5,
    TIMEOUT_EXPIRED: 6,
    ALREADY_SIGNALED: 7,
    fenceSync() {
      return {};
    },
    flush() {},
    clientWaitSync() {
      return 7;
    },
    deleteSync() {},
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

// A driver whose gl.finish() returns at once (ANGLE on Vulkan in a sandbox, #2833) but whose fence reports the real draw time.
test('tile pacing follows the fence, not gl.finish, so the tile size does not climb to the cap', async () => {
  const secondsPerPixel = 4e-6;
  let clock = 0;
  let gpuDoneAt = 0;
  const tileAreas = [];
  const gl = createMockGl();
  gl.drawArrays = () => {
    const { w, h } = gl.lastScissor;
    tileAreas.push(w * h);
    gpuDoneAt = Math.max(gpuDoneAt, clock) + w * h * secondsPerPixel;
  };
  gl.scissor = (x, y, w, h) => {
    gl.lastScissor = { x, y, w, h };
  };
  gl.clientWaitSync = () => {
    clock += 0.01;
    return clock >= gpuDoneAt ? 7 : 6;
  };
  const band = createBandState(480, MAX_TILE_WIDTH, () => clock * 1000);
  for (let sample = 0; sample < 1; sample++) await drawOneSample(gl, {}, 1080, 480, sample, band, () => {});
  const largest = Math.max(...tileAreas);
  assert.ok(largest <= 2 * 0.08 / secondsPerPixel, `largest tile ${largest} pixels takes over twice the 0.08 s target`);
  assert.ok(largest < MAX_TILE_PIXELS, 'the tile size must not reach the cap when the GPU is slow');
});

test('waitForDraw reads one value back when the context has no fences', async () => {
  let reads = 0;
  await waitForDraw({ RGBA: 1, FLOAT: 2, readPixels() { reads++; } });
  assert.equal(reads, 1);
});

test('waitForDraw gives up after its bound instead of hanging on a fence that never signals', async () => {
  let clock = 0;
  let deleted = false;
  await waitForDraw({ TIMEOUT_EXPIRED: 6, fenceSync: () => ({}), flush() {}, clientWaitSync: () => 6, deleteSync() { deleted = true; } }, () => (clock += 500));
  assert.equal(deleted, true);
});
