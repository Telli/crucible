import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { bakeMaterialGraph, compileMaterialGraph, graphSurfaceSettings, surfaceMapKey } from '../src/material-graph.js';

const SLOPE = { surface: { output: 'slope' } };
const MASK = { smoothstep: [0.2, 0.6, { add: [{ noise: { scale: 6, seed: 1, octaves: 3 } }, { mul: [{ uv: 'u' }, 0.3] }] }] };
const MASK_WITH_SLOPE = { smoothstep: [0.2, 0.6, { add: [{ invert: SLOPE }, { mul: [{ noise: { scale: 6, seed: 1, octaves: 3 } }, 0.3] }] }] };

const gatedByMask = mask => ({
  color: { layer: { base: [0.1, 0.1, 0.1], top: [0.9, 0.9, 1], mask, edge: 0.5, softness: 0.1 } },
  roughness: { mix: [0.95, 0.3, mask] },
  height: { mul: [mask, { noise: { scale: 10, octaves: 2 } }] },
});
const costOf = graph => compileMaterialGraph(graph).cost;

test('a mask used by colour, roughness and bump is costed once', () => {
  const full = gatedByMask(MASK);
  const separate = ['color', 'roughness', 'height'].map(output => costOf({ [output]: full[output] }));
  const maskCost = costOf({ height: MASK });
  assert.equal(costOf(full), separate.reduce((sum, cost) => sum + cost, 0) - 2 * maskCost);
});

test('a shared mask counts once toward the node limit', () => {
  const crowdedMask = { smoothstep: [0.2, 0.6, { add: [{ noise: { scale: 6 } }, { noise: { scale: 9 } }] }] };
  const outputs = {};
  for (const name of ['color', 'roughness', 'metallic', 'height', 'opacity']) outputs[name] = { mix: [0.1, 0.9, { mul: [crowdedMask, { add: [crowdedMask, 1] }] }] };
  const compiled = compileMaterialGraph(outputs);
  assert.ok(compiled.nodeCount < 30, `${compiled.nodeCount} nodes`);
});

test('every output reads one evaluation of a shared mask per texel', () => {
  let reads = 0;
  const data = new Proxy(new Uint8ClampedArray(4 * 4 * 4).fill(120), {
    get(target, key) {
      if (typeof key === 'string' && /^\d+$/.test(key)) reads++;
      return target[key];
    },
  });
  const countReads = graph => {
    reads = 0;
    const groups = new Map(graphSurfaceSettings(graph).map(settings => [surfaceMapKey(settings), { width: 4, height: 4, data }]));
    bakeMaterialGraph(graph, { resolution: 8, bump: 1 }, undefined, groups);
    return reads;
  };
  const once = countReads({ roughness: { mix: [0.9, 0.3, MASK_WITH_SLOPE] } });
  const threeOutputs = countReads({ color: { mix: [[0.1, 0.1, 0.1], [0.9, 0.9, 1], MASK_WITH_SLOPE] }, roughness: { mix: [0.9, 0.3, MASK_WITH_SLOPE] }, metallic: MASK_WITH_SLOPE });
  assert.ok(once > 0);
  assert.equal(threeOutputs, once);
});

test('the cost of a noise follows its octaves', () => {
  const costWith = octaves => costOf({ height: { noise: { scale: 6, octaves } } });
  assert.equal(costWith(4) - costWith(1), 9);
  assert.equal(costWith(6) - costWith(2), 12);
});

test('a graph nested past the depth limit still fails with the nesting error', () => {
  let graph = 0.5;
  for (let level = 0; level < 600; level++) graph = { abs: graph };
  assert.throws(() => compileMaterialGraph({ height: graph }), /nesting deeper/);
});

// Sixteen hex digits of the SHA-256 of every baked map. The values were taken from main before sharing existed (#3147),
// so a graph that shares a subgraph must still bake the same bytes.
const GOLDEN_GRAPHS = {
  gatedSnow: [gatedByMask(MASK), '29140dd066ef9f52'],
  vectorShared: [{
    color: { mix: [{ vec: [MASK, 0.2, 0.1] }, { vec: [0.1, MASK, 0.4] }, MASK] },
    aov: { vec: [MASK, MASK, 0.5] },
    metallic: { sub: [1, MASK] },
  }, 'f9ef1a40e974e162'],
  negativeZero: [{ roughness: { add: [{ add: [{ div: [1, 0] }, { div: [1, -0] }] }, { noise: { scale: 3 } }] } }, '353de6593f380c11'],
};

function bakedDigest(graph) {
  const maps = bakeMaterialGraph(graph, { resolution: 64, bump: 3 });
  const hash = createHash('sha256');
  for (const descriptor of [maps.map, maps.metallicRoughnessMap, maps.layerMaps?.clearcoatTexture, maps.aovMap, maps.normalMap]) {
    hash.update(descriptor ? Buffer.from(descriptor.image.data) : 'none');
  }
  return hash.digest('hex').slice(0, 16);
}

for (const [name, [graph, digest]] of Object.entries(GOLDEN_GRAPHS)) {
  test(`${name} bakes the same bytes as before subgraphs were shared`, () => {
    assert.equal(bakedDigest(graph), digest);
  });
}
