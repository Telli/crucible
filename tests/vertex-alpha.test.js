import assert from 'node:assert/strict';
import test from 'node:test';
import { interleaveColorsWithSkyVisibility, shaderFeaturesOfParts } from '../src/renderer.js';
import { createFragmentShader, createVertexShader } from '../src/shaders.js';

const TRIANGLE = { positions: new Float32Array(9), indices: new Uint32Array([0, 1, 2]) };

function blendedPart(geometry, tag) {
  return { geometry, material: { alphaMode: 'blend', tag } };
}

test('a part whose geometry carries a colour alpha turns the vertexAlpha feature on (#2948)', () => {
  const faded = shaderFeaturesOfParts([blendedPart({ ...TRIANGLE, colors: new Float32Array(9), colorAlpha: new Float32Array([0, 1, 0]) }, 'unlit')]);
  assert.ok(faded.has('vertexAlpha'));
  assert.ok(faded.has('vertexColors'));
  const plain = shaderFeaturesOfParts([blendedPart({ ...TRIANGLE, colors: new Float32Array(9) }, 'unlit')]);
  assert.ok(!plain.has('vertexAlpha'));
});

test('the vertexAlpha shader reads the fourth colour component as opacity and multiplies it into the surface alpha (#2948)', () => {
  const features = ['vertexColors', 'vertexAlpha'];
  const vertex = createVertexShader(features);
  assert.match(vertex, /#define VERTEX_ALPHA/);
  assert.match(vertex, /vertexOpacity = USES_CROWD \? 1\.0 : alphaLevel \/ 1023\.0;/);
  const fragment = createFragmentShader(features);
  assert.match(fragment, /in float vertexOpacity;/);
  assert.match(fragment, /materialOpacity \* instanceOpacity \* textureAlpha \* vertexOpacity/);
  assert.doesNotMatch(createVertexShader(['vertexColors']), /#define VERTEX_ALPHA/);
  assert.match(createFragmentShader(['vertexColors']), /const float vertexOpacity = 1\.0;/);
});

function unpackLikeTheShader(packed) {
  const alphaLevel = Math.floor(packed / 1024);
  return { alpha: alphaLevel / 1023, skyVisibility: (packed - alphaLevel * 1024) / 1023 };
}

test('a part with colorAlpha keeps its baked sky visibility in the same vertex component (#2948)', () => {
  const geometry = {
    ...TRIANGLE,
    colors: new Float32Array(9).fill(1),
    colorAlpha: new Float32Array([0, 0.5, 1]),
    skyVisibility: new Float32Array([1, 0.25, 0]),
  };
  const buffer = interleaveColorsWithSkyVisibility(geometry);
  for (let vertex = 0; vertex < 3; vertex++) {
    const { alpha, skyVisibility } = unpackLikeTheShader(buffer[vertex * 4 + 3]);
    assert.ok(Math.abs(alpha - geometry.colorAlpha[vertex]) < 1 / 1023);
    assert.ok(Math.abs(skyVisibility - geometry.skyVisibility[vertex]) < 1 / 1023);
  }
  const withoutSky = interleaveColorsWithSkyVisibility({ ...geometry, skyVisibility: undefined });
  assert.equal(unpackLikeTheShader(withoutSky[3]).skyVisibility, 1);
});

test('a part with wear masks keeps them over a colour alpha and does not take the vertexAlpha feature (#2948)', () => {
  const masks = new Float32Array([2, 3, 4]);
  const geometry = { ...TRIANGLE, colors: new Float32Array(9), colorAlpha: new Float32Array(3).fill(0.5), surfaceMasks: masks };
  assert.deepEqual(Array.from(interleaveColorsWithSkyVisibility(geometry)).filter((_, index) => index % 4 === 3), [2, 3, 4]);
  assert.ok(!shaderFeaturesOfParts([blendedPart(geometry, 'unlit')]).has('vertexAlpha'));
});
