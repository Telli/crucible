import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createAgentScene, loadAllAgentSceneModules } from '../src/agent-scene.js';
import { grassOptionsFor, normalizeGrass, plannedGrass, GRASS_LIMITS } from '../src/agent-grass.js';
import { createGrass } from '../src/grass.js';

await loadAllAgentSceneModules();

const GROUND = { id: 'ground', type: 'terrain', size: 40, resolution: 32, seed: 3, amplitude: 2 };
const FIELD = { ground: 'hills', seed: 4, density: 60, cullDistance: 30 };
const IDENTITY = { translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], parent: null };

function meadowRecipe(grass, extra = {}) {
  return {
    format: 'crucible.scene', schemaVersion: 1,
    geometries: [GROUND, { id: 'marker', type: 'box' }],
    materials: [{ id: 'soil', color: [0.2, 0.15, 0.1] }],
    nodes: [
      { id: 'hills', geometry: 'ground', material: 'soil' },
      ...(grass ? [{ id: 'meadow', grass }] : []),
      ...(extra.nodes ?? []),
    ],
    ...(extra.environment ? { environment: extra.environment } : {}),
    camera: extra.camera ?? { eye: [0, 3, 10], target: [0, 0, 0] },
  };
}

function grassParts(scene) {
  return scene.parts.filter(part => part.name.startsWith('meadow/'));
}

function fingerprint(scene) {
  const hash = createHash('sha256');
  for (const part of grassParts(scene)) {
    hash.update(part.name);
    hash.update(Buffer.from(part.matrix.buffer, part.matrix.byteOffset, part.matrix.byteLength));
    hash.update(Buffer.from(part.geometry.positions.buffer, part.geometry.positions.byteOffset, part.geometry.positions.byteLength));
    hash.update(Buffer.from(part.geometry.colors.buffer, part.geometry.colors.byteOffset, part.geometry.colors.byteLength));
  }
  return hash.digest('hex');
}

function fieldError(grass, pattern, extra) {
  assert.throws(() => createAgentScene(meadowRecipe(grass, extra)), pattern);
}

test('a grass node covers the terrain with blade tiles and scene_inspect reports blades, tiles and triangles per level', () => {
  const scene = createAgentScene(meadowRecipe(FIELD));
  const parts = grassParts(scene);
  assert.ok(parts.length > 10, `built ${parts.length} tiles`);
  const [report] = scene.inspect().grass;
  assert.equal(report.node, 'meadow');
  assert.equal(report.ground, 'hills');
  assert.equal(report.preset, 'meadow');
  assert.equal(report.tiles, parts.length);
  assert.ok(report.blades > 1000, `grew ${report.blades} blades`);
  assert.ok(report.triangles >= report.blades);
  assert.equal(report.levels.length, 3);
  assert.equal(report.levels.reduce((total, row) => total + row.tiles, 0), report.tiles);
  assert.equal(report.levels.reduce((total, row) => total + row.blades, 0), report.blades);
  assert.equal(report.levels.reduce((total, row) => total + row.triangles, 0), report.triangles);
  assert.ok(report.levels[0].tiles > 0 && report.levels[0].blades > 0, 'tiles near the eye are at full detail');
});

test('the blades keep the grass material tag, so environment.wind sways them', () => {
  const scene = createAgentScene(meadowRecipe(FIELD, { environment: { wind: { strength: 1, direction: 30 } } }));
  assert.ok(grassParts(scene).every(part => part.material.tag === 'grass'));
  assert.ok(grassParts(scene).every(part => part.castShadow !== true));
});

test('the same recipe gives the same blades byte for byte, and another seed gives other ones', () => {
  const first = fingerprint(createAgentScene(meadowRecipe(FIELD)));
  assert.equal(fingerprint(createAgentScene(meadowRecipe(FIELD))), first);
  assert.notEqual(fingerprint(createAgentScene(meadowRecipe({ ...FIELD, seed: 5 }))), first);
});

test('the recipe path builds the same geometry as createGrass with the same options', () => {
  const scene = createAgentScene(meadowRecipe(FIELD));
  const recipe = meadowRecipe(FIELD);
  recipe.nodes.forEach(node => Object.assign(node, IDENTITY));
  const options = grassOptionsFor(recipe, recipe.nodes[1], normalizeGrass(FIELD));
  const addon = createGrass({ ...options, eye: [0, 3, 10] });
  assert.equal(scene.inspect().grass[0].triangles, addon.stats().triangles);
});

test('the camera eye decides which tiles are built and at what level, and a seek cannot change them', () => {
  const near = createAgentScene(meadowRecipe(FIELD, { camera: { eye: [0, 2, 0], target: [0, 0, -5] } })).inspect().grass[0];
  const far = createAgentScene(meadowRecipe(FIELD, { camera: { eye: [0, 2, 400], target: [0, 0, 0] } })).inspect().grass[0];
  assert.equal(far.tiles, 0);
  assert.ok(near.tiles > 0);
  const scene = createAgentScene(meadowRecipe(FIELD));
  const before = fingerprint(scene);
  scene.apply([{ type: 'set-camera', eye: [0, 3, -9], target: [0, 0, 0] }], { expectedRevision: scene.revision });
  assert.notEqual(fingerprint(scene), before, 'an edit of the camera builds the field for the new eye');
});

test('density, height and dryness reach the blades', () => {
  const sparse = createAgentScene(meadowRecipe({ ...FIELD, density: 15 })).inspect().grass[0].blades;
  const normal = createAgentScene(meadowRecipe(FIELD)).inspect().grass[0].blades;
  assert.ok(sparse < normal / 2, `${sparse} against ${normal}`);
  const tall = fingerprint(createAgentScene(meadowRecipe({ ...FIELD, height: [1, 1.5] })));
  assert.notEqual(tall, fingerprint(createAgentScene(meadowRecipe(FIELD))));
  assert.notEqual(fingerprint(createAgentScene(meadowRecipe({ ...FIELD, dryness: 1 }))), fingerprint(createAgentScene(meadowRecipe(FIELD))));
});

test('area, polygon and exclusions decide where blades may stand', () => {
  const recipe = meadowRecipe(FIELD);
  recipe.nodes.forEach(node => Object.assign(node, IDENTITY));
  const optionsFor = grass => grassOptionsFor(recipe, recipe.nodes[1], normalizeGrass({ ...FIELD, ...grass }));

  const cleared = optionsFor({ exclude: [{ center: [0, 0], radius: 5 }, { min: [8, 8], max: [12, 12] }] }).mask;
  assert.equal(cleared(1, 1), 0);
  assert.equal(cleared(10, 10), 0);
  assert.equal(cleared(-15, 15), 1);

  const triangle = optionsFor({ polygon: [[-6, -6], [6, -6], [0, 8]] });
  assert.deepEqual([triangle.area.minX, triangle.area.maxX, triangle.area.minZ, triangle.area.maxZ], [-6, 6, -6, 8]);
  assert.equal(triangle.mask(0, 0), 1);
  assert.equal(triangle.mask(5, 6), 0, 'inside the bounding box but outside the outline');

  const boxed = optionsFor({ area: { min: [-30, -30], max: [4, 4] } }).area;
  assert.deepEqual([boxed.minX, boxed.maxX], [-19.5, 4], 'the area is clamped to the ground');
});

test('a node named in exclude is measured in the group frame, and excluding the whole ground leaves nothing', () => {
  const scene = createAgentScene(meadowRecipe({ ...FIELD, exclude: [{ node: 'pond', radius: 100 }] }, {
    nodes: [{ id: 'pond', geometry: 'marker', material: 'soil' }],
  }));
  assert.equal(grassParts(scene).length, 0);
});

test('a scene without grass is unchanged and the grass parts stay out of exports', () => {
  const plain = createAgentScene(meadowRecipe(null));
  assert.equal(plain.inspect().grass, undefined);
  assert.deepEqual(plain.parts.map(part => part.name), ['hills']);
  const exported = createAgentScene(meadowRecipe(FIELD)).exportRecipe();
  assert.equal(exported.nodes.length, 2);
  assert.equal(exported.geometries.length, 2);
  assert.equal(exported.nodes.find(node => node.id === 'meadow').grass.ground, 'hills');
});

test('invalid grass fields fail with what to pass instead', () => {
  fieldError({ ground: 'hills', typo: 1 }, /grass\.typo: .*no such field; use one of ground, preset/);
  fieldError({ preset: 'meadow' }, /grass\.ground: .*terrain node, such as "ground"/);
  fieldError({ ground: 'hills', preset: 'jungle' }, /grass\.preset: got "jungle"; expected one of meadow, lawn, savanna, wild/);
  fieldError({ ground: 'hills', density: 5000 }, /grass\.density: got 5000; expected a number from 1 to 1500/);
  fieldError({ ground: 'hills', dryness: 2 }, /grass\.dryness: .*0 to 1/);
  fieldError({ ground: 'hills', cullDistance: 900 }, /grass\.cullDistance: .*5 to 200/);
  fieldError({ ground: 'hills', height: 0.5 }, /grass\.height: .*\[minimum, maximum\]/);
  fieldError({ ground: 'hills', height: [0.6, 0.2] }, /grass\.height: .*maximum not below minimum/);
  fieldError({ ground: 'marker' }, /grass\.ground: got "marker"; expected the ID of a node that draws a terrain geometry/);
  fieldError({ ground: 'hills', exclude: [{ node: 'missing', radius: 2 }] }, /grass\.exclude\[0\]\.node: got "missing"; expected the ID of a node in the recipe/);
  fieldError({ ground: 'hills', polygon: [[0, 0], [1, 1]] }, /grass\.polygon: got "2 points"; expected 3 to 64/);
  fieldError({ ground: 'hills', area: { min: [100, 100], max: [120, 120] } }, /grass\.area: .*overlaps the ground/);
});

test('limits keep area, planned blades, planned triangles and generated nodes bounded', () => {
  const wide = { ...GROUND, size: 400 };
  const wideRecipe = grass => ({ ...meadowRecipe(grass), geometries: [wide, { id: 'marker', type: 'box' }] });
  assert.throws(() => createAgentScene(wideRecipe({ ground: 'hills' })), /grass\.area: got "\d+ square metres"; expected an area of at most 40000/);
  assert.throws(() => createAgentScene(wideRecipe({ ground: 'hills', area: { min: [-100, -100], max: [100, 100] }, density: 1500, cullDistance: 200 })), /grass\.density: got 1500; expected a density that keeps the blades within cullDistance under 500000/);
  const planned = plannedGrass(normalizeGrass({ ground: 'hills', preset: 'lawn', cullDistance: 12 }), { minX: -100, maxX: 100, minZ: -100, maxZ: 100 });
  assert.ok(planned.blades < GRASS_LIMITS.maxBlades && planned.triangles > 0);
  assert.throws(() => createAgentScene(meadowRecipe(FIELD), { maxNodes: 12 }), /maxNodes 12/);
});

test('a node cannot hold grass together with geometry, vegetation or clutter', () => {
  const recipe = meadowRecipe(FIELD);
  recipe.nodes[1] = { id: 'meadow', geometry: 'marker', material: 'soil', grass: FIELD };
  assert.throws(() => createAgentScene(recipe), /geometry: got "marker"; expected nothing, because a node that grows grass is a group/);
  const both = meadowRecipe(FIELD);
  both.nodes[1] = { id: 'meadow', clutter: [{ preset: 'forest', terrain: 'hills' }], grass: FIELD };
  assert.throws(() => createAgentScene(both), /grass: got .*expected nothing, because a node that scatters clutter is a group/);
});
