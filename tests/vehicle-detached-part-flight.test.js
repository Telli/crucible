import test from 'node:test';
import assert from 'node:assert/strict';
import { detachedPartFlight, crashImpulse } from '../src/vehicle.js';

const BUMPER = { id: 'front-bumper', threshold: 9000, mass: 12, position: [0, 0.5, 2] };
const WALL_HIT = { impulse: crashImpulse({ mass: 1400, speed: 12 }), direction: [0, 0, -1], point: [0, 0.5, 2.1] };

test('a part below its threshold stays on, and one above it flies off', () => {
  assert.equal(detachedPartFlight(BUMPER, { impulse: 8999, direction: [0, 0, -1] }), null);
  const flight = detachedPartFlight(BUMPER, WALL_HIT, { seed: 7 });
  assert.equal(flight.id, 'front-bumper');
  const later = flight.sample(0.5);
  assert.ok(Math.abs(later.position[0]) > 1, `moved ${later.position}`);
});

test('the same seed gives the same transform, a different seed another', () => {
  const first = detachedPartFlight(BUMPER, WALL_HIT, { seed: 7 }).sample(1.25);
  const second = detachedPartFlight(BUMPER, WALL_HIT, { seed: 7 }).sample(1.25);
  const other = detachedPartFlight(BUMPER, WALL_HIT, { seed: 8 }).sample(1.25);
  assert.deepEqual(first, second);
  assert.notDeepEqual(first.rotation, other.rotation);
});

test('a harder hit throws the part faster, and it comes to rest on the ground', () => {
  const soft = detachedPartFlight(BUMPER, { impulse: 12000, direction: [0, 0, -1] }, { seed: 1 });
  const hard = detachedPartFlight(BUMPER, { impulse: 30000, direction: [0, 0, -1] }, { seed: 1 });
  assert.ok(Math.hypot(...hard.launchVelocity) > Math.hypot(...soft.launchVelocity));
  const rest = hard.sample(30);
  assert.equal(rest.settled, true);
  assert.equal(rest.position[1], 0);
});

test('bad input says what to pass instead', () => {
  assert.throws(() => detachedPartFlight({ ...BUMPER, mass: 0 }, WALL_HIT), /part\.mass/);
  assert.throws(() => detachedPartFlight(BUMPER, { impulse: 1, direction: [0, 0, 0] }), /hit\.direction/);
  assert.throws(() => detachedPartFlight(BUMPER, WALL_HIT, { restitution: 2 }), /restitution/);
  assert.throws(() => detachedPartFlight(BUMPER, WALL_HIT).sample(31), /time/);
});

test('the part never crosses the wall and rests beside the nose', () => {
  for (const seed of [1, 2, 3, 4]) {
    const flight = detachedPartFlight(BUMPER, WALL_HIT, { seed });
    for (let step = 0; step <= 30 * 60; step++) {
      const position = flight.sample(step / 60).position;
      const behindWall = (position[2] - WALL_HIT.point[2]) * WALL_HIT.direction[2];
      assert.ok(behindWall >= -1e-6, `seed ${seed} step ${step} crossed the wall by ${behindWall}`);
      if (flight.sample(step / 60).settled) break;
    }
    const rest = flight.sample(30);
    assert.equal(rest.settled, true);
    const sidewaysOffset = Math.abs(rest.position[0] - BUMPER.position[0]);
    const reboundDistance = (rest.position[2] - BUMPER.position[2]) * WALL_HIT.direction[2];
    assert.ok(sidewaysOffset > reboundDistance, `seed ${seed} sideways ${sidewaysOffset} rebound ${reboundDistance}`);
    assert.ok(flight.launchVelocity[1] > 0);
  }
});

test('a part thrown at the wall is held on the car side of its plane', () => {
  const towardWall = detachedPartFlight({ ...BUMPER, position: [0, 0.5, 2.09] }, { ...WALL_HIT, direction: [0, 0, -1], point: [0, 0.5, 2.1] }, { seed: 2 });
  assert.ok(towardWall.sample(1).position[2] <= 2.1 + 1e-6);
});
