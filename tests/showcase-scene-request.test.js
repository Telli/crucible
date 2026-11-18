import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveRequestedScene } from '../src/showcase-scene-request.js';

const sceneIds = ['airport', 'datacenter', 'port'];

test('a known scene opens with no notice', () => {
  assert.deepEqual(resolveRequestedScene('port', sceneIds), { id: 'port', notice: null });
});

test('no query and an empty query open the first scene with no notice', () => {
  assert.deepEqual(resolveRequestedScene(null, sceneIds), { id: 'airport', notice: null });
  assert.deepEqual(resolveRequestedScene('', sceneIds), { id: 'airport', notice: null });
});

test('an unknown scene opens the first scene and the notice names the request and every valid scene', () => {
  const { id, notice } = resolveRequestedScene('datacentre', sceneIds);
  assert.equal(id, 'airport');
  assert.match(notice, /"datacentre"/);
  for (const sceneId of sceneIds) assert.ok(notice.includes(sceneId), `notice lists ${sceneId}`);
});

test('the notice follows the scene list it is given', () => {
  assert.match(resolveRequestedScene('x', ['alpha', 'beta']).notice, /alpha, beta/);
});

test('an empty scene list is refused with what to pass', () => {
  assert.throws(() => resolveRequestedScene('x', []), /non-empty list of scene ids/);
});
