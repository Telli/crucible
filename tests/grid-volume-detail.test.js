// Fine detail on a grid volume (#2289): the 32 cubed blast grid is a soft blob when the camera is near, so a grid volume takes noiseAmount, noiseScale and noiseOctaves,
// which the rasterizer applies on top of the grid's density and flame (headless Chrome on SwiftShader from the Vite dev server; skips when Chrome cannot start).
import './support/load-agent-scene-modules.mjs';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { freePort } from './helpers/free-port.js';
import { launchChrome, skipOrThrow } from './helpers/dev-server-browser.js';
import { encodeVolumeGrid } from '../src/volume-grid.js';
import { resolveLocalVolumes, createLocalVolumeBuffers, packLocalVolumes } from '../src/local-volumes.js';
import { describeIgnoredFeatures } from '../src/path-tracer.js';
import { createAgentScene } from '../src/agent-scene.js';
import { setExplosionBakeStore } from '../src/explosion-grids.js';

const keptBakes = new Map();
setExplosionBakeStore({
  load: descriptor => keptBakes.get(JSON.stringify(descriptor)) ?? null,
  save: (descriptor, frames) => keptBakes.set(JSON.stringify(descriptor), frames),
});
after(() => setExplosionBakeStore(null));

const IGNORED_NOTE = /of a grid volume are ignored/;

test('a grid volume keeps its noise fields, packs them like a box volume and says the tracers ignore them', () => {
  const [volume] = resolveLocalVolumes([{ shape: 'grid', grid: 'smoke', center: [0, 1, 0], size: [3, 3, 3], noiseAmount: 0.7, noiseScale: 5, noiseOctaves: 3 }]);
  assert.deepEqual([volume.noiseAmount, volume.noiseScale, volume.noiseOctaves], [0.7, 5, 3]);
  assert.deepEqual(resolveLocalVolumes([volume])[0], volume, 'a resolved volume resolves again');
  const buffers = createLocalVolumeBuffers();
  packLocalVolumes([{ ...volume, gridData: { channels: {} } }], buffers);
  assert.equal(buffers.absorption[3].toFixed(2), '0.70');
  assert.equal(buffers.emission[3], 5);
  assert.equal(buffers.noiseOctaves, true, 'the shader variant with the fractal noise compiles in');
  assert.ok(describeIgnoredFeatures([], { localVolumes: [volume] }, 'cpu').some(note => IGNORED_NOTE.test(note)));
  assert.equal(describeIgnoredFeatures([], { localVolumes: [{ ...volume, noiseAmount: 0 }] }, 'cpu').some(note => IGNORED_NOTE.test(note)), false);
});

test('a blast carries noise cells that follow its box, so the detail is as fine at every size', () => {
  const volumes = [2.5, 10].map(size => {
    const scene = createAgentScene({ format: 'crucible.scene', schemaVersion: 1, geometries: [], materials: [], nodes: [] });
    scene.apply([{ type: 'add-explosion', id: 'blast', center: [0, 0, 0], size, sparks: 'none' }], { expectedRevision: scene.inspect({}).revision });
    return scene.exportRecipe().environment.localVolumes[0];
  });
  for (const volume of volumes) {
    assert.ok(volume.noiseAmount > 0 && volume.noiseOctaves >= 3);
    assert.equal(Math.round(volume.noiseScale * volume.size[0]), 80, 'the same number of noise cells across the box at any size');
    assert.ok(volume.steps <= 32, 'the CPU preview look keeps its march');
  }
});

function startServer(port) {
  const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('The dev server did not start.')), 30000);
    server.stdout.on('data', data => {
      if (/ready in/.test(data.toString())) {
        clearTimeout(timeout);
        resolve(server);
      }
    });
    server.on('exit', code => {
      clearTimeout(timeout);
      reject(new Error(`The dev server exited ${code}.`));
    });
  });
}

// Draws a grid of constant density seen head on and returns the mean and the spread of the red channel over the middle of the picture.
function drawSpread(page, bytes, volumeFields) {
  const task = async ({ gridBytes, fields }) => {
    const { box } = await import('/src/geometry.js');
    const { CrucibleRenderer } = await import('/src/renderer.js');
    const { decodeVolumeGrid, registerVolumeGrid } = await import('/src/volume-grid.js');
    await import('/src/fog-shader.js');
    registerVolumeGrid('constant', decodeVolumeGrid(new Uint8Array(gridBytes)));
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    document.body.append(canvas);
    const copy = document.createElement('canvas');
    copy.width = 64;
    copy.height = 64;
    const copyContext = copy.getContext('2d', { willReadFrequently: true });
    const wall = { geometry: box(0, 1), matrix: new Float32Array([12, 0, 0, 0, 0, 12, 0, 0, 0, 0, 0.2, 0, 0, 0, -0.1, 1]), material: { tag: 'unlit', color: [0.6, 0.6, 0.6], metallic: 0, roughness: 1 } };
    const renderer = new CrucibleRenderer(canvas, [wall], { hdr: true, depth: true, samples: 1, pixelRatio: 1, ground: false });
    const localVolumes = [{ shape: 'grid', center: [0, 0, 1.5], size: [3, 3, 1], density: 0.6, grid: 'constant', steps: 16, ...fields }];
    renderer.render({ eye: [0, 0, 5], target: [0, 0, 0], fov: 40, time: 0, environment: { keyIntensity: 0, fillIntensity: 0, ambientIntensity: 0, localVolumes } });
    copyContext.drawImage(canvas, 0, 0, 64, 64);
    const pixels = copyContext.getImageData(16, 16, 32, 32).data;
    const values = [];
    for (let index = 0; index < pixels.length; index += 4) values.push(pixels[index]);
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const spread = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
    return { mean, spread, glError: renderer.context.getError() };
  };
  return page.evaluate(task, { gridBytes: bytes, fields: volumeFields });
}

test('the rasterizer breaks a constant grid into detail around the same mean, and a grid without noise stays flat', async context => {
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
    const page = await browser.newPage({ viewport: { width: 64, height: 64 } });
    await page.goto(`http://127.0.0.1:${port}/`);
    const cells = 32 * 32 * 32;
    const bytes = Array.from(encodeVolumeGrid({ resolution: [32, 32, 32], channels: { density: new Float32Array(cells).fill(1) } }));
    const flat = await drawSpread(page, bytes, {});
    const detailed = await drawSpread(page, bytes, { noiseAmount: 1, noiseScale: 6, noiseOctaves: 3 });
    assert.equal(flat.glError, 0);
    assert.equal(detailed.glError, 0);
    assert.ok(flat.spread < 1.5, `a constant grid draws flat, spread ${flat.spread}`);
    assert.ok(detailed.spread > flat.spread + 3, `the noise shows: spread ${detailed.spread} against ${flat.spread}`);
    assert.ok(Math.abs(detailed.mean - flat.mean) < 12, `the noise averages out: mean ${detailed.mean} against ${flat.mean}`);
  } finally {
    await browser?.close();
    server.kill();
  }
});
