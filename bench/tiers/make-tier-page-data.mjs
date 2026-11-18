// Turns the results file of the tier matrix into the figures of the site page /tiers.html, for one scene.
//   node bench/tiers/make-tier-page-data.mjs [results.json] [--scene lit-interior] [--out file.json]
// Defaults: bench/tiers/results/matrix-960.json, lit-interior, bench/tiers/results/tier-page-<scene>.json.
// Every figure is the median of the runs that were not contended, with the lowest and highest beside it. Nothing on the page is typed by
// hand: tests/tier-page-data.test.js runs this on the committed matrix and fails when the committed page data differs.
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { median } from './idle-gate.mjs';

export const TIER_PAGE_SCHEMA = 'crucible.tier-page/1';
export const DEFAULT_SCENE = 'lit-interior';
const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_RESULTS_PATH = resolve(HERE, 'results', 'matrix-960.json');
const COOK_SAMPLES = 256;

// What each tier runs and what sits beside it in Blender. Time is a frame for the real-time tiers and a whole picture for final.
const TIER_PLAN = [
  { id: 'draft', crucible: { engine: 'glaze-draft', label: 'Glaze draft', timeMeans: 'a frame, draw and pixel read' }, blender: { engine: 'eevee-lowest', label: 'EEVEE, 1 sample', timeMeans: 'a render call' }, timeUnit: 'ms', timeSource: 'primaryMilliseconds', timeScale: 1 },
  { id: 'realtime', crucible: { engine: 'glaze-realtime', label: 'Glaze realtime', timeMeans: 'a frame, draw and pixel read' }, blender: { engine: 'eevee-default', label: 'EEVEE, 64 samples', timeMeans: 'a render call' }, timeUnit: 'ms', timeSource: 'primaryMilliseconds', timeScale: 1 },
  { id: 'realtime-high', planned: true, issues: [901, 902] },
  { id: 'final', crucible: { engine: 'cook-native', label: `Cook native, ${COOK_SAMPLES} samples`, samples: COOK_SAMPLES, timeMeans: 'one picture, setup included' }, blender: { engine: 'cycles', label: `Cycles, ${COOK_SAMPLES} samples`, samples: COOK_SAMPLES, timeMeans: 'one picture, setup included' }, timeUnit: 's', timeSource: 'totalTraceSeconds', timeScale: 1 },
];

function fail(message) {
  throw new Error(`make-tier-page-data: ${message}`);
}

function validateMatrix(matrix) {
  if (!matrix || typeof matrix !== 'object' || !Array.isArray(matrix.cells) || !matrix.conditions || !Array.isArray(matrix.scenes)) {
    fail('the results file needs "cells", "scenes" and "conditions"; pass the matrix-<width>.json that bench/tiers/run-all.mjs writes');
  }
  for (const field of ['card', 'blender', 'node', 'platform', 'date']) {
    if (typeof matrix.conditions[field] !== 'string' || matrix.conditions[field] === '') fail(`conditions.${field} is missing; every figure must name the hardware it was measured on, so rerun with the idle gate or add the field`);
  }
}

function spread(values, digits) {
  const finite = values.filter(value => typeof value === 'number' && Number.isFinite(value));
  if (finite.length === 0) return null;
  return { median: median(finite), low: Math.min(...finite), high: Math.max(...finite), runs: finite.length, digits };
}

function usableCells(matrix, scene, part) {
  const cells = matrix.cells.filter(cell => cell.status === 'ok' && cell.scene === scene && cell.engine === part.engine && (part.samples === undefined || cell.samples === part.samples));
  const usable = cells.filter(cell => !cell.contended);
  if (usable.length === 0) fail(`no usable run of ${part.engine}${part.samples ? ` at ${part.samples} samples` : ''} on scene "${scene}" (${cells.length} found, all contended or failed); rerun that cell on an idle card`);
  return { usable, total: cells.length };
}

function figuresOf(matrix, scene, part, plan) {
  const { usable, total } = usableCells(matrix, scene, part);
  const time = spread(usable.map(cell => cell.metrics?.[plan.timeSource] * plan.timeScale), 2);
  const memory = spread(usable.map(cell => cell.metrics?.cardDeltaMebibytes), 0);
  const quality = spread(usable.map(cell => cell.score?.flip), 3);
  if (!time || !memory || !quality) fail(`${part.engine} on "${scene}" lacks a time, a memory or a FLIP figure; run score-tiers.py matrix on the results first`);
  const unit = plan.timeUnit;
  return { engine: part.engine, label: part.label, runs: usable.length, runsTotal: total, time: { ...time, unit, means: part.timeMeans }, memoryMebibytes: memory, flip: quality };
}

export function buildTierPageData(matrix, { scene = DEFAULT_SCENE } = {}) {
  validateMatrix(matrix);
  if (!matrix.scenes.includes(scene)) fail(`scene "${scene}" is not in the results; pass one of ${matrix.scenes.join(', ')}`);
  const tiers = TIER_PLAN.map(plan => {
    if (plan.planned) return { id: plan.id, status: 'planned', issues: plan.issues };
    return { id: plan.id, status: 'measured', crucible: figuresOf(matrix, scene, plan.crucible, plan), blender: figuresOf(matrix, scene, plan.blender, plan) };
  });
  const { card, blender, node, platform, date } = matrix.conditions;
  return {
    schema: TIER_PAGE_SCHEMA,
    scene,
    source: 'bench/tiers/results/matrix-960.json',
    width: matrix.width,
    height: matrix.height,
    referenceSamples: matrix.referenceSamples,
    conditions: { card, blender, node, platform, date },
    tiers,
  };
}

async function main(argumentsGiven) {
  const valueAfter = flag => (argumentsGiven.includes(flag) ? argumentsGiven[argumentsGiven.indexOf(flag) + 1] : undefined);
  const resultsPath = resolve(argumentsGiven[0] && !argumentsGiven[0].startsWith('--') ? argumentsGiven[0] : DEFAULT_RESULTS_PATH);
  const scene = valueAfter('--scene') ?? DEFAULT_SCENE;
  const outputPath = resolve(valueAfter('--out') ?? resolve(HERE, 'results', `tier-page-${scene}.json`));
  const matrix = JSON.parse(await readFile(resultsPath, 'utf8'));
  const data = buildTierPageData(matrix, { scene });
  await writeFile(outputPath, `${JSON.stringify(data, null, 2)}\n`);
  console.log(`wrote ${outputPath}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main(process.argv.slice(2));
