import { invalidField } from './field-error.js';

// Crash damage for vehicles. A hit is an impulse (N s). Body parts dent in proportion to it, loose parts come off above a
// threshold, and a driven path can be searched for the moment it meets a wall. Everything here is a pure function of its
// inputs, so the same crash gives the same bytes on every run.

export const MAX_DENT_IMPACTS = 8;
export const MAX_DENT_VERTICES = 4096;
export const DEFAULT_DENT_STIFFNESS = 2000;
export const DEFAULT_DENT_MAX_DEPTH = 0.25;
export const DEFAULT_DENT_RADIUS = 0.4;
export const MAX_DENT_DEPTH_LIMIT = 2;
export const MAX_DETACHABLE_PARTS = 32;

const DENT_FIELDS = ['stiffness', 'maxDepth', 'radius', 'impacts'];
const IMPACT_FIELDS = ['point', 'direction', 'impulse'];
const DEFAULT_SEARCH_STEP_SECONDS = 1 / 60;
const MAX_SEARCH_SAMPLES = 100000;

function requirePlainObject(value, path, example) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) {
    throw invalidField(path, value, `a plain object, such as ${example}`, TypeError);
  }
}

function rejectUnknownFields(value, allowed, path) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      throw invalidField(`${path}.${key}`, value[key], `no such field; use one of ${allowed.join(', ')}`, TypeError);
    }
  }
}

function requireNumber(value, path, minimum, maximum, example) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw invalidField(path, value, `a number from ${minimum} to ${maximum}, such as ${example}`);
  }
  return value;
}

function requireVector3(value, path, example) {
  if (!Array.isArray(value) || value.length !== 3 || value.some(component => typeof component !== 'number' || !Number.isFinite(component))) {
    throw invalidField(path, value, `three finite numbers, such as ${example}`);
  }
  return value;
}

function normalized(vector) {
  const length = Math.hypot(...vector);
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

/**
 * Check a dent definition: `{ impacts: [{ point, direction, impulse }], stiffness, maxDepth, radius }`.
 * Returns the definition with its defaults filled in and every direction as a unit vector.
 */
export function normalizeDent(definition, path = 'dent') {
  const field = name => (path ? `${path}.${name}` : name);
  requirePlainObject(definition, path || 'dented geometry', '{ "impacts": [{ "point": [0, 0.5, 2], "direction": [0, 0, -1], "impulse": 3000 }] }');
  rejectUnknownFields(definition, DENT_FIELDS, path);
  const stiffness = requireNumber(definition.stiffness ?? DEFAULT_DENT_STIFFNESS, field('stiffness'), 1e-6, 1e9, DEFAULT_DENT_STIFFNESS);
  const maxDepth = requireNumber(definition.maxDepth ?? DEFAULT_DENT_MAX_DEPTH, field('maxDepth'), 1e-6, MAX_DENT_DEPTH_LIMIT, DEFAULT_DENT_MAX_DEPTH);
  const radius = requireNumber(definition.radius ?? DEFAULT_DENT_RADIUS, field('radius'), 1e-6, 100, DEFAULT_DENT_RADIUS);
  const impacts = definition.impacts;
  if (!Array.isArray(impacts) || impacts.length < 1 || impacts.length > MAX_DENT_IMPACTS) {
    throw invalidField(field('impacts'), impacts, `a list of 1 to ${MAX_DENT_IMPACTS} impacts, such as [{ "point": [0, 0.5, 2], "direction": [0, 0, -1], "impulse": 3000 }]`);
  }
  const checkedImpacts = impacts.map((impact, index) => {
    const impactPath = `${field('impacts')}[${index}]`;
    requirePlainObject(impact, impactPath, '{ "point": [0, 0.5, 2], "direction": [0, 0, -1], "impulse": 3000 }');
    rejectUnknownFields(impact, IMPACT_FIELDS, impactPath);
    const point = requireVector3(impact.point, `${impactPath}.point`, '[0, 0.5, 2], a point on the part in its own space');
    const direction = requireVector3(impact.direction, `${impactPath}.direction`, '[0, 0, -1], the way the hit pushes the surface');
    if (Math.hypot(...direction) < 1e-6) {
      throw invalidField(`${impactPath}.direction`, direction, 'a vector that is not zero, such as [0, 0, -1]');
    }
    const impulse = requireNumber(impact.impulse, `${impactPath}.impulse`, 0, 1e9, 3000);
    return { point: [...point], direction: normalized(direction), impulse };
  });
  return { stiffness, maxDepth, radius, impacts: checkedImpacts };
}

/** How far a hit pushes the surface in, in metres: the impulse over the stiffness, never past `maxDepth`. */
export function dentDepth(impulse, { stiffness = DEFAULT_DENT_STIFFNESS, maxDepth = DEFAULT_DENT_MAX_DEPTH } = {}) {
  return Math.min(maxDepth, impulse / stiffness);
}

function nearestVertices(positions, point, radius) {
  const radiusSquared = radius * radius;
  const found = [];
  for (let vertex = 0; vertex < positions.length / 3; vertex++) {
    const dx = positions[vertex * 3] - point[0];
    const dy = positions[vertex * 3 + 1] - point[1];
    const dz = positions[vertex * 3 + 2] - point[2];
    const distanceSquared = dx * dx + dy * dy + dz * dz;
    if (distanceSquared < radiusSquared) found.push({ vertex, distanceSquared });
  }
  found.sort((first, second) => first.distanceSquared - second.distanceSquared || first.vertex - second.vertex);
  return found.slice(0, MAX_DENT_VERTICES);
}

function recomputeNormals(geometry, movedVertices) {
  const { positions, normals, indices } = geometry;
  const sums = new Map();
  const moved = new Set(movedVertices);
  // A face that shares a moved vertex changes shape, so its unmoved corners get new normals too.
  for (let corner = 0; corner < indices.length; corner += 3) {
    const triangle = [indices[corner], indices[corner + 1], indices[corner + 2]];
    if (!triangle.some(vertex => moved.has(vertex))) continue;
    for (const vertex of triangle) sums.set(vertex, [0, 0, 0]);
  }
  for (let corner = 0; corner < indices.length; corner += 3) {
    const triangle = [indices[corner], indices[corner + 1], indices[corner + 2]];
    if (!triangle.some(vertex => sums.has(vertex))) continue;
    const [vertexA, vertexB, vertexC] = triangle.map(vertex => positions.subarray(vertex * 3, vertex * 3 + 3));
    const edgeOne = [vertexB[0] - vertexA[0], vertexB[1] - vertexA[1], vertexB[2] - vertexA[2]];
    const edgeTwo = [vertexC[0] - vertexA[0], vertexC[1] - vertexA[1], vertexC[2] - vertexA[2]];
    const areaNormal = [
      edgeOne[1] * edgeTwo[2] - edgeOne[2] * edgeTwo[1],
      edgeOne[2] * edgeTwo[0] - edgeOne[0] * edgeTwo[2],
      edgeOne[0] * edgeTwo[1] - edgeOne[1] * edgeTwo[0],
    ];
    for (const vertex of triangle) {
      const sum = sums.get(vertex);
      if (!sum) continue;
      sum[0] += areaNormal[0];
      sum[1] += areaNormal[1];
      sum[2] += areaNormal[2];
    }
  }
  for (const [vertex, sum] of sums) {
    const length = Math.hypot(...sum);
    if (length < 1e-12) continue;
    normals[vertex * 3] = sum[0] / length;
    normals[vertex * 3 + 1] = sum[1] / length;
    normals[vertex * 3 + 2] = sum[2] / length;
  }
}

/**
 * A copy of a render geometry (`{ positions, normals, indices, ... }`) with the surface pushed in around each hit.
 * A vertex within `radius` of a hit moves along the hit's direction by `dentDepth(impulse)` times a smooth falloff.
 * At most 4096 vertices move per hit (the nearest), and no vertex ends up more than `maxDepth` from where it started,
 * however many hits land on it. The input geometry is not changed.
 */
export function dentGeometry(geometry, definition) {
  const { stiffness, maxDepth, radius, impacts } = normalizeDent(definition);
  if (!(geometry?.positions instanceof Float32Array) || !(geometry.indices?.length >= 0) || !(geometry.normals instanceof Float32Array)) {
    throw invalidField('geometry', geometry, 'a render geometry with Float32Array positions and normals and an indices list');
  }
  const dented = {};
  for (const [name, value] of Object.entries(geometry)) dented[name] = ArrayBuffer.isView(value) ? value.slice() : value;
  const offsets = new Map();
  for (const impact of impacts) {
    const depth = dentDepth(impact.impulse, { stiffness, maxDepth });
    for (const { vertex, distanceSquared } of nearestVertices(geometry.positions, impact.point, radius)) {
      const falloff = (1 - distanceSquared / (radius * radius)) ** 2;
      const offset = offsets.get(vertex) ?? [0, 0, 0];
      for (let axis = 0; axis < 3; axis++) offset[axis] += impact.direction[axis] * depth * falloff;
      const length = Math.hypot(...offset);
      if (length > maxDepth) for (let axis = 0; axis < 3; axis++) offset[axis] *= maxDepth / length;
      offsets.set(vertex, offset);
    }
  }
  for (const [vertex, offset] of offsets) {
    for (let axis = 0; axis < 3; axis++) dented.positions[vertex * 3 + axis] += offset[axis];
  }
  recomputeNormals(dented, offsets.keys());
  return dented;
}

/** The impulse (N s) a vehicle of `mass` kg takes stopping from `speed` m/s against a fixed wall; a bounce of `restitution` adds to it. */
export function crashImpulse({ mass, speed, restitution = 0 }) {
  requireNumber(mass, 'mass', 1e-6, 1e9, 1400);
  requireNumber(speed, 'speed', 0, 1e4, 12);
  requireNumber(restitution, 'restitution', 0, 1, 0.1);
  return mass * speed * (1 + restitution);
}

/**
 * The ids of the loose parts a hit of `impulse` tears off: those whose `threshold` (N s) it reaches. A part with a
 * higher threshold stays on. `parts` is `[{ id, threshold }]`, at most 32; ids come back in list order.
 */
export function detachedPartIds(parts, impulse) {
  if (!Array.isArray(parts) || parts.length > MAX_DETACHABLE_PARTS) {
    throw invalidField('parts', parts, `a list of at most ${MAX_DETACHABLE_PARTS} loose parts, such as [{ "id": "front-bumper", "threshold": 2500 }]`);
  }
  requireNumber(impulse, 'impulse', 0, 1e9, 3000);
  return parts.filter((part, index) => {
    requirePlainObject(part, `parts[${index}]`, '{ "id": "front-bumper", "threshold": 2500 }');
    if (typeof part.id !== 'string' || part.id === '') throw invalidField(`parts[${index}].id`, part.id, 'the id of a part, such as "front-bumper"', TypeError);
    return impulse >= requireNumber(part.threshold, `parts[${index}].threshold`, 1e-6, 1e9, 2500);
  }).map(part => part.id);
}

function frontPointOf(pose, frontOffset) {
  const travel = pose.direction ?? 1;
  return [
    pose.position[0] + Math.sin(pose.heading) * frontOffset * travel,
    pose.position[1],
    pose.position[2] + Math.cos(pose.heading) * frontOffset * travel,
  ];
}

/**
 * The first moment a drive (from `driveAlongPath`) carries the front of the car into a wall, sampled every 1/60 s.
 * `wall` is `{ point, normal }`: a plane, with `normal` pointing toward the side the car comes from. `frontOffset` is the
 * distance in metres from `pose.position` to the nose. Returns `{ time, speed, impulse, point, direction }`
 * (`point` in the drive's space, `direction` the way the wall pushes the nose in, which is `normal`, ready for a dent impact) or null when the car
 * never reaches the wall.
 */
export function findDriveImpact(drive, wall, { mass, frontOffset = 0, restitution = 0, step = DEFAULT_SEARCH_STEP_SECONDS } = {}) {
  requirePlainObject(wall, 'wall', '{ "point": [0, 0, 10], "normal": [0, 0, -1] }');
  const point = requireVector3(wall.point, 'wall.point', '[0, 0, 10]');
  const rawNormal = requireVector3(wall.normal, 'wall.normal', '[0, 0, -1], pointing toward the car');
  if (Math.hypot(...rawNormal) < 1e-6) {
    throw invalidField('wall.normal', rawNormal, 'a vector that is not zero, such as [0, 0, -1], pointing toward the car');
  }
  const normal = normalized(rawNormal);
  requireNumber(frontOffset, 'frontOffset', -100, 100, 2);
  requireNumber(step, 'step', 1e-4, 10, DEFAULT_SEARCH_STEP_SECONDS);
  if (drive.duration / step > MAX_SEARCH_SAMPLES) {
    throw invalidField('step', step, `a step of at least ${drive.duration / MAX_SEARCH_SAMPLES} s for a ${drive.duration} s drive`);
  }
  for (let time = 0; time <= drive.duration + step; time += step) {
    const pose = drive.sample(Math.min(time, drive.duration));
    const front = frontPointOf(pose, frontOffset);
    const gap = (front[0] - point[0]) * normal[0] + (front[1] - point[1]) * normal[1] + (front[2] - point[2]) * normal[2];
    if (gap > 0) continue;
    const speed = Math.abs(pose.speed);
    return {
      time: pose.time,
      speed,
      impulse: crashImpulse({ mass, speed, restitution }),
      point: front.map((component, axis) => component - normal[axis] * gap),
      direction: normal,
    };
  }
  return null;
}

export const MAX_FLIGHT_SECONDS = 30;
export const MAX_LAUNCH_SPEED = 30;
const FLIGHT_STEP_SECONDS = 1 / 120;
const LAUNCH_IMPULSE_PER_KILOGRAM = 100;
const LAUNCH_UPWARD_SHARE = 0.5;
const SPREAD_SHARE = 0.3;
const MAX_SPIN_RADIANS_PER_SECOND = 12;
const GROUND_FRICTION = 0.6;
const SETTLE_SPEED = 0.2;

function seededUnitSequence(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), state | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function launchVelocityOf(part, hit, nextUnit) {
  const direction = normalized(hit.direction);
  const speed = Math.min(MAX_LAUNCH_SPEED, (hit.impulse - part.threshold) / (part.mass * LAUNCH_IMPULSE_PER_KILOGRAM));
  const spread = () => (nextUnit() * 2 - 1) * SPREAD_SHARE;
  return [
    (direction[0] + spread()) * speed,
    (direction[1] + LAUNCH_UPWARD_SHARE + Math.abs(spread())) * speed,
    (direction[2] + spread()) * speed,
  ];
}

function advanceFlight(state, flight, seconds) {
  const steps = Math.round(seconds / FLIGHT_STEP_SECONDS);
  for (let step = 0; step < steps && !state.settled; step++) {
    state.velocity[1] -= flight.gravity * FLIGHT_STEP_SECONDS;
    for (let axis = 0; axis < 3; axis++) state.position[axis] += state.velocity[axis] * FLIGHT_STEP_SECONDS;
    for (let axis = 0; axis < 3; axis++) state.rotation[axis] += state.spin[axis] * FLIGHT_STEP_SECONDS;
    if (state.position[1] > flight.groundY) continue;
    state.position[1] = flight.groundY;
    state.velocity[1] = -state.velocity[1] * flight.restitution;
    state.velocity[0] *= GROUND_FRICTION;
    state.velocity[2] *= GROUND_FRICTION;
    for (let axis = 0; axis < 3; axis++) state.spin[axis] *= GROUND_FRICTION;
    if (Math.hypot(...state.velocity) < SETTLE_SPEED) {
      state.velocity.fill(0);
      state.spin.fill(0);
      state.settled = true;
    }
  }
}

/**
 * The flight of a loose part a hit tears off. `part` is `{ id, threshold, mass, position }` (N s, kg, the part's centre in
 * metres); `hit` is `{ impulse, direction }` from `findDriveImpact`. Returns null when the impulse stays below the
 * threshold, so the part stays on. Otherwise it returns `{ id, launchVelocity, sample(time) }`: the part leaves along
 * `direction` with a seeded sideways spread and tumble, falls under gravity and bounces on the ground plane `groundY`.
 * `sample(time)` gives `{ position, rotation (Euler radians), velocity, settled }` for 0 to 30 s, and the same inputs
 * with the same `seed` give the same numbers on every run.
 */
export function detachedPartFlight(part, hit, { seed = 0, gravity = 9.81, groundY = 0, restitution = 0.3 } = {}) {
  requirePlainObject(part, 'part', '{ "id": "front-bumper", "threshold": 9000, "mass": 12, "position": [0, 0.5, 2] }');
  if (typeof part.id !== 'string' || part.id === '') throw invalidField('part.id', part.id, 'the id of a part, such as "front-bumper"', TypeError);
  requireNumber(part.threshold, 'part.threshold', 1e-6, 1e9, 9000);
  requireNumber(part.mass, 'part.mass', 1e-3, 1e5, 12);
  requireVector3(part.position, 'part.position', '[0, 0.5, 2]');
  requirePlainObject(hit, 'hit', '{ "impulse": 16800, "direction": [0, 0, -1] }');
  requireNumber(hit.impulse, 'hit.impulse', 0, 1e9, 16800);
  const rawDirection = requireVector3(hit.direction, 'hit.direction', '[0, 0, -1]');
  if (Math.hypot(...rawDirection) < 1e-6) throw invalidField('hit.direction', rawDirection, 'a vector that is not zero, such as [0, 0, -1]');
  requireNumber(seed, 'seed', 0, 4294967295, 7);
  requireNumber(gravity, 'gravity', 0, 100, 9.81);
  requireNumber(groundY, 'groundY', -1e4, 1e4, 0);
  requireNumber(restitution, 'restitution', 0, 1, 0.3);
  if (hit.impulse < part.threshold) return null;
  const nextUnit = seededUnitSequence(seed);
  const launchVelocity = launchVelocityOf(part, hit, nextUnit);
  const spin = [0, 1, 2].map(() => (nextUnit() * 2 - 1) * MAX_SPIN_RADIANS_PER_SECOND);
  const flight = { gravity, groundY, restitution };
  return {
    id: part.id,
    launchVelocity,
    sample(time) {
      requireNumber(time, 'time', 0, MAX_FLIGHT_SECONDS, 1);
      const state = { position: [...part.position], rotation: [0, 0, 0], velocity: [...launchVelocity], spin: [...spin], settled: false };
      advanceFlight(state, flight, time);
      return { position: state.position, rotation: state.rotation, velocity: state.velocity, settled: state.settled };
    },
  };
}

/**
 * The vertex estimate of a recipe `dented` geometry, which is its source's: checks the dent fields and that the source
 * is a geometry of the recipe that is not itself a fragment or a dent. `estimateSource` estimates a source record.
 */
export function dentedVertexEstimate(value, definitions, estimateSource) {
  const { id, type, source: sourceId, ...dent } = value;
  if (typeof sourceId !== 'string') {
    throw invalidField('source', sourceId, 'the ID of a geometry in geometries, such as "front-bumper"', TypeError);
  }
  normalizeDent(dent, '');
  if (!definitions) return 16;
  const source = definitions.get(sourceId);
  if (!source || source.type === 'fragment' || source.type === 'dented') {
    const reason = source ? 'a geometry that is not itself a fragment or a dent' : `the ID of a geometry in geometries, one of ${[...definitions.keys()].slice(0, 8).join(', ') || 'none yet'}`;
    throw invalidField(`geometries.${id}.source`, sourceId, reason);
  }
  return estimateSource(source);
}
