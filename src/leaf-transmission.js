// Sun through leaves for the foliage tag (issue #2991). A leaf is thin, so sun on its back face reaches the eye through it,
// filtered to a warmer, duller green, and most of all when looking toward the sun. The shadow map darkens leaves deep in
// the crown, so that glow lands on the thin edges the sun skims, as in a backlit tree. A leaf in the crown's own shadow
// still gets the sun that passed through the leaves above it, so the inside of a crown reads as dim green, not black.
// No extra pass: one term on the sun, added to shaders that draw foliage. The vegetation addon imports this module, so a
// scene without trees carries none of it.
import { shaderTransforms } from './shader-registry.js';

const FOLIAGE_ENABLED = '#define TAG_FOLIAGE (surface.w == 4.0)';
const SUN_LINE = /\n  vec3 radiance = illuminate\(normal, viewDirection, normalize\(lightDirection\), keyColor \* visibility \* shadowTint([^,]*), color, metallic, roughness\);/;
const DEFINITION_ANCHOR = '\nvec3 toneMap(vec3 color) {';

const LEAF_TRANSMISSION_CODE = `
const float LEAF_TRANSMISSION = 0.55;
const float LEAF_THROUGH_CROWN = 0.07;
vec3 leafTransmission(vec3 normal, vec3 viewDirection, vec3 lightDirection, vec3 sunColor, float visibility, vec3 color) {
  float behind = max(-dot(normal, lightDirection), 0.0);
  float towardSun = pow(max(dot(-viewDirection, lightDirection), 0.0), 4.0);
  vec3 filtered = mix(vec3(dot(color, vec3(0.3, 0.59, 0.11))), color, 0.7) * vec3(1.0, 0.95, 0.75);
  float direct = visibility * LEAF_TRANSMISSION * (0.4 * behind + 0.6 * towardSun);
  float throughCrown = (1.0 - visibility) * LEAF_THROUGH_CROWN;
  return filtered * sunColor * (direct + throughCrown);
}
`;

/** Adds leaf transmission to a fragment shader that draws foliage; every other source passes through unchanged. */
export function addLeafTransmission(source) {
  if (!source.includes(FOLIAGE_ENABLED) || !source.includes(DEFINITION_ANCHOR) || !SUN_LINE.test(source)) return source;
  const withDefinition = source.replace(DEFINITION_ANCHOR, () => LEAF_TRANSMISSION_CODE + DEFINITION_ANCHOR);
  return withDefinition.replace(SUN_LINE, (line, sunLink) => `${line}\n  if (TAG_FOLIAGE) radiance += leafTransmission(normal, viewDirection, normalize(lightDirection), keyColor * shadowTint${sunLink}, visibility, color);`);
}

shaderTransforms.push(addLeafTransmission);
