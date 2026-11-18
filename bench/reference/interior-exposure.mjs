// Draws one daylit room with the raster renderer and with the path tracer from the same recipe, and prints the mean luminance
// of each (issue #1334). The room is closed except for one window; the only light is the sun and a physical sky.
//   node bench/reference/interior-exposure.mjs <output directory> [--samples 48] [--sun-bounce 2] [--exposure 3.6]
//     [--environment-intensity 0.3] [--backend gpu|cpu] [--key-intensity 1] [--sealed] [--width 960] [--height 540] [--denoise]
// Run it through gpu-lock.sh. Files are <output directory>/raster.png and path-traced.png; build the MCP server first
// (`npm run build && node scripts/build-mcp.mjs`).
import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const argumentsGiven = process.argv.slice(2);
const outputDirectory = resolve(argumentsGiven[0] ?? 'artifacts/1334');

function numberAfter(flag, fallback) {
  const index = argumentsGiven.indexOf(flag);
  return index >= 0 ? Number(argumentsGiven[index + 1]) : fallback;
}

const samples = numberAfter('--samples', 48);
const sunBounce = numberAfter('--sun-bounce', 2);
const exposure = numberAfter('--exposure', 3.6);
const environmentIntensity = numberAfter('--environment-intensity', 0.3);
const keyIntensity = numberAfter('--key-intensity', 1);
const backendIndex = argumentsGiven.indexOf('--backend');
const backend = backendIndex >= 0 ? argumentsGiven[backendIndex + 1] : 'gpu';
// --sealed fills the window with a wall, so no light can enter: the room has to come out black from both renderers.
const sealed = argumentsGiven.includes('--sealed');
// --no-lawn drops the large ground slab, which stretches the shadow map and shows whether the room's shadows depend on it.
const withoutLawn = argumentsGiven.includes('--no-lawn');
// --tight-shadow fits the sun's shadow map to the room instead of the default 130 m world view.
const tightShadow = argumentsGiven.includes('--tight-shadow');
// --raster-only skips the path tracer, for sweeps of the raster alone; --shadow-extent <metres> fits the sun's shadow view to that half width around the room.
const rasterOnly = argumentsGiven.includes('--raster-only');
const shadowExtent = numberAfter('--shadow-extent', 0);
const WIDTH = numberAfter('--width', 960);
const HEIGHT = numberAfter('--height', 540);
// --denoise runs the OIDN denoiser on the path traced frame (the default leaves it off so the mean is the raw estimate).
const denoise = argumentsGiven.includes('--denoise') ? 'oidn' : false;

const ROOM = { halfWidth: 4, front: -3, back: 3.5, height: 3, wall: 0.2 };
const WINDOW = { halfWidth: 1.4, bottom: 0.9, top: 2.4 };

function box(id, translation, scale, material = 'plaster') {
  return { id, geometry: 'block', material, translation, scale };
}

function roomNodes() {
  const { halfWidth, front, back, height, wall } = ROOM;
  const depth = back - front;
  const middleZ = (front + back) / 2;
  const frontZ = front - wall / 2;
  const sideWidth = halfWidth - WINDOW.halfWidth;
  return [
    box('floor', [0, -wall / 2, middleZ], [halfWidth * 2 + wall * 2, wall, depth + wall * 2], 'wood'),
    box('ceiling', [0, height + wall / 2, middleZ], [halfWidth * 2 + wall * 2, wall, depth + wall * 2]),
    box('wall-left', [-halfWidth - wall / 2, height / 2, middleZ], [wall, height, depth + wall * 2]),
    box('wall-right', [halfWidth + wall / 2, height / 2, middleZ], [wall, height, depth + wall * 2]),
    box('wall-back', [0, height / 2, back + wall / 2], [halfWidth * 2, height, wall]),
    box('front-left', [-(WINDOW.halfWidth + sideWidth / 2), height / 2, frontZ], [sideWidth, height, wall]),
    box('front-right', [WINDOW.halfWidth + sideWidth / 2, height / 2, frontZ], [sideWidth, height, wall]),
    box('front-sill', [0, WINDOW.bottom / 2, frontZ], [WINDOW.halfWidth * 2, WINDOW.bottom, wall]),
    box('front-head', [0, (WINDOW.top + height) / 2, frontZ], [WINDOW.halfWidth * 2, height - WINDOW.top, wall]),
    ...(sealed ? [box('window-pane', [0, (WINDOW.bottom + WINDOW.top) / 2, frontZ], [WINDOW.halfWidth * 2, WINDOW.top - WINDOW.bottom, wall])] : []),
    ...(withoutLawn ? [] : [box('lawn', [0, -wall / 2 - 0.05, front - 20], [80, wall, 40], 'grass')]),
  ];
}

const recipe = {
  format: 'crucible.scene', schemaVersion: 1,
  geometries: [{ id: 'block', type: 'box' }],
  materials: [
    { id: 'plaster', color: [0.75, 0.72, 0.66], roughness: 0.9 },
    { id: 'wood', color: [0.45, 0.32, 0.2], roughness: 0.6 },
    { id: 'grass', color: [0.2, 0.3, 0.12], roughness: 1 },
  ],
  nodes: roomNodes(),
  camera: { eye: [0, 1.5, -2.4], target: [0, 1.2, 3], up: [0, 1, 0], fov: 70, near: 0.05, far: 100 },
  environment: {
    lightDirection: [0.3, 0.55, -0.8], keyIntensity, environmentIntensity, sunBounce,
    sky: { type: 'physical', sunElevation: 33, sunRotation: 20 },
    viewTransform: 'agx',
  },
  effects: { exposure },
  ...(tightShadow ? { shadow: { target: [0, 1.5, 0.3], extent: 6, distance: 14, near: 1, far: 30 } } : {}),
  ...(shadowExtent > 0 ? { shadow: { target: [0, 1.5, numberAfter('--shadow-target-z', 0.3)], extent: shadowExtent, distance: shadowExtent * 2.4, near: 1, far: shadowExtent * 5 } } : {}),
};

const workDirectory = await mkdtemp(join(tmpdir(), 'crucible-interior-'));
await mkdir(outputDirectory, { recursive: true });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [resolve('bin/crucible-mcp.mjs'), '--backend', backend, '--memory', '384', '--jobs', join(workDirectory, 'jobs')],
  cwd: workDirectory,
  stderr: 'pipe',
});
const client = new Client({ name: 'interior-exposure', version: '1' });

async function call(name, toolArguments) {
  const result = await client.callTool({ name, arguments: toolArguments }, { timeout: 240000 });
  assert.notEqual(result.isError, true, result.content?.[0]?.text);
  return result.structuredContent;
}

async function render(sessionId, name, renderer) {
  const settings = { kind: 'image', width: WIDTH, height: HEIGHT, ...(renderer ? { renderer } : {}) };
  const { jobId } = await call('scene_render_submit', { sessionId, expectedRevision: 0, settings });
  for (;;) {
    const record = await call('scene_render_status', { jobId });
    if (record.state === 'completed') break;
    assert.ok(!['failed', 'cancelled'].includes(record.state), JSON.stringify(record));
    await new Promise(resolveWait => setTimeout(resolveWait, 500));
  }
  const result = await call('scene_render_result', { jobId });
  await copyFile(result.artifacts[0].path, join(outputDirectory, `${name}.png`));
  return result;
}

async function traceAndReport(sessionId) {
  const traced = await render(sessionId, 'path-traced', {
    type: 'pathTracer', backend, samples, bounces: 6, denoise, seed: 1, maxSeconds: 120,
  });
  console.log(JSON.stringify({ ignored: traced.metrics?.pathTracer?.ignored, diagnostics: traced.diagnostics }, null, 1));
  console.log(`wrote ${outputDirectory}/raster.png and path-traced.png`);
}

try {
  await client.connect(transport);
  const created = await call('scene_create', { recipe });
  await render(created.sessionId, 'raster');
  if (rasterOnly) {
    console.log(`wrote ${outputDirectory}/raster.png`);
  } else {
    await traceAndReport(created.sessionId);
  }
} finally {
  await client.close().catch(() => {});
  await rm(workDirectory, { recursive: true, force: true });
}
