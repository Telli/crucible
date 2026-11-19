import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePathQuery } from '../src/agent-navigation.js';

const floor = { positions: new Float32Array([-10, 0, -10, 10, 0, -10, 10, 0, 10, -10, 0, 10]), indices: new Uint32Array([0, 2, 1, 0, 3, 2]) };
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const nodeGeometry = () => ({ geometry: floor, worldMatrix: identity });

test('the example in the path error is a query the path check accepts', () => {
  let message = '';
  try {
    resolvePathQuery(null, nodeGeometry, () => null);
  } catch (error) {
    message = error.message;
  }
  const example = JSON.parse(message.match(/such as (\{.*\})\./)[1]);
  assert.doesNotThrow(() => resolvePathQuery(example, nodeGeometry, () => null));
});
