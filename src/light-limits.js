// How many lights of each kind one frame takes. Light linking keeps one mask bit for the sun and one for each of these
// lights in a 32 bit integer, so the three limits and the sun together must fit in 32 bits.
export const MAX_POINT_LIGHTS = 16;
export const MAX_SPOT_LIGHTS = 8;
export const MAX_AREA_LIGHTS = 7;

export const SHADOW_ATLAS_TILE_COUNT = 24;
export const POINT_LIGHT_SHADOW_TILES = 6;

// The atlas error: tiles needed, the shadowed lights of each kind and the field to turn off. The atlas size is fixed.
export function shadowAtlasOverflowMessage({ pointLights, spotLights, areaLights }) {
  const tiles = pointLights * POINT_LIGHT_SHADOW_TILES + spotLights + areaLights;
  return `Shadow casting lights need ${tiles} atlas tiles, and the atlas holds ${SHADOW_ATLAS_TILE_COUNT}: ${pointLights} point lights x 6 tiles, ${spotLights} spot, ${areaLights} area x 1. Set castShadow false on some environment.pointLights[i], spotLights[i] or areaLights[i]; the atlas size is fixed`;
}
