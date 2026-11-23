import test from 'node:test';
import assert from 'node:assert/strict';
import { wetnessUniformValues } from '../src/wetness.js';
import { measurePuddleShare } from './support/wetness-noise-port.mjs';

// The fill level the renderer uploads (the second wetness uniform) is run through a JavaScript port of the shader's noise basin,
// so the share of ground under water is counted without a GPU. It must be a quarter of the ground at most, whatever the settings.
const CAP = 0.25;
const wantedShare = (wetness, coverage) => CAP * coverage * wetness * wetness;

test('the uploaded fill level floods the share of the ground the settings ask for, never above the cap', () => {
  for (const [wetness, coverage] of [[0.5, 0.5], [1, 0.5], [1, 1]]) {
    const fillLevel = wetnessUniformValues({ wetness, puddles: { coverage } })[1];
    const measured = measurePuddleShare(fillLevel);
    const wanted = wantedShare(wetness, coverage);
    assert.ok(Math.abs(measured - wanted) <= 0.015, `wetness ${wetness} coverage ${coverage}: wanted ${wanted}, measured ${measured}`);
    assert.ok(measured <= 0.27, 'puddles never flood more than a quarter of the ground');
  }
});

test('puddles fill the same low spots on ground at any height', () => {
  const fillLevel = wetnessUniformValues({ wetness: 1, puddles: { coverage: 1 } })[1];
  const groundAtZero = measurePuddleShare(fillLevel, { size: 60, groundHeight: 0 });
  assert.ok(groundAtZero > 0.2, 'a quarter of the ground holds water at the cap');
  for (const groundHeight of [3, -2]) {
    const share = measurePuddleShare(fillLevel, { size: 60, groundHeight });
    assert.ok(Math.abs(share - groundAtZero) < 0.005, `ground at y ${groundHeight}`);
  }
});
