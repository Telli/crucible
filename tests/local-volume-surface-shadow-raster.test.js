// A local volume casts the key light's shadow on the floor under it in the rasterizer (#1047), and the CPU path tracer agrees on how much of the floor's light it takes.
// It skips when Chrome cannot start. Set SURFACE_SHADOW_ARTIFACTS to a folder to write the numbers there.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { freePort } from './helpers/free-port.js';
import { launchChrome, skipOrThrow, openBlankPage } from './helpers/dev-server-browser.js';
import { renderPathTracedImage } from '../src/path-tracer.js';
import { encodePng } from '../src/export-png.js';
import { encodeVolumeGrid, registerVolumeGrid } from '../src/volume-grid.js';

const SIZE = 256;
const DIFFERENCE_GAIN = 8;
const SMOKE = { castShadow: true, shape: 'box', center: [0, 2, 0], size: [4, 2, 4], density: 0.6, falloff: 0.3, absorption: [0.7, 0.8, 1], noiseAmount: 0.6, noiseScale: 2, steps: 16 };
const { castShadow: _castShadow, ...withoutFlag } = SMOKE;
const SUN_TOWARD = [0.6, 1, 0].map(component => component / Math.hypot(0.6, 1, 0));
const SUN = { keyColor: [3, 3, 3], lightDirection: SUN_TOWARD, keyIntensity: 1, fillIntensity: 0, ambientIntensity: 0, environmentIntensity: 0, skyTop: [0.02, 0.02, 0.02], skyBottom: [0.02, 0.02, 0.02] };
const CAMERA = { eye: [0, 12, 0], target: [0, 0, 0], up: [0, 0, -1], fov: 50 };
const UNDER_COLUMN = Math.round(SIZE * 25 / 64);
const OPEN_COLUMN = Math.round(SIZE * 58 / 64);

const GRID_NAME = 'surface-shadow-raster-block';
const GRID_BYTES = encodeVolumeGrid({ resolution: [8, 4, 8], channels: { density: new Float32Array(8 * 4 * 8).fill(1) }, size: [4, 2, 4] });
registerVolumeGrid(GRID_NAME, GRID_BYTES);
const GRID_SMOKE = { castShadow: true, shape: 'grid', grid: GRID_NAME, center: [0, 2, 0], density: 0.6, absorption: [0.7, 0.8, 1], steps: 16 };
const { castShadow: _gridCastShadow, ...gridWithoutFlag } = GRID_SMOKE;

async function startServer(port) {
  const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('The dev server did not start.')), 30000);
    server.stdout.on('data', data => {
      if (/ready in/.test(data.toString())) {
        clearTimeout(timeout);
        resolve();
      }
    });
    server.on('exit', code => {
      clearTimeout(timeout);
      reject(new Error(`The dev server exited ${code}.`));
    });
  });
  return server;
}

async function rasterFrames(page, volumeLists, grids = {}) {
  const task = async ({ size, lists, camera, light, gridBytes }) => {
    const { decodeVolumeGrid, registerVolumeGrid: registerInPage } = await import('/src/volume-grid.js');
    for (const [name, bytes] of Object.entries(gridBytes)) registerInPage(name, decodeVolumeGrid(new Uint8Array(bytes)));
    const { box } = await import('/src/geometry.js');
    const { CrucibleRenderer } = await import('/src/renderer.js');
    const { createFloatOutput, readFloatPixels } = await import('/src/float-output.js');
    await import('/src/fog-shader.js');
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    canvas.style.width = size + 'px';
    canvas.style.height = size + 'px';
    document.body.append(canvas);
    const material = { color: [0.8, 0.8, 0.8], metallic: 0, roughness: 1, emission: 0 };
    const ground = { name: 'ground', geometry: box(0, 1), matrix: new Float32Array([40, 0, 0, 0, 0, 0.2, 0, 0, 0, 0, 40, 0, 0, -0.1, 0, 1]), material };
    const renderer = new CrucibleRenderer(canvas, [ground], { hdr: true, depth: true, samples: 1, pixelRatio: 1, ground: false });
    const output = createFloatOutput(renderer.context, size, size);
    const frames = lists.map(localVolumes => {
      renderer.render({ ...camera, time: 0, environment: { ...light, localVolumes }, outputFramebuffer: output.framebuffer });
      return Array.from(readFloatPixels(renderer.context, output.framebuffer, size, size));
    });
    const glError = renderer.context.getError();
    output.dispose();
    renderer.dispose?.();
    return { frames, glError };
  };
  return page.evaluate(task, { size: SIZE, lists: volumeLists, camera: CAMERA, light: SUN, gridBytes: Object.fromEntries(Object.entries(grids).map(([name, bytes]) => [name, Array.from(bytes)])) });
}

// Mean green of one column over the middle band of rows, for a frame of `stride` floats per pixel.
function columnMean(frame, column, stride) {
  let total = 0;
  for (let row = SIZE / 2 - 16; row < SIZE / 2 + 16; row++) total += frame[(row * SIZE + column) * stride + 1];
  return total / 32;
}

// The frame without the shadow, with it, and their absolute difference times DIFFERENCE_GAIN, side by side (rows run bottom up in the float frames).
function writeStill(path, before, after) {
  const panels = [before, after, before.map((value, index) => (index % 4 === 3 ? 1 : Math.abs(after[index] - value) * DIFFERENCE_GAIN))];
  const pixels = new Uint8Array(SIZE * panels.length * SIZE * 4);
  panels.forEach((frame, index) => {
    for (let row = 0; row < SIZE; row++) {
      for (let column = 0; column < SIZE; column++) {
        const from = ((SIZE - 1 - row) * SIZE + column) * 4;
        const to = (row * SIZE * panels.length + index * SIZE + column) * 4;
        for (let channel = 0; channel < 3; channel++) pixels[to + channel] = Math.round(Math.max(0, Math.min(1, frame[from + channel])) * 255);
        pixels[to + 3] = 255;
      }
    }
  });
  writeFileSync(path, encodePng(pixels, SIZE * panels.length, SIZE));
}

async function cpuFrame(volume) {
  const floor = {
    name: 'ground',
    geometry: { positions: new Float32Array([-20, 0, 20, 20, 0, 20, 20, 0, -20, -20, 0, -20]), normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]), uvs: new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]), indices: new Uint32Array([0, 1, 2, 0, 2, 3]) },
    material: { tag: 'surface', metallic: 0, roughness: 1, color: [0.8, 0.8, 0.8], ior: 1.5 },
  };
  const { linear } = await renderPathTracedImage(
    { parts: [floor], environment: { lightDirection: SUN_TOWARD, keyColor: [3, 3, 3], localVolumes: [volume] }, camera: CAMERA },
    { width: SIZE, height: SIZE, denoise: false, threads: 1, bounces: 1, samples: 16, seed: 3 },
  );
  return linear;
}

test('the rasterizer darkens the floor under a smoke box as the CPU path tracer does, and castShadow false takes it away', async context => {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    skipOrThrow(context, 'playwright is not installed');
    return;
  }
  const port = await freePort();
  const server = await startServer(port);
  let browser;
  try {
    try {
      browser = await launchChrome(chromium);
    } catch (error) {
      skipOrThrow(context, `Chrome did not start: ${error.message.split('\n')[0]}`);
      return;
    }
    const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE } });
    await openBlankPage(page, port);
    const { frames, glError } = await rasterFrames(page, [[SMOKE], [{ ...SMOKE, castShadow: false }], [withoutFlag]]);
    assert.equal(glError, 0);
    const [shadowed, open, byDefault] = frames;
    assert.deepEqual(Array.from(byDefault), Array.from(open), 'a volume without castShadow draws the same frame as castShadow false');
    const rasterRatio = columnMean(shadowed, UNDER_COLUMN, 4) / columnMean(open, UNDER_COLUMN, 4);
    const rasterOpenRatio = columnMean(shadowed, OPEN_COLUMN, 4) / columnMean(open, OPEN_COLUMN, 4);
    const cpuShadowed = await cpuFrame(SMOKE);
    const cpuOpen = await cpuFrame({ ...SMOKE, castShadow: false });
    const cpuRatio = columnMean(cpuShadowed, UNDER_COLUMN, 3) / columnMean(cpuOpen, UNDER_COLUMN, 3);
    context.diagnostic(`floor under the smoke keeps ${rasterRatio.toFixed(3)} of its light in the rasterizer and ${cpuRatio.toFixed(3)} in the CPU tracer; the open floor keeps ${rasterOpenRatio.toFixed(3)}`);
    if (process.env.SURFACE_SHADOW_ARTIFACTS) {
      mkdirSync(process.env.SURFACE_SHADOW_ARTIFACTS, { recursive: true });
      writeStill(join(process.env.SURFACE_SHADOW_ARTIFACTS, 'surface-shadow-before-after.png'), open, shadowed);
      writeFileSync(join(process.env.SURFACE_SHADOW_ARTIFACTS, 'surface-shadow.json'), JSON.stringify({ rasterRatio, cpuRatio, rasterOpenRatio }, null, 2));
    }
    assert.ok(rasterOpenRatio > 0.99, `the floor the sun reaches past the smoke keeps its light: ${rasterOpenRatio}`);
    assert.ok(rasterRatio < 0.8, `the floor under the smoke is darker: ${rasterRatio}`);
    assert.ok(Math.abs(rasterRatio - cpuRatio) < 0.25, `rasterizer ${rasterRatio} against CPU tracer ${cpuRatio}`);
  } finally {
    await browser?.close();
    server.kill();
  }
});

test('the rasterizer darkens the floor under a smoke grid as the CPU path tracer does, and castShadow false takes it away', async context => {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    skipOrThrow(context, 'playwright is not installed');
    return;
  }
  const port = await freePort();
  const server = await startServer(port);
  let browser;
  try {
    try {
      browser = await launchChrome(chromium);
    } catch (error) {
      skipOrThrow(context, `Chrome did not start: ${error.message.split('\n')[0]}`);
      return;
    }
    const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE } });
    await openBlankPage(page, port);
    const { frames, glError } = await rasterFrames(page, [[GRID_SMOKE], [{ ...GRID_SMOKE, castShadow: false }], [gridWithoutFlag]], { [GRID_NAME]: GRID_BYTES });
    assert.equal(glError, 0);
    const [shadowed, open, byDefault] = frames;
    assert.deepEqual(Array.from(byDefault), Array.from(open), 'a volume without castShadow draws the same frame as castShadow false');
    const rasterRatio = columnMean(shadowed, UNDER_COLUMN, 4) / columnMean(open, UNDER_COLUMN, 4);
    const rasterOpenRatio = columnMean(shadowed, OPEN_COLUMN, 4) / columnMean(open, OPEN_COLUMN, 4);
    const cpuShadowed = await cpuFrame(GRID_SMOKE);
    const cpuOpen = await cpuFrame({ ...GRID_SMOKE, castShadow: false });
    const cpuRatio = columnMean(cpuShadowed, UNDER_COLUMN, 3) / columnMean(cpuOpen, UNDER_COLUMN, 3);
    context.diagnostic(`floor under the smoke keeps ${rasterRatio.toFixed(3)} of its light in the rasterizer and ${cpuRatio.toFixed(3)} in the CPU tracer; the open floor keeps ${rasterOpenRatio.toFixed(3)}`);
    if (process.env.SURFACE_SHADOW_ARTIFACTS) {
      mkdirSync(process.env.SURFACE_SHADOW_ARTIFACTS, { recursive: true });
      writeStill(join(process.env.SURFACE_SHADOW_ARTIFACTS, 'surface-shadow-grid-before-after.png'), open, shadowed);
      writeFileSync(join(process.env.SURFACE_SHADOW_ARTIFACTS, 'surface-shadow-grid.json'), JSON.stringify({ rasterRatio, cpuRatio, rasterOpenRatio }, null, 2));
    }
    assert.ok(rasterOpenRatio > 0.99, `the floor the sun reaches past the grid smoke keeps its light: ${rasterOpenRatio}`);
    assert.ok(rasterRatio < 0.6, `the floor under the smoke is darker: ${rasterRatio}`);
    assert.ok(Math.abs(rasterRatio - cpuRatio) < 0.25, `rasterizer ${rasterRatio} against CPU tracer ${cpuRatio}`);
  } finally {
    await browser?.close();
    server.kill();
  }
});
