// #3142: the spread of the normals each normal-map mip level averages is measured from the full-resolution texels at upload and
// stored in the alpha of every level, because the 8-bit RGB of a mip cannot show it. The shader fades the direct specular by it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFragmentShader } from '../src/shaders.js';

// Loaded on demand so a tree without the module fails the first test at an assertion instead of at import.
const variance = await import('../src/normal-map-variance.js').catch(() => ({}));
const { buildNormalVarianceLevels, decodeSpread, encodeSpread, MAXIMUM_BAKED_ALPHA } = variance;

test('the upload bake is exported', () => {
  assert.equal(typeof variance.bakeNormalMapVariance, 'function', 'src/normal-map-variance.js must export bakeNormalMapVariance');
  assert.equal(typeof buildNormalVarianceLevels, 'function', 'src/normal-map-variance.js must export buildNormalVarianceLevels');
});

// Bytes of a unit normal in tangent space: x and y tilt by `tilt` radians toward `direction` along x.
function encodedNormal(tilt, direction) {
  const normal = [Math.sin(tilt) * direction, 0, Math.cos(tilt)];
  return normal.map(component => Math.round((component * 0.5 + 0.5) * 255));
}

function mapOf(width, height, texelAt) {
  const rgba = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      const [red, green, blue] = texelAt(column, row);
      rgba.set([red, green, blue, 255], (row * width + column) * 4);
    }
  }
  return rgba;
}

const alphaOf = (level, texel = 0) => level.data[texel * 4 + 3];

test('a flat normal map has no spread at any level and keeps its direction', () => {
  const levels = buildNormalVarianceLevels(mapOf(16, 16, () => [128, 128, 255]), 16, 16);
  assert.equal(levels.length, 5);
  for (const level of levels) {
    for (let texel = 0; texel < level.width * level.height; texel++) {
      assert.equal(alphaOf(level, texel), 0, `${level.width}x${level.height} texel ${texel}`);
    }
  }
  assert.deepEqual([...levels[4].data.subarray(0, 3)], [128, 128, 255]);
});

test('alternating tilted normals leave a spread of one minus the cosine of the tilt from level 1 down', () => {
  const tilt = Math.PI / 6;
  const rgba = mapOf(8, 8, column => encodedNormal(tilt, column % 2 === 0 ? 1 : -1));
  const levels = buildNormalVarianceLevels(rgba, 8, 8);
  assert.equal(alphaOf(levels[0]), 0, 'level 0 holds single texels, so it has no spread');
  const expected = 1 - Math.cos(tilt);
  for (const level of levels.slice(1)) {
    for (let texel = 0; texel < level.width * level.height; texel++) {
      const measured = decodeSpread(alphaOf(level, texel));
      assert.ok(Math.abs(measured - expected) < 0.01, `${level.width}x${level.height}: spread ${measured.toFixed(4)}, expected ${expected.toFixed(4)}`);
    }
    assert.deepEqual([...level.data.subarray(0, 3)], [128, 128, 255], 'the mean direction of opposite tilts is straight up');
  }
});

test('a uniform tilt has no spread however far it is tilted, so a bevel that is one smooth facet stays sharp', () => {
  const levels = buildNormalVarianceLevels(mapOf(8, 8, () => encodedNormal(1.0, 1)), 8, 8);
  for (const level of levels) assert.equal(alphaOf(level), 0);
});

test('the spread only reaches the texels whose block mixes normals', () => {
  const rgba = mapOf(4, 4, column => (column < 2 ? [128, 128, 255] : encodedNormal(Math.PI / 3, column === 2 ? 1 : -1)));
  const [, firstLevel] = buildNormalVarianceLevels(rgba, 4, 4);
  assert.equal(alphaOf(firstLevel, 0), 0);
  assert.equal(alphaOf(firstLevel, 2), 0);
  assert.ok(decodeSpread(alphaOf(firstLevel, 1)) > 0.45, 'opposite 60 degree tilts average to a half-length normal');
});

test('the chain runs to 1x1 on a map that is not square or not a power of two', () => {
  assert.deepEqual(buildNormalVarianceLevels(mapOf(4, 2, () => [128, 128, 255]), 4, 2).map(({ width, height }) => `${width}x${height}`), ['4x2', '2x1', '1x1']);
  assert.deepEqual(buildNormalVarianceLevels(mapOf(5, 3, () => [128, 128, 255]), 5, 3).map(({ width, height }) => `${width}x${height}`), ['5x3', '2x1', '1x1']);
});

test('the stored spread round-trips and never reads as an unbaked texture', () => {
  for (const spread of [0, 0.001, 0.05, 0.5]) assert.ok(Math.abs(decodeSpread(encodeSpread(spread)) - spread) < 0.01);
  assert.equal(encodeSpread(1), MAXIMUM_BAKED_ALPHA);
  assert.equal(encodeSpread(5), MAXIMUM_BAKED_ALPHA);
  assert.equal(encodeSpread(-1), 0);
});

test('a map that is not width x height RGBA bytes is refused with what to pass', () => {
  assert.throws(() => buildNormalVarianceLevels(new Uint8Array(12), 2, 2), /width x height x 4 RGBA bytes/);
  assert.throws(() => buildNormalVarianceLevels(new Uint8Array(16), 0, 2), /whole width and height/);
});

test('the specular fade of a shader with a normal map reads the baked spread', () => {
  assert.match(createFragmentShader(['normalMap']), /normalVariance = [^;]*[*] normalMapSpread;/);
});
