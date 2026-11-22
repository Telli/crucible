import { registerShaderFeatureCode } from './shader-registry.js';

// Shader code for the opt-in hard sun shadow (`shadow.hard`). It lives outside shaders.js so a scene with soft shadows never
// carries it. One depth compare per pixel replaces the 3 by 3 filter of shadowVisibility, and the lookup is moved to the middle
// of its shadow texel so the four texels the sampler blends are the same one: the edge is a clean step, one texel wide at most.
// The shadow view is snapped to whole texels on the CPU (snapShadowView in shadow-light.js), so the steps do not crawl on a pan.
const HARD_SHADOW_DECLARATIONS = `float hardShadowVisibility(vec3 normal) {
  vec3 projected = shadowPosition.xyz / shadowPosition.w * 0.5 + 0.5;
  if (projected.z > 1.0 || projected.z < 0.0 || any(lessThan(projected.xy, vec2(0.0))) || any(greaterThan(projected.xy, vec2(1.0)))) return 1.0;
  float cosine = max(dot(normal, normalize(lightDirection)), 0.05);
  float bias = shadowBiasPerSlope * clamp(sqrt(1.0 - cosine * cosine) / cosine, 0.25, 4.0);
  vec2 size = vec2(textureSize(shadowMap, 0));
  vec2 texelCentre = (floor(projected.xy * size) + 0.5) / size;
  return texture(shadowMap, vec3(texelCentre, projected.z - bias));
}
#define shadowVisibility(normal) hardShadowVisibility(normal)
`;

registerShaderFeatureCode('hardShadows', { declarations: HARD_SHADOW_DECLARATIONS });
