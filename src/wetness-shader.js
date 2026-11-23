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
/** How far (in noise-basin depth units, about 3 cm per 0.01) the damp band reaches outside the shore, and how much it darkens the road at the shore. */
export const WET_FRINGE_WIDTH = '0.02';
export const WET_FRINGE_DARKENING = '0.5';
/** The stone height range over which a stone top in the damp band turns glossy: none below the first, all above the second. */
export const WET_FRINGE_GLINT_STONE = Object.freeze(['0.7', '0.85']);
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
// Road aggregate of mixed sizes: stones about 3.3 cm, 1.4 cm and 6 mm across, the small ones the most contrasty. Each octave sits on its own
// rotated lattice so no square cell shows, and fades out (its fade goes 1 to 0) where a pixel is wider than a fraction of its stones.
// Heights centre on 0.5.
float wetStone(vec3 position, vec3 fades) {
  float height = 0.5;
  if (fades.x > 0.0) height += 0.35 * (wearNoise(vec3(position.x * 0.8 - position.z * 0.6, position.y, position.x * 0.6 + position.z * 0.8) * 30.0) - 0.5) * fades.x;
  if (fades.y > 0.0) height += 0.45 * (wearNoise(vec3(position.x * 0.485 - position.z * 0.875, position.y, position.x * 0.875 + position.z * 0.485) * 70.0 + vec3(11.0)) - 0.5) * fades.y;
  if (fades.z > 0.0) height += 0.6 * (wearNoise(vec3(position.x * 0.96 + position.z * 0.28, position.y, position.z * 0.96 - position.x * 0.28) * 160.0 + vec3(23.0)) - 0.5) * fades.z;
  return height;
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
    // A pixel wider than the stones cannot show them: each octave fades with the pixel footprint so the far road does not speckle.
    // Geometric mean of the two footprint axes: at a grazing angle one axis is huge, and using it would erase the grain of the whole road.
    float pixelSize = sqrt(length(dFdx(worldPosition)) * length(dFdy(worldPosition)));
    vec3 stoneFades = 1.0 - vec3(smoothstep(0.009, 0.03, pixelSize), smoothstep(0.0055, 0.016, pixelSize), smoothstep(0.0018, 0.0049, pixelSize));
    float grainFade = stoneFades.x;
    float wallGrainFade = 1.0 - smoothstep(0.006, 0.03, pixelSize);
    // The grit eases in from the first drop of wetness instead of switching on, so a barely wet road is still the same road.
    float wetGrit = wetnessState.x * sqrt(wetnessState.x);
    // A road with scanned maps keeps its own grit: the stone heights come from its colour map (stones lighter than the binder) and its
    // slopes from its normal map, so the road is the same road dry, damp and wet. Only a road without maps gets the procedural stones.
    float scannedRoad = (USES_BASE_MAP && !BOX_MAPPED) ? 1.0 : 0.0;
    float stoneHeight = 0.5;
    float stoneSlopeU = 0.0;
    float stoneSlopeV = 0.0;
    vec3 groundTangent = normalize(cross(geometricNormal, abs(geometricNormal.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
    vec3 groundBitangent = cross(geometricNormal, groundTangent);
    if (scannedRoad > 0.5) {
      vec2 scanCoordinates = mapUV(hasBaseMap);
      float scanTone = dot(texture(baseMap, scanCoordinates).rgb, vec3(0.2126, 0.7152, 0.0722));
      float scanMeanTone = dot(textureLod(baseMap, scanCoordinates, 10.0).rgb, vec3(0.2126, 0.7152, 0.0722));
      stoneHeight = clamp(0.5 + 0.8 * (scanTone / max(scanMeanTone, 0.0001) - 1.0), 0.0, 1.0);
    } else {
      stoneHeight = wetStone(worldPosition, stoneFades);
      stoneSlopeU = (wetStone(worldPosition + groundTangent * 0.003, stoneFades) - stoneHeight) / 0.003;
      stoneSlopeV = (wetStone(worldPosition + groundBitangent * 0.003, stoneFades) - stoneHeight) / 0.003;
    }
    float stoneTop = smoothstep(0.44, 0.60, stoneHeight);
    // Walls, crowns and paint keep the soft grain they had.
    float wetGrain = 0.0;
    if (gritGround < 0.999) wetGrain = 0.7 * (wearNoise(worldPosition * 38.0) - 0.5) * wallGrainFade;
    color *= 1.0 - 0.6 * wetPorosity;
    // Stone and gap differ in tone as well as in gloss, so the grit reads on a road that is only damp.
    color *= 1.0 + 1.0 * (stoneHeight - 0.5) * wetGrit * gritGround * (1.0 - scannedRoad);
    float soakedRoughness = mix(roughness, roughness * ${SOAKED_ROAD_ROUGHNESS_SCALE.toFixed(2)}, wetGloss);
    float softRoughness = mix(roughness, mix(0.58, 0.46, wetSoak), wetGloss) + wetGrain * 0.14 * wetGloss;
    // Stone tops are glossier than the crevices between them. Where an octave is smaller than a pixel, its lost slope variance widens the highlight.
    float stoneRoughness = soakedRoughness * mix(1.0, 0.72, stoneTop * wetGloss * grainFade);
    stoneRoughness = sqrt(stoneRoughness * stoneRoughness + ((1.0 - stoneFades.x) * 0.015 + (1.0 - stoneFades.y) * 0.02 + (1.0 - stoneFades.z) * 0.03) * wetGloss);
    roughness = clamp(mix(softRoughness, stoneRoughness, gritGround), 0.075, 1.0);
    splatCavity *= 1.0 - 0.4 * wetPorosity;
    float standing = 0.0;
    float soakBand = 0.0;
    float fringe = 0.0;
    float interior = 0.0;
    if (wetnessState.y > 0.0) {
      float clearance = wetKeepOutDistance(worldPosition);
      float detailFade = 1.0 - smoothstep(0.03, 0.12, pixelSize);
      float puddleDepth = wetBasin(worldPosition, detailFade) - wetnessState.y - 6.0 * (worldPosition.y - wetnessState.w) - 0.3 * (1.0 - smoothstep(0.2, 1.0, clearance));
      // The stones break the rim: the same height field that makes the road grit lets the tops of stones stay dry at the shore.
      float stoneDepth = puddleDepth - 0.024 * (stoneHeight - 0.5);
      float gate = smoothstep(0.996, 0.9995, geometricNormal.y) * (1.0 - metallic) * smoothstep(0.18, 0.45, clearance) * paintGuard;
      // The shore is anti-aliased on the whole depth, stones included: a stone term steeper than the basin would otherwise step across pixels.
      float edgeWidth = max(1.5 * fwidth(stoneDepth), 0.00001);
      standing = smoothstep(-edgeWidth, edgeWidth, stoneDepth) * gate;
      interior = smoothstep(0.012, 0.06, puddleDepth);
      // Just outside the water the road is a damp band, darker than dry road and fading out over a few centimetres.
      fringe = smoothstep(-${WET_FRINGE_WIDTH}, 0.0, stoneDepth) * gate * (1.0 - standing);
      soakBand = smoothstep(-0.10, 0.0, puddleDepth) * gate * (1.0 - standing);
    }
    wetStanding = standing;
    // Road stones tilt the normal, less as they shrink under a pixel, and not at all under water.
    vec2 stoneTilt = clamp(vec2(stoneSlopeU, stoneSlopeV) * 0.003, -0.35, 0.35) * wetGrit * gritGround * (1.0 - standing);
    normal = normalize(normal - groundTangent * stoneTilt.x - groundBitangent * stoneTilt.y);
    // The soaked road is a little more saturated (at most 1.2 times); the soak band beside the shore is darker, the fringe darker and glossier.
    float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
    color = mix(vec3(luminance), color, mix(1.0, 1.2, wetPorosity * gritGround));
    color *= (1.0 - 0.15 * soakBand) * (1.0 - ${WET_FRINGE_DARKENING} * fringe * (1.0 - 0.5 * stoneTop));
    // A few stone tops in the damp band glint, and only seen at a grazing angle; the rest of the band keeps the road's satin finish.
    float fringeGlint = fringe * smoothstep(${WET_FRINGE_GLINT_STONE[0]}, ${WET_FRINGE_GLINT_STONE[1]}, stoneHeight) * smoothstep(0.55, 0.2, dot(geometricNormal, viewDirection));
    roughness = mix(roughness, 0.2, fringeGlint);
    // Water: the bottom shows through the film, darker where it is deeper; the surface is flat, with a faint slow ripple, and the mirror does the rest.
    color *= mix(1.0, mix(0.7, 0.35, interior), standing);
    roughness = mix(roughness, ${WATER_SURFACE_ROUGHNESS.toFixed(2)}, standing);
    splatCavity *= 1.0 - 0.7 * standing;
    vec2 wetRipple = vec2(sin(worldPosition.x * 2.3 + worldPosition.z * 1.3 + time * 0.5) + 0.6 * sin(worldPosition.x * 5.9 - worldPosition.z * 4.1 - time * 0.8),
      sin(worldPosition.z * 2.1 - worldPosition.x * 0.9 + time * 0.45) + 0.6 * sin(worldPosition.z * 6.3 + worldPosition.x * 3.7 - time * 0.7)) * 0.005;
    normal = normalize(mix(normal, normalize(vec3(wetRipple.x, 1.0, wetRipple.y)), standing));
  }
`,
  // Only the water mirrors the scene: the planar mirror reads the roughness after the lighting, so the road is set rough enough to show
  // none of it (weight 0 from roughness 0.5), the water smooth, and the shore pixels in between.
  worldLight: `  if (wetGroundFacing > 0.5) roughness = wetStanding > 0.99 ? ${WATER_SURFACE_ROUGHNESS.toFixed(2)} : mix(0.5, 0.35, wetStanding);
`,
});
