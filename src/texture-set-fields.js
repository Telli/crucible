// The recipe material fields of scanned texture sets. Kept apart from texture-set-names.js (file name rules, capability text) because the
// scene core imports these few names and must not carry the rest.

/** The map roles a texture set holds, with the recipe field that takes each one's catalog image ID. */
export const TEXTURE_MAP_FIELD_BY_ROLE = Object.freeze({
  color: 'colorMap',
  normal: 'normalMap',
  roughness: 'roughnessMap',
  metallic: 'metallicMap',
  occlusion: 'occlusionMap',
  height: 'heightMap',
});

export const TEXTURE_MAP_FIELDS = Object.freeze(Object.values(TEXTURE_MAP_FIELD_BY_ROLE));
export const NORMAL_CONVENTIONS = Object.freeze(['opengl', 'directx']);
/** The UV transform fields: scale, offset and rotation of every map together, and the metres one tile covers. */
export const UV_TRANSFORM_FIELDS = Object.freeze(['uvScale', 'uvOffset', 'uvRotation', 'worldScale']);

/** Bounds of the UV transform fields, shared by the recipe check and the MCP schema. */
export const UV_TRANSFORM_LIMITS = Object.freeze({ scale: [0.001, 10000], offset: [-10000, 10000], rotation: [-360, 360], worldScale: [0.001, 100000] });

/** Every material field of this feature: the six maps, the set that fills them, the normal convention and the UV transform. */
export const TEXTURE_SET_RECIPE_FIELDS = Object.freeze([...TEXTURE_MAP_FIELDS, 'textureSet', 'normalConvention', ...UV_TRANSFORM_FIELDS]);
