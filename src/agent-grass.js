import { createGrass, GRASS_LEVELS, GRASS_PRESETS } from './grass.js';
import { createRecipeTerrain } from './agent-terrain.js';
import { invalidField } from './field-error.js';
import {
  knownKeys, numberWithin, planePoint, boxCorners, normalizeExclusion, normalizeList, planePositionInGroup, exclusionTest, eyeInGroup, terrainGround, clampedArea,
} from './recipe-ground-field.js';

// Recipe grass: a group node with a `grass` field covers a terrain node with blade grass from the grass addon. It calls
// `createGrass` with the terrain's own `heightAt`, so the recipe path and an addon user get the same blades for the same
// options. Like vegetation and clutter, the result travels the placed-asset channel of agent-scene.js (generated
// geometries of type "asset", materials flagged assetSource and part nodes with assetPart), so exports and edits skip it.
// Tiles and their level of detail come from the recipe camera eye at each edit, never from the frame being drawn, so a
// seek cannot change them. The material keeps the `grass` tag, so the blades sway with environment.wind.

export const GRASS_LIMITS = Object.freeze({
  maxExclusions: 32, maxPolygonPoints: 64, maxArea: 40000, maxBlades: 500000, maxTriangles: 1500000, maxCachedSets: 4,
});
const GRASS_FIELDS = ['ground', 'preset', 'area', 'polygon', 'exclude', 'density', 'height', 'dryness', 'seed', 'cullDistance'];
const PART_NAME = /^Grass tile (-?\d+),(-?\d+)$/;
const TILE_INDEX_STRIDE = 4096;

/** Validate the `grass` field of a node (`node` is the whole node, which must be a group). Returns the canonical form kept in the recipe. */
export function normalizeGrass(value, node) {
  const conflict = node && ['geometry', 'skin', 'asset', 'vegetation', 'clutter'].find(field => node[field] !== undefined);
  if (conflict) {
    throw invalidField(conflict, node[conflict], 'nothing, because a node that grows grass is a group; drop geometry, material, skin, asset, vegetation and clutter', TypeError);
  }
  knownKeys(value, GRASS_FIELDS, 'grass');
  if (typeof value.ground !== 'string' || !value.ground) {
    throw invalidField('grass.ground', value.ground, 'the ID of a terrain node, such as "ground"', TypeError);
  }
  const preset = value.preset ?? 'meadow';
  if (!GRASS_PRESETS[preset]) throw invalidField('grass.preset', preset, `one of ${Object.keys(GRASS_PRESETS).join(', ')}`);
  const result = {
    ground: value.ground,
    preset,
    seed: numberWithin(value.seed ?? 1, -2147483648, 2147483647, 'grass.seed'),
    cullDistance: numberWithin(value.cullDistance ?? GRASS_LEVELS.at(-1).distance, 5, 200, 'grass.cullDistance'),
    exclude: value.exclude === undefined ? [] : normalizeList(value.exclude, GRASS_LIMITS.maxExclusions, 'grass.exclude', '[{ "center": [0, 0], "radius": 5 }]', normalizeExclusion),
  };
  if (value.density !== undefined) result.density = numberWithin(value.density, 1, 1500, 'grass.density');
  if (value.dryness !== undefined) result.dryness = numberWithin(value.dryness, 0, 1, 'grass.dryness');
  if (value.height !== undefined) result.height = normalizeHeight(value.height);
  if (value.area !== undefined) {
    knownKeys(value.area, ['min', 'max'], 'grass.area');
    result.area = boxCorners(value.area, 'grass.area');
  }
  if (value.polygon !== undefined) result.polygon = normalizePolygon(value.polygon);
  return result;
}

function normalizeHeight(value) {
  if (!Array.isArray(value) || value.length !== 2) throw invalidField('grass.height', value, '[minimum, maximum] blade height in metres, such as [0.25, 0.6]', TypeError);
  const range = [numberWithin(value[0], 0.02, 3, 'grass.height[0]'), numberWithin(value[1], 0.02, 3, 'grass.height[1]')];
  if (range[1] < range[0]) throw invalidField('grass.height', value, '[minimum, maximum] with maximum not below minimum, such as [0.25, 0.6]');
  return range;
}

function normalizePolygon(value) {
  if (!Array.isArray(value) || value.length < 3 || value.length > GRASS_LIMITS.maxPolygonPoints) {
    throw invalidField('grass.polygon', Array.isArray(value) ? `${value.length} points` : value, `3 to ${GRASS_LIMITS.maxPolygonPoints} [x, z] points in metres, such as [[-5, -5], [5, -5], [0, 6]]`);
  }
  return value.map((point, index) => planePoint(point, `grass.polygon[${index}]`));
}

// Even-odd rule: a point is inside when a ray toward +x crosses the outline an odd number of times.
function insidePolygon(polygon, x, z) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const [currentX, currentZ] = polygon[index];
    const [previousX, previousZ] = polygon[previous];
    if ((currentZ > z) !== (previousZ > z) && x < (previousX - currentX) * (z - currentZ) / (previousZ - currentZ) + currentX) inside = !inside;
  }
  return inside;
}

// The wanted area: the box when given, else the outline's bounding box, clamped to the ground; null covers the whole ground.
function wantedArea(grass) {
  if (!grass.polygon) return grass.area ?? null;
  const xs = grass.polygon.map(point => point[0]);
  const zs = grass.polygon.map(point => point[1]);
  const bounds = { min: [Math.min(...xs), Math.min(...zs)], max: [Math.max(...xs), Math.max(...zs)] };
  if (!grass.area) return bounds;
  return { min: [Math.max(bounds.min[0], grass.area.min[0]), Math.max(bounds.min[1], grass.area.min[1])], max: [Math.min(bounds.max[0], grass.area.max[0]), Math.min(bounds.max[1], grass.area.max[1])] };
}

/** Blades and triangles planned within reach of the eye, counted ring by ring as the levels of detail will build them (an upper bound: patches thin the field). */
export function plannedGrass(grass, area) {
  const preset = GRASS_PRESETS[grass.preset];
  const density = grass.density ?? preset.density;
  const size = (area.maxX - area.minX) * (area.maxZ - area.minZ);
  let blades = 0;
  let triangles = 0;
  let reachedArea = 0;
  GRASS_LEVELS.forEach((level, index) => {
    const outerDistance = index === GRASS_LEVELS.length - 1 ? grass.cullDistance : Math.min(level.distance, grass.cullDistance);
    const reach = Math.min(size, Math.PI * outerDistance ** 2);
    const ring = Math.max(0, reach - reachedArea);
    reachedArea = Math.max(reachedArea, reach);
    blades += ring * density * level.keep;
    triangles += ring * density * level.keep * (level.segments * 2 - 1);
  });
  return { blades: Math.round(blades), triangles: Math.round(triangles), density, size };
}

function checkBudget(grass, area) {
  const planned = plannedGrass(grass, area);
  if (planned.size > GRASS_LIMITS.maxArea) {
    throw invalidField('grass.area', `${Math.round(planned.size)} square metres`, `an area of at most ${GRASS_LIMITS.maxArea} square metres, such as 100 by 100 metres; split a larger ground into several grass nodes`);
  }
  const hint = 'lower density or cullDistance, or give a smaller area or polygon';
  if (planned.blades > GRASS_LIMITS.maxBlades) {
    throw invalidField('grass.density', planned.density, `a density that keeps the blades within cullDistance under ${GRASS_LIMITS.maxBlades} (this plans about ${planned.blades}); ${hint}`);
  }
  if (planned.triangles > GRASS_LIMITS.maxTriangles) {
    throw invalidField('grass.density', planned.density, `a density that keeps the triangles within cullDistance under ${GRASS_LIMITS.maxTriangles} (this plans about ${planned.triangles}); ${hint}`);
  }
}

/** The options `createGrass` gets for a grass node: the same call an addon user makes, so both give the same blades. */
export function grassOptionsFor(recipe, groupNode, grass) {
  const ground = terrainGround(recipe, grass.ground, 'grass.ground', createRecipeTerrain);
  const area = clampedArea(wantedArea(grass), ground, 'grass');
  checkBudget(grass, area);
  const excluded = exclusionTest(recipe, groupNode, grass.exclude, 'grass');
  const mask = (x, z) => {
    if (excluded(x, z) || ground.terrain.isHole(x, z)) return 0;
    return grass.polygon && !insidePolygon(grass.polygon, x, z) ? 0 : 1;
  };
  return {
    preset: grass.preset, area, terrainHeight: ground.terrain.heightAt, mask, seed: grass.seed, cullDistance: grass.cullDistance,
    ...(grass.density !== undefined ? { density: grass.density } : {}),
    ...(grass.height ? { height: grass.height } : {}),
    ...(grass.dryness !== undefined ? { dryness: grass.dryness } : {}),
  };
}

function groundDefinition(recipe, grass) {
  const ground = recipe.nodes.find(node => node.id === grass.ground);
  return recipe.geometries.find(geometry => geometry.id === ground?.geometry) ?? null;
}

// What the field depends on besides the camera: the field, its ground record and where named exclusions stand.
function cacheKey(recipe, groupNode, eye) {
  const { grass } = groupNode;
  const named = grass.exclude.filter(entry => entry.node && recipe.nodes.some(node => node.id === entry.node)).map(entry => planePositionInGroup(recipe, groupNode, entry.node));
  return `grass:${JSON.stringify([grass, groundDefinition(recipe, grass), named, eye])}`;
}

function materialJson(material) {
  return {
    tag: material.tag, color: [...material.color], metallic: material.metallic ?? 0, roughness: material.roughness ?? 0.5,
    emission: material.emission ?? 0, opacity: 1, alphaMode: 'opaque', doubleSided: Boolean(material.doubleSided),
  };
}

function growField(recipe, groupNode, eye, cache) {
  const key = cacheKey(recipe, groupNode, eye);
  if (!cache.has(key)) {
    // The scene shares this map with its placed assets, so only grown sets are evicted.
    const grownKeys = [...cache.keys()].filter(candidate => candidate.startsWith('grass:'));
    if (grownKeys.length >= GRASS_LIMITS.maxCachedSets) cache.delete(grownKeys[0]);
    const grass = createGrass({ ...grassOptionsFor(recipe, groupNode, groupNode.grass), eye });
    cache.set(key, { serial: ++cache.serial, grass, geometryIds: new Map(), outputs: new Map() });
  }
  return cache.get(key);
}

// Add the generated geometry, material and part node of one grass tile to the recipe and the runtime maps.
// Ids are stable per cached set, but each stage starts from a fresh recipe, so the runtime maps say what is already added.
function addPart(recipe, runtime, generatedNodes, entry, groupNode, part) {
  const [, column, row] = PART_NAME.exec(part.name);
  if (!entry.geometryIds.has(part.geometry)) entry.geometryIds.set(part.geometry, `grass:${entry.serial}:${entry.geometryIds.size}`);
  const geometryId = entry.geometryIds.get(part.geometry);
  if (!runtime.geometryParts.has(geometryId)) {
    recipe.geometries.push({ id: geometryId, type: 'asset', grass: entry.serial });
    runtime.geometryParts.set(geometryId, part.geometry);
  }
  const materialId = `grass:${entry.serial}`;
  if (!entry.outputs.has(materialId)) entry.outputs.set(materialId, Object.freeze({ ...part.material }));
  if (!runtime.materialOutputs.has(materialId)) {
    runtime.materialOutputs.set(materialId, entry.outputs.get(materialId));
    recipe.materials.push({ id: materialId, ...materialJson(entry.outputs.get(materialId)), assetSource: true });
  }
  generatedNodes.push({
    id: `${groupNode.id}/tile-${column}-${row}`, parent: groupNode.id, label: 'grass tile',
    translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1],
    geometry: geometryId, material: materialId,
    assetPart: { placement: groupNode.id, index: Number(column) * TILE_INDEX_STRIDE + Number(row), matrix: Array.from(part.matrix) },
  });
  runtime.partExtras.set(`${groupNode.id}/tile-${column}-${row}`, { group: groupNode.id, castShadow: part.castShadow === true });
}

// Tiles, blades and triangles per level of detail, from the parts the field draws now.
function fieldReport(entry, groupNode) {
  const levels = GRASS_LEVELS.map((level, index) => ({ level: index, distance: level.distance, tiles: 0, blades: 0, triangles: 0 }));
  for (const part of entry.grass.parts) {
    const row = levels[part.level];
    row.tiles++;
    row.blades += part.bladeCount;
    row.triangles += part.geometry.indices.length / 3;
  }
  const stats = entry.grass.stats();
  return {
    node: groupNode.id, preset: groupNode.grass.preset, ground: groupNode.grass.ground,
    blades: levels.reduce((total, row) => total + row.blades, 0), tiles: stats.visibleTiles, triangles: stats.triangles,
    geometryBytes: stats.geometryBytes, levels,
  };
}

/**
 * Generate the geometries, materials and part nodes of every grass node into a normalized recipe, in place.
 * `cache` (the scene's asset output map) keeps built tiles across edits, so a material or node edit does not grow the field again.
 * Returns the placed runtime with the grass maps added, and a report for scene_inspect.
 */
export function expandGrass(recipe, limits, cache, placedRuntime) {
  cache.serial ??= 0;
  const runtime = { geometryParts: new Map(), materialOutputs: new Map(), partExtras: new Map(), report: [] };
  const generatedNodes = [];
  for (const groupNode of recipe.nodes.filter(node => node.grass)) {
    const entry = growField(recipe, groupNode, eyeInGroup(recipe, groupNode), cache);
    for (const part of entry.grass.parts) addPart(recipe, runtime, generatedNodes, entry, groupNode, part);
    runtime.report.push(fieldReport(entry, groupNode));
  }
  if (recipe.nodes.length + generatedNodes.length > limits.maxNodes) {
    throw invalidField('grass.cullDistance', `${generatedNodes.length} generated part nodes`, `a cullDistance that keeps authored plus generated nodes (${recipe.nodes.length} authored) within maxNodes ${limits.maxNodes}; lower cullDistance or give a smaller area`);
  }
  recipe.nodes.push(...generatedNodes);
  return {
    ...placedRuntime,
    grass: runtime.report,
    geometryParts: new Map([...placedRuntime.geometryParts, ...runtime.geometryParts]),
    materialOutputs: new Map([...placedRuntime.materialOutputs, ...runtime.materialOutputs]),
    partExtras: new Map([...placedRuntime.partExtras, ...runtime.partExtras]),
  };
}
