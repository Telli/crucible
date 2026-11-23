import assert from 'node:assert/strict';
import test from 'node:test';
import { shaderFeaturesOfParts } from '../src/renderer.js';
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
  assert.match(vertex, /vertexOpacity = USES_CROWD \? 1\.0 : vertexColor\.a;/);
  const fragment = createFragmentShader(features);
  assert.match(fragment, /in float vertexOpacity;/);
  assert.match(fragment, /materialOpacity \* instanceOpacity \* textureAlpha \* vertexOpacity/);
  assert.doesNotMatch(createVertexShader(['vertexColors']), /#define VERTEX_ALPHA/);
  assert.match(createFragmentShader(['vertexColors']), /const float vertexOpacity = 1\.0;/);
});
