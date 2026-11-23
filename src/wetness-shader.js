// The GLSL of environment wetness (src/wetness.js), spliced into the main fragment shader only when the scene is wet, so a dry
// scene compiles the same program as before. wetnessState is (wetness response, puddle share, keep-out box count).
// Porous surfaces (not metal, rougher ones more) darken and lose some roughness. A puddle is a flat, near-black, glossy film on
// up-facing ground, laid where a smooth noise basin on the ground plane rises above a level that falls with world height, so water
// fills the low spots first. It keeps clear of thin raised parts (src/wetness-keep-out.js). Its normal points straight up and its
// roughness is the floor, so it mirrors the sky; a little metallic with a dark colour gives it the reflectance of water (about 0.02). The wet ground parts are flagged for the water mirror (src/water-reflection.js), whose weight and blur follow the roughness set here: the puddle shows a sharp mirror, the plain wet road a soft one.

export const WETNESS_CODE = Object.freeze({
  declarations: `uniform vec3 wetnessState;
uniform vec4 wetnessKeepOut[24];
float wetBasin(vec3 position) {
  vec3 plane = vec3(position.x * 0.55, 3.7, position.z * 0.55);
  return 0.85 * wearNoise(plane) + 0.15 * wearNoise(plane * 2.3 + vec3(17.0));
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
    float wetSoak = 1.0 - pow(1.0 - wetnessState.x, 3.0);
    float paintGuard = mix(1.0, 0.15, smoothstep(0.35, 0.65, max(color.r, max(color.g, color.b))));
    float wetPorosity = wetnessState.x * (1.0 - metallic) * mix(0.35, 1.0, roughness) * paintGuard;
    float wetGloss = wetSoak * (1.0 - metallic) * mix(0.5, 1.0, paintGuard);
    float wetGrain = 0.7 * (wearNoise(worldPosition * 38.0) - 0.5) + 0.3 * (wearNoise(worldPosition * 5.0) - 0.5);
    color *= 1.0 - 0.8 * wetPorosity;
    roughness = clamp(mix(roughness, 0.42, wetGloss) + wetGrain * 0.14 * wetGloss, 0.075, 1.0);
    splatCavity *= 1.0 - 0.4 * wetPorosity;
    float puddle = 0.0;
    float puddleDepth = 0.0;
    if (wetnessState.y > 0.0) {
      float clearance = wetKeepOutDistance(worldPosition);
      float fill = wetBasin(worldPosition) - mix(0.72, 0.42, wetnessState.y) - 6.0 * worldPosition.y - 0.3 * (1.0 - smoothstep(0.2, 1.0, clearance));
      // The edge fades over at least four pixels: a fixed 3.5 cm ramp is under a pixel wide on far ground and cuts the edge into stair steps.
      float fillEdge = clamp(4.0 * fwidth(fill), 0.035, 0.3);
      puddleDepth = smoothstep(0.0, 0.3, fill);
      puddle = smoothstep(0.0, fillEdge, fill) * smoothstep(0.96, 0.995, geometricNormal.y) * (1.0 - metallic) * smoothstep(0.18, 0.45, clearance) * paintGuard;
    }
    color *= 1.0 - 0.95 * puddle;
    // Deeper water and clean patches reflect more; a slow ripple of both keeps the film from being one flat tone.
    float puddleSheen = mix(puddleDepth, wearNoise(vec3(worldPosition.x * 1.7, 5.1, worldPosition.z * 1.7)), 0.6);
    metallic = mix(metallic, mix(0.8, 0.4, puddleSheen), puddle);
    roughness = mix(roughness, mix(0.16, 0.08, puddleSheen), puddle);
    splatCavity *= 1.0 - 0.7 * puddle;
    normal = normalize(mix(normal, vec3(0.0, 1.0, 0.0), puddle));
  }
`,
});
