// An authored HDRI faces the way three.js and Cycles show it: the file's column 0.25 is seen toward -Z at rotation 0 (#1371).
import './support/load-agent-scene-modules.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { alignEnvironmentRows } from '../src/environment-orientation.js';
import { loadHdri, parseRadianceHdr } from '../src/hdri.js';
import { catalogEnvironmentSource, registerCatalogEnvironment } from '../src/look-catalog.js';
import { environmentRadiance } from '../src/path-tracer-shading.js';
import { freePort } from './helpers/free-port.js';
import { launchChrome, skipOrThrow, openBlankPage } from './helpers/dev-server-browser.js';

const WIDTH = 32;
const HEIGHT = 16;
const SPOT_COLUMN = WIDTH / 4;

// An uncompressed Radiance file: a dim sky with a bright 2 by 2 block whose right column is SPOT_COLUMN, on the horizon.
function spotHdrBytes() {
  const header = Buffer.from(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${HEIGHT} +X ${WIDTH}\n`);
  const pixels = Buffer.alloc(WIDTH * HEIGHT * 4);
  for (let row = 0; row < HEIGHT; row++) {
    for (let column = 0; column < WIDTH; column++) {
      const inSpot = column >= SPOT_COLUMN - 1 && column <= SPOT_COLUMN && row >= HEIGHT / 2 - 1 && row <= HEIGHT / 2;
      pixels.set(inSpot ? [128, 128, 128, 135] : [64, 64, 64, 120], (row * WIDTH + column) * 4);
    }
  }
  return Buffer.concat([header, pixels]);
}

function cpuRadianceToward(map, direction) {
  const environment = { width: map.width, height: map.height, channels: map.channels ?? map.data.length / (map.width * map.height), data: map.data, intensity: 1, cosine: Math.cos(map.rotation ?? 0), sine: Math.sin(map.rotation ?? 0) };
  const out = new Float64Array(3);
  environmentRadiance(environment, direction[0], direction[1], direction[2], out);
  return out[0];
}

test('alignEnvironmentRows turns every row a quarter of the width and keeps every value', () => {
  const data = new Float32Array(8 * 2 * 3);
  data.set([1, 2, 3], (0 * 8 + 2) * 3);
  data.set([4, 5, 6], (1 * 8 + 7) * 3);
  const turned = alignEnvironmentRows({ width: 8, height: 2, data });
  assert.deepEqual(Array.from(turned.data.subarray((0 * 8 + 4) * 3, (0 * 8 + 4) * 3 + 3)), [1, 2, 3]);
  assert.deepEqual(Array.from(turned.data.subarray((1 * 8 + 1) * 3, (1 * 8 + 1) * 3 + 3)), [4, 5, 6]);
  assert.equal(turned.data.reduce((sum, value) => sum + value, 0), data.reduce((sum, value) => sum + value, 0));
});

test('a loaded HDRI shows its column 0.25 toward -Z in the CPU tracer and none of the other axes', async () => {
  const map = await loadHdri('spot.hdr', { fetchImplementation: async () => new Response(spotHdrBytes()) });
  const towardMinusZ = cpuRadianceToward(map, [0, 0, -1]);
  assert.ok(towardMinusZ > 1, `the spot reads ${towardMinusZ} toward -Z`);
  for (const direction of [[0, 0, 1], [1, 0, 0], [-1, 0, 0]]) {
    assert.ok(cpuRadianceToward(map, direction) < 0.1, `no spot toward ${direction}`);
  }
});

test('a catalog HDRI is turned the same way, and environmentRotation + PI / 2 gives the old direction back', () => {
  registerCatalogEnvironment('sky-clouds', parseRadianceHdr(spotHdrBytes()));
  const map = { ...catalogEnvironmentSource('sky-clouds'), rotation: 0 };
  assert.ok(cpuRadianceToward(map, [0, 0, -1]) > 1);
  // Before #1371 the file's column 0.25 faced -X at rotation 0. A rotation of PI / 2 turns the new maps back to that.
  const oldLook = { ...map, rotation: Math.PI / 2 };
  assert.ok(cpuRadianceToward(oldLook, [-1, 0, 0]) > 1, 'the spot is toward -X again');
  assert.ok(cpuRadianceToward(oldLook, [0, 0, -1]) < 0.1);
});

test('the raster shows the spot toward -Z at rotation 0', async (context) => {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    skipOrThrow(context, 'playwright is not installed');
    return;
  }
  const port = await freePort();
  const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('The dev server did not start.')), 30000);
    server.stdout.on('data', data => { if (/ready in/.test(data.toString())) { clearTimeout(timeout); resolve(); } });
    server.on('exit', code => { clearTimeout(timeout); reject(new Error(`The dev server exited ${code}.`)); });
  });
  let browser;
  try {
    try {
      browser = await launchChrome(chromium);
    } catch (error) {
      skipOrThrow(context, `Chrome did not start: ${error.message.split('\n')[0]}`);
      return;
    }
    const page = await browser.newPage({ viewport: { width: 64, height: 64 } });
    await openBlankPage(page, port);
    const means = await page.evaluate(async (hdrBase64) => {
      const bytes = Uint8Array.from(atob(hdrBase64), character => character.charCodeAt(0));
      const { createAgentScene, loadAllAgentSceneModules } = await import('/src/agent-scene.js');
      await loadAllAgentSceneModules?.();
      const { CrucibleRenderer } = await import('/src/renderer.js');
      const { agentEnvironmentMap } = await import('/src/agent-look.js');
      const { parseRadianceHdr } = await import('/src/hdri.js');
      const { registerCatalogEnvironment } = await import('/src/look-catalog.js');
      registerCatalogEnvironment('sky-clouds', parseRadianceHdr(bytes));
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 64;
      document.body.append(canvas);
      const copy = document.createElement('canvas');
      copy.width = 64;
      copy.height = 64;
      const copyContext = copy.getContext('2d', { willReadFrequently: true });
      const results = {};
      for (const [name, target] of Object.entries({ minusZ: [0, 0, -1], plusZ: [0, 0, 1], plusX: [1, 0, 0], minusX: [-1, 0, 0] })) {
        const scene = createAgentScene({ format: 'crucible.scene', schemaVersion: 1, geometries: [{ id: 'box', type: 'box', bevel: 0 }], materials: [{ id: 'm', color: [0.5, 0.5, 0.5], emission: 0 }],
          nodes: [{ id: 'far', geometry: 'box', material: 'm', translation: [0, -80, 0] }],
          camera: { eye: [0, 0, 0], target, fov: 30, near: 0.05, far: 200 }, environment: { hdri: 'sky-clouds', world: true } });
        const environment = scene.environment;
        const map = agentEnvironmentMap(environment);
        const renderer = new CrucibleRenderer(canvas, scene.parts, { ground: false, world: true, samples: 1, pixelRatio: 1, environment: { ...environment, map } });
        renderer.render({ ...scene.camera, environment: { ...environment, map } });
        copyContext.clearRect(0, 0, 64, 64);
        copyContext.drawImage(canvas, 0, 0, 64, 64);
        const pixels = copyContext.getImageData(0, 0, 64, 64).data;
        let sum = 0;
        for (let index = 0; index < pixels.length; index += 4) sum += pixels[index];
        results[name] = sum / 4096;
      }
      return results;
    }, spotHdrBytes().toString('base64'));
    assert.ok(means.minusZ > means.plusZ + 20, `the view toward -Z (${means.minusZ}) is brighter than toward +Z (${means.plusZ})`);
    assert.ok(means.minusZ > means.plusX + 20 && means.minusZ > means.minusX + 20, `and than toward +X (${means.plusX}) and -X (${means.minusX})`);
  } finally {
    await browser?.close();
    server.kill();
  }
});
