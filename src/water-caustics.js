// Caustics under water: the moving net of bright lines that the sun draws on a bed through a rippled surface. Games fake
// them with two rotated Voronoi patterns projected from the sun onto everything below the water, warped by a slow pan and
// faded with depth; this does the same in the water's own sun term, so a shadow still blocks them. They are a water material
// field (`caustics`) because the water body (its level and optics) already comes from the largest flat water part.
// The GLSL has no comments, because comments ship to every page.

export const WATER_CAUSTICS_FIELDS = Object.freeze(['scale', 'speed', 'intensity', 'depthFade']);

// scale: metres across one cell of the net. speed: how fast the net drifts and morphs. intensity: extra sun on a net line at the
// surface (0 switches caustics off). depthFade: the net loses exp(-depthFade * depth) of its strength, depth in metres below the surface.
export const WATER_CAUSTICS_RANGES = Object.freeze({
  scale: Object.freeze({ minimum: 0.05, maximum: 50, default: 1.2 }),
  speed: Object.freeze({ minimum: 0, maximum: 10, default: 0.5 }),
  intensity: Object.freeze({ minimum: 0, maximum: 10, default: 2 }),
  depthFade: Object.freeze({ minimum: 0, maximum: 10, default: 0.35 }),
});

/** Resolves a water material's `caustics` field: null (or undefined) means off, an object fills its missing fields with the defaults. */
export function resolveWaterCaustics(value) {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('caustics must be an object such as {"intensity": 2, "scale": 1.2}, or null to switch them off.');
  }
  const unknown = Object.keys(value).filter(field => !WATER_CAUSTICS_FIELDS.includes(field));
  if (unknown.length > 0) {
    throw new RangeError(`caustics has no field ${unknown.join(', ')}; pass ${WATER_CAUSTICS_FIELDS.join(', ')}.`);
  }
  const resolved = {};
  for (const field of WATER_CAUSTICS_FIELDS) {
    const { minimum, maximum, default: fallback } = WATER_CAUSTICS_RANGES[field];
    const given = value[field] ?? fallback;
    if (!Number.isFinite(given) || given < minimum || given > maximum) {
      throw new RangeError(`caustics.${field} must be a number from ${minimum} to ${maximum}, such as ${fallback}.`);
    }
    resolved[field] = given;
  }
  return resolved;
}

/** The four numbers of the `waterCaustics` uniform: scale, speed, intensity and depthFade, all zero when caustics are off. */
export function waterCausticsUniform(caustics) {
  if (!caustics || caustics.intensity <= 0) {
    return [0, 0, 0, 0];
  }
  return [caustics.scale, caustics.speed, caustics.intensity, caustics.depthFade];
}

export const causticsDeclarations = `uniform vec4 waterCaustics;
vec2 causticPoint(vec2 cell, float seconds) {
  vec2 seed = fract(cell * vec2(0.1031, 0.1030));
  seed += dot(seed, seed.yx + 33.33);
  vec2 phase = fract((seed.xx + seed.yx) * seed.yx);
  return 0.5 + 0.42 * sin(seconds + 6.2831853 * phase);
}
float causticEdge(vec2 position, float seconds) {
  vec2 cell = floor(position);
  float nearest = 8.0;
  float second = 8.0;
  for (int row = -1; row <= 1; row++) {
    for (int column = -1; column <= 1; column++) {
      vec2 neighbour = cell + vec2(column, row);
      float gap = distance(position, neighbour + causticPoint(neighbour, seconds));
      second = min(second, max(gap, nearest));
      nearest = min(nearest, gap);
    }
  }
  return 1.0 - smoothstep(0.0, 0.3, second - nearest);
}
float causticNet(vec2 surfacePoint, float seconds) {
  vec2 scaled = surfacePoint / waterCaustics.x;
  float pan = seconds * waterCaustics.y;
  vec2 warp = 0.3 * vec2(sin(scaled.y * 1.7 + pan * 0.9), cos(scaled.x * 1.9 + pan * 1.1));
  vec2 turned = mat2(0.8253, -0.5646, 0.5646, 0.8253) * (scaled * 1.37 + warp) + vec2(7.3, 2.1);
  float first = causticEdge(scaled + warp, pan);
  float other = causticEdge(turned, pan * 0.8 + 3.0);
  return sqrt(first * other);
}
float causticGain(vec3 position, float depth) {
  vec3 sun = normalize(lightDirection);
  vec2 bent = sun.xz / 1.33;
  float vertical = sqrt(max(1.0 - dot(bent, bent), 0.0025));
  vec2 surfacePoint = position.xz + bent / vertical * depth;
  return 1.0 + waterCaustics.z * causticNet(surfacePoint, time) * exp(-waterCaustics.w * depth);
}
`;
