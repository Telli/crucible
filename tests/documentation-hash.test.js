import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDocumentationHash } from '../src/documentation-hash.js';

test('a malformed percent escape in a docs hash clears only that part', () => {
  assert.deepEqual(parseDocumentationHash('#%E0%A4%A'), { topic: '', section: '' });
  assert.deepEqual(parseDocumentationHash('#mesh/edge%ZZ'), { topic: 'mesh', section: '' });
  assert.deepEqual(parseDocumentationHash('#mesh-blend/fog%20bounce'), { topic: 'mesh-blend', section: 'fog bounce' });
});
