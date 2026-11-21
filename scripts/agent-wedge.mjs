import { WEDGE_LIMITS, parseWedgeField, wedgeColumns, wedgeLabel } from '../src/agent-wedge.js';
import { invalidField } from '../src/field-error.js';
import { REVIEW_CAMERA_FIELDS, validateReviewCamera } from './agent-review.mjs';

const ALLOWED_INPUT = ['sessionId', 'expectedRevision', 'target', 'parameter', 'values', 'shot', 'width', 'height'];
const ALLOWED_SHOT = ['camera', 'motionTime'];

function requireKnownKeys(value, allowed, subject) {
  const rejected = Object.keys(value).filter(key => !allowed.includes(key));
  if (rejected.length > 0) {
    throw new TypeError(`${subject} field${rejected.length > 1 ? 's' : ''} not accepted: ${rejected.join(', ')}. ${subject} takes ${allowed.join(', ')}; remove the others.`);
  }
}

function dimension(value, name, fallback, maximum) {
  const chosen = value ?? fallback;
  if (!Number.isInteger(chosen) || chosen < WEDGE_LIMITS.minimumDimension || chosen > maximum) {
    throw invalidField(name, value, `an integer from ${WEDGE_LIMITS.minimumDimension} to ${maximum} for this many values`);
  }
  return chosen;
}

function requireValues(values) {
  if (!Array.isArray(values) || values.length < WEDGE_LIMITS.minimumValues || values.length > WEDGE_LIMITS.maximumValues) {
    const received = Array.isArray(values) ? values.length : values;
    throw invalidField('values', received, `a list of ${WEDGE_LIMITS.minimumValues} to ${WEDGE_LIMITS.maximumValues} values, such as [0.2, 0.5, 0.8]`);
  }
  for (const [index, value] of values.entries()) {
    const text = JSON.stringify(value);
    if (text === undefined || Buffer.byteLength(text) > WEDGE_LIMITS.maximumValueBytes) {
      throw invalidField(`values[${index}]`, value, `JSON of at most ${WEDGE_LIMITS.maximumValueBytes} bytes; pass a number, a text, a list or a small object`);
    }
  }
}

function requireCamera(camera) {
  if (!camera || typeof camera !== 'object' || Array.isArray(camera)) {
    throw new TypeError(`Wedge camera must be an object with the fields ${REVIEW_CAMERA_FIELDS.join(', ')}.`);
  }
  requireKnownKeys(camera, REVIEW_CAMERA_FIELDS, 'Wedge camera');
  validateReviewCamera(camera);
}

function requireShot(shot) {
  requireKnownKeys(shot, ALLOWED_SHOT, 'Wedge shot');
  if (shot.camera !== undefined) requireCamera(shot.camera);
  const { motionTime } = shot;
  const valid = motionTime === undefined || motionTime === null || (Number.isFinite(motionTime) && motionTime >= 0 && motionTime <= 3600);
  if (!valid) throw invalidField('shot.motionTime', motionTime, 'a time in seconds from 0 to 3600, or null for the authored pose');
}

/** Validate a wedge before the renderer is leased, and shape it as a review: one shot per value, each on its own variant name. */
export function normalizeWedge(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError(`Wedge must be an object with the fields ${ALLOWED_INPUT.join(', ')}.`);
  }
  requireKnownKeys(input, ALLOWED_INPUT, 'Wedge');
  if (typeof input.sessionId !== 'string' || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
    throw new TypeError('Wedge requires a sessionId and a safe nonnegative expectedRevision.');
  }
  if (typeof input.target !== 'string' || input.target.length === 0 || input.target.length > 128) {
    throw invalidField('target', input.target, 'environment, effects, shadow or a material ID', TypeError);
  }
  parseWedgeField(input.parameter);
  requireValues(input.values);
  const shot = input.shot ?? {};
  requireShot(shot);
  const values = input.values;
  const columns = wedgeColumns(values.length);
  const rows = Math.ceil(values.length / columns);
  const maximumWidth = Math.min(WEDGE_LIMITS.maximumDimension, Math.floor(WEDGE_LIMITS.maximumGridWidth / columns));
  const maximumHeight = Math.min(WEDGE_LIMITS.maximumDimension, Math.floor(WEDGE_LIMITS.maximumGridHeight / rows) - WEDGE_LIMITS.labelHeight);
  const width = dimension(input.width, 'width', Math.min(WEDGE_LIMITS.defaultDimension, maximumWidth), maximumWidth);
  const height = dimension(input.height, 'height', Math.min(WEDGE_LIMITS.defaultDimension, maximumHeight), maximumHeight);
  const motionTime = shot.motionTime ?? null;
  const variantNames = values.map((_, index) => `wedge-${index}`);
  const shots = values.map((value, index) => ({
    label: wedgeLabel(input.parameter, value), branch: variantNames[index], motionTime, rendererTime: motionTime ?? 0,
    ...(shot.camera === undefined ? {} : { camera: structuredClone(shot.camera) }),
  }));
  const groups = shots.map((entry, index) => ({ branch: entry.branch, shotIndexes: [index] }));
  return {
    sessionId: input.sessionId, expectedRevision: input.expectedRevision, width, height, shots, groups, branchNames: variantNames,
    labels: false, columns, gridWidth: width * columns, gridHeight: (height + WEDGE_LIMITS.labelHeight) * rows,
    wedge: { target: input.target, field: input.parameter, values: structuredClone(values) },
  };
}
