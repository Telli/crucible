import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTree, resolveTreePreset } from '../src/vegetation.js';
import { createFragmentShader } from '../src/shaders.js';
import { crownBrightness, crownDepth, crownLightSettings, describeCrownShape, roundedCanopyNormal, roundedNormalSettings, tipTint } from '../src/foliage-shading.js';
import { FOLIAGE_SHADOW_BIAS_SCALE, FOLIAGE_SUN_SPECULAR_SCALE, LEAF_TRANSMISSION_PARAMETERS, addLeafTransmission, foliageSunSpecularPeak, leafTransmissionReference } from '../src/leaf-transmission.js';

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
    assert.ok(mean(inner) < mean(outer) * 0.5, `${name}: inner luminance ${mean(inner).toFixed(3)} should be under half of outer ${mean(outer).toFixed(3)} (round 1 measured 0.6)`);
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
  assert.ok(shaded > 0.2 * lit && shaded < lit, `shaded ${shaded} against lit ${lit}`);
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

// The shading terms of a sunlit leaf on plain numbers: sun on the crown's own normal plus a constant sky share, scaled by the
// leaf's baked colour. Light that reaches the sun-facing flank of a crown is a clear multiple of the light on the far flank.
const SKY_SHARE = 0.25;

function flankRadiance(geometry, sunDirection) {
  const positions = vertexPositions(geometry);
  const center = describeCrownShape(positions).center;
  const sunSide = positions.map(position => position.reduce((sum, value, axis) => sum + (value - center[axis]) * sunDirection[axis], 0));
  const lit = [];
  const shaded = [];
  positions.forEach((position, index) => {
    const normal = [geometry.normals[index * 3], geometry.normals[index * 3 + 1], geometry.normals[index * 3 + 2]];
    const sun = Math.max(normal[0] * sunDirection[0] + normal[1] * sunDirection[1] + normal[2] * sunDirection[2], 0);
    const radiance = luminanceAt(geometry, index) * (SKY_SHARE + (1 - SKY_SHARE) * sun);
    (sunSide[index] > 0 ? lit : shaded).push(radiance);
  });
  return { lit: mean(lit), shaded: mean(shaded) };
}

test('with the sun beside the tree the sun-facing flank of every crown is clearly brighter than the far flank', () => {
  const sun = [0.93, 0.34, 0.12].map(value => value / Math.hypot(0.93, 0.34, 0.12));
  for (const [name, grow] of TREES) {
    const { lit, shaded } = flankRadiance(foliageOf(grow()), sun);
    assert.ok(lit > 1.6 * shaded, `${name}: sun-facing flank ${lit.toFixed(3)} should be over 1.6 times the far flank ${shaded.toFixed(3)}`);
    // The birch is toned down on purpose (its leaf colour is pale), so only the dark-leaved crowns pin the lit flank's level (round 1 measured 0.725).
    if (name !== 'birch') assert.ok(lit > 0.74, `${name}: sun-facing flank radiance ${lit.toFixed(3)} should reach 0.74`);
  }
});

test('the crown is a lit shell around a darker, cooler core', () => {
  const light = crownLightSettings(createTreeLeafSpec('broadleaf'));
  assert.ok(crownBrightness(light, 0.3, 0.5) < 0.6 * crownBrightness(light, 1, 0.5), 'a leaf at 30 percent depth is under 60 percent of a hull leaf');
  assert.ok(crownBrightness(light, 1, 0.5) > 1.3, 'the hull is lit brighter than the leaf colour');
});

test('birch back-light is toned down against the oak: the same sun behind a pale birch hull leaf glows less', () => {
  const glowAtHull = (species, hull) => {
    const leaf = createTreeLeafSpec(species);
    const color = leaf.foliageColor.map(value => value * 1.5 * hull);
    return mean(leafTransmissionReference({ normal: [0, 0, 1], viewDirection: [0, 0, 1], lightDirection: [0, 0.3, -0.954].map(value => value / Math.hypot(0, 0.3, 0.954)), visibility: 1, color }));
  };
  const birchNow = glowAtHull('birch', crownLightSettings(createTreeLeafSpec('birch')).hull);
  const oakNow = glowAtHull('broadleaf', crownLightSettings(createTreeLeafSpec('broadleaf')).hull);
  assert.ok(birchNow < 0.3, `birch hull glow ${birchNow.toFixed(3)} stays under 0.3 (round 1 glowed neon at 0.35 and over)`);
  assert.ok(birchNow < 0.85 * oakNow, `birch ${birchNow.toFixed(3)} should glow less than oak ${oakNow.toFixed(3)} although its leaf colour is paler`);
});

test('a foliage shader tests the sun shadow with a larger bias so the sunlit flank does not shadow itself', () => {
  const plain = createFragmentShader(['foliage']);
  const foliage = addLeafTransmission(plain);
  assert.ok(foliage.includes(`clamp(sqrt(1.0 - cosine * cosine) / cosine, 0.25, 4.0) * ${FOLIAGE_SHADOW_BIAS_SCALE}.0;`));
  assert.ok(FOLIAGE_SHADOW_BIAS_SCALE > 1);
  assert.equal(plain.split('shadowBiasPerSlope * clamp').length - 1, foliage.split('shadowBiasPerSlope * clamp').length - 1, 'no bias line is added or lost');
});

// Ghost clumps (round 3): with the sun behind the tree the top of a crown seen toward the sun showed pale, see-through patches.
// They were the sun's white specular lobe on the crown's own normal, which no leaf colour bounds and the larger shadow bias no
// longer hid. The sun's light on a leaf must stay leafy: the white lobe is a small part of what the back-light adds.
const LOOKING_TOWARD_SUN = { viewDirection: [0, 0, 1], lightDirection: [0, 0.3, -0.954].map(value => value / Math.hypot(0, 0.3, 0.954)) };

test('looking toward the sun, the white specular lobe on a foliage card stays a small part of the leaf-coloured back-light', () => {
  const hullLeaf = createTreeLeafSpec('broadleaf').foliageColor.map(value => value * 1.5 * crownLightSettings(createTreeLeafSpec('broadleaf')).hull);
  const backLight = leafTransmissionReference({ normal: [0, 0, 1], viewDirection: LOOKING_TOWARD_SUN.viewDirection, lightDirection: LOOKING_TOWARD_SUN.lightDirection, visibility: 1, color: hullLeaf });
  const whiteLobe = foliageSunSpecularPeak({ ...LOOKING_TOWARD_SUN, roughness: 0.85 });
  assert.ok(whiteLobe < 0.1 * backLight[2], `the white lobe ${whiteLobe.toFixed(4)} lifts the blue of a hull leaf (${backLight[2].toFixed(4)}) by under 10 percent`);
  assert.ok(backLight[1] > 1.5 * backLight[2], 'the back-light itself stays green, not white');
  const unscaled = foliageSunSpecularPeak({ ...LOOKING_TOWARD_SUN, roughness: 0.85, scale: 1 });
  assert.ok(unscaled > 0.25 * backLight[2], `without the scale the lobe (${unscaled.toFixed(4)}) would wash the blue by a quarter or more, the ghost`);
});

test('a foliage shader keeps a small share of the sun specular, and no other shader changes', () => {
  assert.ok(FOLIAGE_SUN_SPECULAR_SCALE > 0 && FOLIAGE_SUN_SPECULAR_SCALE <= 0.1, 'leaves keep a hint of gloss, not the full lobe');
  const plain = createFragmentShader(['foliage']);
  const foliage = addLeafTransmission(plain);
  assert.ok(foliage.includes(`specular *= directSpecularGain; if (TAG_FOLIAGE) specular *= ${FOLIAGE_SUN_SPECULAR_SCALE};`));
  assert.equal(foliage.split('directSpecularGain;').length, plain.split('directSpecularGain;').length, 'no specular line is added or lost');
});

// Exposure balance (round 3): the photos' leaves run from deep shade to bright sunlit tops (10th to 90th percentile ratio 3 to 7,
// 90th percentile 140 to 165 of 255), and round 2's crown, dimmed all over by the occlusion, ended at 124. The hull must be a
// clear multiple of the leaf colour and the core a small fraction of it.
test('the crown light spans deep shade to sunlit hull: a bright hull, a dark core, and a wide spread of sunlit leaf radiance', () => {
  for (const species of ['broadleaf', 'birch']) {
    const light = crownLightSettings(createTreeLeafSpec(species));
    const spread = crownBrightness(light, 1, 0.5) / crownBrightness(light, 0, 0.5);
    assert.ok(spread > 6, `${species}: hull over core is ${spread.toFixed(1)} times (round 2 had 3 to 5)`);
  }
  assert.ok(crownBrightness(crownLightSettings(createTreeLeafSpec('broadleaf')), 1, 0.5) > 2.2, 'an oak hull leaf reaches a bright sunlit tail');
  const sun = [0.93, 0.34, 0.12].map(value => value / Math.hypot(0.93, 0.34, 0.12));
  const geometry = foliageOf(createTree({ preset: 'oak' }, 4));
  const radiances = [];
  for (let index = 0; index < geometry.positions.length / 3; index++) {
    const sunShare = Math.max(geometry.normals[index * 3] * sun[0] + geometry.normals[index * 3 + 1] * sun[1] + geometry.normals[index * 3 + 2] * sun[2], 0);
    radiances.push(luminanceAt(geometry, index) * (SKY_SHARE + (1 - SKY_SHARE) * sunShare));
  }
  radiances.sort((first, second) => first - second);
  const percentile = fraction => radiances[Math.floor(radiances.length * fraction)];
  assert.ok(percentile(0.9) > 1.4, `the 90th percentile of the oak's sunlit radiance is ${percentile(0.9).toFixed(2)}`);
  assert.ok(percentile(0.9) / percentile(0.1) > 6, `the 90th over 10th percentile is ${(percentile(0.9) / percentile(0.1)).toFixed(1)}`);
});

test('the clump speckle varies leaf colour within a clump without blotchy outliers', () => {
  const geometry = foliageOf(createTree({ preset: 'oak' }, 4));
  const positions = vertexPositions(geometry);
  const crown = describeCrownShape(positions);
  const outer = [];
  positions.forEach((position, index) => { if (crownDepth(crown, position) > 0.95) outer.push(luminanceAt(geometry, index)); });
  const average = mean(outer);
  const deviation = Math.sqrt(mean(outer.map(value => (value - average) ** 2))) / average;
  assert.ok(deviation > 0.16, `outermost leaves vary by ${(deviation * 100).toFixed(1)} percent (without the fine speckle it is 14.4)`);
  assert.ok(Math.max(...outer) < 3.2 * average && Math.min(...outer) > 0.3 * average, 'no leaf is a blotchy outlier');
});
