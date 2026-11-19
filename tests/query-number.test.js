import test from 'node:test';
import assert from 'node:assert/strict';

async function readQueryNumber(...parameters) {
  return (await import('../src/query-number.js')).readQueryNumber(...parameters);
}

test('a numeric query value is read as a number', async () => {
  assert.equal(await readQueryNumber(new URLSearchParams('samples=8'), 'samples', 4, { minimum: 1, integer: true }), 8);
  assert.equal(await readQueryNumber(new URLSearchParams('memory=128.5'), 'memory', 256, { minimum: 1 }), 128.5);
});

test('a missing, empty or non-numeric query value gives the fallback instead of NaN or 0', async () => {
  for (const query of ['', 'samples=', 'samples=%20', 'samples=abc', 'samples=Infinity']) {
    assert.equal(await readQueryNumber(new URLSearchParams(query), 'samples', 4, { minimum: 1, integer: true }), 4, query);
  }
});

test('a value below the minimum or fractional for an integer gives the fallback', async () => {
  assert.equal(await readQueryNumber(new URLSearchParams('samples=0'), 'samples', 4, { minimum: 1, integer: true }), 4);
  assert.equal(await readQueryNumber(new URLSearchParams('samples=2.5'), 'samples', 4, { minimum: 1, integer: true }), 4);
  assert.equal(await readQueryNumber(new URLSearchParams('memory=-8'), 'memory', 256, { minimum: 1 }), 256);
});
