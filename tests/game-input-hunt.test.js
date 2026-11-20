import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameRules } from '../src/game-rules.js';
import { createInput } from '../src/input.js';

const STEP = 1 / 60;

function countTimerFirings(seconds, repeat, steps) {
  const rules = createGameRules({
    version: 1,
    variables: { fired: 0 },
    rules: [{ when: { type: 'timer', seconds, repeat }, do: [{ type: 'add', variable: 'fired', value: 1 }] }],
  });
  for (let step = 0; step < steps; step++) rules.fixedUpdate(STEP);
  return rules.state.variables.fired;
}

test('a one-shot timer shorter than a nanosecond fires once on the first step', () => {
  assert.equal(countTimerFirings(1e-10, false, 10), 1);
});

test('one-shot timers fire once, on the step that reaches their time', () => {
  assert.equal(countTimerFirings(0.05, false, 10), 1);
  assert.equal(countTimerFirings(1, false, 59), 0);
  assert.equal(countTimerFirings(1, false, 60), 1);
  assert.equal(countTimerFirings(1, false, 600), 1);
});

test('unbindAction and unbindAxis drop the last sample at once', () => {
  const input = createInput();
  input.bindAction('jump', ['keyboard/Space']).bindAxis('move', ['keyboard/KeyD']);
  input.press('keyboard/Space');
  input.press('keyboard/KeyD');
  input.sample();
  assert.equal(input.wasPressed('jump'), true);
  assert.equal(input.getAxis('move'), 1);
  input.unbindAction('jump');
  input.unbindAxis('move');
  assert.throws(() => input.wasPressed('jump'), /No action named "jump"/);
  assert.throws(() => input.getAxis('move'), /No axis named "move"/);
});

test('bindAxis refuses a misspelled field and names the fields to use', () => {
  const input = createInput();
  assert.throws(
    () => input.bindAxis('move', { bindings: ['keyboard/KeyD'], deadzone: 0.5 }),
    /Axis "move" has the unknown field "deadzone"\. Use one of: bindings, deadZone, smoothing\./,
  );
  assert.throws(() => createInput({ axes: { look: { bindings: ['mouse/x'], smoothness: 0.5 } } }), /unknown field "smoothness"/);
  input.bindAxis('move', { bindings: ['keyboard/KeyD'], deadZone: 0.5, smoothing: 0 });
});
