// Validation of the scene_fit_look arguments. Every error says which field failed and what to pass instead, because an agent reads it.
// The result is the exact shape the solver and the runtime use, with every count inside FIT_LOOK_LIMITS.

import { invalidField } from './field-error.js';
import { FIT_LOOK_LIMITS, fitParameterDefinition, recipeHasPhysicalSky, recipeValueOf } from './look-fit-parameters.js';

export const FIT_LOOK_SIZE = Object.freeze({ minimum: 64, maximum: 512, defaultWidth: 256, defaultHeight: 160 });
const GRADE_PRIOR_WEIGHT = 0.05;
const CAMERA_VECTOR_FIELDS = ['eye', 'target', 'up'];
const CAMERA_NUMBER_FIELDS = ['fov', 'focalLength'];
const LABEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,47}$/;

function requireList(value, path, minimum, maximum, example) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    throw invalidField(path, Array.isArray(value) ? value.length : value, `a list of ${minimum} to ${maximum} entries, such as ${example}`, TypeError);
  }
  return value;
}

function requireNumbers(value, path, length, minimum, maximum) {
  if (!Array.isArray(value) || value.length !== length || value.some(entry => !Number.isFinite(entry) || entry < minimum || entry > maximum)) {
    throw invalidField(path, value, `${length} numbers from ${minimum} to ${maximum}`);
  }
  return [...value];
}

function normalizeRect(rect, path) {
  const [x0, y0, x1, y1] = requireNumbers(rect, path, 4, 0, 1);
  if (x0 >= x1 || y0 >= y1) {
    throw invalidField(path, rect, '[x0, y0, x1, y1] with x0 < x1 and y0 < y1, in 0..1 image coordinates with y down, such as [0.4, 0.1, 0.6, 0.25]');
  }
  return [x0, y0, x1, y1];
}

function normalizeCamera(camera, path) {
  if (camera === undefined) return undefined;
  const allowed = [...CAMERA_VECTOR_FIELDS, ...CAMERA_NUMBER_FIELDS];
  const unknown = Object.keys(camera ?? {}).filter(key => !allowed.includes(key));
  if (unknown.length || !camera || Object.keys(camera).length === 0) {
    throw invalidField(path, unknown.length ? unknown : camera, `an object with ${allowed.join(', ')}, such as { "eye": [0, 2, 8], "target": [0, 1, 0], "fov": 45 }`, TypeError);
  }
  const clean = {};
  for (const field of CAMERA_VECTOR_FIELDS) {
    if (camera[field] !== undefined) clean[field] = requireNumbers(camera[field], `${path}.${field}`, 3, -100000, 100000);
  }
  for (const field of CAMERA_NUMBER_FIELDS) {
    if (camera[field] === undefined) continue;
    if (!Number.isFinite(camera[field]) || camera[field] <= 0 || camera[field] > 1000) throw invalidField(`${path}.${field}`, camera[field], 'a number above 0 and at most 1000');
    clean[field] = camera[field];
  }
  if (clean.fov !== undefined && clean.focalLength !== undefined) {
    throw invalidField(path, camera, 'fov or focalLength, not both', TypeError);
  }
  return clean;
}

function normalizeShots(shots) {
  const entries = requireList(shots, 'shots', 1, FIT_LOOK_LIMITS.maximumShots, '[{ "id": "coast", "camera": { "eye": [0, 2, 8], "target": [0, 1, 0] } }]');
  const names = new Set();
  return entries.map((shot, index) => {
    const path = `shots[${index}]`;
    if (typeof shot?.id !== 'string' || !LABEL_PATTERN.test(shot.id) || names.has(shot.id)) {
      throw invalidField(`${path}.id`, shot?.id, 'an id of 1 to 48 letters, digits, spaces, dots, dashes or underscores that no other shot uses, such as "coast"', TypeError);
    }
    names.add(shot.id);
    return { name: shot.id, camera: normalizeCamera(shot.camera, `${path}.camera`) };
  });
}

function normalizeRegions(regions, shotNames) {
  const entries = requireList(regions, 'regions', 1, FIT_LOOK_LIMITS.maximumRegions, '[{ "label": "high sky", "shot": "coast", "rect": [0.3, 0.02, 0.7, 0.15], "lab": [0.72, -0.03, -0.08] }]');
  const labels = new Set();
  return entries.map((region, index) => {
    const path = `regions[${index}]`;
    if (typeof region?.label !== 'string' || !LABEL_PATTERN.test(region.label) || labels.has(region.label)) {
      throw invalidField(`${path}.label`, region?.label, 'a label of 1 to 48 letters, digits, spaces, dots, dashes or underscores that no other region uses, such as "lit grass"', TypeError);
    }
    labels.add(region.label);
    if (!shotNames.includes(region.shot)) {
      throw invalidField(`${path}.shot`, region.shot, `the name of a shot in shots: ${shotNames.join(', ')}`, TypeError);
    }
    const exclude = region.exclude === undefined ? [] : requireList(region.exclude, `${path}.exclude`, 0, 4, '[[0.4, 0.1, 0.5, 0.2]]').map((rect, at) => normalizeRect(rect, `${path}.exclude[${at}]`));
    const [lightness, a, b] = Array.isArray(region.lab) && region.lab.length === 3 && region.lab.every(Number.isFinite) ? region.lab : [NaN, 0, 0];
    if (!(lightness >= 0 && lightness <= 1.2) || Math.abs(a) > 1 || Math.abs(b) > 1) {
      throw invalidField(`${path}.lab`, region.lab, 'OKLab [L, a, b] with L from 0 to 1.2 and a, b within 1 (a mean of reference pixels, not sRGB), such as [0.72, -0.03, -0.08]');
    }
    return { label: region.label, shot: region.shot, rect: normalizeRect(region.rect, `${path}.rect`), exclude, lab: [lightness, a, b], holdout: Boolean(region.holdout) };
  });
}

function startValueFor(entry, definition, recipe, path) {
  if (entry.start !== undefined) return entry.start;
  const held = recipeValueOf(recipe, entry.name);
  if (held !== undefined) return Math.min(entry.max, Math.max(entry.min, held));
  if (definition.neutral !== undefined) return Math.min(entry.max, Math.max(entry.min, definition.neutral));
  if (definition.path[0] === 'sky') {
    throw invalidField(`${path}.start`, undefined, `a start value, since the scene's sky does not set ${entry.parameter}`);
  }
  return (entry.min + entry.max) / 2;
}

function normalizeParameters(free, recipe) {
  const entries = requireList(free, 'free', 1, FIT_LOOK_LIMITS.maximumParameters, '[{ "parameter": "sunElevation", "min": 3, "max": 40 }, { "parameter": "keyIntensity", "min": 0.5, "max": 3 }]');
  const names = new Set();
  return entries.map((entry, index) => {
    const path = `free[${index}]`;
    const definition = fitParameterDefinition(entry?.parameter, `${path}.parameter`);
    if (names.has(entry.parameter)) throw invalidField(`${path}.parameter`, entry.parameter, 'a parameter listed once');
    names.add(entry.parameter);
    if (definition.path[0] === 'sky' && !recipeHasPhysicalSky(recipe)) {
      throw invalidField(`${path}.parameter`, entry.parameter, 'a parameter the scene can move: it has no physical sky, so apply set-environment with a sky such as { "type": "physical", "sunElevation": 20 } first, or fit keyIntensity, ambientIntensity and the grade');
    }
    const min = entry.min ?? definition.min;
    const max = entry.max ?? definition.max;
    if (!Number.isFinite(min) || !Number.isFinite(max) || min < definition.min || max > definition.max || min >= max) {
      throw invalidField(`${path}.min/max`, [entry.min, entry.max], `min below max inside ${definition.min} to ${definition.max} for ${entry.parameter}`);
    }
    const bounds = { name: entry.parameter, min, max, start: entry.start };
    const start = startValueFor(bounds, definition, recipe, path);
    if (!Number.isFinite(start) || start < min || start > max) {
      throw invalidField(`${path}.start`, start, `a number from ${min} to ${max}`);
    }
    const prior = definition.neutral === undefined ? undefined : { value: Math.min(max, Math.max(min, definition.neutral)), weight: GRADE_PRIOR_WEIGHT };
    return { name: entry.parameter, stage: definition.stage, min, max, start, ...(prior ? { prior } : {}) };
  });
}

function normalizeSize(input) {
  const width = input.width ?? FIT_LOOK_SIZE.defaultWidth;
  const height = input.height ?? FIT_LOOK_SIZE.defaultHeight;
  for (const [name, value] of [['width', width], ['height', height]]) {
    if (!Number.isInteger(value) || value < FIT_LOOK_SIZE.minimum || value > FIT_LOOK_SIZE.maximum) {
      throw invalidField(name, value, `an integer from ${FIT_LOOK_SIZE.minimum} to ${FIT_LOOK_SIZE.maximum} pixels`);
    }
  }
  return { width, height };
}

/** Checks the arguments of scene_fit_look against the scene's recipe and returns what the fit runs on. */
export function normalizeFitLookInput(input, recipe) {
  if (input === null || typeof input !== 'object') {
    throw invalidField('arguments', input, 'an object with shots, regions and free', TypeError);
  }
  const shots = normalizeShots(input.shots);
  const regions = normalizeRegions(input.regions, shots.map(shot => shot.name));
  const unusedShot = shots.find(shot => !regions.some(region => region.shot === shot.name));
  if (unusedShot) {
    throw invalidField('shots', unusedShot.name, 'only shots that at least one region measures; remove it or add a region with that shot', TypeError);
  }
  if (regions.every(region => region.holdout)) {
    throw invalidField('regions', 'every region held out', 'at least one region without holdout: true, since held-out regions are only reported');
  }
  const maximumIterations = input.maxIterations ?? 6;
  if (!Number.isInteger(maximumIterations) || maximumIterations < 1 || maximumIterations > FIT_LOOK_LIMITS.maximumIterations) {
    throw invalidField('maxIterations', maximumIterations, `an integer from 1 to ${FIT_LOOK_LIMITS.maximumIterations}`);
  }
  return { shots, regions, parameters: normalizeParameters(input.free, recipe), maximumIterations, ...normalizeSize(input) };
}
