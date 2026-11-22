// Linear output (#1749): a frame drawn with linearOutput writes scene radiance after the volume pass, with no view transform and no clamp.
// The source test needs no browser. The browser test draws a glowing grid volume (headless Chrome on SwiftShader, from the Vite dev server)
// both ways and checks that the linear values pass 1 and, run through the ACES curve and the display encoding, equal the display frame.
// It skips when Chrome cannot start. Set LINEAR_OUTPUT_ARTIFACTS to a folder to write the display still there.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { freePort } from './helpers/free-port.js';
import { launchChrome, skipOrThrow, openBlankPage } from './helpers/dev-server-browser.js';
import { encodePng } from '../src/export-png.js';
import { applyViewTransform } from '../src/view-transform.js';
import { encodeVolumeGrid } from '../src/volume-grid.js';
import * as post from '../src/post.js';
import '../src/linear-output-shader.js';

const SIZE = 64;
const GRID_NAME = 'linear-output-fire';
const VOXELS = 16 * 16 * 16;
const GRID_BYTES = encodeVolumeGrid({
  resolution: [16, 16, 16],
  channels: { density: new Float32Array(VOXELS).fill(0.6), temperature: new Float32Array(VOXELS).fill(0.5), flame: new Float32Array(VOXELS).fill(1) },
  size: [2, 2, 2],
});
const GLOWING_GRID = { shape: 'grid', grid: GRID_NAME, center: [0, 1.2, 0], density: 1, absorption: [0, 0, 0], emission: [1, 0.45, 0.12], emissionStrength: 12, steps: 24 };

test('the linear step adds an early return only to the program that asks for it', () => {
  const display = post.createPostFragment(post.POST_STEPS);
  const linear = post.createPostFragment([...post.POST_STEPS, 'linearOutput']);
  assert.ok(!display.includes('linearAlpha'), 'the display program keeps its source');
  assert.ok(linear.includes('linearAlpha'));
  assert.ok(linear.indexOf('linearAlpha') < linear.indexOf('2.51 * color'), 'the linear exit comes before the view transform');
  assert.ok(linear.indexOf('volumeFog(color);') < linear.indexOf('linearAlpha'), 'the linear exit comes after the volume passes');
});

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

// Draws the glowing grid with one renderer: display, linear, display again, and an explicit linearOutput false. Rows run bottom to top.
async function renderBothWays(page) {
  const task = async ({ size, gridBytes, gridName, volume }) => {
    const { decodeVolumeGrid, registerVolumeGrid } = await import('/src/volume-grid.js');
    registerVolumeGrid(gridName, decodeVolumeGrid(new Uint8Array(gridBytes)));
    const { CrucibleRenderer } = await import('/src/renderer.js');
    const { createFloatOutput, readFloatPixels } = await import('/src/float-output.js');
    await import('/src/fog-shader.js');
    await import('/src/linear-output-shader.js');
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    canvas.style.width = size + 'px';
    canvas.style.height = size + 'px';
    document.body.append(canvas);
    const renderer = new CrucibleRenderer(canvas, [], { hdr: true, depth: true, samples: 1, pixelRatio: 1, ground: false });
    const output = createFloatOutput(renderer.context, size, size);
    const dark = [0.02, 0.02, 0.03];
    const frameOptions = { eye: [0, 1.3, 5], target: [0, 1.2, 0], fov: 40, time: 0, environment: { keyIntensity: 0, fillIntensity: 0, skyTop: dark, skyBottom: dark, localVolumes: [volume] }, outputFramebuffer: output.framebuffer };
    const draw = extra => {
      renderer.render({ ...frameOptions, ...extra });
      return Array.from(readFloatPixels(renderer.context, output.framebuffer, size, size));
    };
    const display = draw({});
    const linear = draw({ linearOutput: true });
    const displayAgain = draw({});
    const explicitOff = draw({ linearOutput: false });
    let withoutTarget = '';
    try {
      renderer.render({ ...frameOptions, outputFramebuffer: undefined, linearOutput: true });
    } catch (error) {
      withoutTarget = error.message;
    }
    const glError = renderer.context.getError();
    output.dispose();
    renderer.dispose?.();
    return { display, linear, displayAgain, explicitOff, withoutTarget, glError };
  };
  return page.evaluate(task, { size: SIZE, gridBytes: Array.from(GRID_BYTES), gridName: GRID_NAME, volume: GLOWING_GRID });
}

function writeStill(path, frame) {
  const pixels = new Uint8Array(SIZE * SIZE * 4);
  for (let row = 0; row < SIZE; row++) {
    for (let column = 0; column < SIZE; column++) {
      const from = ((SIZE - 1 - row) * SIZE + column) * 4;
      const to = (row * SIZE + column) * 4;
      for (let channel = 0; channel < 3; channel++) pixels[to + channel] = Math.round(Math.max(0, Math.min(1, frame[from + channel])) * 255);
      pixels[to + 3] = 255;
    }
  }
  writeFileSync(path, encodePng(pixels, SIZE, SIZE));
}

test('linear output of a glowing grid volume passes 1 and matches the display frame after the view transform; the display frame does not change', async context => {
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
    const { display, linear, displayAgain, explicitOff, withoutTarget, glError } = await renderBothWays(page);
    if (process.env.LINEAR_OUTPUT_ARTIFACTS) {
      mkdirSync(process.env.LINEAR_OUTPUT_ARTIFACTS, { recursive: true });
      writeStill(join(process.env.LINEAR_OUTPUT_ARTIFACTS, 'display.png'), display);
      writeFileSync(join(process.env.LINEAR_OUTPUT_ARTIFACTS, 'display.f32'), Buffer.from(new Float32Array(display).buffer));
    }
    assert.equal(glError, 0);
    assert.deepEqual(displayAgain, display, 'a display frame drawn after a linear one is the same as before');
    assert.deepEqual(explicitOff, display, 'linearOutput: false is the display frame');
    assert.match(withoutTarget, /linearOutput .* outputFramebuffer/, 'linearOutput without a float target says what to pass');
    let peak = 0;
    let worstDifference = 0;
    for (let index = 0; index < linear.length; index += 4) {
      for (let channel = 0; channel < 3; channel++) {
        const radiance = linear[index + channel];
        peak = Math.max(peak, radiance);
        const expected = applyViewTransform('aces', [radiance, radiance, radiance])[0] ** (1 / 2.2);
        worstDifference = Math.max(worstDifference, Math.abs(expected - display[index + channel]));
      }
    }
    context.diagnostic(`linear peak ${peak}, worst difference from the display frame ${worstDifference}`);
    assert.ok(peak > 1, `the glow is brighter than 1 in linear light: ${peak}`);
    assert.ok(worstDifference < 0.004, `the view transform of the linear frame matches the display frame (largest difference ${worstDifference})`);
  } finally {
    await browser?.close();
    server.kill();
  }
});
