// The GLSL of environment wetness (src/wetness.js), spliced into the main fragment shader only when the scene is wet, so a dry
// scene compiles the same program as before. wetnessState is (wetness, puddle share, puddle source).
// Porous surfaces (not metal, rougher ones more) darken and lose roughness. A puddle is a flat, dark, glossy film on up-facing
// ground, laid where a noise basin on the ground plane rises above a level that falls with world height, so water fills the
// low spots first. Its normal points straight up and its roughness is the floor, so the sky reflects in it.

export const WETNESS_CODE = Object.freeze({
  declarations: `uniform vec3 wetnessState;
float wetBasin(vec3 position) {
  vec3 plane = vec3(position.x * 0.4, 3.7, position.z * 0.4);
  return 0.65 * wearNoise(plane) + 0.35 * wearNoise(plane * 3.1 + vec3(17.0));
}
`,
  worldSurface: `  if (!TAG_WATER && !TAG_FIRE && !TAG_SMOKE && wetnessState.x > 0.0) {
    float wetPorosity = wetnessState.x * (1.0 - metallic) * mix(0.35, 1.0, roughness);
    color *= 1.0 - 0.6 * wetPorosity;
    roughness = clamp(roughness * (1.0 - 0.55 * wetPorosity), 0.075, 1.0);
    float puddle = 0.0;
    if (wetnessState.y > 0.0) {
      float fill = wetBasin(worldPosition) - mix(0.72, 0.42, wetnessState.y) - 6.0 * worldPosition.y;
      puddle = smoothstep(0.0, 0.015, fill) * smoothstep(0.96, 0.995, geometricNormal.y) * (1.0 - metallic);
    }
    color *= 1.0 - 0.9 * puddle;
    roughness = mix(roughness, 0.075, puddle);
    normal = normalize(mix(normal, vec3(0.0, 1.0, 0.0), puddle));
  }
`,
});
