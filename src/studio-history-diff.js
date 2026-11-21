import { OWN_SECTIONS } from './agent-apply-report.js';

// Undo and redo restore a recipe the scene already holds almost all of. When the two recipes differ only in things an
// existing scene operation can set in place, those operations are cheaper than building the whole scene again.
// Anything else (other nodes, geometries or material lists, a field that would have to be removed) returns null.

const NESTED_MERGE_FIELDS = Object.freeze({ environment: 'volumeFog', effects: 'bloom' });
const MERGED_SECTIONS = Object.freeze({ environment: 'set-environment', effects: 'set-effects', shadow: 'set-shadow' });
const SECTION_OPERATIONS = Object.freeze(Object.fromEntries(Object.entries(OWN_SECTIONS).map(([type, section]) => [section, type])));
const COMPARED_RECIPE_KEYS = new Set(['nodes', 'materials', 'camera', ...Object.keys(MERGED_SECTIONS), ...Object.values(OWN_SECTIONS)]);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Structural equality of two JSON-like values, ignoring key order. */
export function sameRecipeValue(left, right) {
  if (left === right) {
    return true;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, index) => sameRecipeValue(item, right[index]));
  }
  if (isPlainObject(left) && isPlainObject(right)) {
    const leftKeys = Object.keys(left);
    return leftKeys.length === Object.keys(right).length && leftKeys.every(key => Object.hasOwn(right, key) && sameRecipeValue(left[key], right[key]));
  }
  return false;
}

/** The fields of `target` that differ from `current`, or null when a field of `current` is missing from `target` (a patch cannot remove it). */
function changedFields(current, target) {
  if (!isPlainObject(current) || !isPlainObject(target)) {
    return null;
  }
  for (const key of Object.keys(current)) {
    if (!Object.hasOwn(target, key)) {
      return null;
    }
  }
  const patch = {};
  for (const [key, value] of Object.entries(target)) {
    if (!sameRecipeValue(current[key], value)) {
      patch[key] = value;
    }
  }
  return patch;
}

function recordOperations(type, currentRecords, targetRecords) {
  if (!Array.isArray(currentRecords) || !Array.isArray(targetRecords) || currentRecords.length !== targetRecords.length) {
    return null;
  }
  const operations = [];
  for (let index = 0; index < currentRecords.length; index += 1) {
    const current = currentRecords[index];
    const target = targetRecords[index];
    if (current === target || sameRecipeValue(current, target)) {
      continue;
    }
    if (current?.id !== target?.id) {
      return null;
    }
    const patch = changedFields(current, target);
    if (patch === null) {
      return null;
    }
    operations.push({ type, id: target.id, ...patch });
  }
  return operations;
}

function mergedSectionOperation(section, current, target) {
  const patch = changedFields(current, target);
  if (patch === null) {
    return null;
  }
  const nestedField = NESTED_MERGE_FIELDS[section];
  if (nestedField && Object.hasOwn(patch, nestedField)) {
    const nestedPatch = changedFields(current[nestedField], target[nestedField]);
    if (nestedPatch === null) {
      return null;
    }
    patch[nestedField] = nestedPatch;
  }
  if (section === 'environment' && Object.hasOwn(patch, 'sky') && changedFields(current.sky, target.sky) === null) {
    return null;
  }
  return Object.keys(patch).length === 0 ? [] : [{ type: MERGED_SECTIONS[section], [section]: patch }];
}

function mergedSectionOperations(currentRecipe, targetRecipe) {
  const operations = [];
  for (const section of Object.keys(MERGED_SECTIONS)) {
    if (sameRecipeValue(currentRecipe[section], targetRecipe[section])) {
      continue;
    }
    const sectionOperations = mergedSectionOperation(section, currentRecipe[section], targetRecipe[section]);
    if (sectionOperations === null) {
      return null;
    }
    operations.push(...sectionOperations);
  }
  return operations;
}

function ownSectionOperations(currentRecipe, targetRecipe) {
  const operations = [];
  for (const [section, type] of Object.entries(SECTION_OPERATIONS)) {
    if (sameRecipeValue(currentRecipe[section], targetRecipe[section])) {
      continue;
    }
    // Clearing a section leaves `section: null` in the scene's recipe, which is not the recipe being restored.
    if (targetRecipe[section] === undefined) {
      return null;
    }
    operations.push({ type, [section]: targetRecipe[section] });
  }
  return operations;
}

function cameraOperations(currentCamera, targetCamera) {
  if (sameRecipeValue(currentCamera, targetCamera)) {
    return [];
  }
  const patch = changedFields(currentCamera, targetCamera);
  return patch === null ? null : [{ type: 'set-camera', ...patch }];
}

function otherKeysMatch(currentRecipe, targetRecipe) {
  const keys = new Set([...Object.keys(currentRecipe), ...Object.keys(targetRecipe)]);
  for (const key of keys) {
    if (!COMPARED_RECIPE_KEYS.has(key) && !sameRecipeValue(currentRecipe[key], targetRecipe[key])) {
      return false;
    }
  }
  return true;
}

/**
 * The scene operations that turn `currentRecipe` into `targetRecipe` in place, or null when the scene must be built again.
 * Returns an empty list when the recipes already match. The caller still checks the result by exporting the recipe.
 */
export function operationsBetweenRecipes(currentRecipe, targetRecipe) {
  if (!isPlainObject(currentRecipe) || !isPlainObject(targetRecipe) || !otherKeysMatch(currentRecipe, targetRecipe)) {
    return null;
  }
  const nodeOperations = recordOperations('set-node', currentRecipe.nodes, targetRecipe.nodes);
  const materialOperations = recordOperations('set-material', currentRecipe.materials, targetRecipe.materials);
  const camera = cameraOperations(currentRecipe.camera, targetRecipe.camera);
  const mergedOperations = mergedSectionOperations(currentRecipe, targetRecipe);
  if (!nodeOperations || !materialOperations || !camera || !mergedOperations) {
    return null;
  }
  const sectionOperations = ownSectionOperations(currentRecipe, targetRecipe);
  if (!sectionOperations) {
    return null;
  }
  return [...materialOperations, ...nodeOperations, ...camera, ...mergedOperations, ...sectionOperations];
}
