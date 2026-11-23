import { invalidField } from './field-error.js';

// Wet ground from one environment value: `environment.wetness` (0 to 1) darkens porous surfaces and lowers their roughness,
// and `environment.puddles` pools flat water that mirrors the sky. Both are absent by default, and a scene without them
// compiles none of the wetness shader (src/wetness-shader.js). The realtime rasterizer draws it; the path tracers do not.

export const WETNESS_RANGE = Object.freeze([0, 1]);
export const PUDDLE_SOURCES = Object.freeze(['height']);
export const PUDDLE_DEFAULTS = Object.freeze({ coverage: 0.5, from: 'height' });

const PUDDLE_FIELDS = ['coverage', 'from'];

/** Validate `environment.wetness` and return it. */
export function normalizeWetness(value) {
  if (typeof value !== 'number' || !(value >= WETNESS_RANGE[0] && value <= WETNESS_RANGE[1])) {
    throw invalidField('environment.wetness', value, 'a number from 0 (dry) to 1 (soaked), such as 0.5 for damp ground; null clears it', TypeError);
  }
  return value;
}

/** Validate `environment.puddles` and return a frozen copy with the defaults filled in. */
export function normalizePuddles(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidField('environment.puddles', value, 'an object such as {"coverage": 0.5, "from": "height"}; null clears it', TypeError);
  }
  for (const key of Object.keys(value)) {
    if (!PUDDLE_FIELDS.includes(key)) {
      throw invalidField(`environment.puddles.${key}`, value[key], `one of the fields ${PUDDLE_FIELDS.join(', ')}; remove ${key}`, TypeError);
    }
  }
  const coverage = value.coverage ?? PUDDLE_DEFAULTS.coverage;
  if (typeof coverage !== 'number' || !(coverage >= 0 && coverage <= 1)) {
    throw invalidField('environment.puddles.coverage', value.coverage, 'a number from 0 (no puddles) to 1 (water everywhere), such as 0.5', TypeError);
  }
  const from = value.from ?? PUDDLE_DEFAULTS.from;
  if (!PUDDLE_SOURCES.includes(from)) {
    throw invalidField('environment.puddles.from', from, `"height" (water pools in the low spots of the ground by world height); the "cavity" and mask sources are not available yet, so pass from: "height"`, TypeError);
  }
  return Object.freeze({ coverage, from });
}

/**
 * How wet the surface looks for a wetness value: the first half of the range does most of the work (0.5 gives 0.75), because
 * a scan of wet asphalt is already dark and glossy once it is damp. Wet ground goes from dry to soaked on this curve.
 */
export function wetnessResponse(wetness) {
  return 1 - (1 - wetness) * (1 - wetness);
}

/**
 *The three numbers the wetness shader reads: wetness, the puddle share of the surface, and a slot the renderer fills with its keep-out box count.
 * Both numbers follow wetnessResponse. Puddles need wet ground, so their share is the coverage scaled by it: damp ground gets a few, soaked ground many.
 */
export function wetnessUniformValues(environment) {
  const response = wetnessResponse(environment.wetness ?? 0);
  const coverage = environment.puddles?.coverage ?? 0;
  return [response, coverage * response, 0];
}
