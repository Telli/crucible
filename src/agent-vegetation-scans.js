// The first-party vegetation-scans pack (packs/vegetation-scans): when it is installed, the MCP server fills `vegetation.scans`
// on every tree node that has none, with the catalog image IDs of the pack's bark and leaf maps. The scene draws those scans;
// a node without scans keeps the procedural textures. Only the server imports this module, so the core bundles stay the same.

export const VEGETATION_SCANS_PACK = 'vegetation-scans';

const PART_OF_KIND = Object.freeze({ bark: 'bark', leaf: 'leaves' });
const FIELD_OF_CHANNEL = Object.freeze({ color: 'colorMap', normal: 'normalMap', roughness: 'roughnessMap', crown: 'crownMap' });
const ITEM_ID = /^([a-z]+)-(bark|leaf)-(color|normal|roughness|crown)$/;
const MAXIMUM_DEPTH = 8;

/**
 * The scans each species gets from the pack's image items (`[{ id, assetId }]`, ids such as "broadleaf-bark-color"):
 * `{ broadleaf: { bark: { colorMap, normalMap, roughnessMap }, leaves: { colorMap, normalMap, crownMap } }, ... }`.
 * A part without its colour map is left out, because the scene needs one to draw it.
 */
export function vegetationScansFromPack(images) {
  const scans = {};
  for (const { id, assetId } of images ?? []) {
    const match = ITEM_ID.exec(id);
    if (!match || typeof assetId !== 'string') continue;
    const [, species, kind, channel] = match;
    const part = PART_OF_KIND[kind];
    scans[species] ??= {};
    scans[species][part] ??= {};
    scans[species][part][FIELD_OF_CHANNEL[channel]] = assetId;
  }
  for (const species of Object.keys(scans)) {
    for (const part of Object.keys(scans[species])) {
      if (scans[species][part].colorMap === undefined) delete scans[species][part];
    }
    if (Object.keys(scans[species]).length === 0) delete scans[species];
  }
  return scans;
}

function speciesOf(vegetation) {
  if (typeof vegetation.species === 'string') return [vegetation.species];
  if (vegetation.mix && typeof vegetation.mix === 'object' && !Array.isArray(vegetation.mix)) return Object.keys(vegetation.mix);
  return [];
}

function visitVegetation(value, visit, depth) {
  if (!value || typeof value !== 'object' || depth > MAXIMUM_DEPTH) return;
  if (Array.isArray(value)) {
    for (const item of value) visitVegetation(item, visit, depth + 1);
    return;
  }
  const { vegetation } = value;
  if (vegetation && typeof vegetation === 'object' && !Array.isArray(vegetation)) visit(vegetation);
  for (const child of Object.values(value)) visitVegetation(child, visit, depth + 1);
}

/** Whether a recipe or edit list has a tree node without `scans`, which the server fills when the pack is installed. */
export function needsVegetationScans(value) {
  let found = false;
  visitVegetation(value, vegetation => {
    if (vegetation.scans === undefined) found = true;
  }, 0);
  return found;
}

/**
 * Fills `scans` on every vegetation field of a recipe or edit list that has none, in place, with the scans of the species it
 * grows. Species the pack has no scan for (grass, flowers) are skipped; a node left with no scanned species is not changed.
 */
export function fillVegetationScans(value, scansBySpecies) {
  visitVegetation(value, vegetation => {
    if (vegetation.scans !== undefined) return;
    const scans = {};
    for (const species of speciesOf(vegetation)) {
      if (scansBySpecies[species]) scans[species] = structuredClone(scansBySpecies[species]);
    }
    if (Object.keys(scans).length > 0) vegetation.scans = scans;
  }, 0);
}
