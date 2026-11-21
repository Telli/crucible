// Multiple scattering in local volumes (#1047): scatterOctaves adds the octave sum of volumeFog to the key light of a scattering volume, in the rasterizer and the CPU path tracer.
// Octave n scatters half^n as much, sees half^n of the light's optical depth and has half^n of the anisotropy, so a thick smoke lights up in its shade. One octave is the single scatter and draws as before.
// The browser test draws one smoke box in both and compares how much light the extra octaves add; it skips when Chrome cannot start.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { encodePng } from '../src/export-png.js';
import { freePort } from './helpers/free-port.js';
import { launchChrome, skipOrThrow, openBlankPage } from './helpers/dev-server-browser.js';
import { renderPathTracedImage } from '../src/path-tracer.js';
import { applyViewTransform } from '../src/view-transform.js';
import { resolveLocalVolumes, createLocalVolumeBuffers, packLocalVolumes, LOCAL_VOLUME_MAXIMUM_SCATTER_OCTAVES } from '../src/local-volumes.js';
import { createLocalVolumeCrossing } from '../src/path-tracer-volume.js';

const SMOKE = { shape: 'box', center: [0, 1.5, 0], size: [3, 1.5, 3], density: 1.2, falloff: 0.3, absorption: [0.7, 0.8, 1], scatter: 0.8, steps: 32 };
const SUN_TOWARD = [1, 0.1, 0].map(component => component / Math.hypot(1, 0.1, 0));
const FULL_SUN = { sun: { direction: SUN_TOWARD, color: [3, 3, 3] }, ambient: [0, 0, 0], sunVisibility: () => 1 };

function downRay(volume, x) {
  const crossing = createLocalVolumeCrossing(resolveLocalVolumes([volume]), FULL_SUN);
  const throughput = new Float64Array([1, 1, 1]);
  const emitted = new Float64Array(3);
  crossing(x, 4, 0, 0, -1, 0, 8, 0.5, throughput, emitted);
  return emitted[1];
}

test('scatterOctaves defaults to 1 and takes a whole number from 1 to 4', () => {
  assert.equal(resolveLocalVolumes([SMOKE])[0].scatterOctaves, 1);
  assert.equal(resolveLocalVolumes([{ ...SMOKE, scatterOctaves: 3 }])[0].scatterOctaves, 3);
  for (const bad of [0, 5, 1.5, '2', null]) {
    assert.throws(() => resolveLocalVolumes([{ ...SMOKE, scatterOctaves: bad }], 'environment.localVolumes'), /environment\.localVolumes\[0\]\.scatterOctaves must be a whole number from 1 to 4/);
  }
  assert.equal(LOCAL_VOLUME_MAXIMUM_SCATTER_OCTAVES, 4);
});

test('the octave count rides in the free fourth component of the first axis row, as the octaves beyond the first so a volume without it keeps its bytes', () => {
  const buffers = createLocalVolumeBuffers();
  packLocalVolumes(resolveLocalVolumes([SMOKE, { ...SMOKE, scatterOctaves: 3 }]), buffers);
  assert.deepEqual([buffers.axes[3], buffers.axes[7], buffers.axes[11]], [0, 0, 0]);
  assert.deepEqual([buffers.axes[15], buffers.axes[19], buffers.axes[23]], [2, 0, 0]);
});

test('one octave is the single scatter, and more octaves return more light that fills the shaded side most', () => {
  const columns = [-1.2, -0.6, 0, 0.6, 1.2];
  const single = columns.map(x => downRay(SMOKE, x));
  assert.deepEqual(columns.map(x => downRay({ ...SMOKE, scatterOctaves: 1 }, x)), single);
  const multiple = columns.map(x => downRay({ ...SMOKE, scatterOctaves: 3 }, x));
  multiple.forEach((light, index) => assert.ok(light > single[index], `column ${columns[index]}: ${light} against ${single[index]}`));
  const shadeGain = multiple[0] / single[0];
  const sunGain = multiple[4] / single[4];
  assert.ok(shadeGain > sunGain, `the shaded side (${shadeGain.toFixed(3)}) gains more than the sunward side (${sunGain.toFixed(3)})`);
  assert.ok(multiple[1] > single[1] * 1.1, 'three octaves lift the middle of a thick smoke by more than 10 percent');
});

const SIZE = 64;
const CPU_SIZE = 32;
const LOOKING_DOWN = { eye: [0, 3, 0], target: [0, 0, 0], up: [0, 0, -1], fov: 40 };
const LIGHT = { keyColor: [3, 3, 3], lightDirection: SUN_TOWARD, keyIntensity: 1, fillIntensity: 0, ambientIntensity: 0, skyTop: [0, 0, 0], skyBottom: [0, 0, 0] };

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

async function rasterFrames(page, volumeLists, size = SIZE, groundColor = [0, 0, 0], camera = LOOKING_DOWN) {
  const task = async ({ size, lists, camera, light, groundColor }) => {
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
    const material = { tag: 'unlit', color: groundColor, metallic: 0, roughness: 1, emission: 0 };
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
  return page.evaluate(task, { size, lists: volumeLists, camera, light: LIGHT, groundColor });
}

// The display shows aces(light) ^ (1 / 2.2); this undoes both for a channel.
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

function rasterTotal(frame) {
  let total = 0;
  for (let pixel = 0; pixel < SIZE * SIZE; pixel++) total += lightOf(frame[pixel * 4 + 1]);
  return total;
}

async function cpuTotal(volume) {
  const geometry = {
    positions: new Float32Array([-20, 0, 20, 20, 0, 20, 20, 0, -20, -20, 0, -20]),
    normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]),
    uvs: new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
  };
  const { linear } = await renderPathTracedImage(
    { parts: [{ name: 'ground', geometry, material: { tag: 'surface', metallic: 0, roughness: 1, color: [0, 0, 0], ior: 1 } }], environment: { localVolumes: [volume], keyColor: [3, 3, 3], lightDirection: SUN_TOWARD }, camera: LOOKING_DOWN },
    { width: CPU_SIZE, height: CPU_SIZE, denoise: false, threads: 1, bounces: 1, samples: 16 },
  );
  let total = 0;
  for (let pixel = 0; pixel < CPU_SIZE * CPU_SIZE; pixel++) total += linear[pixel * 3 + 1];
  return total;
}

test('the rasterizer and the CPU path tracer add about the same light for three octaves over one', async context => {
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
    const { frames: [single, triple, omitted], glError } = await rasterFrames(page, [[SMOKE], [{ ...SMOKE, scatterOctaves: 3 }], [{ ...SMOKE, scatterOctaves: 1 }]]);
    assert.equal(glError, 0);
    assert.deepEqual(omitted, single, 'one octave must draw exactly as a volume with no scatterOctaves field');
    const rasterGain = rasterTotal(triple) / rasterTotal(single);
    const cpuGain = await cpuTotal({ ...SMOKE, scatterOctaves: 3 }) / await cpuTotal(SMOKE);
    context.diagnostic(`three octaves add ${((rasterGain - 1) * 100).toFixed(1)} percent in the rasterizer and ${((cpuGain - 1) * 100).toFixed(1)} percent in the CPU tracer`);
    if (process.env.OCTAVES_ARTIFACTS) await writeStill(page, process.env.OCTAVES_ARTIFACTS);
    assert.ok(rasterGain > 1.1, `the rasterizer gain ${rasterGain}`);
    assert.ok(cpuGain > 1.1, `the CPU tracer gain ${cpuGain}`);
    assert.ok(Math.abs(rasterGain - cpuGain) < 0.1, `rasterizer ${rasterGain} against CPU tracer ${cpuGain}`);
  } finally {
    await browser?.close();
    server.kill();
  }
});

// The still for the pull request: one octave, three octaves and their absolute difference times 8, a smoke box over a dim floor seen from above, 256 px panels.
async function writeStill(page, folder) {
  const size = 256;
  const { frames: [single, triple] } = await rasterFrames(page, [[SMOKE], [{ ...SMOKE, scatterOctaves: 3 }]], size, [0.05, 0.05, 0.05], { ...LOOKING_DOWN, eye: [0, 7, 0] });
  const panels = [single, triple, single.map((value, index) => (index % 4 === 3 ? 1 : Math.abs(triple[index] - value) * 8))];
  const pixels = new Uint8Array(size * panels.length * size * 4);
  panels.forEach((frame, panel) => {
    for (let row = 0; row < size; row++) {
      for (let column = 0; column < size; column++) {
        const from = ((size - 1 - row) * size + column) * 4;
        const to = (row * size * panels.length + panel * size + column) * 4;
        for (let channel = 0; channel < 3; channel++) pixels[to + channel] = Math.round(Math.max(0, Math.min(1, frame[from + channel])) * 255);
        pixels[to + 3] = 255;
      }
    }
  });
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, 'scatter-octaves-before-after.png'), encodePng(pixels, size * panels.length, size));
}
