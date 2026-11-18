import test from 'node:test';
import assert from 'node:assert/strict';
import { groundPart } from '../src/renderer.js';
import { createFragmentShader } from '../src/shaders.js';

const FLOOR_TONE_LINE = /floorColor = clamp\(floorColor \* color \/ vec3\(([^)]*)\), 0\.0, 1\.0\);/;
// The floor tone main shipped before the floor colour scaled it: near the origin and far away.
const MAIN_NEAR_TONE = [0.17, 0.19, 0.205];
const MAIN_FAR_TONE = [0.145, 0.162, 0.177];

function parseVector(text) {
  return text.split(',').map((component) => Number(component.trim()));
}

function floorToneAfterLine(tone, color, divisor) {
  return tone.map((channel, index) => Math.min(1, Math.max(0, Math.fround(Math.fround(Math.fround(channel) * Math.fround(color[index])) / Math.fround(divisor[index])))));
}

test('the default studio floor keeps main\'s tone: the floor shader divides by exactly the default floor colour', () => {
  const source = createFragmentShader();
  const match = source.match(FLOOR_TONE_LINE);
  assert.ok(match, 'the floor tone line is missing from the fragment shader; update this test with it');
  const divisor = parseVector(match[1]);
  const defaultColor = groundPart().material.color;
  assert.deepEqual(divisor, defaultColor, 'the shader divisor must equal the default studio floor colour, or the default floor changes tone');
  for (const tone of [MAIN_NEAR_TONE, MAIN_FAR_TONE]) {
    const scaled = floorToneAfterLine(tone, defaultColor, divisor);
    scaled.forEach((channel, index) => {
      assert.ok(Math.abs(channel - Math.fround(tone[index])) <= 2 ** -23, `channel ${index} moved from ${tone[index]} to ${channel}`);
    });
  }
});

test('the floor tone constants of main stay in the shader, so the default floor cannot drift', () => {
  const source = createFragmentShader();
  assert.ok(source.includes('mix(vec3(0.145, 0.162, 0.177), vec3(0.17, 0.19, 0.205), distanceFade)'));
  assert.ok(source.includes('floorColor * (0.72 + 0.28 * visibility) * contact'));
});

test('a lighter floor colour lifts the tone and a darker one lowers it', () => {
  const divisor = groundPart().material.color;
  const lifted = floorToneAfterLine(MAIN_NEAR_TONE, [0.08, 0.1, 0.12], divisor);
  const lowered = floorToneAfterLine(MAIN_NEAR_TONE, [0.02, 0.025, 0.03], divisor);
  lifted.forEach((channel, index) => assert.ok(channel > MAIN_NEAR_TONE[index]));
  lowered.forEach((channel, index) => assert.ok(channel < MAIN_NEAR_TONE[index]));
});
