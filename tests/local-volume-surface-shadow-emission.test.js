// A volume that shadows the key light dims what a surface receives and leaves its emission alone (#1360). Two slabs lie on a floor under a smoke box: one glows, one is lit only.
// It skips when Chrome cannot start. Set SURFACE_SHADOW_ARTIFACTS to a folder to write the numbers and the stills there.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { freePort } from './helpers/free-port.js';
import { launchChrome, skipOrThrow } from './helpers/dev-server-browser.js';
import { encodePng } from '../src/export-png.js';

const SIZE = 256;
const SMOKE = { castShadow: true, shape: 'box', center: [0, 2, 0], size: [4, 2, 4], density: 0.6, falloff: 0.3, absorption: [0.7, 0.8, 1], noiseAmount: 0.6, noiseScale: 2, steps: 16 };
const SUN_TOWARD = [0.6, 1, 0].map(component => component / Math.hypot(0.6, 1, 0));
const SUN = { keyColor: [3, 3, 3], lightDirection: SUN_TOWARD, keyIntensity: 1, fillIntensity: 0, ambientIntensity: 0, environmentIntensity: 0, skyTop: [0.02, 0.02, 0.02], skyBottom: [0.02, 0.02, 0.02] };
const CAMERA = { eye: [0, 12, 0], target: [0, 0, 0], up: [0, 0, -1], fov: 50 };
const GLOWING_CENTER_X = -1.2;
const LIT_CENTER_X = 0.4;
const SLAB_WIDTH = 0.8;
const EMISSION = 1.5;

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

// Renders each volume list in order on one renderer, so a frame that follows another shows what the first left behind.
async function rasterFrames(page, volumeLists, preload = true) {
  const task = async ({ size, lists, camera, light, emission, glowingX, litX, width, preload }) => {
    const { box } = await import('/src/geometry.js');
    const { CrucibleRenderer } = await import('/src/renderer.js');
    const { createFloatOutput, readFloatPixels } = await import('/src/float-output.js');
    const fogShader = await import('/src/fog-shader.js');
    // The mask code is a lazy chunk: a host that renders a shadowing volume loads it first (loadEmissionMask), or the first frames dim the glow as before.
    if (preload) await fogShader.loadEmissionMask();
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    canvas.style.width = size + 'px';
    canvas.style.height = size + 'px';
    document.body.append(canvas);
    const slab = (name, centerX, material) => ({ name, geometry: box(0, 1), matrix: new Float32Array([width, 0, 0, 0, 0, 0.2, 0, 0, 0, 0, 2, 0, centerX, 0.0, 0, 1]), material });
    const lit = { color: [0.8, 0.8, 0.8], metallic: 0, roughness: 1, emission: 0 };
    const ground = { name: 'ground', geometry: box(0, 1), matrix: new Float32Array([40, 0, 0, 0, 0, 0.2, 0, 0, 0, 0, 40, 0, 0, -0.1, 0, 1]), material: lit };
    const parts = [ground, slab('glowing', glowingX, { ...lit, emission }), slab('lit', litX, lit)];
    const renderer = new CrucibleRenderer(canvas, parts, { hdr: true, depth: true, samples: 1, pixelRatio: 1, ground: false });
    const output = createFloatOutput(renderer.context, size, size);
    const frames = [];
    for (const localVolumes of lists) {
      renderer.render({ ...camera, time: 0, environment: { ...light, localVolumes }, outputFramebuffer: output.framebuffer });
      frames.push(Array.from(readFloatPixels(renderer.context, output.framebuffer, size, size)));
      if (!preload) await new Promise(resolve => setTimeout(resolve, 400));
    }
    const glError = renderer.context.getError();
    output.dispose();
    renderer.dispose?.();
    return { frames, glError };
  };
  return page.evaluate(task, { size: SIZE, lists: volumeLists, camera: CAMERA, light: SUN, emission: EMISSION, glowingX: GLOWING_CENTER_X, litX: LIT_CENTER_X, width: SLAB_WIDTH, preload });
}

// Mean green over the middle of a slab (rows run bottom up in the float frames, four floats a pixel).
function slabMean(frame, centerX) {
  const column = Math.round(((centerX / (12 * Math.tan(Math.PI * 25 / 180))) + 1) / 2 * SIZE);
  let total = 0;
  let count = 0;
  for (let row = SIZE / 2 - 12; row < SIZE / 2 + 12; row++) {
    for (let offset = -4; offset <= 4; offset++) {
      total += frame[(row * SIZE + column + offset) * 4 + 1];
      count++;
    }
  }
  return total / count;
}

function writeStill(path, panels) {
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

test('a shadowing volume dims the light a lit slab receives and leaves a glowing slab its emission, frame after frame', async context => {
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
    await page.goto(`http://127.0.0.1:${port}/`);
    const open = { ...SMOKE, castShadow: false };
    const { frames, glError } = await rasterFrames(page, [[SMOKE], [open], [SMOKE], [SMOKE], [open], [SMOKE]]);
    assert.equal(glError, 0);
    const shadowed = frames[0];
    const unshadowed = frames[1];
    const numbers = {
      glowingShadowed: slabMean(shadowed, GLOWING_CENTER_X),
      glowingOpen: slabMean(unshadowed, GLOWING_CENTER_X),
      litShadowed: slabMean(shadowed, LIT_CENTER_X),
      litOpen: slabMean(unshadowed, LIT_CENTER_X),
    };
    context.diagnostic(JSON.stringify(numbers));
    context.diagnostic(JSON.stringify(frames.map(frame => [slabMean(frame, GLOWING_CENTER_X), slabMean(frame, LIT_CENTER_X), slabMean(frame, 4.5)].map(value => +value.toFixed(4)))));
    if (process.env.SURFACE_SHADOW_ARTIFACTS) {
      mkdirSync(process.env.SURFACE_SHADOW_ARTIFACTS, { recursive: true });
      writeStill(join(process.env.SURFACE_SHADOW_ARTIFACTS, 'surface-shadow-emission.png'), [unshadowed, shadowed]);
      writeFileSync(join(process.env.SURFACE_SHADOW_ARTIFACTS, 'surface-shadow-emission.json'), JSON.stringify(numbers, null, 2));
    }
    // The frames are display values (the view transform is on), so the shares are compared, not subtracted.
    const litKept = numbers.litShadowed / numbers.litOpen;
    const glowingKept = numbers.glowingShadowed / numbers.glowingOpen;
    assert.ok(litKept < 0.7, `the lit slab is shadowed: it keeps ${litKept} of its light`);
    assert.ok(glowingKept > 0.85, `the glowing slab keeps its emission under the shadow: it keeps ${glowingKept}`);
    assert.ok(numbers.glowingShadowed > numbers.litShadowed + 0.2, `the glowing slab stays brighter than the shadowed lit slab: ${numbers.glowingShadowed} against ${numbers.litShadowed}`);
    for (const later of [2, 3, 5]) assert.deepEqual(frames[later], shadowed, `frame ${later} draws the same shadowed picture as frame 0, so the volumes survive the emission pass`);
    assert.deepEqual(frames[4], unshadowed, 'a frame without castShadow after a shadowed one draws as before');
    // Without the preload the chunk loads during the first frame: that frame dims the glow as before, the next one has the mask and matches the preloaded picture.
    const freshPage = await browser.newPage({ viewport: { width: SIZE, height: SIZE } });
    await freshPage.goto(`http://127.0.0.1:${port}/`);
    const lazy = await rasterFrames(freshPage, [[SMOKE], [SMOKE]], false);
    assert.equal(lazy.glError, 0);
    assert.ok(slabMean(lazy.frames[0], GLOWING_CENTER_X) / numbers.glowingOpen < 0.85, 'the first frame, before the chunk has loaded, dims the glow as it did before the mask');
    assert.deepEqual(lazy.frames[1], shadowed, 'once the chunk has loaded the frame matches the preloaded one');
  } finally {
    await browser?.close();
    server.kill();
  }
});
