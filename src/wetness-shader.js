// The GLSL of environment wetness (src/wetness.js), spliced into the main fragment shader only when the scene is wet, so a dry
// scene compiles the same program as before. wetnessState is (wetness response, puddle share, keep-out box count).
// Porous surfaces (not metal, rougher ones more) darken, get a little glossier and are never a mirror: a plain wet road keeps a soft sheen.
// Standing water is built from one signed depth field laid over the ground: a smooth noise basin, warped and broken by finer noise, that rises
// above a level falling with world height, so water fills the low spots first. Around zero depth the road is only damp (darker, more
// saturated), then shallow water lets the road texture show through a dark film, then deep water is near black and mirrors the scene.
// Normals flatten with depth, so the rim keeps the road bumps and the middle is flat. The roughness inside the water is almost zero, so the
// wet ground parts mirror the scene and sky (src/water-reflection.js). Water keeps clear of thin raised parts (src/wetness-keep-out.js).

/** The fill level a basin must exceed at zero puddle reach: nearly no ground holds water. */
export const PUDDLE_LEVEL_DRY = 0.88;
/** How far the level falls as puddle reach grows to 1. */
export const PUDDLE_LEVEL_SPAN = 0.5;

/**
 * The level the noise basin must rise above for water to stand, from the wetness response and the puddle share the shader reads.
 * The reach is share times response squared, so soaked ground (response 1) lowers the level about twice as far as damp ground (0.75).
 */
export function puddleFillLevel(wetnessResponse, puddleShare) {
  return PUDDLE_LEVEL_DRY - PUDDLE_LEVEL_SPAN * puddleShare * wetnessResponse * wetnessResponse;
}

export const WETNESS_CODE = Object.freeze({
  declarations: `uniform vec3 wetnessState;
uniform vec4 wetnessKeepOut[24];
// Smooth noise basin of the ground plane: the plane is bent by a slow warp so the outlines are not round, and finer noise breaks them up
// (detailFade is 0 where a pixel is wider than the detail, so far ground does not speckle).
float wetBasin(vec3 position, float detailFade) {
  vec2 warp = vec2(wearNoise(vec3(position.x * 1.1, 9.3, position.z * 1.1)), wearNoise(vec3(position.x * 1.1 + 31.0, 2.7, position.z * 1.1))) - 0.5;
  vec3 plane = vec3((position.x + 0.9 * warp.x) * 0.55, 3.7, (position.z + 0.9 * warp.y) * 0.55);
  float broad = 0.8 * wearNoise(plane) + 0.2 * wearNoise(plane * 2.3 + vec3(17.0));
  float fine = wearNoise(vec3(position.x * 6.0, 1.9, position.z * 6.0)) - 0.5;
  return broad + 0.1 * fine * detailFade;
}
// Distance in metres from the ground point to the nearest keep-out footprint (1000 when there is none).
float wetKeepOutDistance(vec3 position) {
  float nearest = 1000.0;
  for (int index = 0; index < 24; index++) {
    if (float(index) >= wetnessState.z) break;
    vec4 box = wetnessKeepOut[index];
    vec2 outside = max(max(box.xy - position.xz, position.xz - box.zw), vec2(0.0));
    nearest = min(nearest, length(outside));
  }
  return nearest;
}
`,
  worldSurface: `  if (!TAG_WATER && !TAG_FIRE && !TAG_SMOKE && wetnessState.x > 0.0) {
    float wetSoak = wetnessState.x * wetnessState.x;
    float paintGuard = mix(1.0, 0.15, smoothstep(0.35, 0.65, max(color.r, max(color.g, color.b))));
    float wetPorosity = wetnessState.x * (1.0 - metallic) * mix(0.35, 1.0, roughness) * paintGuard;
    float wetGloss = wetSoak * (1.0 - metallic) * mix(0.5, 1.0, paintGuard);
    // A pixel wider than the grain cannot show it: the grain fades with the pixel footprint so the far road does not speckle.
    // Geometric mean of the two footprint axes: at a grazing angle one axis is huge, and using it would erase the grain of the whole road.
    float pixelSize = sqrt(length(dFdx(worldPosition)) * length(dFdy(worldPosition)));
    float grainFade = 1.0 - smoothstep(0.006, 0.03, pixelSize);
    float wetGrain = (0.7 * (wearNoise(worldPosition * 38.0) - 0.5) + 0.3 * (wearNoise(worldPosition * 5.0) - 0.5)) * grainFade;
    color *= 1.0 - 0.6 * wetPorosity;
    roughness = clamp(mix(roughness, mix(0.58, 0.46, wetSoak), wetGloss) + wetGrain * 0.14 * wetGloss, 0.075, 1.0);
    splatCavity *= 1.0 - 0.4 * wetPorosity;
    float standing = 0.0;
    float deep = 0.0;
    float damp = 0.0;
    float flatten = 0.0;
    if (wetnessState.y > 0.0) {
      float clearance = wetKeepOutDistance(worldPosition);
      float level = ${PUDDLE_LEVEL_DRY.toFixed(2)} - ${PUDDLE_LEVEL_SPAN.toFixed(2)} * wetnessState.y * wetnessState.x * wetnessState.x;
      float detailFade = 1.0 - smoothstep(0.03, 0.12, pixelSize);
      float fill = wetBasin(worldPosition, detailFade) - level - 6.0 * worldPosition.y - 0.3 * (1.0 - smoothstep(0.2, 1.0, clearance));
      // The road texture is the height map of the rim: a coarse pebble noise lets raised bits stay dry while the water is shallow.
      float pebble = (wearNoise(worldPosition * 22.0) - 0.5) * detailFade;
      // A damp rim of shallow water: where the depth is under a few millimetres the road shows through and stays dark.
      float depthField = fill + 0.08 * pebble;
      float edgeWidth = clamp(4.0 * fwidth(fill), 0.1, 0.3);
      float gate = smoothstep(0.93, 0.99, geometricNormal.y) * (1.0 - metallic) * smoothstep(0.18, 0.45, clearance) * paintGuard;
      standing = smoothstep(0.0, edgeWidth, depthField) * gate;
      deep = smoothstep(0.05, 0.45, fill);
      damp = smoothstep(-0.32, 0.0, depthField) * gate;
      flatten = standing * smoothstep(0.0, 0.12, depthField);
    }
    // Damp ring: the road next to the water is wetter and more saturated than the plain wet road.
    float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
    color = mix(vec3(luminance), color, 1.0 + 0.8 * damp);
    color *= 1.0 - 0.3 * damp * (1.0 - standing);
    roughness = mix(roughness, roughness * 0.7, damp * (1.0 - standing));
    // Shallow water leaves the road colour dim but visible; deep water is nearly black.
    color *= mix(1.0, mix(0.6, 0.1, deep), standing);
    metallic = mix(metallic, mix(0.35, 0.85, deep), standing);
    roughness = mix(roughness, mix(0.06, 0.03, deep), standing);
    splatCavity *= 1.0 - 0.7 * standing;
    // Normals flatten with depth: the rim keeps the road bumps, the middle is flat.
    normal = normalize(mix(normal, vec3(0.0, 1.0, 0.0), flatten));
  }
`,
});
