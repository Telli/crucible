import { mat4 } from 'gl-matrix';
import { invalidField } from './field-error.js';

// Checks and geometry shared by the recipe fields that fill a terrain with streamed tiles (clutter and grass): the same
// area, exclusion and group-frame rules, so a node field reads the same wherever the ground is scattered.

export const EXCLUSION_FIELDS = ['center', 'radius', 'min', 'max', 'node'];
export const GROUND_EDGE_MARGIN = 0.5;
export const DEFAULT_GROUND_SIZE = 40;

export function knownKeys(value, allowed, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidField(path, value, 'an object, such as {}', TypeError);
  }
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw invalidField(`${path}.${key}`, value[key], `no such field; use one of ${allowed.join(', ')}`, TypeError);
  }
}

export function numberWithin(value, minimum, maximum, path) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw invalidField(path, value, `a number from ${minimum} to ${maximum}, such as ${Math.min(Math.max(1, minimum), maximum)}`);
  }
  return value;
}

export function planePoint(value, path) {
  if (!Array.isArray(value) || value.length !== 2 || value.some(component => !Number.isFinite(component))) {
    throw invalidField(path, value, '[x, z] in metres, such as [0, 0]', TypeError);
  }
  return [...value];
}

export function boxCorners(value, path) {
  const min = planePoint(value.min, `${path}.min`);
  const max = planePoint(value.max, `${path}.max`);
  if (max[0] <= min[0] || max[1] <= min[1]) throw invalidField(`${path}.max`, max, `[x, z] above min ${JSON.stringify(min)} on both axes`);
  return { min, max };
}

export function normalizeExclusion(value, path) {
  knownKeys(value, EXCLUSION_FIELDS, path);
  if (value.min !== undefined || value.max !== undefined) {
    if (value.center !== undefined || value.radius !== undefined || value.node !== undefined) {
      throw invalidField(path, value, 'either the box form "min", "max" or the circle form "center", "radius", not both');
    }
    return boxCorners(value, path);
  }
  const radius = numberWithin(value.radius, 0.01, 2000, `${path}.radius`);
  if (value.node !== undefined) {
    if (typeof value.node !== 'string' || !value.node) throw invalidField(`${path}.node`, value.node, 'a node ID, such as "pond"', TypeError);
    return { node: value.node, radius };
  }
  return { center: planePoint(value.center, `${path}.center`), radius };
}

export function normalizeList(value, maximum, path, example, normalizeEntry) {
  if (!Array.isArray(value) || value.length > maximum) {
    throw invalidField(path, Array.isArray(value) ? `${value.length} entries` : value, `a list of at most ${maximum} entries, such as ${example}`);
  }
  return value.map((entry, index) => normalizeEntry(entry, `${path}[${index}]`));
}

export function nodeWorldMatrix(nodes, node) {
  const byId = new Map(nodes.map(candidate => [candidate.id, candidate]));
  let matrix = mat4.fromRotationTranslationScale(mat4.create(), node.rotation, node.translation, node.scale);
  let parent = node.parent === null ? null : byId.get(node.parent);
  for (let depth = 0; parent && depth < 256; depth++) {
    const local = mat4.fromRotationTranslationScale(mat4.create(), parent.rotation, parent.translation, parent.scale);
    matrix = mat4.multiply(mat4.create(), local, matrix);
    parent = parent.parent === null ? null : byId.get(parent.parent);
  }
  return matrix;
}

// The [x, z] of a node in the group's own space, which is where the area, mask and exclusions are measured.
export function planePositionInGroup(recipe, groupNode, nodeId) {
  const target = recipe.nodes.find(node => node.id === nodeId);
  const inGroup = mat4.multiply(mat4.create(), mat4.invert(mat4.create(), nodeWorldMatrix(recipe.nodes, groupNode)), nodeWorldMatrix(recipe.nodes, target));
  return [inGroup[12], inGroup[14]];
}

export function exclusionTest(recipe, groupNode, exclusions, path) {
  const areas = exclusions.map((entry, index) => {
    if (entry.min) return (x, z) => x >= entry.min[0] && x <= entry.max[0] && z >= entry.min[1] && z <= entry.max[1];
    let center = entry.center;
    if (entry.node) {
      if (!recipe.nodes.some(node => node.id === entry.node)) throw invalidField(`${path}.exclude[${index}].node`, entry.node, 'the ID of a node in the recipe, such as "pond"');
      center = planePositionInGroup(recipe, groupNode, entry.node);
    }
    return (x, z) => Math.hypot(x - center[0], z - center[1]) <= entry.radius;
  });
  return (x, z) => areas.some(test => test(x, z));
}

export function eyeInGroup(recipe, groupNode) {
  const eye = recipe.camera?.eye ?? [0, 0, 0];
  const inverse = mat4.invert(mat4.create(), nodeWorldMatrix(recipe.nodes, groupNode));
  return [
    inverse[0] * eye[0] + inverse[4] * eye[1] + inverse[8] * eye[2] + inverse[12],
    inverse[1] * eye[0] + inverse[5] * eye[1] + inverse[9] * eye[2] + inverse[13],
    inverse[2] * eye[0] + inverse[6] * eye[1] + inverse[10] * eye[2] + inverse[14],
  ];
}

/** The terrain a node ID draws ({ definition, terrain }), or throws naming `path`. `createTerrain` builds the sampler from the definition. */
export function terrainGround(recipe, nodeId, path, createTerrain) {
  const ground = recipe.nodes.find(node => node.id === nodeId);
  const definition = ground && recipe.geometries.find(geometry => geometry.id === ground.geometry);
  if (definition?.type !== 'terrain') {
    throw invalidField(path, nodeId, 'the ID of a node that draws a terrain geometry, such as "ground"; give the group node the same transform as the ground');
  }
  return { definition, terrain: createTerrain(definition) };
}

/** `area` (or the whole ground) clamped to the ground's extent, as { minX, maxX, minZ, maxZ }. */
export function clampedArea(area, ground, path) {
  const half = ground ? (ground.definition.size ?? DEFAULT_GROUND_SIZE) / 2 - GROUND_EDGE_MARGIN : Infinity;
  const wanted = area ?? { min: [-half, -half], max: [half, half] };
  const clamped = {
    minX: Math.max(wanted.min[0], -half), maxX: Math.min(wanted.max[0], half),
    minZ: Math.max(wanted.min[1], -half), maxZ: Math.min(wanted.max[1], half),
  };
  if (clamped.maxX <= clamped.minX || clamped.maxZ <= clamped.minZ) {
    throw invalidField(`${path}.area`, area, `an area that overlaps the ground, which spans ${-half} to ${half} on x and z`);
  }
  return clamped;
}
