// Renders every GLB of a folder as icons through the MCP server on the cpu backend and copies the files to --out.
//   node scripts/smoke-icons.mjs --assets <folder of .glb files> --out <folder> [--style clean|toon|sketch] [--scale fit|relative]
//     [--size 128] [--angles 1|4|8] [--breakdown] [--seed 0] [--only a.glb,b.glb] [--twice]
// Checks each icon's alpha box against the frame (inside it, centred) and, with --twice, that a second job writes the same bytes.
// With --breakdown it measures the outline and the hatching of every strip (src/icon-sketch.js) and prints them.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { decodePng } from './agent-icon-png.mjs';
import { startIconsServer } from './icons-mcp-client.mjs';
import { hexLuma, measureHatchBand, measureOutline } from '../src/icon-sketch.js';

const argumentsGiven = process.argv.slice(2);
function option(name, fallback) {
  const index = argumentsGiven.indexOf(`--${name}`);
  return index < 0 ? fallback : argumentsGiven[index + 1];
}
const assets = resolve(option('assets', ''));
const output = resolve(option('out', 'artifacts/icons'));
const style = option('style', 'clean');
const scale = option('scale', 'fit');
const size = Number(option('size', 128));
const angles = Number(option('angles', 1));
const seed = Number(option('seed', 0));
const breakdown = argumentsGiven.includes('--breakdown');
const runTwice = argumentsGiven.includes('--twice');
const only = option('only', undefined)?.split(',');
const names = (await readdir(assets)).filter(name => name.endsWith('.glb') && (!only || only.includes(name))).sort();
assert.ok(names.length, `No .glb files in ${assets}.`);

const settings = { items: names, size, style, scale, ...(angles > 1 ? { angles } : {}), ...(breakdown ? { breakdown } : {}), ...(style === 'sketch' ? { seed } : {}) };
const digest = async path => createHash('sha256').update(await readFile(path)).digest('hex');
const server = await startIconsServer({ assets });

async function printSketchMeasures(manifest, artifacts) {
  const paperLuma = hexLuma(manifest.sketch.paperColor);
  const inkLuma = hexLuma(manifest.sketch.inkColor);
  for (const icon of manifest.icons.filter(entry => entry.breakdown)) {
    const strip = decodePng(await readFile(artifacts.get(icon.breakdown)));
    const panel = position => ({ width: size, height: size, data: panelPixels(strip, position), paperLuma, inkLuma });
    const outline = measureOutline(panel(1));
    const hatch = measureHatchBand(panel(2));
    console.log(icon.name.padEnd(24), `outline inked ${outline.inkedShare.toFixed(2)}`, hatch ? `hatch contrast ${hatch.contrast.toFixed(2)} bimodal ${hatch.bimodal.toFixed(2)} coverage ${hatch.coverage.toFixed(2)} (${hatch.pixels} px)` : 'no hatching');
  }
}

/** The RGBA bytes of the n-th square panel of a strip. */
function panelPixels(strip, position) {
  const data = Buffer.alloc(size * size * 4);
  for (let row = 0; row < size; row++) {
    strip.data.copy(data, row * size * 4, (row * strip.width + position * size) * 4, (row * strip.width + (position + 1) * size) * 4);
  }
  return data;
}

try {
  const first = await server.runJob(settings);
  await mkdir(output, { recursive: true });
  for (const [filename, path] of first.artifacts) await copyFile(path, join(output, filename));
  for (const icon of first.manifest.icons) {
    const { x, y, width, height } = icon.bounds;
    assert.ok(x >= 1 && y >= 1 && x + width <= size - 1 && y + height <= size - 1, `${icon.name} touches the frame edge: ${JSON.stringify(icon.bounds)}`);
    console.log(icon.name.padEnd(24), String(icon.angle).padStart(5), JSON.stringify(icon.bounds), `view height ${icon.viewHeight}`);
  }
  if (breakdown) await printSketchMeasures(first.manifest, first.artifacts);
  if (runTwice) {
    const second = await server.runJob(settings);
    for (const [filename, path] of first.artifacts) {
      assert.equal(await digest(path), await digest(second.artifacts.get(filename)), `${filename} differs between two runs`);
    }
    console.log(`${first.artifacts.size} files are byte-identical across two jobs`);
  }
  console.log(`wrote ${first.artifacts.size} files to ${output}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await server.close();
}
