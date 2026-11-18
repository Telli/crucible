import test from 'node:test';
import assert from 'node:assert/strict';
import { BREAKDOWN_ORDER, SKETCH_CAPABILITIES, SKETCH_STAGES, hexLuma, measureHatchBand, measureOutline, normalizeSketchSettings, seedFrom, sketchMetrics, sketchPass } from '../src/icon-sketch.js';
import { normalizeUserPasses } from '../src/user-pass.js';

const PAPER = '#f4ecd8';
const INK = '#2b2a33';

/** A `side` px square picture with a see-through border of `margin` px; `paint(column, row)` returns the luma 0 to 1 of an opaque pixel. */
function picture(side, margin, paint) {
  const data = new Uint8Array(side * side * 4);
  for (let row = margin; row < side - margin; row++) {
    for (let column = margin; column < side - margin; column++) {
      const value = Math.round(paint(column, row) * 255);
      data.set([value, value, value, 255], (row * side + column) * 4);
    }
  }
  return { data, width: side, height: side, paperLuma: hexLuma(PAPER), inkLuma: hexLuma(INK) };
}

const paperLuma = hexLuma(PAPER);
const inkLuma = hexLuma(INK);

test('hatching of crisp diagonal lines measures as strong, bimodal contrast with a share of ink', () => {
  const lines = picture(48, 4, (column, row) => ((column + row) % 3 === 0 ? inkLuma : paperLuma));
  const band = measureHatchBand(lines);
  assert.ok(band.contrast >= 0.9, `contrast ${band.contrast}`);
  assert.ok(band.bimodal >= 0.99, `bimodal ${band.bimodal}`);
  assert.ok(Math.abs(band.coverage - 1 / 3) < 0.02, `coverage ${band.coverage}`);
});

test('grey noise fails the same measure, so a regression to mush would be caught', () => {
  let state = 12345;
  const randomLuma = () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return inkLuma + (paperLuma - inkLuma) * (0.35 + 0.3 * (state / 2147483648));
  };
  const mush = picture(48, 4, () => randomLuma());
  const band = measureHatchBand({ ...mush, window: 3 });
  assert.ok(band === null || band.bimodal < 0.2 || band.contrast < 0.35, `mush scored ${JSON.stringify(band)}`);
});

test('a picture with no hatching has no hatched band, and the outline measure sees an inked or a bare contour', () => {
  assert.equal(measureHatchBand(picture(48, 4, () => paperLuma)), null);
  const inked = picture(48, 4, (column, row) => (column <= 4 || row <= 4 || column >= 43 || row >= 43 ? inkLuma : paperLuma));
  const bare = picture(48, 4, () => paperLuma);
  assert.equal(measureOutline(inked).inkedShare, 1);
  assert.equal(measureOutline(bare).inkedShare, 0);
  assert.ok(measureOutline(bare).contourPixels > 100);
});

test('the pass is valid for the user-pass checker at every size and every step, and fits the 4096 byte budget', () => {
  const settings = { sketch: normalizeSketchSettings(undefined), seed: 0 };
  for (const size of [64, 128, 256, 512]) {
    for (const stage of Object.keys(SKETCH_STAGES)) {
      const [pass] = normalizeUserPasses([sketchPass({ settings, size, stage })]);
      assert.equal(pass.uniforms.stage.value, SKETCH_STAGES[stage]);
    }
  }
});

test('hatching is laid out in whole pixels at 64 px and grows with the icon, so the look stays the same across sizes', () => {
  const base = { hatchDensity: 1, jitter: 0.35 };
  assert.deepEqual([64, 128, 256, 512].map(size => sketchMetrics({ size, ...base }).hatchPeriod), [3, 5, 11, 21]);
  assert.deepEqual([64, 128, 256, 512].map(size => sketchMetrics({ size, ...base }).reach), [1, 1, 2, 4]);
  assert.equal(sketchMetrics({ size: 64, hatchDensity: 2, jitter: 0 }).hatchPeriod, 3, 'never finer than 3 px, where lines stop reading');
  assert.ok(Number.isInteger(sketchMetrics({ size: 200, hatchDensity: 0.7, jitter: 0 }).hatchPeriod));
  assert.equal(sketchMetrics({ size: 256, hatchDensity: 1, jitter: 0 }).hatchShift, 0, 'no jitter means straight lines');
  assert.ok(sketchMetrics({ size: 256, hatchDensity: 1, jitter: 1 }).hatchShift < sketchMetrics({ size: 256, hatchDensity: 1, jitter: 1 }).hatchPeriod / 2, 'a line never wobbles into the next one');
});

test('the colours reach the pass as display values, the seed as a number, and a new seed is a new pass', () => {
  const settings = { sketch: normalizeSketchSettings({ inkColor: '#ff0000', paperColor: '#00ff00' }), seed: 9 };
  const pass = sketchPass({ settings, size: 128 });
  assert.deepEqual(pass.uniforms.inkColor, [1, 0, 0]);
  assert.deepEqual(pass.uniforms.paperColor, [0, 1, 0]);
  assert.equal(pass.uniforms.seed, 9);
  assert.notDeepEqual(pass.uniforms, sketchPass({ settings: { ...settings, seed: 10 }, size: 128 }).uniforms);
});

test('the seed is a whole number from 0 to 65535, and colours accept upper case hex', () => {
  assert.equal(seedFrom(undefined), 0);
  assert.equal(seedFrom(65535), 65535);
  assert.throws(() => seedFrom(-1), /seed: got -1/);
  assert.equal(normalizeSketchSettings({ inkColor: '#ABCDEF' }).inkColor, '#abcdef');
});

test('the breakdown shows four steps in a fixed order, and scene_capabilities lists them', () => {
  assert.deepEqual(BREAKDOWN_ORDER, ['shaded', 'outline', 'hatching', 'final']);
  assert.deepEqual(SKETCH_CAPABILITIES.breakdownSteps, BREAKDOWN_ORDER);
  assert.equal(SKETCH_CAPABILITIES.seed.maximum, 65535);
});
