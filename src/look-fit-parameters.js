// The look parameters scene_fit_look may move, with the hard range of each and where it lands in a scene_apply patch.
// Physical parameters fit first; grade parameters fit second, pulled toward neutral. This leaf module holds plain data and
// small pure functions, so the MCP server, the runtime and the tests share it.

import { invalidField } from './field-error.js';

export const FIT_LOOK_LIMITS = Object.freeze({ maximumRegions: 32, maximumParameters: 8, maximumShots: 4, maximumIterations: 8, maximumEvaluations: 100, deadlineSeconds: 50 });

/** name: { stage, section, path, min, max, neutral? }. A path under `sky` edits the physical sky of the environment. */
export const FIT_PARAMETERS = Object.freeze({
  sunElevation: { stage: 'physical', section: 'environment', path: ['sky', 'sunElevation'], min: -10, max: 90 },
  sunRotation: { stage: 'physical', section: 'environment', path: ['sky', 'sunRotation'], min: -360, max: 360 },
  turbidity: { stage: 'physical', section: 'environment', path: ['sky', 'turbidity'], min: 1, max: 10 },
  aerialPerspective: { stage: 'physical', section: 'environment', path: ['sky', 'aerialPerspective'], min: 0, max: 4 },
  ozone: { stage: 'physical', section: 'environment', path: ['sky', 'ozone'], min: 0, max: 10 },
  groundAlbedo: { stage: 'physical', section: 'environment', path: ['sky', 'groundAlbedo'], min: 0, max: 1 },
  environmentIntensity: { stage: 'physical', section: 'environment', path: ['environmentIntensity'], min: 0, max: 20 },
  keyIntensity: { stage: 'physical', section: 'environment', path: ['keyIntensity'], min: 0, max: 20 },
  ambientIntensity: { stage: 'physical', section: 'environment', path: ['ambientIntensity'], min: 0, max: 20 },
  fogDensity: { stage: 'physical', section: 'environment', path: ['fogDensity'], min: 0, max: 2 },
  exposure: { stage: 'grade', section: 'effects', path: ['exposure'], min: 0.1, max: 8, neutral: 1 },
  saturation: { stage: 'grade', section: 'effects', path: ['saturation'], min: 0, max: 2, neutral: 1 },
  contrast: { stage: 'grade', section: 'effects', path: ['contrast'], min: 0.1, max: 2, neutral: 1 },
  temperature: { stage: 'grade', section: 'effects', path: ['temperature'], min: -1, max: 1, neutral: 0 },
});

export const FIT_PARAMETER_NAMES = Object.freeze(Object.keys(FIT_PARAMETERS));

export function fitParameterDefinition(name, path = 'free[].parameter') {
  const definition = Object.hasOwn(FIT_PARAMETERS, name) ? FIT_PARAMETERS[name] : undefined;
  if (!definition) {
    throw invalidField(path, name, `one of ${FIT_PARAMETER_NAMES.join(', ')}`, TypeError);
  }
  return definition;
}

function readPath(root, path) {
  return path.reduce((cursor, step) => (cursor === undefined || cursor === null ? undefined : cursor[step]), root);
}

/** The value a scene already holds for a parameter, or undefined when the recipe leaves it to a default. */
export function recipeValueOf(recipe, name) {
  const { section, path } = fitParameterDefinition(name);
  const value = readPath(recipe?.[section], path);
  return typeof value === 'number' ? value : undefined;
}

/** True when the recipe has a physical sky, which the sky parameters edit field by field. */
export function recipeHasPhysicalSky(recipe) {
  const sky = recipe?.environment?.sky;
  return Boolean(sky) && sky.type !== 'gradient';
}

/**
 * The scene_apply patch for fitted values: { environment?, effects? }. A sky parameter writes the whole sky object (the
 * recipe's own sky with the fitted fields over it), because a nested patch replaces the sky as a unit.
 */
export function fitPatchFromValues(values, recipe) {
  const patch = {};
  for (const [name, value] of Object.entries(values)) {
    const { section, path } = fitParameterDefinition(name);
    patch[section] ??= {};
    if (path[0] === 'sky') {
      patch[section].sky ??= { ...recipe.environment.sky };
      patch[section].sky[path[1]] = value;
    } else {
      patch[section][path[0]] = value;
    }
  }
  return patch;
}

/** The scene_apply operations that draw one shot with fitted values: the shot's camera, then the look patch. */
export function fitOperationsForShot(shot, patch) {
  const operations = [];
  if (shot.camera) operations.push({ type: 'set-camera', ...shot.camera });
  if (patch.environment) operations.push({ type: 'set-environment', environment: patch.environment });
  if (patch.effects) operations.push({ type: 'set-effects', effects: patch.effects });
  return operations;
}
