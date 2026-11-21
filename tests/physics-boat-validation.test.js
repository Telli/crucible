import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBoat, resolveBoat, setBoatControls } from '../src/physics-boat.js';
import { normalizeFloat } from '../src/physics-buoyancy.js';

function liveBoat() {
  return resolveBoat(normalizeBoat({}, 'boat'), [-1, -1, -1], [1, 1, 1]);
}

test('a rejected setBoatControls call leaves the live controls unchanged', () => {
  const boat = liveBoat();
  setBoatControls(boat, { throttle: 0.5, rudder: -0.5 });
  assert.throws(() => setBoatControls(boat, { throttle: 1, rudder: 9 }), /setBoatControls rudder must be a number from -1 to 1/);
  assert.deepEqual(boat.live, { throttle: 0.5, rudder: -0.5, set: true });
  const fresh = liveBoat();
  assert.throws(() => setBoatControls(fresh, { throttle: 1, rudder: 9 }), RangeError);
  assert.equal(fresh.live.set, false, 'keyframes keep driving the boat after a rejected call');
  assert.equal(fresh.live.throttle, 0);
});

test('setBoatControls names what to pass when there are no controls', () => {
  const boat = liveBoat();
  assert.throws(() => setBoatControls(boat), /setBoatControls needs controls like \{ throttle: 1, rudder: 0 \}/);
  assert.throws(() => setBoatControls(boat, null, 'setBoatControls("boat")'), /setBoatControls\("boat"\) needs controls/);
});

test('sparse arrays fail with the index instead of becoming null or crashing later', () => {
  assert.throws(() => normalizeFloat({ points: [[0, , 0]] }, 'float'), /float\.points\[0\]\[1\] must be a number/);
  assert.throws(() => normalizeBoat({ controls: new Array(2) }, 'boat'), /boat\.controls\[0\] must be an object/);
  assert.throws(() => normalizeBoat({ stern: [0, , 1] }, 'boat'), /boat\.stern\[1\] must be a number/);
});

test('boat.forward must be one of the axis strings', () => {
  assert.throws(() => normalizeBoat({ forward: ['+x'] }, 'boat'), /boat\.forward must be one of \+x, -x, \+z, -z, got \+x/);
  assert.throws(() => normalizeBoat({ forward: { toString: () => '-z' } }, 'boat'), /boat\.forward must be one of/);
  assert.equal(normalizeBoat({ forward: '+x' }, 'boat').forward, '+x');
});
