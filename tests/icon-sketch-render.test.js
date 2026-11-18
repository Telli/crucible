// The sketch look drawn for real: the MCP server on the cpu backend (SwiftShader) renders the Kenney boat fixture, and the pictures are
// measured. These pin what the issue asks of sketch: the outline and the hatching still read at 64 px, the same seed gives the same
// bytes, and the knobs change the picture. Needs Chrome, like the other MCP tests.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { decodePng } from '../scripts/agent-icon-png.mjs';
import { startIconsServer } from '../scripts/icons-mcp-client.mjs';
import { alphaBounds } from '../src/icon-sheet.js';
import { hexLuma, measureHatchBand, measureOutline } from '../src/icon-sketch.js';

const FIXTURES = fileURLToPath(new URL('./fixtures/kenney-boat/', import.meta.url));
const SIZE = 64;
const JOB = { items: ['boat-fishing-small.glb'], size: SIZE, style: 'sketch', breakdown: true, seed: 1 };
const RENDER_TEST_TIMEOUT_MS = 240000;

let server;
before(async () => { server = await startIconsServer({ assets: FIXTURES }); });
after(async () => { await server?.close(); });

async function readAll(artifacts) {
  const files = new Map();
  for (const [filename, path] of artifacts) files.set(filename, await readFile(path));
  return files;
}

/** The n-th square panel of a strip as its own picture. */
function panelOf(strip, position, extra) {
  const data = Buffer.alloc(SIZE * SIZE * 4);
  for (let row = 0; row < SIZE; row++) {
    strip.data.copy(data, row * SIZE * 4, (row * strip.width + position * SIZE) * 4, (row * strip.width + (position + 1) * SIZE) * 4);
  }
  return { width: SIZE, height: SIZE, data, ...extra };
}

test('sketch at 64 px keeps its outline and its hatching readable: ink on the contour, bimodal hatching with real contrast', { timeout: RENDER_TEST_TIMEOUT_MS }, async () => {
  const { artifacts, manifest } = await server.runJob(JOB);
  const files = await readAll(artifacts);
  const strip = decodePng(files.get('breakdown-0.png'));
  assert.deepEqual([strip.width, strip.height], [SIZE * 4, SIZE]);
  const luma = { paperLuma: hexLuma(manifest.sketch.paperColor), inkLuma: hexLuma(manifest.sketch.inkColor) };
  const outline = measureOutline(panelOf(strip, 1, luma));
  assert.ok(outline.contourPixels > 100, 'the boat has a contour to ink');
  assert.ok(outline.inkedShare >= 0.95, `the outline is inked along ${outline.inkedShare} of the contour`);
  const hatching = measureHatchBand(panelOf(strip, 2, luma));
  assert.ok(hatching, 'the shaded side of the boat is hatched');
  assert.ok(hatching.pixels >= 300, `${hatching.pixels} px of hatching`);
  assert.ok(hatching.contrast >= 0.7, `hatching contrast ${hatching.contrast}: lines are as dark against the paper as ${hatching.contrast} of the ink to paper range`);
  assert.ok(hatching.bimodal >= 0.8, `${hatching.bimodal} of the hatched pixels are paper or ink: the rest is grey noise`);
  assert.ok(hatching.coverage > 0.08 && hatching.coverage < 0.7, `ink covers ${hatching.coverage} of the hatched band`);
});

test('the sketch fills the item with paper, keeps the frame clean and writes the strip, outline and hatching panels apart', { timeout: RENDER_TEST_TIMEOUT_MS }, async () => {
  const { artifacts, manifest } = await server.runJob(JOB);
  const files = await readAll(artifacts);
  assert.deepEqual([...files.keys()], ['icon-0.png', 'breakdown-0.png', 'atlas.png', 'icons.json']);
  assert.equal(manifest.icons[0].breakdown, 'breakdown-0.png');
  const icon = decodePng(files.get('icon-0.png'));
  const box = alphaBounds(icon.data, SIZE, SIZE);
  assert.ok(box.left >= 1 && box.top >= 1 && box.right <= SIZE - 1 && box.bottom <= SIZE - 1, 'the ink does not clip the frame');
  const paper = [0xf4, 0xec, 0xd8];
  let paperPixels = 0;
  let opaquePixels = 0;
  for (let pixel = 0; pixel < SIZE * SIZE; pixel++) {
    if (icon.data[pixel * 4 + 3] < 250) continue;
    opaquePixels++;
    if (paper.every((value, channel) => Math.abs(icon.data[pixel * 4 + channel] - value) <= 6)) paperPixels++;
  }
  assert.ok(paperPixels / opaquePixels > 0.3, `${paperPixels} of ${opaquePixels} opaque pixels are paper`);
  const strip = decodePng(files.get('breakdown-0.png'));
  const panels = [0, 1, 2, 3].map(position => panelOf(strip, position));
  const distinct = new Set(panels.map(panel => panel.data.toString('base64')));
  assert.equal(distinct.size, 4, 'shaded, outline, hatching and final differ');
  assert.ok(panels[3].data.equals(icon.data), 'the last panel is the final icon');
});

test('the same input and seed give byte-identical files, and another seed or knob gives another picture', { timeout: RENDER_TEST_TIMEOUT_MS }, async () => {
  const first = await readAll((await server.runJob(JOB)).artifacts);
  const second = await readAll((await server.runJob(JOB)).artifacts);
  for (const [filename, bytes] of first) assert.ok(bytes.equals(second.get(filename)), `${filename} differs between two runs`);
  const otherSeed = await readAll((await server.runJob({ ...JOB, seed: 2 })).artifacts);
  assert.ok(!first.get('icon-0.png').equals(otherSeed.get('icon-0.png')), 'a new seed wobbles the lines differently');
  const steady = await readAll((await server.runJob({ ...JOB, sketch: { jitter: 0 } })).artifacts);
  assert.ok(!first.get('icon-0.png').equals(steady.get('icon-0.png')), 'jitter 0 draws straight lines');
  const blue = await readAll((await server.runJob({ ...JOB, sketch: { inkColor: '#1030a0', paperColor: '#e0f0ff' } })).artifacts);
  const bluePixels = decodePng(blue.get('icon-0.png'));
  const [red, green, blueChannel] = bluePixels.data.subarray((32 * SIZE + 32) * 4, (32 * SIZE + 32) * 4 + 3);
  assert.ok(blueChannel > red, `the interior takes the paper colour: ${[red, green, blueChannel]}`);
});

test('a turnaround sheet of sketches has a row per item, a column per angle, and four different views', { timeout: RENDER_TEST_TIMEOUT_MS }, async () => {
  const { artifacts, manifest } = await server.runJob({ items: ['boat-fishing-small.glb'], size: SIZE, style: 'sketch', angles: 4, seed: 1 });
  const files = await readAll(artifacts);
  assert.deepEqual([...files.keys()], ['icon-0.png', 'icon-1.png', 'icon-2.png', 'icon-3.png', 'atlas.png', 'icons.json']);
  assert.deepEqual(manifest.atlas, { file: 'atlas.png', width: SIZE * 4, height: SIZE, columns: 4, rows: 1 });
  assert.deepEqual(manifest.icons.map(icon => icon.angle), [35, 125, -145, -55]);
  assert.equal(new Set(manifest.icons.map(icon => icon.viewHeight)).size, 1, 'one scale for the four views of the item');
  assert.equal(new Set(['icon-0.png', 'icon-1.png', 'icon-2.png', 'icon-3.png'].map(name => files.get(name).toString('base64'))).size, 4);
});
