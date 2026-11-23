import test from 'node:test';
import assert from 'node:assert/strict';
import { blockMedians, median, rotatedOrder, summarize, summarizeAfterWarmup, summarizeRounds } from '../bench/glaze-passes/frame-statistics.mjs';

test('median takes the middle value of an unsorted list and refuses an empty one', () => {
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(median([4, 1, 3, 2]), 3);
  assert.throws(() => median([]), /at least one value/);
});

test('summarize reports median, range and count', () => {
  assert.deepEqual(summarize([4.8, 4.7, 17.5, 4.81]), { median: 4.81, min: 4.7, max: 17.5, count: 4 });
});

test('summarizeAfterWarmup ignores the warm-up frames, however slow', () => {
  assert.deepEqual(summarizeAfterWarmup([50, 40, 2, 3, 4], 2), { median: 3, min: 2, max: 4, count: 3 });
});

test('rotatedOrder starts one item later each round and wraps', () => {
  const items = ['a', 'b', 'c'];
  assert.deepEqual(rotatedOrder(items, 0), ['a', 'b', 'c']);
  assert.deepEqual(rotatedOrder(items, 1), ['b', 'c', 'a']);
  assert.deepEqual(rotatedOrder(items, 4), ['b', 'c', 'a']);
  assert.deepEqual(items, ['a', 'b', 'c']);
});

test('blockMedians exposes a slow start and drops a partial last block', () => {
  assert.deepEqual(blockMedians([9, 9, 9, 2, 2, 2, 7], 3), [9, 2]);
});

test('summarizeRounds keeps one disturbed round from moving the median', () => {
  assert.deepEqual(summarizeRounds([4.75, 4.81, 17.5, 4.81]), { median: 4.81, min: 4.75, max: 17.5, rounds: 4 });
});
