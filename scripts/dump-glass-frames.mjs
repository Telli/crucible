// Writes the native frames of the glass scene of tests/native-job-materials.test.js (#1918) as raw float32 files plus a summary,
// so the same frames from two adapters (a real GPU, lavapipe in CI) can be compared pixel by pixel.
// Usage: node scripts/dump-glass-frames.mjs <output directory>
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCamera } from '../src/path-tracer.js';
import * as pack from '../src/path-tracer-gpu-pack.js';
import { buildTraceScene } from '../src/path-tracer-scene.js';
import { cookModule } from '../tests/support/cook.js';

const WIDTH = 24;
const HEIGHT = 16;
const camera = createCamera({ eye: [0, 0, 8], target: [0, 0, 0], fov: 50 }, WIDTH, HEIGHT);
const packOptions = { width: WIDTH, height: HEIGHT, samples: 16, bounces: 4, seed: 7, fireflyClamp: 20, noiseThreshold: 0 };
const environment = { keyColor: [3, 3, 3], lightDirection: [0.4, 0.8, 0.5] };

function quad(scale) {
  return {
    positions: Float32Array.from([-scale, -scale, 0, scale, -scale, 0, scale, scale, 0, -scale, scale, 0]),
    normals: Float32Array.from([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
    uvs: Float32Array.from([0, 0, 1, 0, 1, 1, 0, 1]),
    indices: Uint32Array.from([0, 1, 2, 0, 2, 3]),
  };
}

const translate = x => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 0, 0, 1];
const part = (name, x, material) => ({ name, geometry: quad(0.8), matrix: translate(x), material });

const glass = part('glass', 0, { color: [1, 1, 1], transmission: 0.9, ior: 1.45, roughness: 0.05 });
const lacquer = part('lacquer', 0.1, { color: [0.7, 0.1, 0.1], clearcoat: 0.8, clearcoatRoughness: 0.1 });
const wax = part('wax', 0.2, { color: [0.9, 0.8, 0.6], subsurface: { weight: 0.5, radius: [1, 0.4, 0.2] } });
const masked = part('masked', 0.3, { color: [0.5, 0.5, 0.9], lightMask: 1 });
const variants = {
  full: [glass, lacquer, wax, masked],
  glassOnly: [glass],
  opaqueGlass: [part('glass', 0, { color: [1, 1, 1], roughness: 0.05 })],
  noGlass: [lacquer, wax, masked],
};

const outputDirectory = process.argv[2];
if (!outputDirectory) throw new Error('Pass the directory the frames are written to as the first argument.');
mkdirSync(outputDirectory, { recursive: true });
const cook = await cookModule();
if (!cook) throw new Error('Cook (@codepawlhq/cook) is not installed: run npm ci.');
const { buildNativeInput } = await cookModule('pack-input');

function sumOf(values) {
  let total = 0;
  for (const value of values) total += value;
  return total;
}

const summary = {};
for (const [name, parts] of Object.entries(variants)) {
  const traced = cook.traceNative(buildNativeInput(buildTraceScene(parts, environment), camera, packOptions, pack), { width: WIDTH, height: HEIGHT, samples: 8, kernel: 'cycles' });
  summary[name] = {};
  for (const channel of ['rgba', 'albedo', 'normal', 'depth']) {
    const values = traced[channel];
    if (!values) continue;
    writeFileSync(join(outputDirectory, `${name}-${channel}.f32`), Buffer.from(values.buffer, values.byteOffset, values.byteLength));
    summary[name][channel] = { length: values.length, sum: sumOf(values) };
  }
}
writeFileSync(join(outputDirectory, 'summary.json'), JSON.stringify({ width: WIDTH, height: HEIGHT, summary }, null, 2));
console.log(JSON.stringify(summary));
