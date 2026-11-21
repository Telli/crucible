import './support/load-agent-scene-modules.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAgentLook } from '../src/agent-look.js';

// #2820: a render job normalizes the snapshot of the scene again, and the snapshot of a gradient sky already holds its
// skyTop, skyBottom and fogColor as radiance, which is above 1 for a bright stop.
const BRIGHT_SKY = { type: 'gradient', stops: [{ at: 0, color: '#d8f3f7' }, { at: 1, color: '#2a6fd0' }] };

test('a gradient sky with a bright stop normalizes again from its own snapshot', () => {
  const first = normalizeAgentLook({ environment: { sky: BRIGHT_SKY } }).environment;
  assert.ok(first.skyBottom.some(channel => channel > 1), 'the stop must be brighter than 1 for this test to mean anything');
  const second = normalizeAgentLook({ environment: first }).environment;
  assert.deepEqual(second.skyBottom, first.skyBottom);
  assert.deepEqual(second.skyTop, first.skyTop);
  assert.deepEqual(second.fogColor, first.fogColor);
});

test('a sky colour above the radiance ceiling still says what to pass', () => {
  assert.throws(
    () => normalizeAgentLook({ environment: { skyBottom: [0.5, 1001, 0.5] } }),
    /environment\.skyBottom\[1\].*a number from 0 to 1000/,
  );
});
