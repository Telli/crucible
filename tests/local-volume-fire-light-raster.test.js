// Fire lights the set (#1046), drawn: a glowing sphere volume over a grey floor in the rasterizer (headless Chrome, from the Vite dev server).
// With lightsScene the floor around the fire is brighter than without it, and with the flag off the frame equals a volume that never named the field.
// It skips when Chrome cannot start. Set FIRE_LIGHT_ARTIFACTS to a folder to write the before and after stills there.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { freePort } from './helpers/free-port.js';
import { launchChrome, skipOrThrow, openBlankPage } from './helpers/dev-server-browser.js';
import { encodePng } from '../src/export-png.js';

const SIZE = 96;
const FIREBALL = { shape: 'sphere', center: [0, 0.9, 0], radius: 0.45, density: 3, emission: [1, 0.5, 0.15], emissionStrength: 6, steps: 24 };
const CAMERA = { eye: [0, 4.5, 4.5], target: [0, 0.3, 0], up: [0, 1, 0], fov: 45 };
const DARK_SET = { keyIntensity: 0, fillIntensity: 0, ambientIntensity: 0.02, skyTop: [0.02, 0.02, 0.02], skyBottom: [0.02, 0.02, 0.02] };

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

async function rasterFrames(page, volumeLists) {
  const task = async ({ size, lists, camera, light }) => {
    const { box } = await import('/src/geometry.js');
    const { CrucibleRenderer } = await import('/src/renderer.js');
    const { createFloatOutput, readFloatPixels } = await import('/src/float-output.js');
    await import('/src/fog-shader.js');
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    document.body.append(canvas);
    const material = { color: [0.6, 0.6, 0.6], metallic: 0, roughness: 0.9, emission: 0 };
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
  return page.evaluate(task, { size: SIZE, lists: volumeLists, camera: CAMERA, light: DARK_SET });
}

// Mean of the green channel over the lower half of the frame, where the floor is, with the rows of the volume's own glow left in.
function lowerHalfMean(frame) {
  let total = 0;
  let count = 0;
  for (let row = 0; row < SIZE / 2; row++) {
    for (let column = 0; column < SIZE; column++) {
      total += frame[(row * SIZE + column) * 4 + 1];
      count++;
    }
  }
  return total / count;
}

function writeStill(path, frames) {
  const pixels = new Uint8Array(SIZE * frames.length * SIZE * 4);
  frames.forEach((frame, index) => {
    for (let row = 0; row < SIZE; row++) {
      for (let column = 0; column < SIZE; column++) {
        const from = ((SIZE - 1 - row) * SIZE + column) * 4;
        const to = (row * SIZE * frames.length + index * SIZE + column) * 4;
        for (let channel = 0; channel < 3; channel++) pixels[to + channel] = Math.round(Math.max(0, Math.min(1, frame[from + channel])) * 255);
        pixels[to + 3] = 255;
      }
    }
  });
  writeFileSync(path, encodePng(pixels, SIZE * frames.length, SIZE));
}

test('a fireball with lightsScene brightens the floor around it, and with the flag off the frame is unchanged', async context => {
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
    const { frames: [unnamed, flagOff, flagOn], glError } = await rasterFrames(page, [[FIREBALL], [{ ...FIREBALL, lightsScene: false }], [{ ...FIREBALL, lightsScene: true }]]);
    assert.equal(glError, 0);
    assert.deepEqual(flagOff, unnamed, 'lightsScene false must draw exactly as a volume that does not name the field');
    const darkFloor = lowerHalfMean(flagOff);
    const litFloor = lowerHalfMean(flagOn);
    assert.ok(litFloor > darkFloor * 1.5, `the floor reads ${litFloor} lit and ${darkFloor} dark; fire light should lift it clearly`);
    const folder = process.env.FIRE_LIGHT_ARTIFACTS;
    if (folder) {
      mkdirSync(folder, { recursive: true });
      writeStill(join(folder, 'fire-light-before-after.png'), [flagOff, flagOn]);
      writeFileSync(join(folder, 'fire-light-floor.json'), `${JSON.stringify({ volume: FIREBALL, note: 'Left: lightsScene false. Right: lightsScene true. 96 px rasterizer, dark set, grey floor, no key or fill light.', lowerHalfGreen: { off: darkFloor, on: litFloor } }, null, 2)}\n`);
    }
  } finally {
    await browser?.close();
    server.kill();
  }
});
