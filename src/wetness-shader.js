// The GLSL of environment wetness (src/wetness.js), spliced into the main fragment shader only when the scene is wet, so a dry
// scene compiles the same program as before. wetnessState is (wetness response, puddle fill level, keep-out box count, ground height).
// The ground splits into two materials. The road is porous: darker, a little more saturated, satin and gritty, lit by the sky and the
// sun but never a mirror. Standing water is the only part that mirrors the scene (src/water-reflection.js): a flat interior of constant
// roughness behind a narrow rim that the road stones break. Both come from one signed depth field laid over the ground: a smooth noise
// basin, warped and broken by finer noise, that rises above a fill level. The level comes from the share of the ground that should be
// under water (puddleFillLevel), and the depth is measured from the ground plane height, so the same ground floods the same at any y.
// Water keeps clear of thin raised parts (src/wetness-keep-out.js) and of slopes steeper than a few degrees.

/** The roughness scale of a soaked porous surface: 1 leaves the dry roughness, lower is glossier. Soaked road is satin, not a mirror. */
export const SOAKED_ROAD_ROUGHNESS_SCALE = 0.62;
/** The roughness of the water surface. */
export const WATER_SURFACE_ROUGHNESS = 0.04;

/** The fill level for a share of the ground under water: [share, level] pairs measured on the basin noise, joined by straight lines. */
export const PUDDLE_LEVEL_TABLE = Object.freeze([
  [0, 0.9],
  [0.01, 0.812],
  [0.03, 0.766],
  [0.0625, 0.726],
  [0.125, 0.678],
  [0.25, 0.609],
]);

/** The level the noise basin must rise above for water to cover the share of the ground (0 to 0.25) the caller asks for. */
export function puddleFillLevel(share) {
  const table = PUDDLE_LEVEL_TABLE;
  if (share >= table.at(-1)[0]) return table.at(-1)[1];
  let upper = 1;
  while (table[upper][0] < share) upper++;
  const [lowShare, lowLevel] = table[upper - 1];
  const [highShare, highLevel] = table[upper];
  return lowLevel + ((share - lowShare) / (highShare - lowShare)) * (highLevel - lowLevel);
}

export const WETNESS_CODE = Object.freeze({
  declarations: `uniform vec4 wetnessState;
uniform vec4 wetnessKeepOut[24];
// How much of the pixel is standing water (0 to 1), and whether it is ground that may mirror; the worldLight slot reads both.
float wetStanding = 0.0;
float wetGroundFacing = 0.0;
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
  worldSurface: `  wetStanding = 0.0;
  wetGroundFacing = 0.0;
  if (!TAG_WATER && !TAG_FIRE && !TAG_SMOKE && wetnessState.x > 0.0) {
    float wetSoak = wetnessState.x * wetnessState.x;
    float paintGuard = mix(1.0, 0.15, smoothstep(0.35, 0.65, max(color.r, max(color.g, color.b))));
    float wetPorosity = wetnessState.x * (1.0 - metallic) * mix(0.35, 1.0, roughness) * paintGuard;
    float wetGloss = wetSoak * (1.0 - metallic) * mix(0.5, 1.0, paintGuard);
    // Rough, ground-facing, unpainted surfaces get the road grit; walls, crowns and paint keep the soft grain.
    float gritGround = smoothstep(0.85, 0.92, geometricNormal.y) * smoothstep(0.55, 0.65, roughness) * smoothstep(0.5, 0.9, paintGuard) * (1.0 - metallic);
    wetGroundFacing = smoothstep(0.85, 0.92, geometricNormal.y) * (1.0 - metallic);
    // A pixel wider than the grain cannot show it: the grain fades with the pixel footprint so the far road does not speckle.
    // Geometric mean of the two footprint axes: at a grazing angle one axis is huge, and using it would erase the grain of the whole road.
    float pixelSize = sqrt(length(dFdx(worldPosition)) * length(dFdy(worldPosition)));
    float grainFade = 1.0 - smoothstep(0.006, 0.03, pixelSize);
    float wetGrain = (0.7 * (wearNoise(worldPosition * 38.0) - 0.5) + 0.3 * (wearNoise(worldPosition * 5.0) - 0.5)) * grainFade;
    // One stone height field (about a centimetre across) and two taps along the ground tangents give the stones their slopes.
    float stoneHeight = wearNoise(worldPosition * 90.0);
    vec3 groundTangent = normalize(cross(geometricNormal, abs(geometricNormal.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
    vec3 groundBitangent = cross(geometricNormal, groundTangent);
    float stoneSlopeU = (wearNoise((worldPosition + groundTangent * 0.004) * 90.0) - stoneHeight) / 0.36;
    float stoneSlopeV = (wearNoise((worldPosition + groundBitangent * 0.004) * 90.0) - stoneHeight) / 0.36;
    float stoneTop = smoothstep(0.35, 0.75, stoneHeight);
    color *= 1.0 - 0.6 * wetPorosity;
    float soakedRoughness = mix(roughness, roughness * ${SOAKED_ROAD_ROUGHNESS_SCALE.toFixed(2)}, wetGloss);
    float softRoughness = mix(roughness, mix(0.58, 0.46, wetSoak), wetGloss) + wetGrain * 0.14 * wetGloss;
    // Stone tops are glossier than the crevices between them; where the stones are smaller than a pixel their lost slope variance widens the highlight.
    float stoneRoughness = soakedRoughness * mix(1.0, 0.55, stoneTop * wetGloss * grainFade);
    stoneRoughness = sqrt(stoneRoughness * stoneRoughness + (1.0 - grainFade) * 0.03 * wetGloss);
    roughness = clamp(mix(softRoughness, stoneRoughness, gritGround), 0.075, 1.0);
    splatCavity *= 1.0 - 0.4 * wetPorosity;
    float standing = 0.0;
    float soakBand = 0.0;
    float interior = 0.0;
    if (wetnessState.y > 0.0) {
      float clearance = wetKeepOutDistance(worldPosition);
      float detailFade = 1.0 - smoothstep(0.03, 0.12, pixelSize);
      float puddleDepth = wetBasin(worldPosition, detailFade) - wetnessState.y - 6.0 * (worldPosition.y - wetnessState.w) - 0.3 * (1.0 - smoothstep(0.2, 1.0, clearance));
      // The stones break the rim: the same height field that makes the road grit lets the tops of stones stay dry at the shore.
      float stoneDepth = puddleDepth - 0.012 * (stoneHeight - 0.5) * grainFade;
      float gate = smoothstep(0.996, 0.9995, geometricNormal.y) * (1.0 - metallic) * smoothstep(0.18, 0.45, clearance) * paintGuard;
      float edgeWidth = max(fwidth(puddleDepth), 0.00001);
      standing = smoothstep(-edgeWidth, edgeWidth, stoneDepth) * gate;
      interior = smoothstep(0.012, 0.06, puddleDepth);
      soakBand = smoothstep(-0.10, 0.0, puddleDepth) * gate * (1.0 - standing);
    }
    wetStanding = standing;
    // Road stones tilt the normal up to about 0.4, less as they shrink under a pixel, and not at all under water.
    vec2 stoneTilt = clamp(vec2(stoneSlopeU, stoneSlopeV) * 0.3, -0.4, 0.4) * wetnessState.x * grainFade * gritGround * (1.0 - standing);
    normal = normalize(normal - groundTangent * stoneTilt.x - groundBitangent * stoneTilt.y);
    // The soaked road is a little more saturated (at most 1.2 times), and the soak band beside the shore is wetter and smoother.
    float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
    color = mix(vec3(luminance), color, mix(1.0, 1.2, wetPorosity * gritGround));
    color *= 1.0 - 0.2 * soakBand;
    roughness = mix(roughness, roughness * 0.75, soakBand);
    // Water: the bottom shows through the film, darker where it is deeper; the surface is flat and smooth, and the mirror does the rest.
    color *= mix(1.0, mix(0.7, 0.35, interior), standing);
    roughness = mix(roughness, ${WATER_SURFACE_ROUGHNESS.toFixed(2)}, standing);
    splatCavity *= 1.0 - 0.7 * standing;
    normal = normalize(mix(normal, vec3(0.0, 1.0, 0.0), standing));
  }
`,
  // Only the water mirrors the scene: the planar mirror reads the roughness after the lighting, so the road is set rough enough to show
  // none of it (weight 0 from roughness 0.5), the water smooth, and the shore pixels in between.
  worldLight: `  if (wetGroundFacing > 0.5) roughness = wetStanding > 0.99 ? ${WATER_SURFACE_ROUGHNESS.toFixed(2)} : mix(0.5, 0.35, wetStanding);
`,
});
