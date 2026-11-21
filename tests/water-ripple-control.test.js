import './support/load-agent-scene-modules.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentScene } from '../src/agent-scene.js';
import { createFragmentShader } from '../src/shaders.js';
import { layerTextureSupport } from '../src/shader-registry.js';
import { resolveWaterRipples, waterRipplesUniform } from '../src/world-material-shader.js';

function waterRecipe(fields) {
  return {
    format: 'crucible.scene', schemaVersion: 1,
    geometries: [{ id: 'sheet', type: 'plane' }],
    materials: [{ id: 'surface', color: [0.1, 0.2, 0.3], tag: 'water', ...fields }],
    nodes: [{ id: 'sea', geometry: 'sheet', material: 'surface' }],
  };
}

test('a water material takes ripples with defaults and refuses bad values with what to pass', () => {
  const given = createAgentScene(waterRecipe({ ripples: { strength: 0.3, speed: 0.5, windDirection: 90 } })).parts[0].material.ripples;
  assert.deepEqual({ ...given }, { strength: 0.3, speed: 0.5, windDirection: 90 });
  const defaults = createAgentScene(waterRecipe({ ripples: {} })).parts[0].material.ripples;
  assert.deepEqual({ ...defaults }, { strength: 1, speed: 1 });
  assert.equal(createAgentScene(waterRecipe({})).parts[0].material.ripples, undefined);
  const refusals = [
    [{ ripples: 0.5 }, /ripples must be an object such as/],
    [{ ripples: [] }, /ripples must be an object such as/],
    [{ ripples: { calm: 1 } }, /no field calm; pass strength, speed or windDirection/],
    [{ ripples: { strength: 2 } }, /ripples\.strength must be a number from 0 to 1, such as 1/],
    [{ ripples: { speed: -1 } }, /ripples\.speed must be a number from 0 to 2/],
    [{ ripples: { windDirection: 'north' } }, /ripples\.windDirection must be a number from -360 to 360/],
  ];
  for (const [bad, message] of refusals) {
    assert.throws(() => createAgentScene(waterRecipe(bad)), message, JSON.stringify(bad));
  }
  const plain = waterRecipe({ ripples: {} });
  delete plain.materials[0].tag;
  assert.throws(() => createAgentScene(plain), /ripples need the water tag/);
  assert.equal(resolveWaterRipples({ strength: 0 }).strength, 0);
  assert.throws(() => resolveWaterRipples({ strength: NaN }), /ripples.strength must be a number/);
});

test('the ripple uniform is the unchanged look without ripples, and carries wind alignment in radians when given', () => {
  assert.deepEqual(waterRipplesUniform(undefined), [1, 1, 0, 0]);
  assert.deepEqual(waterRipplesUniform({ strength: 0.25, speed: 0.5 }), [0.25, 0.5, 0, 0]);
  assert.deepEqual(waterRipplesUniform({ strength: 0.25, speed: 1, windDirection: 180 }), [0.25, 1, 1, Math.PI]);
  assert.deepEqual(waterRipplesUniform({ strength: 1, speed: 1, windDirection: 0 }), [1, 1, 1, 0]);
});

test('a water batch sends its ripples, and a batch without ripples sends the defaults', () => {
  const sent = [];
  const renderer = {
    shaderFeatures: new Set(['water']),
    program: {},
    batches: [],
    context: new Proxy({}, {
      get: (_target, name) => {
        if (name === 'getUniformLocation') return (_program, uniform) => uniform;
        if (name === 'uniform4f') return (uniform, ...values) => uniform === 'waterRipples' && sent.push(values);
        return () => null;
      },
    }),
  };
  const bind = material => layerTextureSupport.bind(renderer, {}, {}, { parts: [{ material }] });
  bind({ tag: 'water', ripples: { strength: 0.3, speed: 0.6, windDirection: 90 } });
  bind({ tag: 'water' });
  assert.deepEqual(sent, [[0.3, 0.6, 1, Math.PI / 2], [1, 1, 0, 0]]);
});

test('the shader scales the ripple height and the time term by the ripple uniform and leaves the default expressions in place', () => {
  const shader = createFragmentShader(['water', 'vertexColors']);
  assert.match(shader, /uniform vec4 waterRipples;/);
  assert.ok(shader.includes('time * waterRipples.y * sqrt(9.81 * wavenumber)'), 'speed scales the clock; strength 0 zeroes the amplitude that multiplies the whole term');
  assert.ok(shader.includes('* strength * waterRipples.x;'), 'strength scales every ripple height');
  assert.ok(shader.includes('slope += direction * cos(phase) * amplitude * visible;'), 'the slope is the amplitude times the cosine, so amplitude 0 removes the clock from the picture');
  assert.ok(shader.includes('if (waterRipples.z > 0.5) {'), 'the golden angle directions stay unless wind alignment is on');
  assert.ok(shader.includes('angle += 2.399963;'));
});
