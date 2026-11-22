import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTree } from '../src/vegetation.js';
import { createFragmentShader } from '../src/shaders.js';
import { addLeafTransmission } from '../src/leaf-transmission.js';
import { shaderTransforms } from '../src/shader-registry.js';

function foliageOf(tree, levelIndex) {
  return tree.levels[levelIndex].parts.find(part => part.role === 'foliage').geometry;
}

function vertexAt(geometry, index) {
  return [geometry.positions[index * 3], geometry.positions[index * 3 + 1], geometry.positions[index * 3 + 2]];
}

function colorAt(geometry, index) {
  return [geometry.colors[index * 3], geometry.colors[index * 3 + 1], geometry.colors[index * 3 + 2]];
}

function crownOf(geometry) {
  const count = geometry.positions.length / 3;
  const center = [0, 0, 0];
  for (let index = 0; index < count; index++) vertexAt(geometry, index).forEach((value, axis) => { center[axis] += value / count; });
  let radius = 0;
  for (let index = 0; index < count; index++) radius = Math.max(radius, Math.hypot(...vertexAt(geometry, index).map((value, axis) => value - center[axis])));
  return { center, radius };
}

function blueOverRed(color) {
  return color[2] / color[0];
}

test('crown tint is the same for the same seed and leaves colour spread between clumps', () => {
  const first = foliageOf(createTree('broadleaf', 7), 0);
  const second = foliageOf(createTree('broadleaf', 7), 0);
  assert.deepEqual(Array.from(first.colors), Array.from(second.colors));
  assert.deepEqual(Array.from(first.positions), Array.from(second.positions));
  const ratios = [];
  for (let index = 0; index < first.colors.length / 3; index++) ratios.push(blueOverRed(colorAt(first, index)));
  const mean = ratios.reduce((sum, value) => sum + value, 0) / ratios.length;
  const spread = Math.sqrt(ratios.reduce((sum, value) => sum + (value - mean) ** 2, 0) / ratios.length);
  assert.ok(spread > 0.03, `blue over red should vary between clumps, spread ${spread}`);
});

test('leaves deep in the crown are cooler than leaves on its outside', () => {
  for (const species of ['broadleaf', 'birch']) {
    const geometry = foliageOf(createTree(species, 7), 0);
    const { center, radius } = crownOf(geometry);
    const inner = [];
    const outer = [];
    for (let index = 0; index < geometry.colors.length / 3; index++) {
      const fraction = Math.hypot(...vertexAt(geometry, index).map((value, axis) => value - center[axis])) / radius;
      if (fraction < 0.45) inner.push(blueOverRed(colorAt(geometry, index)));
      else if (fraction > 0.8) outer.push(blueOverRed(colorAt(geometry, index)));
    }
    const average = values => values.reduce((sum, value) => sum + value, 0) / values.length;
    assert.ok(inner.length > 20 && outer.length > 20, `${species}: both shells need leaves`);
    assert.ok(average(inner) > average(outer) + 0.02, `${species}: inner ${average(inner)} should be bluer than outer ${average(outer)}`);
  }
});

function triangleArea(geometry, indices) {
  const [first, second, third] = indices.map(index => vertexAt(geometry, index));
  const edgeA = second.map((value, axis) => value - first[axis]);
  const edgeB = third.map((value, axis) => value - first[axis]);
  return Math.hypot(edgeA[1] * edgeB[2] - edgeA[2] * edgeB[1], edgeA[2] * edgeB[0] - edgeA[0] * edgeB[2], edgeA[0] * edgeB[1] - edgeA[1] * edgeB[0]) / 2;
}

// Mean blue over red weighted by leaf area, the share of the crown each colour covers.
function areaWeightedHue(geometry) {
  let weightedSum = 0;
  let totalArea = 0;
  for (let triangle = 0; triangle < geometry.indices.length; triangle += 3) {
    const indices = [geometry.indices[triangle], geometry.indices[triangle + 1], geometry.indices[triangle + 2]];
    const area = triangleArea(geometry, indices);
    for (const index of indices) {
      weightedSum += area * blueOverRed(colorAt(geometry, index));
      totalArea += area;
    }
  }
  return weightedSum / totalArea;
}

test('every level of a tree keeps the same overall leaf hue, so a level change does not shift colour', () => {
  for (const species of ['broadleaf', 'birch', 'conifer']) {
    const tree = createTree(species, 7);
    const nearHue = areaWeightedHue(foliageOf(tree, 0));
    for (let level = 1; level < tree.levels.length; level++) {
      const levelHue = areaWeightedHue(foliageOf(tree, level));
      // A far card stands for one crown cell however many leaves it holds, so the dense, cooler core of a conifer weighs a
      // little less there: about 0.03 in blue over red, a few thousandths of linear blue, against a 0.2 shift from the tint itself.
      assert.ok(Math.abs(levelHue - nearHue) < 0.04, `${species} level ${level}: blue over red ${levelHue} against ${nearHue} near`);
    }
  }
});

test('mesh leaves keep their tinted vertex colours within [0, 1]', () => {
  const geometry = foliageOf(createTree({ species: 'broadleaf', leaves: 'mesh' }, 7), 0);
  assert.ok(Array.from(geometry.colors).every(value => value >= 0 && value <= 1));
});

test('leaf transmission is added to shaders that draw foliage only, and only once the vegetation addon is loaded', () => {
  const call = 'if (TAG_FOLIAGE) radiance += leafTransmission(';
  const foliage = addLeafTransmission(createFragmentShader(['foliage']));
  assert.ok(foliage.includes(call), 'the sun adds leaf transmission on foliage');
  assert.ok(foliage.includes('vec3 leafTransmission('), 'the function is defined');
  assert.ok(foliage.indexOf('vec3 leafTransmission(') < foliage.indexOf(call), 'defined before it is called');
  assert.ok(foliage.includes('keyColor * shadowTint, visibility, color);'), 'the term takes the unshadowed sun and the shadow separately');
  const grass = createFragmentShader(['grass']);
  assert.equal(addLeafTransmission(grass), grass, 'a grass-only shader is left alone');
  assert.equal(addLeafTransmission(createFragmentShader([])), createFragmentShader([]));
  assert.ok(!createFragmentShader(['foliage']).includes('leafTransmission'), 'the core shader carries none of it');
  assert.ok(shaderTransforms.includes(addLeafTransmission), 'loading the vegetation addon registers the transform');
});
