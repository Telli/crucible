// Overlapping box and sphere volumes in the rasterizer (issue 1722): volumes that share a stretch of the ray are marched together, so
// the glow and the dimming of both add per step. Checked against the closed form of two uniform slabs, in the overlap, apart and alone.
// Draws in headless Chrome (SwiftShader) from the Vite dev server; skips when Chrome cannot start.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { freePort } from './helpers/free-port.js';
import { launchChrome, skipOrThrow, openBlankPage } from './helpers/dev-server-browser.js';
import { applyViewTransform } from '../src/view-transform.js';

const SIZE = 16;

async function startServer(port) {
  const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('The dev server did not start.')), 30000);
    server.stdout.on('data', (data) => {
      if (/ready in/.test(data.toString())) {
        clearTimeout(timeout);
        resolve();
      }
    });
    server.on('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`The dev server exited ${code}.`));
    });
  });
  return server;
}

// A black backdrop: the frame is only the glow of the volumes, looked at along -z through the middle of the image.
async function drawInChrome(page, scenarios) {
  const task = async (input) => {
    const { box } = await import('/src/geometry.js');
    const { CrucibleRenderer } = await import('/src/renderer.js');
    const { createFloatOutput, readFloatPixels } = await import('/src/float-output.js');
    await import('/src/fog-shader.js');
    const canvas = document.createElement('canvas');
    canvas.width = input.size;
    canvas.height = input.size;
    canvas.style.width = input.size + 'px';
    canvas.style.height = input.size + 'px';
    document.body.append(canvas);
    const unlit = { tag: 'unlit', color: [0, 0, 0], metallic: 0, roughness: 1, emission: 0 };
    const results = [];
    for (const localVolumes of input.scenarios) {
      const renderer = new CrucibleRenderer(canvas, [{ name: 'idle', visible: false, geometry: box(0, 1), matrix: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]), material: unlit }], { hdr: true, depth: true, samples: 1, pixelRatio: 1, ground: false, background: [0, 0, 0] });
      const output = createFloatOutput(renderer.context, input.size, input.size);
      let message = null;
      let pixels = null;
      try {
        const environment = { keyIntensity: 0, fillIntensity: 0, ambientIntensity: 0, localVolumes };
        renderer.render({ eye: [0, 0, 5], target: [0, 0, 0], fov: 40, time: 0, environment, outputFramebuffer: output.framebuffer });
        pixels = Array.from(readFloatPixels(renderer.context, output.framebuffer, input.size, input.size));
      } catch (error) {
        message = error.message;
      }
      results.push({ message, pixels, glError: renderer.context.getError() });
      output.dispose();
      renderer.dispose?.();
    }
    return results;
  };
  return page.evaluate(task, { scenarios, size: SIZE });
}

// The display shows aces(light) ^ (1 / 2.2); this undoes both for one channel.
function lightOf(displayed) {
  let low = 0;
  let high = 64;
  for (let round = 0; round < 40; round++) {
    const middle = (low + high) / 2;
    if (applyViewTransform('aces', [middle, middle, middle])[0] ** (1 / 2.2) < displayed) low = middle;
    else high = middle;
  }
  return low;
}

function centreLight(pixels) {
  const at = ((SIZE / 2) * SIZE + SIZE / 2) * 4;
  return [0, 1, 2].map(channel => lightOf(pixels[at + channel]));
}

// Radiance through uniform slabs, front to back: each stretch dims what is behind it by exp(-k L) and adds j (1 - exp(-k L)) / k.
function stretchLight(stretches) {
  const radiance = [0, 0, 0];
  const transmittance = [1, 1, 1];
  for (const { length, extinction, glow } of stretches) {
    for (let channel = 0; channel < 3; channel++) {
      const factor = Math.exp(-extinction[channel] * length);
      radiance[channel] += transmittance[channel] * glow[channel] * (1 - factor) / extinction[channel];
      transmittance[channel] *= factor;
    }
  }
  return radiance;
}

const NEAR = { shape: 'box', center: [0, 0, 1], size: [4, 4, 2], density: 1.2, falloff: 0, absorption: [1, 1, 1], emission: [1, 0.5, 0.25], emissionStrength: 1, steps: 24, blur: 0 };
const FAR = { shape: 'box', center: [0, 0, 0], size: [4, 4, 2], density: 0.8, falloff: 0, absorption: [1, 1, 1], emission: [0.2, 0.6, 1], emissionStrength: 1, steps: 24, blur: 0 };
const SEPARATE = { ...FAR, center: [0, 0, -2] };

function slab(volume, length) {
  return { length, extinction: volume.absorption.map(channel => channel * volume.density), glow: volume.emission.map(channel => channel * volume.emissionStrength) };
}

function both(near, far, length) {
  const nearSlab = slab(near, length);
  const farSlab = slab(far, length);
  return { length, extinction: nearSlab.extinction.map((channel, index) => channel + farSlab.extinction[index]), glow: nearSlab.glow.map((channel, index) => channel + farSlab.glow[index]) };
}

test('overlapping box volumes add their glow and dimming along the shared stretch of the ray', async (context) => {
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
    const [alone, apart, overlapping] = await drawInChrome(page, [[NEAR], [NEAR, SEPARATE], [NEAR, FAR]]);
    for (const frame of [alone, apart, overlapping]) {
      assert.equal(frame.message, null);
      assert.equal(frame.glError, 0);
    }
    const tolerance = (expected) => expected.map(channel => channel * 0.08 + 0.002);
    const check = (frame, expected, what) => {
      const light = centreLight(frame.pixels);
      const allowed = tolerance(expected);
      for (let channel = 0; channel < 3; channel++) {
        assert.ok(Math.abs(light[channel] - expected[channel]) <= allowed[channel], `${what}, channel ${channel}: got ${light[channel]}, expected ${expected[channel]}`);
      }
    };
    check(alone, stretchLight([slab(NEAR, 2)]), 'one volume');
    check(apart, stretchLight([slab(NEAR, 2), slab(SEPARATE, 2)]), 'two volumes with a gap between them');
    // The near box spans z 0..2 and the far box z -1..1: along the ray the stretches are 1 (near only), 1 (both) and 1 (far only).
    check(overlapping, stretchLight([slab(NEAR, 1), both(NEAR, FAR, 1), slab(FAR, 1)]), 'two volumes that overlap by half');
    // Marched one after the other, each over its whole length, the same pair gives the light of the volumes in two separate stretches.
    const together = stretchLight([slab(NEAR, 1), both(NEAR, FAR, 1), slab(FAR, 1)]);
    const oneAfterTheOther = stretchLight([slab(NEAR, 2), slab(FAR, 2)]);
    const light = centreLight(overlapping.pixels);
    for (const channel of [1, 2]) {
      assert.ok(Math.abs(light[channel] - together[channel]) < Math.abs(light[channel] - oneAfterTheOther[channel]), `channel ${channel} follows the volumes marched together`);
    }
  } finally {
    await browser?.close();
    server.kill();
  }
});
