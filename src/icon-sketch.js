// The sketch look of the `icons` render job (docs/agent-render-jobs.md, "Icons"): a user post pass (docs/user-passes.md) that draws an
// ink outline from the alpha, depth and normal edges, pencil hatching whose density follows the light, and a paper-coloured fill.
// This file holds the knobs and their limits, the GLSL, the numbers the GLSL gets at each icon size, and the measurements the tests
// and the smoke script use to check that the look still reads at 64 px. No browser, no files.
import { invalidField } from './field-error.js';

export const SKETCH_LIMITS = Object.freeze({
  densities: Object.freeze({ minimum: 0.5, maximum: 2, default: 1 }),
  jitters: Object.freeze({ minimum: 0, maximum: 1, default: 0.35 }),
  maximumSeed: 65535,
  defaultInkColor: '#2b2a33',
  defaultPaperColor: '#f4ecd8',
});

/** The steps a breakdown strip shows, left to right, and the value of the pass's `stage` uniform that draws each. */
export const SKETCH_STAGES = Object.freeze({ final: 0, outline: 1, hatching: 2, shaded: 3 });
export const BREAKDOWN_ORDER = Object.freeze(['shaded', 'outline', 'hatching', 'final']);

const SKETCH_FIELDS = ['inkColor', 'paperColor', 'hatchDensity', 'jitter'];
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const TONE_BANDS = Object.freeze([0.68, 0.48, 0.3]);
const CREASE_ANGLE_DEGREES = 40;
const DEPTH_STEP = 0.02;
const HATCH_LINES_ACROSS_ICON = 24;
const MINIMUM_HATCH_PERIOD = 3;

function colorFrom(value, field, fallback) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !HEX_COLOR.test(value)) {
    throw invalidField(`sketch.${field}`, typeof value === 'string' ? value.slice(0, 20) : typeof value, 'a colour as "#rrggbb", for example "#2b2a33"', RangeError);
  }
  return value.toLowerCase();
}

function numberFrom(value, field, { minimum, maximum, default: fallback }) {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw invalidField(`sketch.${field}`, value, `a number from ${minimum} to ${maximum} (default ${fallback})`, RangeError);
  }
  return value;
}

/** The sketch knobs with every default filled in and every limit checked. */
export function normalizeSketchSettings(input) {
  if (input === undefined) input = {};
  if (!input || Object.getPrototypeOf(input) !== Object.prototype) {
    throw invalidField('sketch', typeof input, `an object with any of ${SKETCH_FIELDS.join(', ')}`, TypeError);
  }
  for (const key of Object.keys(input)) {
    if (!SKETCH_FIELDS.includes(key)) throw invalidField(`sketch.${key}`, 'an unknown field', `only ${SKETCH_FIELDS.join(', ')}`, TypeError);
  }
  return {
    inkColor: colorFrom(input.inkColor, 'inkColor', SKETCH_LIMITS.defaultInkColor),
    paperColor: colorFrom(input.paperColor, 'paperColor', SKETCH_LIMITS.defaultPaperColor),
    hatchDensity: numberFrom(input.hatchDensity, 'hatchDensity', SKETCH_LIMITS.densities),
    jitter: numberFrom(input.jitter, 'jitter', SKETCH_LIMITS.jitters),
  };
}

/** The seed of the pencil wobble: a whole number, so the same seed always draws the same lines. */
export function seedFrom(value) {
  if (value === undefined) return 0;
  if (!Number.isInteger(value) || value < 0 || value > SKETCH_LIMITS.maximumSeed) {
    throw invalidField('seed', value, `a whole number from 0 to ${SKETCH_LIMITS.maximumSeed}`, RangeError);
  }
  return value;
}

function displayColor(hex) {
  return [1, 3, 5].map(offset => Number((parseInt(hex.slice(offset, offset + 2), 16) / 255).toFixed(4)));
}

/** The numbers the GLSL gets at one icon size: line reach, hatch spacing and weight, and the wobble, all in output pixels. */
export function sketchMetrics({ size, hatchDensity, jitter }) {
  const hatchPeriod = Math.max(MINIMUM_HATCH_PERIOD, Math.round(size / (HATCH_LINES_ACROSS_ICON * hatchDensity)));
  const reach = Math.max(1, Math.round(size / 128));
  return {
    reach,
    outlineWobble: Number((jitter * Math.max(0.5, reach * 0.6)).toFixed(4)),
    hatchPeriod,
    hatchWeight: Number(Math.max(1, hatchPeriod * 0.2).toFixed(4)),
    hatchShift: Number((jitter * hatchPeriod * 0.3).toFixed(4)),
  };
}

// The pass is one function per idea so people who tune it can find the part they want: inkEdge (outline), hatchAmount (pencil).
// Hatching is laid out in whole pixel steps (x + y for the 45 degree layer), so at 64 px it is a clean pattern and not a moire.
const SKETCH_FRAGMENT = `
const vec2 directions[4] = vec2[4](vec2(1.0, 0.0), vec2(0.0, 1.0), vec2(0.7071, 0.7071), vec2(0.7071, -0.7071));

float hash(vec2 cell) { return fract(sin(dot(cell, vec2(127.1, 311.7)) + seed * 17.31) * 43758.5453); }

float smoothNoise(vec2 point) {
  vec2 cell = floor(point);
  vec2 blend = fract(point);
  blend = blend * blend * (3.0 - 2.0 * blend);
  float low = mix(hash(cell), hash(cell + vec2(1.0, 0.0)), blend.x);
  float high = mix(hash(cell + vec2(0.0, 1.0)), hash(cell + vec2(1.0, 1.0)), blend.x);
  return mix(low, high, blend.y);
}

// 1 where this pixel is within the line's reach of a silhouette, a surface that sits behind a nearer one, or a crease.
float inkEdge(vec2 uv) {
  vec2 pixel = 1.0 / resolution;
  float lineReach = reach + outlineWobble * smoothNoise(uv * resolution / 7.0);
  float depthHere = depthAt(uv);
  float edge = 0.0;
  for (int i = 0; i < 4; i++) {
    vec2 offset = directions[i] * lineReach * pixel;
    if (texture(sceneColor, uv + offset).a < 0.5 || texture(sceneColor, uv - offset).a < 0.5) {
      edge = 1.0;
    } else {
      float depthBend = depthAt(uv + offset) + depthAt(uv - offset) - 2.0 * depthHere;
      float creased = dot(worldNormalAt(uv + offset), worldNormalAt(uv - offset)) < creaseCosine ? 1.0 : 0.0;
      if (depthBend < -depthStep || (abs(depthBend) < depthStep && creased > 0.0)) edge = 1.0;
    }
  }
  return edge;
}

// One set of parallel pencil lines. across runs perpendicular to the lines in whole pixel steps, along runs the other way.
float pencilLines(float across, float along, float layer) {
  float wobble = (smoothNoise(vec2(along / (hatchPeriod * 4.0), floor(across / hatchPeriod) + layer * 17.0)) - 0.5) * 2.0 * hatchShift;
  float position = (across + wobble) / hatchPeriod;
  float lineDistance = abs(position - floor(position + 0.5)) * hatchPeriod;
  return 1.0 - smoothstep(hatchWeight * 0.5 - 0.5, hatchWeight * 0.5 + 0.5, lineDistance);
}

// The darker the light, the more layers: one set of lines, then a crossing set, then a third.
float hatchAmount(float tone) {
  float x = gl_FragCoord.x;
  float y = gl_FragCoord.y;
  float edgeNoise = (smoothNoise(gl_FragCoord.xy / 9.0) - 0.5) * 0.08 * (hatchShift / hatchPeriod + 0.1);
  float amount = 0.0;
  if (tone < bands.x + edgeNoise) amount = max(amount, pencilLines(x + y, x - y, 0.0));
  if (tone < bands.y + edgeNoise) amount = max(amount, pencilLines(x - y, x + y, 1.0));
  if (tone < bands.z + edgeNoise) amount = max(amount, pencilLines(y, x, 2.0));
  return amount;
}

vec4 userPass(vec2 uv) {
  vec4 source = texture(sceneColor, uv);
  if (stage == 3 || source.a < 0.002) return source;
  float tone = dot(source.rgb / source.a, vec3(0.299, 0.587, 0.114));
  float outline = (stage == 0 || stage == 1) ? inkEdge(uv) : 0.0;
  float hatching = (stage == 0 || stage == 2) ? hatchAmount(tone) : 0.0;
  vec3 color = mix(paperColor, inkColor, max(outline, hatching * 0.85));
  return vec4(color * source.a, source.a);
}
`;

/**
 * The user pass (the `postPasses` entry of the icon's recipe) for one icon size and one step. Stage `final` draws the sketch,
 * `outline` and `hatching` draw one half of it on paper, and `shaded` passes the clean render through, for the breakdown strip.
 */
export function sketchPass({ settings, size, stage = 'final' }) {
  const { sketch, seed } = settings;
  const metrics = sketchMetrics({ size, hatchDensity: sketch.hatchDensity, jitter: sketch.jitter });
  return {
    name: 'icon-sketch',
    scale: 1,
    fragment: SKETCH_FRAGMENT,
    uniforms: {
      inkColor: displayColor(sketch.inkColor),
      paperColor: displayColor(sketch.paperColor),
      reach: metrics.reach,
      outlineWobble: metrics.outlineWobble,
      hatchPeriod: metrics.hatchPeriod,
      hatchWeight: metrics.hatchWeight,
      hatchShift: metrics.hatchShift,
      creaseCosine: Number(Math.cos(CREASE_ANGLE_DEGREES * Math.PI / 180).toFixed(4)),
      depthStep: DEPTH_STEP,
      bands: [...TONE_BANDS],
      seed,
      stage: { type: 'int', value: SKETCH_STAGES[stage] },
    },
  };
}

/** What `scene_capabilities` jobs reports for the sketch style. */
export const SKETCH_CAPABILITIES = Object.freeze({
  note: 'style sketch is a user post pass: ink outline from alpha, depth and normal edges, pencil hatching (up to three crossing layers) that gets denser as the light gets darker, a paper fill and a seeded wobble. Same input and seed give the same pixels on the cpu backend. breakdown: true writes breakdown-<item>.png, four steps side by side.',
  inkColor: Object.freeze({ default: SKETCH_LIMITS.defaultInkColor, format: '#rrggbb' }),
  paperColor: Object.freeze({ default: SKETCH_LIMITS.defaultPaperColor, format: '#rrggbb' }),
  hatchDensity: SKETCH_LIMITS.densities,
  jitter: SKETCH_LIMITS.jitters,
  seed: Object.freeze({ default: 0, maximum: SKETCH_LIMITS.maximumSeed }),
  breakdownSteps: BREAKDOWN_ORDER,
});

function luma(data, pixel) {
  return (0.299 * data[pixel * 4] + 0.587 * data[pixel * 4 + 1] + 0.114 * data[pixel * 4 + 2]) / 255;
}

function isOpaque(data, pixel) {
  return data[pixel * 4 + 3] >= 250;
}

/** Pixels that are opaque and have only opaque pixels within `margin` pixels: the inside of the silhouette, away from its outline. */
function interiorPixels(data, width, height, margin) {
  const inside = [];
  for (let row = margin; row < height - margin; row++) {
    for (let column = margin; column < width - margin; column++) {
      let allOpaque = true;
      for (let rowOffset = -margin; rowOffset <= margin && allOpaque; rowOffset++) {
        for (let columnOffset = -margin; columnOffset <= margin; columnOffset++) {
          if (!isOpaque(data, (row + rowOffset) * width + column + columnOffset)) { allOpaque = false; break; }
        }
      }
      if (allOpaque) inside.push(row * width + column);
    }
  }
  return inside;
}

function percentile(sortedValues, fraction) {
  return sortedValues[Math.min(sortedValues.length - 1, Math.floor(sortedValues.length * fraction))];
}

/**
 * Measures the pencil hatching in the hatching step of a breakdown strip (hatching alone on paper). The hatched band is every
 * interior pixel with ink within `window` pixels, which leaves out the bright parts of the item where no line is drawn.
 * Returns `contrast` (the 90th to the 10th percentile of luma in the band, as a share of the paper to ink range: 1 is full ink
 * against full paper), `bimodal` (the share of band pixels that are within a quarter of the range of paper or ink; grey noise
 * scores low here) and `coverage` (the share of the band that is ink), or null when the item has no hatching at all.
 */
export function measureHatchBand({ data, width, height, paperLuma, inkLuma, window = 3 }) {
  const range = paperLuma - inkLuma;
  const interior = interiorPixels(data, width, height, 2);
  const isInk = pixel => luma(data, pixel) < inkLuma + range * 0.5;
  const interiorSet = new Set(interior);
  const band = interior.filter(pixel => {
    const row = Math.floor(pixel / width);
    const column = pixel % width;
    for (let rowOffset = -window; rowOffset <= window; rowOffset++) {
      for (let columnOffset = -window; columnOffset <= window; columnOffset++) {
        const neighbour = (row + rowOffset) * width + column + columnOffset;
        if (interiorSet.has(neighbour) && isInk(neighbour)) return true;
      }
    }
    return false;
  });
  if (band.length === 0) return null;
  const lumas = band.map(pixel => luma(data, pixel)).sort((first, second) => first - second);
  const nearExtreme = lumas.filter(value => value <= inkLuma + range * 0.25 || value >= paperLuma - range * 0.25).length;
  return {
    pixels: band.length,
    contrast: (percentile(lumas, 0.9) - percentile(lumas, 0.1)) / range,
    bimodal: nearExtreme / band.length,
    coverage: band.filter(isInk).length / band.length,
  };
}

/**
 * Measures the outline in the outline step of a breakdown strip: of the opaque pixels that touch a see-through pixel (the
 * silhouette), the share drawn in ink. 1 means the whole contour is inked.
 */
export function measureOutline({ data, width, height, paperLuma, inkLuma }) {
  const range = paperLuma - inkLuma;
  let contour = 0;
  let inked = 0;
  for (let row = 1; row < height - 1; row++) {
    for (let column = 1; column < width - 1; column++) {
      const pixel = row * width + column;
      if (!isOpaque(data, pixel)) continue;
      const touchesBackground = [pixel - 1, pixel + 1, pixel - width, pixel + width].some(neighbour => data[neighbour * 4 + 3] < 128);
      if (!touchesBackground) continue;
      contour++;
      if (luma(data, pixel) < inkLuma + range * 0.35) inked++;
    }
  }
  return { contourPixels: contour, inkedShare: contour === 0 ? 0 : inked / contour };
}

/** The luma (0 to 1) of a `#rrggbb` colour, as the measurements above weigh it. */
export function hexLuma(hex) {
  const [red, green, blue] = displayColor(hex);
  return 0.299 * red + 0.587 * green + 0.114 * blue;
}
