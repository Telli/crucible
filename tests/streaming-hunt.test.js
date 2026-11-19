// Bug hunt over streaming and tile fields: a loader that answers nothing, a load that cannot fit, and an area that holds no tiles.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createStreaming } from '../src/streaming.js';
import { createTileField } from '../src/tile-field.js';

function tileDefinition(id, x, overrides = {}) {
  return { id, format: 'tile', source: `${id}.bin`, position: [x, 0, 0], loadDistance: 15, estimatedBytes: 100, ...overrides };
}

function countingLoader(bytes = 100) {
  const disposed = [];
  return {
    disposed,
    async load({ id }) {
      return { asset: { id }, bytes };
    },
    dispose(asset) {
      disposed.push(asset.id);
    },
  };
}

test('a loader that resolves with nothing fails the asset instead of leaving it pending', async () => {
  const unhandled = [];
  const record = reason => unhandled.push(reason);
  process.on('unhandledRejection', record);
  try {
    const streaming = createStreaming({ budgetBytes: 1000, loaders: { tile: { load: async () => undefined } } });
    streaming.addAsset(tileDefinition('a', 0));
    streaming.setFocus([0, 0, 0]);
    streaming.update();
    await streaming.settled();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(unhandled, []);
    assert.equal(streaming.getState('a').state, 'failed');
    assert.match(streaming.getState('a').failure, /asset/);
    assert.equal(streaming.stats.bytesInUse, 0);
  } finally {
    process.off('unhandledRejection', record);
  }
});

test('an asset too large for the budget leaves the resident assets in place', async () => {
  const loader = countingLoader();
  const streaming = createStreaming({ budgetBytes: 250, loaders: { tile: loader } });
  streaming.addAsset(tileDefinition('small', 0));
  streaming.addAsset(tileDefinition('huge', 100, { estimatedBytes: 400 }));
  streaming.setFocus([0, 0, 0]);
  streaming.update();
  await streaming.settled();
  assert.equal(streaming.getState('small').state, 'loaded');

  streaming.setFocus([100, 0, 0]);
  streaming.update();
  await streaming.settled();
  assert.deepEqual(loader.disposed, [], 'nothing was freed for a load that can never fit');
  assert.equal(streaming.getState('small').state, 'loaded');
  assert.equal(streaming.getState('huge').state, 'idle');
});

test('a tile field over an area with no tiles throws and says what to pass', () => {
  const options = { levels: [{ distance: 10 }], cullDistance: 10, terrainHeight: () => 0, buildParts: () => [] };
  const area = { minX: 0, maxX: 100, minZ: 0, maxZ: 100 };
  const rejected = [
    { area: { ...area, maxX: -100 }, tileSize: 10 },
    { area, tileSize: -10 },
    { area, tileSize: 0 },
    { area, tileSize: NaN },
    { area: { ...area, maxZ: 0 }, tileSize: 10 },
  ];
  for (const bad of rejected) {
    assert.throws(() => createTileField({ ...options, ...bad }), /tileSize|area/, JSON.stringify(bad));
  }
  assert.equal(createTileField({ ...options, area, tileSize: 10 }).stats().tiles, 100);
});
