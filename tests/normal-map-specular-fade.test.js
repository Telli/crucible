import test from 'node:test';
import assert from 'node:assert/strict';
import { createFragmentShader, NORMAL_MAP_SPECULAR_FADE_STRENGTH } from '../src/shaders.js';

const FADE = 'normalMapSpecularFade';

function occurrences(source, text) {
  return source.split(text).length - 1;
}

test('a shader without a normal map carries none of the specular fade code', () => {
  for (const features of [[], ['baseMap'], ['metallicRoughnessMap', 'occlusionMap']]) {
    assert.equal(createFragmentShader(features).includes(FADE), false, `features ${features.join(',') || 'none'}`);
  }
});

test('a shader with a normal map declares the fade, applies it to the direct specular and sets it from the normal variance', () => {
  for (const features of [['normalMap'], ['normalMap', 'baseMap'], ['normalMap', 'tangents']]) {
    const source = createFragmentShader(features);
    const declaration = source.indexOf(`float ${FADE} = 1.0;`);
    const illuminate = source.indexOf('vec3 illuminate(');
    const application = source.indexOf(`specular *= ${FADE};`);
    const assignment = source.indexOf(`${FADE} = 1.0 / (1.0 + ${NORMAL_MAP_SPECULAR_FADE_STRENGTH}.0 * specularAntiAliasing * normalVariance);`);
    const widening = source.indexOf('roughness = clamp(sqrt(roughness * roughness + specularAntiAliasing * widening)');
    assert.equal(occurrences(source, `float ${FADE} = 1.0;`), 1, 'one declaration');
    assert.ok(declaration >= 0 && declaration < illuminate, 'declared before illuminate');
    assert.ok(application > illuminate, 'applied inside illuminate');
    assert.ok(assignment > widening && widening > 0, 'set after the roughness widening, from the final shading normal');
    assert.match(source, /normalVariance = 0\.5 \* \(dot\(fadeNormalX, fadeNormalX\) \+ dot\(fadeNormalY, fadeNormalY\)\) \+ 0\.5 \* normalMapVariance;/);
  }
});

test('the fade strength is a positive whole number that the shader prints as a float literal', () => {
  assert.ok(Number.isInteger(NORMAL_MAP_SPECULAR_FADE_STRENGTH) && NORMAL_MAP_SPECULAR_FADE_STRENGTH > 0);
});
