import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTree, resolveTreePreset } from '../src/vegetation.js';
import { createFragmentShader } from '../src/shaders.js';
import { crownDepth, describeCrownShape, roundedCanopyNormal, roundedNormalSettings, tipTint } from '../src/foliage-shading.js';
import { LEAF_TRANSMISSION_PARAMETERS, addLeafTransmission, leafTransmissionReference } from '../src/leaf-transmission.js';

function foliageOf(tree, levelIndex = 0) {
  return tree.levels[levelIndex].parts.find(part => part.role === 'foliage').geometry;
}

function vertexPositions(geometry) {
  const positions = [];
  for (let index = 0; index < geometry.positions.length; index += 3) positions.push([geometry.positions[index], geometry.positions[index + 1], geometry.positions[index + 2]]);
  return positions;
}

function luminanceAt(geometry, index) {
  return 0.2126 * geometry.colors[index * 3] + 0.7152 * geometry.colors[index * 3 + 1] + 0.0722 * geometry.colors[index * 3 + 2];
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

const TREES = [
  ['broadleaf', () => createTree('broadleaf', 7)],
  ['birch', () => createTree('birch', 7)],
  ['oak preset', () => createTree({ preset: 'oak' }, 4)],
];

test('crown occlusion is baked: leaves deeper in the crown are darker than leaves at its hull', () => {
  for (const [name, grow] of TREES) {
    const geometry = foliageOf(grow());
    const positions = vertexPositions(geometry);
    const crown = describeCrownShape(positions);
    const inner = [];
    const outer = [];
    positions.forEach((position, index) => {
      const depth = crownDepth(crown, position);
      if (depth < 0.4) inner.push(luminanceAt(geometry, index));
      else if (depth > 0.85) outer.push(luminanceAt(geometry, index));
    });
    assert.ok(inner.length > 20 && outer.length > 20, `${name}: both shells need leaves (${inner.length}, ${outer.length})`);
    assert.ok(mean(inner) < mean(outer) * 0.8, `${name}: inner luminance ${mean(inner).toFixed(3)} should be under 80% of outer ${mean(outer).toFixed(3)}`);
  }
});

test('crown depth follows the crown ellipsoid, so a flat crown is shallow at its top', () => {
  const flatCrown = [];
  for (const x of [-6, 0, 6]) for (const y of [-1, 0, 1]) for (const z of [-6, 0, 6]) flatCrown.push([x, y, z]);
  const crown = describeCrownShape(flatCrown);
  assert.ok(crown.radii[0] > 3 * crown.radii[1], `a wide crown has wide radii ${crown.radii}`);
  const topOfFlatCrown = crownDepth(crown, [0, 1, 0]);
  const flankOfFlatCrown = crownDepth(crown, [1, 0, 0]);
  assert.ok(topOfFlatCrown > 2 * flankOfFlatCrown, `1 m above the centre of a flat crown is deeper in its hull (${topOfFlatCrown}) than 1 m beside it (${flankOfFlatCrown})`);
});

test('clump colour jitter is deterministic for one seed and differs between seeds', () => {
  const first = foliageOf(createTree('broadleaf', 7));
  const again = foliageOf(createTree('broadleaf', 7));
  assert.ok(Buffer.from(first.colors.buffer, first.colors.byteOffset, first.colors.byteLength).equals(Buffer.from(again.colors.buffer, again.colors.byteOffset, again.colors.byteLength)), 'the same seed gives the same colours byte for byte');
  const other = foliageOf(createTree('broadleaf', 8));
  const sameLength = Math.min(first.colors.length, other.colors.length);
  let differing = 0;
  for (let index = 0; index < sameLength; index++) if (first.colors[index] !== other.colors[index]) differing++;
  assert.ok(differing > sameLength * 0.5, 'another seed gives other colours');
  const positions = [[0, 0, 0], [1, 2, 0], [-1, 1, 1]];
  assert.equal(describeCrownShape(positions).tintSalt, describeCrownShape(positions.map(position => [...position])).tintSalt, 'one crown, one salt');
  assert.notEqual(describeCrownShape(positions).tintSalt, describeCrownShape(positions.map(([x, y, z]) => [x + 0.5, y, z])).tintSalt, 'another crown, another salt');
});

test('the leaves at the branch tips take a lighter, yellower tint', () => {
  assert.deepEqual(tipTint(0.5), [1, 1, 1], 'inside the crown nothing changes');
  const tip = tipTint(1);
  assert.ok(tip.every(channel => channel > 0.9));
  assert.ok(tip[0] > 1.15 && tip[1] > 1.15, `red and green lift at the tip: ${tip}`);
  assert.ok(tip[2] < tip[0] - 0.1, `blue lifts less than red, so the tip turns yellow-green: ${tip}`);
  assert.ok(tipTint(0.9)[1] < tip[1] && tipTint(0.9)[1] > 1, 'the lift grows smoothly toward the hull');
});

test('rounded normals follow the crown surface and every foliage normal leans outward', () => {
  const dome = describeCrownShape(Array.from({ length: 60 }, (_, index) => [Math.cos(index) * 5 * ((index % 5) / 5 + 0.2), Math.sin(index * 1.7) * 2, Math.sin(index) * 5 * ((index % 5) / 5 + 0.2)]));
  const top = roundedCanopyNormal(dome, [dome.center[0], dome.center[1] + 2, dome.center[2]], 0);
  const flank = roundedCanopyNormal(dome, [dome.center[0] + 5, dome.center[1], dome.center[2]], 0);
  assert.ok(top[1] > 0.99, `the top of the crown faces up: ${top}`);
  assert.ok(flank[0] > 0.99, `the flank faces sideways: ${flank}`);
  const flatCrown = [];
  for (const x of [-6, 0, 6]) for (const y of [-1, 0, 1]) for (const z of [-6, 0, 6]) flatCrown.push([x, y, z]);
  const flat = describeCrownShape(flatCrown);
  const shoulder = roundedCanopyNormal(flat, [4, 1, 0], 0);
  assert.ok(shoulder[1] > 2 * shoulder[0], `on a flat crown 4 m out and 1 m up the surface still faces mostly up (a sphere would face sideways): ${shoulder}`);
  assert.ok(Math.abs(Math.hypot(...roundedCanopyNormal(dome, [1, 2, 3], 0.35)) - 1) < 1e-9, 'unit length');
  const geometry = foliageOf(createTree({ preset: 'oak' }, 4));
  const positions = vertexPositions(geometry);
  const crown = describeCrownShape(positions);
  const outward = positions.map((position, index) => {
    const direction = position.map((value, axis) => value - crown.center[axis]);
    const length = Math.hypot(...direction);
    return (direction[0] * geometry.normals[index * 3] + direction[1] * geometry.normals[index * 3 + 1] + direction[2] * geometry.normals[index * 3 + 2]) / length;
  });
  assert.ok(mean(outward) > 0.5, `the mean cosine between a leaf normal and the way out of the crown is ${mean(outward).toFixed(2)}`);
});

test('each species tunes how round its crown lights', () => {
  assert.deepEqual(roundedNormalSettings({ roundedNormals: { blend: 0.7, skyLift: 0.2 } }, 0.55), { blend: 0.7, skyLift: 0.2 });
  assert.deepEqual(roundedNormalSettings({}, 0.55), { blend: 0.55, skyLift: 0.35 }, 'a species without settings keeps its card blend');
  const broadleaf = roundedNormalSettings(createTreeLeafSpec('broadleaf'), 0.55);
  const birch = roundedNormalSettings(createTreeLeafSpec('birch'), 0.55);
  assert.ok(broadleaf.blend > 0.55 && birch.blend > 0.55, 'broad crowns light as domes');
  assert.ok(birch.skyLift < broadleaf.skyLift, 'hanging birch leaves tilt up less');
  assert.equal(roundedNormalSettings(createTreeLeafSpec('conifer'), 0.55).blend, 0.55, 'a conifer is untuned');
});

function createTreeLeafSpec(species) {
  return resolveTreePreset({ species }).preset.leaf;
}

const BACK_SUN = { lightDirection: [0, 0.3, -0.954], viewDirection: [0, 0, 1] };
const SIDE_SUN = { lightDirection: [0.954, 0.3, 0], viewDirection: [0, 0, 1] };
const LEAF_COLOR = [0.4, 0.55, 0.2];

function glowOf({ lightDirection, viewDirection, normal = [0, 0, 1], visibility = 1 }) {
  const lightLength = Math.hypot(...lightDirection);
  const unitLight = lightDirection.map(value => value / lightLength);
  return mean(leafTransmissionReference({ normal, viewDirection, lightDirection: unitLight, visibility, color: LEAF_COLOR }));
}

test('leaves glow with the sun behind them and barely with the sun beside the tree', () => {
  const behind = glowOf(BACK_SUN);
  const beside = glowOf({ ...SIDE_SUN, normal: [0, 0, 1] });
  assert.ok(behind > 0.2, `a leaf facing the camera with the sun behind it glows: ${behind}`);
  assert.ok(behind > 8 * beside, `behind-sun glow ${behind} against side-sun glow ${beside}`);
  assert.equal(glowOf({ lightDirection: [0, 0.3, 0.954], viewDirection: [0, 0, 1], normal: [0, 0, 1] }), 0, 'sun behind the camera and in front of the leaf: no back-light');
});

test('a leaf in the crown shadow still glows, by the share that passed through the leaves above it', () => {
  const lit = glowOf({ ...BACK_SUN, visibility: 1 });
  const shaded = glowOf({ ...BACK_SUN, visibility: 0 });
  assert.ok(shaded > 0.3 * lit && shaded < lit, `shaded ${shaded} against lit ${lit}`);
  const share = LEAF_TRANSMISSION_PARAMETERS.throughCrown;
  assert.ok(shaded > share * 0.5 * lit, 'the shaded glow is at least the through-crown share');
});

test('a darker, cooler leaf deep in the crown glows less', () => {
  const dark = mean(leafTransmissionReference({ normal: [0, 0, 1], viewDirection: [0, 0, 1], lightDirection: [0, 0.3, -0.954].map(value => value / Math.hypot(0, 0.3, 0.954)), visibility: 1, color: LEAF_COLOR.map(value => value * 0.5) }));
  assert.ok(dark < glowOf(BACK_SUN) * 0.6);
});

test('the shader term reads the same numbers as the reference and exists only in foliage shaders', () => {
  const foliage = addLeafTransmission(createFragmentShader(['foliage']));
  assert.ok(foliage.includes(`const float LEAF_THROUGH_CROWN = ${LEAF_TRANSMISSION_PARAMETERS.throughCrown};`));
  assert.ok(foliage.includes(`const float LEAF_TRANSMISSION = ${LEAF_TRANSMISSION_PARAMETERS.strength};`));
  assert.ok(foliage.includes('float reach = mix(LEAF_THROUGH_CROWN, 1.0, visibility);'), 'the crown shadow lets a share of the back-light through');
  for (const features of [['grass'], []]) {
    const plain = createFragmentShader(features);
    assert.equal(addLeafTransmission(plain), plain, `shader with ${features.join(',') || 'no features'} is left alone`);
    assert.ok(!plain.includes('leafTransmission'));
  }
});
