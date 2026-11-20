import test from 'node:test';
import assert from 'node:assert/strict';
import { planSceneEviction, sessionProblem, SCENE_STORE_LIMITS } from '../src/agent-errors.js';

const MIB = 1024 * 1024;

function scenes(sizesInMiB) {
  return sizesInMiB.map((size, index) => ({ sessionId: `scene-${index}`, bytes: size * MIB }));
}

test('small scenes stay open up to the scene cap and nothing is closed', () => {
  const plan = planSceneEviction(scenes([1, 1, 1]), MIB);
  assert.deepEqual(plan.sessionIds, []);
  assert.equal(plan.reason, null);
});

test('a fifth scene closes only the least recently used one and names the scene cap', () => {
  const plan = planSceneEviction(scenes([1, 1, 1, 1]), MIB);
  assert.deepEqual(plan.sessionIds, ['scene-0']);
  assert.match(plan.reason, /because the server keeps at most 4 open scenes$/);
});

test('large scenes close for the memory cap and the reason gives the numbers', () => {
  const plan = planSceneEviction(scenes([40, 40]), 30 * MIB);
  assert.deepEqual(plan.sessionIds, ['scene-0']);
  assert.match(plan.reason, /110\.0 MiB of resident geometry, over the 96\.0 MiB cap \(the new scene alone is 30\.0 MiB\)/);
  assert.doesNotMatch(plan.reason, /at most 4 open scenes/);
});

test('scenes close oldest first until the memory cap holds and both caps can apply together', () => {
  const plan = planSceneEviction(scenes([10, 50, 10, 10]), 40 * MIB);
  assert.deepEqual(plan.sessionIds, ['scene-0', 'scene-1']);
  assert.match(plan.reason, /scenes because the server keeps at most 4 open scenes and the open scenes/);
});

test('the default limits are the documented four scenes and 96 MiB', () => {
  assert.equal(SCENE_STORE_LIMITS.maxOpenScenes, 4);
  assert.equal(SCENE_STORE_LIMITS.maxOpenSceneBytes, 96 * MIB);
});

test('a later call with an evicted ID repeats the reason it was closed for', () => {
  const reason = 'closed the least recently used scene because the server keeps at most 4 open scenes';
  const message = sessionProblem('old', 'b', { openSessionIds: ['a', 'b'], evictedSessionIds: ['old'], evictionReasons: { old: reason } });
  assert.match(message, /sessionId old was evicted: closed the least recently used scene because the server keeps at most 4 open scenes\./);
  const withoutReason = sessionProblem('old', 'b', { openSessionIds: ['a', 'b'], evictedSessionIds: ['old'] });
  assert.match(withoutReason, /sessionId old was evicted: the server keeps a limited number/);
});
