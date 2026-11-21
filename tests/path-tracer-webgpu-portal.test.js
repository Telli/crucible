// Light portals in the WebGPU path tracer (#1144), on a real adapter in headless Chrome (the Vite dev server serves the modules).
// It skips where Chrome, playwright or a WebGPU adapter is missing. The room is the one of the CPU portal test: a window in the west wall, a closed
// ceiling, so the sky reaches it only through the window and a portal must keep the mean while cutting the change between seeds.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { freePort } from './helpers/free-port.js';
import { skipOrThrow, openBlankPage } from './helpers/dev-server-browser.js';

const WEBGPU_ARGUMENTS = [process.platform === 'win32' ? '--use-angle=d3d11' : '--use-angle=swiftshader', '--enable-unsafe-webgpu', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-features=Vulkan'];

// The Google Chrome install ships dxcompiler.dll, which Dawn needs to compile this kernel for D3D12 on Windows; the bundled test Chromium does not, and its FXC fallback fails on the kernel.
async function launchWebGpuChrome(chromium) {
  try {
    return await chromium.launch({ headless: true, channel: 'chrome', args: WEBGPU_ARGUMENTS });
  } catch {
    return chromium.launch({ headless: true, args: WEBGPU_ARGUMENTS });
  }
}

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

// Runs in the page: renders the room with and without the portal on the WebGPU tracer and returns the mean and the seed difference of each.
async function measureRoom({ width, height, samples, seeds, kernel }) {
  const { box } = await import('/src/geometry.js');
  const { createEnvironmentMap } = await import('/src/environment.js');
  const { renderPathTracedImage } = await import('/src/path-tracer.js');
  const slab = (centerX, centerY, centerZ, sizeX, sizeY, sizeZ) => ({ name: 'wall', geometry: box(0, 1), matrix: new Float32Array([sizeX, 0, 0, 0, 0, sizeY, 0, 0, 0, 0, sizeZ, 0, centerX, centerY, centerZ, 1]), material: { color: [0.35, 0.35, 0.35] } });
  const parts = [slab(0, -0.1, 0, 4.8, 0.2, 4.8), slab(0, 0, -2.1, 4.8, 6, 0.2), slab(0, 0, 2.1, 4.8, 6, 0.2), slab(2.1, 0, 0, 0.2, 6, 4.8), slab(-2.1, 0.5, 0, 0.2, 1, 4), slab(-2.1, 2.5, 0, 0.2, 1, 4), slab(-2.1, 1.5, -1.5, 0.2, 1, 1), slab(-2.1, 1.5, 1.5, 0.2, 1, 1), slab(0, 3.1, 0, 4.8, 0.2, 4.8)];
  const mapWidth = 32;
  const mapHeight = 16;
  const data = new Float32Array(mapWidth * mapHeight * 3);
  for (let row = 0; row < mapHeight; row++) data.fill(row < mapHeight / 2 ? 4 : 0.5, row * mapWidth * 3, (row + 1) * mapWidth * 3);
  const map = createEnvironmentMap({ width: mapWidth, height: mapHeight, data, intensity: 1 });
  const portal = { position: [-2, 1.5, 0], direction: [1, 0, 0], up: [0, 1, 0], width: 2, height: 1, portal: true };
  const camera = { eye: [-1.4, 1.3, 1.2], target: [2, 1, -0.5], fov: 70 };
  const result = {};
  for (const withPortal of [false, true]) {
    const frames = [];
    for (const seed of seeds) {
      if (kernel) {
        // renderPathTracedImage does not expose the kernel choice, so the wavefront run calls the tracer directly.
        const { createCamera, normalizePathTracerOptions } = await import('/src/path-tracer.js');
        const { buildTraceSceneForDevice } = await import('/src/path-tracer-scene.js');
        const gpuModule = await import('/src/path-tracer-webgpu.js');
        const scene = await buildTraceSceneForDevice(parts, { map, areaLights: withPortal ? [portal] : [] }, gpuModule);
        const traced = await gpuModule.traceOnWebGpu(scene, createCamera(camera, width, height), { ...normalizePathTracerOptions({ width, height, samples, bounces: 8, seed, backend: 'webgpu', denoiser: 'none', threads: 1 }), kernel }, () => {});
        frames.push(Array.from(traced.color));
        continue;
      }
      const image = await renderPathTracedImage({ parts, environment: { map, areaLights: withPortal ? [portal] : [] }, camera }, { width, height, samples, bounces: 8, seed, backend: 'webgpu', denoiser: 'none', threads: 1 });
      frames.push(Array.from(image.linear));
      result.ignored = image.report.ignored;
      result.gpu = image.report.gpu;
    }
    const mean = frames.flat().reduce((sum, value) => sum + value, 0) / frames.flat().length;
    let total = 0;
    let count = 0;
    for (let first = 0; first < frames.length; first++) {
      for (let second = first + 1; second < frames.length; second++) {
        for (let index = 0; index < frames[first].length; index++) {
          total += Math.abs(frames[first][index] - frames[second][index]);
          count++;
        }
      }
    }
    result[withPortal ? 'with' : 'without'] = { mean, seedDifference: total / count };
  }
  return result;
}

test('on a WebGPU adapter a portal keeps the mean of a room lit through a window and cuts the change between seeds', async context => {
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
      browser = await launchWebGpuChrome(chromium);
    } catch (error) {
      skipOrThrow(context, `Chrome did not start: ${error.message.split('\n')[0]}`);
      return;
    }
    const page = await browser.newPage({ viewport: { width: 128, height: 128 } });
    await openBlankPage(page, port);
    const adapter = await page.evaluate(async () => {
      const found = navigator.gpu ? await navigator.gpu.requestAdapter() : null;
      if (!found) return null;
      const info = found.info ?? {};
      const description = [info.vendor, info.architecture, info.device, info.description].join(' ');
      return { software: Boolean(found.isFallbackAdapter || info.isFallbackAdapter) || /swiftshader|llvmpipe|software|lavapipe/i.test(description), description };
    });
    if (!adapter) {
      skipOrThrow(context, 'Chrome has no WebGPU adapter');
      return;
    }
    if (adapter.software) {
      // The CI runners expose a software adapter (SwiftShader) that took over five minutes on this room, so the check runs on real hardware only.
      context.skip(`the WebGPU adapter is software (${adapter.description.trim()}) and traces this room too slowly`);
      return;
    }
    const spp = process.env.CI ? 16 : 64;
    const mean = await page.evaluate(measureRoom, { width: 32, height: 24, samples: spp * 8, seeds: [1, 2, 3, 4] });
    const seeds = await page.evaluate(measureRoom, { width: 32, height: 24, samples: spp, seeds: [1, 2, 3, 4] });
    context.diagnostic(`gpu ${mean.gpu}; mean ${mean.with.mean.toFixed(5)} with a portal, ${mean.without.mean.toFixed(5)} without; seed difference ${seeds.without.seedDifference.toFixed(5)} without, ${seeds.with.seedDifference.toFixed(5)} with`);
    assert.doesNotMatch(mean.ignored.join(' '), /portal/, 'the WebGPU tracer should no longer name portals as ignored');
    assert.ok(mean.without.mean > 0.02, `the room is lit: ${mean.without.mean}`);
    assert.ok(Math.abs(mean.with.mean / mean.without.mean - 1) < 0.015, `mean ${mean.with.mean} with a portal against ${mean.without.mean} without`);
    const wavefront = await page.evaluate(measureRoom, { width: 32, height: 24, samples: spp * 8, seeds: [1, 2], kernel: 'wavefront' });
    context.diagnostic(`wavefront mean ${wavefront.with.mean.toFixed(5)} with a portal, ${wavefront.without.mean.toFixed(5)} without`);
    assert.ok(Math.abs(wavefront.with.mean / wavefront.without.mean - 1) < 0.015, `wavefront mean ${wavefront.with.mean} with a portal against ${wavefront.without.mean} without`);
    const wavefrontSeeds = await page.evaluate(measureRoom, { width: 32, height: 24, samples: spp, seeds: [1, 2, 3, 4], kernel: 'wavefront' });
    context.diagnostic(`wavefront seed difference ${wavefrontSeeds.without.seedDifference.toFixed(5)} without, ${wavefrontSeeds.with.seedDifference.toFixed(5)} with`);
    assert.ok(wavefrontSeeds.without.seedDifference / wavefrontSeeds.with.seedDifference >= 2, `wavefront seed difference ${wavefrontSeeds.without.seedDifference} without, ${wavefrontSeeds.with.seedDifference} with a portal`);
    assert.ok(wavefront.with.mean > 0.02, `the wavefront room is lit: ${wavefront.with.mean}`);
    assert.ok(seeds.without.seedDifference / seeds.with.seedDifference >= 2, `seed difference ${seeds.without.seedDifference} without, ${seeds.with.seedDifference} with a portal`);
  } finally {
    await browser?.close();
    server.kill();
  }
});
