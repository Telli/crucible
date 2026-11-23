// Foam must never outshine a plain white diffuse surface under the same light (#2035).
// Draws the sea of tests/water-ocean-look.test.js three times through the real MCP server on the CPU backend (SwiftShader):
// without foam (coverage -1), with foam, and with foam beside a white albedo-1 slab. Chrome is needed, as for the other MCP tests.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { decodePng } from '../scripts/agent-icon-png.mjs';

const chromePath = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const enabled = existsSync(chromePath) || process.env.CI === 'true';
const FRAME = { kind: 'image', width: 200, height: 112 };
const FOAM_GAIN_LEVELS = 24;
const MARGIN_LEVELS = 10;

function recipeFor({ coverage, withSlab }) {
  const recipe = {
    format: 'crucible.scene', schemaVersion: 1,
    geometries: [
      { id: 'sea', type: 'mesh', base: { type: 'box', bevel: 0 }, edits: [
        { op: 'delete', select: { not: { normal: [0, 1, 0], maxAngle: 10 } } },
        { op: 'subdivide_edges', edges: { open: true }, cuts: 16 },
        { op: 'subdivide', levels: 3 },
        { op: 'set_position', position: { mul: [{ attr: 'position' }, [100, 1, 100]] } },
        { op: 'ocean', windSpeed: 16, choppiness: 1.5, size: 50, seed: 3, resolution: 3, coverage },
      ] },
      { id: 'slab', type: 'mesh', base: { type: 'box', bevel: 0 }, edits: [
        { op: 'set_position', position: { mul: [{ attr: 'position' }, [1.6, 0.1, 1.6]] } },
      ] },
    ],
    materials: [
      { id: 'surface', tag: 'water', color: [0.1, 0.2, 0.3] },
      { id: 'white', color: [1, 1, 1], metallic: 0, roughness: 1 },
    ],
    nodes: [{ id: 'sea', geometry: 'sea', material: 'surface' }],
    camera: { eye: [-9, 5.5, 9.5], target: [-11.9, 3.2, 3.9], fov: 50 },
    environment: { world: true, lightDirection: [-0.5, 1, 0.6], keyIntensity: 1.6, ambientIntensity: 0.5, skyTop: [0.55, 0.7, 0.9], skyBottom: [0.85, 0.88, 0.9] },
  };
  if (withSlab) recipe.nodes.push({ id: 'slab', geometry: 'slab', material: 'white', translation: [-9.5, 4.3, 6.2] });
  return recipe;
}

let directory;
let client;

before(async () => {
  if (!enabled) return;
  directory = await mkdtemp(join(tmpdir(), 'crucible-foam-brightness-'));
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [resolve('bin/crucible-mcp.mjs'), '--backend', 'cpu', '--memory', '256', '--jobs', join(directory, 'jobs')], cwd: directory, stderr: 'pipe' });
  client = new Client({ name: 'crucible-foam-brightness-test', version: '1' });
  await client.connect(transport, { timeout: 240000 });
});

after(async () => {
  await client?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

async function renderPixels(options, name) {
  const call = (toolName, args) => client.callTool({ name: toolName, arguments: args }, { timeout: 240000 });
  const { sessionId } = (await call('scene_create', { recipe: recipeFor(options) })).structuredContent;
  const submitted = (await call('scene_render_submit', { sessionId, expectedRevision: 0, settings: FRAME })).structuredContent;
  for (;;) {
    const record = (await call('scene_render_status', { jobId: submitted.jobId })).structuredContent;
    if (record.state === 'completed') break;
    if (['cancelled', 'failed'].includes(record.state)) throw new Error(`${name}: ${record.state}: ${record.error}`);
    await delay(200);
  }
  const result = (await call('scene_render_result', { jobId: submitted.jobId })).structuredContent;
  const stillPath = join(directory, `${name}.png`);
  await copyFile(result.artifacts[0].path, stillPath);
  await call('scene_dispose', { sessionId });
  return decodePng(await readFile(stillPath)).data;
}

function meanLevel(pixels, selected) {
  let sum = 0;
  let count = 0;
  for (let offset = 0; offset < pixels.length; offset += 4) {
    if (!selected(offset)) continue;
    sum += (pixels[offset] + pixels[offset + 1] + pixels[offset + 2]) / 3;
    count += 1;
  }
  return { count, mean: count ? sum / count : 0 };
}

const brightness = (pixels, offset) => (pixels[offset] + pixels[offset + 1] + pixels[offset + 2]) / 3;

test('at key 1.6 the foam is at most 10 levels brighter than a white albedo-1 diffuse slab under the same light', { skip: !enabled, timeout: 600000 }, async () => {
  const noFoam = await renderPixels({ coverage: -1, withSlab: false }, 'no-foam');
  const foam = await renderPixels({ coverage: 0.3, withSlab: false }, 'foam');
  const foamWithSlab = await renderPixels({ coverage: 0.3, withSlab: true }, 'foam-and-slab');
  const foamPixels = meanLevel(foam, offset => brightness(foam, offset) - brightness(noFoam, offset) >= FOAM_GAIN_LEVELS);
  const slabPixels = meanLevel(foamWithSlab, offset => brightness(foamWithSlab, offset) - brightness(foam, offset) > 20);
  assert.ok(foamPixels.count >= 100, `the test sea shows foam (${foamPixels.count} pixels)`);
  assert.ok(slabPixels.count >= 50, `the white slab is in frame (${slabPixels.count} pixels)`);
  const excess = foamPixels.mean - slabPixels.mean;
  assert.ok(excess <= MARGIN_LEVELS, `foam mean ${foamPixels.mean.toFixed(1)} against the white slab ${slabPixels.mean.toFixed(1)}: ${excess.toFixed(1)} levels above, at most ${MARGIN_LEVELS} allowed (foam must not be lit twice)`);
});
