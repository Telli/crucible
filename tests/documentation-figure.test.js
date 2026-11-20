import test from 'node:test';
import assert from 'node:assert/strict';
import { figureMatch } from '../src/documentation-figure.js';

test('only a well-formed image paragraph is a documentation figure', () => {
  assert.deepEqual(figureMatch('![a](still.webp)')?.slice(1, 3), ['a', 'still.webp']);
  assert.equal(figureMatch('![a](b c.png)'), null);
  assert.equal(figureMatch('![a](b.png) trailing'), null);
  assert.equal(figureMatch(null), null);
});
