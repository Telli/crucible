// Child process of tests/kernel-batch.test.js: builds a room of baked pattern materials cold (nothing cached by an
// earlier build) and prints a digest of its textures with how the kernels ran, as JSON.
// Argument: inline, one-by-one (one kernel per build pass, as before batching) or batched (all kernels of a pass at once).
import { loadAllAgentSceneModules, createAgentScene } from '../../src/agent-scene.js';
import { buildWithKernels, forEachDeferring, kernelStats, resetKernelStats } from '../../src/kernel-offload.js';
import { answerKernelRequest } from '../../src/kernel-registry.js';
import { digestOf } from './kernel-offload-fixture.mjs';

const PATTERN_COUNT = 6;

export function patternRoom() {
  const materials = Array.from({ length: PATTERN_COUNT }, (_, index) => ({ id: `pattern-${index}`, pattern: { type: 'noise', resolution: 256, seed: 700 + index } }));
  const nodes = materials.map((material, index) => ({ id: `box-${index}`, geometry: 'box', material: material.id, translation: [index, 0, 0] }));
  // A second part with the first material: its bake must be reused, not run again.
  nodes.push({ id: 'box-again', geometry: 'box', material: 'pattern-0', translation: [0, 2, 0] });
  return { format: 'crucible.scene', schemaVersion: 1, geometries: [{ id: 'box', type: 'box' }], materials, nodes, camera: { eye: [3, 2, 6], target: [3, 0, 0], fov: 50, near: 0.1, far: 30 } };
}

/** Workers that answer like the real one but out of order: the first job each worker gets is the slowest. */
function createStaggeredWorker(log) {
  const worker = {
    jobsAnswered: 0,
    postMessage(message) {
      log.push(message.name);
      const { response } = answerKernelRequest(structuredClone(message));
      const delay = worker.jobsAnswered++ === 0 ? 30 : 0;
      setTimeout(() => worker.onmessage?.({ data: structuredClone(response) }), delay);
    },
    terminate() {},
  };
  return worker;
}

await loadAllAgentSceneModules();
const mode = process.argv[2];
const requestedKernels = [];
let workersStarted = 0;
resetKernelStats();
const touchTextures = parts => {
  if (mode === 'batched') {
    forEachDeferring(parts, part => void part.material.map);
  } else {
    parts.forEach(part => void part.material.map);
  }
};
const scene = mode === 'inline'
  ? createAgentScene(patternRoom())
  : await buildWithKernels(() => {
    const built = createAgentScene(patternRoom());
    touchTextures(built.parts);
    return built;
  }, { createWorker: () => { workersStarted++; return createStaggeredWorker(requestedKernels); }, available: true, maximumWorkers: 3 });
const digest = digestOf(scene.parts.map(part => ['map', 'normalMap', 'metallicRoughnessMap'].map(field => part.material[field])));
console.log(JSON.stringify({ digest, passes: kernelStats().passes, kernelJobs: requestedKernels.length, workersStarted }));
