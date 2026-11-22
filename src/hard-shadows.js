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

function normalized(vector) {
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  return vector.map(component => component / length);
}

function crossProduct(first, second) {
  return [
    first[1] * second[2] - first[2] * second[1],
    first[2] * second[0] - first[0] * second[2],
    first[0] * second[1] - first[1] * second[0],
  ];
}

function dotProduct(first, second) {
  return first[0] * second[0] + first[1] * second[1] + first[2] * second[2];
}

/**
 * A hard shadow view moved sideways so its target sits on a whole shadow texel in light space. The edges of a hard shadow
 * are single texels, and they only stay put on a pan when the texel grid stays put; the shift is under half a texel.
 * Any other view comes back unchanged. `light` is the result of `resolveShadowLight`.
 */
export function snapShadowView(light, mapSize) {
  if (!light.hard) return light;
  const forward = normalized(light.target.map((value, axis) => value - light.eye[axis]));
  const right = normalized(crossProduct(forward, light.up ?? [0, 1, 0]));
  const up = crossProduct(right, forward);
  const texel = (light.extent * 2) / mapSize;
  const shift = [right, up].map(axis => {
    const position = dotProduct(light.target, axis);
    return Math.round(position / texel) * texel - position;
  });
  const move = point => point.map((value, axis) => value + right[axis] * shift[0] + up[axis] * shift[1]);
  return { ...light, eye: move(light.eye), target: move(light.target) };
}

// The renderer reads the snap from the registered code, so a scene without hard shadows never loads it.
registerShaderFeatureCode('hardShadows', { declarations: HARD_SHADOW_DECLARATIONS, snapView: snapShadowView });
