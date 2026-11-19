import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeClipLayers } from '../src/agent-clip-layers.js';

const context = {
  clips: [{ duration: 2, targets: new Set(['Hips']) }],
  nodes: [{ id: 'node-0', name: 'Hips' }, { id: 'node-1', name: 'Spine' }],
  hierarchy: [],
  external: new Map(),
};

test('a mask that excludes every one of its joints is refused, since the layer would move nothing', () => {
  assert.throws(
    () => normalizeClipLayers([{ clip: 0, mask: { joints: ['Hips'], exclude: ['node-0'] } }], context),
    /motion\.layers\[0\]\.mask\.exclude.*leaves at least one of the mask joints in/,
  );
  assert.throws(
    () => normalizeClipLayers([{ clip: 0, mask: { joints: ['Hips', 'Spine'], exclude: ['Spine', 'Hips'], descendants: false } }], context),
    /mask\.exclude/,
  );
});

test('a mask that excludes only some joints, or other nodes, still loads', () => {
  const layers = normalizeClipLayers([{ clip: 0, mask: { joints: ['Hips', 'Spine'], exclude: ['Spine'] } }], context);
  assert.deepEqual(layers[0].mask, { joints: ['Hips', 'Spine'], exclude: ['Spine'] });
  assert.doesNotThrow(() => normalizeClipLayers([{ clip: 0, mask: { joints: ['Hips'], exclude: ['Spine'] } }], context));
});
