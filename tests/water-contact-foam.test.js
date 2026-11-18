import './support/load-agent-scene-modules.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentScene } from '../src/agent-scene.js';
import { createFragmentShader } from '../src/shaders.js';
import { CONTACT_FOAM_DEFAULTS } from '../src/world-material-shader.js';

function waterRecipe(fields) {
  return {
    format: 'crucible.scene', schemaVersion: 1,
    geometries: [{ id: 'sheet', type: 'box' }],
    materials: [{ id: 'water', tag: 'water', alphaMode: 'blend', opacity: 0.98, ...fields }],
    nodes: [{ id: 'sea', geometry: 'sheet', material: 'water', scale: [100, 0.1, 100] }],
  };
}

test('contactFoam fills its defaults and stays unset when not given', () => {
  const material = createAgentScene(waterRecipe({ contactFoam: { width: 10 } })).parts[0].material;
  assert.deepEqual({ ...material.contactFoam }, { ...CONTACT_FOAM_DEFAULTS, width: 10 });
  assert.equal(createAgentScene(waterRecipe({})).parts[0].material.contactFoam, undefined);
});

test('contactFoam refuses values out of range, unknown fields and water that cannot read the scene behind it', () => {
  const bad = [
    [{ contactFoam: { width: 0 } }, /contactFoam\.width must be a number from 1 to 64/],
    [{ contactFoam: { width: 65 } }, /contactFoam\.width/],
    [{ contactFoam: { hardness: 2 } }, /contactFoam\.hardness/],
    [{ contactFoam: { noise: -1 } }, /contactFoam\.noise/],
    [{ contactFoam: { color: [1, 1] } }, /contactFoam\.color must be three numbers/],
    [{ contactFoam: { thickness: 1 } }, /no field thickness/],
    [{ contactFoam: 'on' }, /must be an object/],
    [{ contactFoam: {}, alphaMode: 'opaque', opacity: 1 }, /alphaMode "blend"/],
  ];
  for (const [fields, message] of bad) {
    assert.throws(() => createAgentScene(waterRecipe(fields)), message, JSON.stringify(fields));
  }
  assert.equal(createAgentScene(waterRecipe({ contactFoam: {}, opacity: 1 })).parts[0].material.contactFoam.width, 6);
  const plain = waterRecipe({});
  plain.materials[0] = { id: 'water', contactFoam: {} };
  assert.throws(() => createAgentScene(plain), /need the water tag/);
});

test('the water shader carries a contact foam function that is off unless a material turns it on', () => {
  const shader = createFragmentShader(['water', 'vertexColors']);
  assert.match(shader, /float waterContactFoam\(vec3 surfacePosition, float noiseValue\)/);
  assert.match(shader, /if \(waterContact\.w < 0\.5 \|\| waterBody\.w < 0\.5\) return 0\.0;/);
  assert.match(shader, /waterFoam = max\(waterFoam, waterContactShare\)/);
});
