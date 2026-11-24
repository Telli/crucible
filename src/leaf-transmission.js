// Sun through leaves for the foliage tag (issue #2991). A leaf is thin, so sun on its back face reaches the eye through it,
// filtered to a warmer, yellower green, and most of all when looking toward the sun: a tree with the sun behind it glows from
// every leaf the light has crossed, and a tree lit from the side does not. Sun that was stopped by the crown's own shadow still
// reaches a leaf through the leaves above it, in the share `LEAF_THROUGH_CROWN`, and the leaf's vertex colour (darker and cooler
// deep in the crown, baked at build time) sets how much of it shows, so the glow fades toward the crown's centre. A leaf in
// shade also keeps a little sun that passed through the leaves above it, so the inside reads as dim green, not black.
// No extra pass: one term on the sun, added to shaders that draw foliage. The vegetation addon imports this module, so a
// scene without trees carries none of it.
import { shaderTransforms } from './shader-registry.js';

const FOLIAGE_ENABLED = '#define TAG_FOLIAGE (surface.w == 4.0)';
const SUN_LINE = /\n  vec3 radiance = illuminate\(normal, viewDirection, normalize\(lightDirection\), keyColor \* visibility \* shadowTint([^,]*), color, metallic, roughness\);/;
const DEFINITION_ANCHOR = '\nvec3 toneMap(vec3 color) {';
// The sun's shadow test of `shadowVisibility`: a leaf card is thin and its shading normal is the crown's, not its own, so at the
// usual bias the sunlit flank of a crown shadows itself in specks. A foliage shader takes a larger bias; a leaf is a few
// millimetres thick, so nothing floats off its shadow.
const SHADOW_BIAS_LINE = '  float bias = shadowBiasPerSlope * clamp(sqrt(1.0 - cosine * cosine) / cosine, 0.25, 4.0);';
/** How many times the usual shadow bias a foliage shader uses for the sun (measured: the sunlit half of an oak crown gains 15 percent). */
export const FOLIAGE_SHADOW_BIAS_SCALE = 8;

/** The numbers of the term; the shader and `leafTransmissionReference` both read them. */
export const LEAF_TRANSMISSION_PARAMETERS = Object.freeze({
  strength: 0.8,
  throughCrown: 0.45,
  shadeGlow: 0.07,
  behindWeight: 0.3,
  towardSunWeight: 0.7,
  towardSunSharpness: 3.0,
  towardSunFloor: 0.35,
  desaturation: 0.7,
  filter: Object.freeze([0.95, 1.05, 0.5]),
});

const { strength, throughCrown, shadeGlow, behindWeight, towardSunWeight, towardSunSharpness, towardSunFloor, desaturation, filter } = LEAF_TRANSMISSION_PARAMETERS;
const glslFloat = value => (Number.isInteger(value) ? `${value}.0` : String(value));

const LEAF_TRANSMISSION_CODE = `
const float LEAF_TRANSMISSION = ${glslFloat(strength)};
const float LEAF_THROUGH_CROWN = ${glslFloat(throughCrown)};
const float LEAF_SHADE_GLOW = ${glslFloat(shadeGlow)};
vec3 leafTransmission(vec3 normal, vec3 viewDirection, vec3 lightDirection, vec3 sunColor, float visibility, vec3 color) {
  float behind = max(-dot(normal, lightDirection), 0.0);
  float towardSun = pow(max(dot(-viewDirection, lightDirection), 0.0), ${glslFloat(towardSunSharpness)});
  vec3 filtered = mix(vec3(dot(color, vec3(0.3, 0.59, 0.11))), color, ${glslFloat(desaturation)}) * vec3(${filter.map(glslFloat).join(', ')});
  float reach = mix(LEAF_THROUGH_CROWN, 1.0, visibility);
  float glow = ${glslFloat(behindWeight)} * behind + ${glslFloat(towardSunWeight)} * towardSun * (${glslFloat(towardSunFloor)} + ${glslFloat(1 - towardSunFloor)} * behind);
  return filtered * sunColor * (reach * LEAF_TRANSMISSION * glow + (1.0 - visibility) * LEAF_SHADE_GLOW);
}
`;

/**
 * The same arithmetic as the shader on plain numbers (unit vectors, `visibility` in [0, 1]), for tests and for reading what the
 * term does: how much of the sun colour, filtered by the leaf, reaches the eye.
 */
export function leafTransmissionReference({ normal, viewDirection, lightDirection, visibility, color }) {
  const dot = (first, second) => first[0] * second[0] + first[1] * second[1] + first[2] * second[2];
  const behind = Math.max(-dot(normal, lightDirection), 0);
  const towardSun = Math.max(-dot(viewDirection, lightDirection), 0) ** towardSunSharpness;
  const gray = color[0] * 0.3 + color[1] * 0.59 + color[2] * 0.11;
  const reach = throughCrown + (1 - throughCrown) * visibility;
  const glow = behindWeight * behind + towardSunWeight * towardSun * (towardSunFloor + (1 - towardSunFloor) * behind);
  return color.map((channel, index) => (gray + (channel - gray) * desaturation) * filter[index] * (reach * strength * glow + (1 - visibility) * shadeGlow));
}

/** Adds leaf transmission to a fragment shader that draws foliage; every other source passes through unchanged. */
export function addLeafTransmission(source) {
  if (!source.includes(FOLIAGE_ENABLED) || !source.includes(DEFINITION_ANCHOR) || !SUN_LINE.test(source)) return source;
  const withBias = source.replace(SHADOW_BIAS_LINE, () => `${SHADOW_BIAS_LINE.slice(0, -1)} * ${glslFloat(FOLIAGE_SHADOW_BIAS_SCALE)};`);
  const withDefinition = withBias.replace(DEFINITION_ANCHOR, () => LEAF_TRANSMISSION_CODE + DEFINITION_ANCHOR);
  return withDefinition.replace(SUN_LINE, (line, sunLink) => `${line}\n  if (TAG_FOLIAGE) radiance += leafTransmission(normal, viewDirection, normalize(lightDirection), keyColor * shadowTint${sunLink}, visibility, color);`);
}

shaderTransforms.push(addLeafTransmission);
