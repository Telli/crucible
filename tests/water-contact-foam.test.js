import './support/load-agent-scene-modules.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentScene } from '../src/agent-scene.js';
import { createFragmentShader } from '../src/shaders.js';
import { CONTACT_FOAM_DEFAULTS, contactFoamUniform } from '../src/world-material-shader.js';

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
    [{ contactFoam: {}, opacity: 1 }, /opacity below 1/],
    [{ contactFoam: {}, alphaMode: 'opaque', opacity: 1 }, /alphaMode "blend"/],
  ];
  for (const [fields, message] of bad) {
    assert.throws(() => createAgentScene(waterRecipe(fields)), message, JSON.stringify(fields));
  }
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

test('contact foam skips water whose scene behind it is more than half a metre away, so far water and the horizon stay clear', () => {
  const shader = createFragmentShader(['water', 'vertexColors']);
  const functionStart = shader.indexOf('float waterContactFoam(');
  const body = shader.slice(functionStart, shader.indexOf('#ifndef shadowVisibility', functionStart));
  const gapLine = body.indexOf('float gap = abs(surfacePosition.y - waterBody.x + sceneDepth);');
  const reachLine = body.indexOf('if (gap > 0.5) return 0.0;');
  const pixelsLine = body.indexOf('float gapPixels = gap * pixelsPerMetre;');
  assert.ok(gapLine >= 0, 'the gap is measured in metres');
  assert.ok(reachLine > gapLine, 'a gap over half a metre returns no foam');
  assert.ok(reachLine < pixelsLine, 'the metre limit applies before the width in pixels, which is huge far away');
});

test('contactFoam.drift defaults to 0 and refuses values outside 0 to 1 with what to pass', () => {
  assert.equal(createAgentScene(waterRecipe({ contactFoam: {} })).parts[0].material.contactFoam.drift, 0);
  assert.equal(createAgentScene(waterRecipe({ contactFoam: { drift: 0.7 } })).parts[0].material.contactFoam.drift, 0.7);
  for (const drift of [-0.1, 1.5, '1']) {
    assert.throws(() => createAgentScene(waterRecipe({ contactFoam: { drift } })), /contactFoam\.drift must be a number from 0 to 1, such as 0/, String(drift));
  }
});

test('the drifting rim is gated on drift above 0, so the static rim keeps its noise and its full width', () => {
  const shader = createFragmentShader(['water', 'vertexColors']);
  assert.match(shader, /uniform float waterContactDrift;/);
  assert.match(shader, /float contactNoise = terrainNoise\(worldPosition\.xz \* 1\.7 \+ 11\.3\)\.x;\s+float contactTear = 1\.0;\s+if \(waterContactDrift > 0\.0\) \{/);
  assert.match(shader, /waterContactShare = waterContactFoam\(worldPosition, contactNoise\) \* contactTear;/);
  const driftBranch = shader.slice(shader.indexOf('if (waterContactDrift > 0.0) {'));
  assert.match(driftBranch.slice(0, 600), /time \*/, 'the drift moves with the water time');
});

test('contactFoam.rim defaults to true and refuses anything but a boolean with what to pass', () => {
  assert.equal(createAgentScene(waterRecipe({ contactFoam: {} })).parts[0].material.contactFoam.rim, true);
  assert.equal(createAgentScene(waterRecipe({ contactFoam: { rim: false } })).parts[0].material.contactFoam.rim, false);
  for (const rim of [0, 'no', null]) {
    assert.throws(() => createAgentScene(waterRecipe({ contactFoam: { rim } })), /contactFoam.rim must be true or false/, String(rim));
  }
});

test('the rim reaches the shader as its on flag: drawn by default, absent with rim false or without contactFoam', () => {
  const rimmed = createAgentScene(waterRecipe({ contactFoam: { width: 8, noise: 0.2 } })).parts[0].material.contactFoam;
  const rimless = createAgentScene(waterRecipe({ contactFoam: { width: 8, noise: 0.2, rim: false } })).parts[0].material.contactFoam;
  assert.deepEqual(contactFoamUniform(rimmed), [8, 1, 0.2, 1]);
  assert.deepEqual(contactFoamUniform(rimless), [0, 0, 0, 0]);
  assert.deepEqual(contactFoamUniform(undefined), [0, 0, 0, 0]);
});
