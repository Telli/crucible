import { registerShaderFeatureCode, layerTextureSupport } from './shader-registry.js';
import { MATERIAL_LAYER_STATE_LENGTH } from './material-layers.js';

// Shader code for the toon material option. It lives outside shaders.js so a scene without banded light never carries it:
// the renderer asks for the `toon` feature only when a part has `toon` above 0, or when the line art addon turns on a
// default for every material (line-art.js).
//
// toonLight turns the cosine of a light into steps. Each light the material receives is stepped on its own, so a
// scene with a sun and a lamp shows two sets of bands. `materialToon` is the step count of the material and
// `toonDefault` the count for a material that sets none; 0 in both leaves the smooth light. The edge between steps is
// 0.02 of the light range wide, which antialiases without derivatives (those are undefined in the light loops).
//
// A material with `toonColors` has one colour per step, darkest first. toonStepColor picks the colour of the step the
// light falls in, blending with the step below across the same narrow edge, and illuminate multiplies the light by it in
// place of the grey step level, so the darkest step can be a tint rather than black. The side facing away from a light
// gets no direct light at all, so it shows the ambient light.
//
// `toonEdge` picks the edge between steps: 0 the soft edge (default), 1 a hard step, 2 a hard step after an ordered
// Bayer 4 by 4 threshold moves each pixel's light by up to half a step either way, so the edge becomes a pattern of pixels.

const TOON_SOFTNESS = '0.02';

export const MAX_TOON_STEPS = 8;

const TOON_DECLARATIONS = `uniform float materialToon;
uniform float toonDefault;
uniform float materialToonColored;
uniform vec3 materialToonColors[${MAX_TOON_STEPS}];
uniform float materialToonEdge;
const float BAYER_4[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
float toonScaledLight(float light, float bands) {
  float scaled = clamp(light, 0.0, 1.0) * bands;
  if (materialToonEdge < 1.5) return scaled;
  ivec2 cell = ivec2(mod(gl_FragCoord.xy, 4.0));
  float threshold = (BAYER_4[cell.y * 4 + cell.x] + 0.5) / 16.0 - 0.5;
  return clamp(scaled + threshold, 0.0, bands);
}
float toonStepEdge(float scaled, float band, float bands) {
  if (materialToonEdge > 0.5) return scaled > band ? 1.0 : 0.0;
  return smoothstep(0.0, ${TOON_SOFTNESS} * bands, scaled - band);
}
float toonLight(float light) {
  float bands = materialToon > 0.0 ? materialToon : toonDefault;
  if (bands <= 0.0) return light;
  float scaled = toonScaledLight(light, bands);
  float band = floor(scaled);
  return (band + toonStepEdge(scaled, band, bands)) / bands;
}
vec3 toonStepColor(float light) {
  float scaled = toonScaledLight(light, materialToon);
  float band = floor(scaled);
  int top = int(min(band, materialToon - 1.0));
  if (top == 0) return materialToonColors[0];
  float blend = band >= materialToon ? 1.0 : toonStepEdge(scaled, band, materialToon);
  return mix(materialToonColors[top - 1], materialToonColors[top], blend);
}
`;

registerShaderFeatureCode('toon', Object.freeze({
  declarations: TOON_DECLARATIONS,
  illuminateReflectance: `  if (materialToonColored > 0.5) {
    radiance *= toonStepColor(normalLight);
    normalLight = 1.0;
  } else {
    normalLight = toonLight(normalLight);
  }
`,
}));

const TOON_COLORS_STATE_INDEX = MATERIAL_LAYER_STATE_LENGTH - 2;
const TOON_EDGE_STATE_INDEX = MATERIAL_LAYER_STATE_LENGTH - 1;
const parsedColorsByState = new Map();

function toonColorValues(colorsState) {
  if (!parsedColorsByState.has(colorsState)) {
    const values = new Float32Array(MAX_TOON_STEPS * 3);
    values.set(JSON.parse(colorsState).flat());
    parsedColorsByState.set(colorsState, values);
  }
  return parsedColorsByState.get(colorsState);
}

function uniformOf(renderer, name) {
  renderer.uniforms[name] ??= renderer.context.getUniformLocation(renderer.program, name);
  return renderer.uniforms[name];
}

// Other optional features also bind per batch, so this keeps whatever was registered first.
const previousBind = layerTextureSupport.bind;
layerTextureSupport.bind = (renderer, mapState, layerState, batch) => {
  previousBind?.(renderer, mapState, layerState, batch);
  if (!renderer.shaderFeatures?.has('toon')) return;
  const colorsState = layerState[TOON_COLORS_STATE_INDEX];
  renderer.context.uniform1f(uniformOf(renderer, 'materialToonEdge'), layerState[TOON_EDGE_STATE_INDEX]);
  renderer.context.uniform1f(uniformOf(renderer, 'materialToonColored'), colorsState ? 1 : 0);
  if (colorsState) renderer.context.uniform3fv(uniformOf(renderer, 'materialToonColors'), toonColorValues(colorsState));
};
