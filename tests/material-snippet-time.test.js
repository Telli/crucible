import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMaterialSnippet, probeMaterialSnippets, MATERIAL_SNIPPET_CAPABILITIES } from '../src/material-snippet.js';
import { createFragmentShader, withDepthCode, depthFragmentShader } from '../src/shaders.js';
import '../src/world-material-shader.js';

const FLICKER = `void materialHook(inout vec3 color, inout float alpha, vec2 uv, vec3 worldPosition, float seconds) {
  color *= 0.75 + 0.25 * sin(seconds * 6.0);
}`;
const FOUR_ARGUMENTS = `void materialHook(inout vec3 color, inout float alpha, vec2 uv, vec3 worldPosition) {
  color *= 0.5;
}`;

test('a materialHook with a fifth float parameter gets the frame time in the main and shadow shaders', () => {
  const snippet = normalizeMaterialSnippet({ fragment: FLICKER });
  const prefix = `u67_${snippet.feature}`;
  const main = createFragmentShader(['studioLighting', snippet.feature]);
  assert.match(main, new RegExp(`${prefix}_materialHook\\(color, textureAlpha, textureUV, worldPosition, time\\)`));
  const shadow = withDepthCode(depthFragmentShader, new Set([snippet.feature]));
  assert.match(shadow, new RegExp(`${prefix}_materialHook\\(hookColor, hookAlpha, textureUV, snippetWorld, time\\)`));
  assert.equal(shadow.split('uniform float time;').length, 2, 'the shadow fragment shader declares time once');
});

test('the four-argument materialHook is unchanged', () => {
  const snippet = normalizeMaterialSnippet({ fragment: FOUR_ARGUMENTS });
  const prefix = `u67_${snippet.feature}`;
  const main = createFragmentShader(['studioLighting', snippet.feature]);
  assert.match(main, new RegExp(`${prefix}_materialHook\\(color, textureAlpha, textureUV, worldPosition\\);`));
  assert.doesNotMatch(withDepthCode(depthFragmentShader, new Set([snippet.feature])), /snippetWorld, time/);
});

test('the time parameter must be a float and the probe compiles the call with it', () => {
  assert.throws(
    () => normalizeMaterialSnippet({ fragment: 'void materialHook(inout vec3 color, inout float alpha, vec2 uv, vec3 worldPosition, int seconds) { }' }),
    /entry function is missing/,
  );
  const snippet = normalizeMaterialSnippet({ fragment: FLICKER });
  let compiled = '';
  const context = {
    createShader: () => ({}),
    shaderSource: (_shader, text) => { compiled = text; },
    compileShader: () => {},
    getShaderParameter: () => true,
    deleteShader: () => {},
    getExtension: () => null,
    FRAGMENT_SHADER: 1,
    COMPILE_STATUS: 2,
  };
  probeMaterialSnippets([{ name: 'lamp', material: { snippet } }], () => context);
  assert.match(compiled, /materialHook\(color, alpha, vec2\(0\.5\), vec3\(0\.0\), 1\.5\);/);
  assert.match(MATERIAL_SNIPPET_CAPABILITIES.fields, /float time/);
});
