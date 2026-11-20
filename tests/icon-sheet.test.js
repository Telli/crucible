import test from 'node:test';
import assert from 'node:assert/strict';
import { ICON_CAPABILITIES, ICON_LIMITS, atlasCapacity, cameraBasis, cameraForFraming, iconArtifactNames, iconFrames, iconManifest, iconNames, iconRecipe, itemCapacity, layoutAtlas, lightRigEnvironment, normalizeIconSettings, sphereFraming, turnaroundAzimuth } from '../src/icon-sheet.js';
import { normalizeUserPasses } from '../src/user-pass.js';

const valid = { kind: 'icons', items: ['sword.glb'] };

test('defaults: 256 px, clean, fit, three-quarter view and the padding', () => {
  const settings = normalizeIconSettings(valid);
  assert.deepEqual({ size: settings.size, style: settings.style, scale: settings.scale, padding: settings.padding, viewpoint: settings.viewpoint },
    { size: 256, style: 'clean', scale: 'fit', padding: 0.08, viewpoint: { azimuth: 35, elevation: 25 } });
  assert.deepEqual(settings.items, [{ source: 'sword.glb' }]);
  assert.equal(settings.frameCount, 1);
  assert.equal(settings.transparent, true);
});

test('an unknown style is named with the styles to pass', () => {
  assert.throws(() => normalizeIconSettings({ ...valid, style: 'pencil' }), /style: got "pencil"; expected one of clean, toon, sketch/);
});

test('fields left for later releases say they are coming', () => {
  for (const field of ['lighting', 'background', 'outline']) {
    assert.throws(() => normalizeIconSettings({ ...valid, [field]: 4 }), new RegExp(`settings.${field}: .*is coming`));
  }
  assert.throws(() => normalizeIconSettings({ ...valid, bogus: 1 }), /Unknown settings field: bogus/);
});

test('every field is checked and the error names it and what to pass', () => {
  const cases = [
    [{ items: [] }, /items: got 0; expected a list of 1 to 256/],
    [{ items: 'sword.glb' }, /items: got "string"; expected a list of 1 to 256/],
    [{ items: [7] }, /items\[0\]: got "number"; expected a catalog GLB name/],
    [{ items: ['https://example.com/a.glb'] }, /remote URLs are not accepted/],
    [{ items: ['a'.repeat(300)] }, /items\[0\]: got .* expected a catalog GLB name of 1 to 260/],
    [{ items: [{ source: 'a.glb', asset: 'xyz' }] }, /items\[0\]\.asset: got "xyz"; expected the 64 hexadecimal/],
    [{ size: 100 }, /size: got 100; expected one of 64, 128, 256, 512/],
    [{ scale: 'huge' }, /scale: got "huge"; expected fit/],
    [{ padding: 0.9 }, /padding: got 0.9; expected a fraction of the icon side from 0.02 to 0.4/],
    [{ padding: 0 }, /padding: got 0;/],
    [{ viewpoint: 'top' }, /viewpoint: got "string"; expected "three-quarter" or \{ azimuth, elevation \}/],
    [{ viewpoint: { azimuth: 200 } }, /viewpoint.azimuth: got 200; expected degrees from -180 to 180/],
    [{ viewpoint: { elevation: 90 } }, /viewpoint.elevation: got 90; expected degrees from -89 to 89/],
    [{ viewpoint: { roll: 1 } }, /viewpoint.roll/],
  ];
  for (const [overrides, pattern] of cases) assert.throws(() => normalizeIconSettings({ ...valid, ...overrides }), pattern, JSON.stringify(overrides).slice(0, 60));
});

test('the item count is bounded by 256 and by the atlas for the size', () => {
  const items = count => Array.from({ length: count }, (_, index) => `item-${index}.glb`);
  assert.equal(normalizeIconSettings({ kind: 'icons', items: items(256), size: 256 }).frameCount, 256);
  assert.throws(() => normalizeIconSettings({ kind: 'icons', items: items(257) }), /items: got 257; expected a list of 1 to 256/);
  assert.equal(atlasCapacity(512), 64);
  assert.throws(() => normalizeIconSettings({ kind: 'icons', items: items(65), size: 512 }), /items: got 65; expected at most 64 items at size 512/);
  assert.equal(normalizeIconSettings({ kind: 'icons', items: items(64), size: 512 }).frameCount, 64);
});

test('a view override replaces azimuth and elevation and keeps the other default', () => {
  assert.deepEqual(normalizeIconSettings({ ...valid, viewpoint: { azimuth: -45 } }).viewpoint, { azimuth: -45, elevation: 25 });
  assert.deepEqual(normalizeIconSettings({ ...valid, viewpoint: 'three-quarter' }).viewpoint, ICON_LIMITS.defaultView);
});

test('stored settings with the pinned item form normalise to themselves', () => {
  const asset = 'ab'.repeat(32);
  const settings = normalizeIconSettings({ ...valid, items: [{ source: 'sword.glb', asset }] });
  assert.deepEqual(settings.items, [{ source: 'sword.glb', asset }]);
  // The job store re-reads its records without the frame count, which it checks separately.
  const { frameCount, ...stored } = settings;
  assert.deepEqual(normalizeIconSettings(stored), settings);
});

test('the camera looks at the item from the view direction with an orthographic square frame', () => {
  const { toCamera, right, up } = cameraBasis({ azimuth: 0, elevation: 0 });
  const rounded = vector => vector.map(value => Math.round(value) + 0);
  assert.deepEqual(rounded(toCamera), [0, 0, 1]);
  assert.deepEqual(rounded(right), [1, 0, 0]);
  assert.deepEqual(rounded(up), [0, 1, 0]);
  const framing = sphereFraming({ min: [-1, 0, -1], max: [1, 2, 1] });
  assert.deepEqual(framing.center, [0, 1, 0]);
  const camera = cameraForFraming(framing, { azimuth: 35, elevation: 25 });
  assert.equal(camera.projection, 'orthographic');
  assert.equal(camera.orthoScale, framing.radius * 2);
  assert.ok(camera.near > 0 && camera.far > camera.near);
});

test('the light rig and toon lines come from the recipe, never from the caller', () => {
  const clean = iconRecipe({ assetId: 'ab'.repeat(32), style: 'clean', view: { azimuth: 35, elevation: 25 }, size: 256 });
  const toon = iconRecipe({ assetId: 'ab'.repeat(32), style: 'toon', view: { azimuth: 35, elevation: 25 }, size: 256 });
  assert.equal(clean.environment.lines, undefined);
  assert.deepEqual(toon.environment.lines, { width: 2, toon: 3 });
  assert.equal(clean.environment.ground, false);
  assert.equal(clean.environment.world, false);
  assert.deepEqual(lightRigEnvironment({ azimuth: 35, elevation: 25 }), clean.environment);
  assert.ok(Math.abs(Math.hypot(...clean.environment.lightDirection) - 1) < 1e-9);
  assert.deepEqual(clean.nodes, [{ id: 'icon', asset: { id: 'ab'.repeat(32) } }]);
});

test('the atlas is a near square grid and names stay unique', () => {
  const layout = layoutAtlas(9, 64);
  assert.deepEqual([layout.columns, layout.rows, layout.width, layout.height], [3, 3, 192, 192]);
  assert.deepEqual(layout.rectangles[4], { x: 64, y: 64, width: 64, height: 64 });
  assert.deepEqual(iconNames(['kenney/sword.glb', 'other\\sword.glb', 'chest.GLB']), ['sword-0', 'sword-1', 'chest']);
});

test('scene_capabilities reports the limits the validator enforces', () => {
  assert.equal(ICON_CAPABILITIES.maximumItems, 256);
  assert.deepEqual(ICON_CAPABILITIES.styles, ['clean', 'toon', 'sketch']);
  assert.deepEqual(ICON_CAPABILITIES.angles, [1, 4, 8]);
  assert.equal(ICON_CAPABILITIES.maximumIcons, 256);
  assert.deepEqual(ICON_CAPABILITIES.itemsPerSizeAndAngles, { 4: { 64: 64, 128: 32, 256: 16, 512: 8 }, 8: { 64: 32, 128: 32, 256: 16, 512: 8 } });
  assert.equal(ICON_CAPABILITIES.sketch.hatchDensity.maximum, 2);
  assert.deepEqual(ICON_CAPABILITIES.itemsPerSize, { 64: 256, 128: 256, 256: 256, 512: 64 });
  assert.ok(!ICON_CAPABILITIES.notYet.includes('breakdown'));
  assert.ok(ICON_CAPABILITIES.notYet.includes('lighting'));
});

test('sketch is a style with its own defaults, and its fields belong to it alone', () => {
  const settings = normalizeIconSettings({ ...valid, style: 'sketch' });
  assert.deepEqual(settings.sketch, { inkColor: '#2b2a33', paperColor: '#f4ecd8', hatchDensity: 1, jitter: 0.35 });
  assert.equal(settings.seed, 0);
  const tuned = normalizeIconSettings({ ...valid, style: 'sketch', seed: 7, sketch: { inkColor: '#102030', hatchDensity: 2 } });
  assert.deepEqual([tuned.seed, tuned.sketch.inkColor, tuned.sketch.hatchDensity, tuned.sketch.paperColor], [7, '#102030', 2, '#f4ecd8']);
  assert.throws(() => normalizeIconSettings({ ...valid, seed: 3 }), /seed: got "a field of the sketch style"; expected no seed unless style is "sketch" \(the style is clean\)/);
  assert.throws(() => normalizeIconSettings({ ...valid, style: 'toon', sketch: {} }), /sketch: .*no sketch unless style is "sketch"/);
});

test('every sketch knob is bounded and the error says what to pass', () => {
  const sketchStyle = { ...valid, style: 'sketch' };
  const cases = [
    [{ sketch: { inkColor: 'black' } }, /sketch.inkColor: got "black"; expected a colour as "#rrggbb"/],
    [{ sketch: { paperColor: '#fff' } }, /sketch.paperColor: got "#fff"; expected a colour as "#rrggbb"/],
    [{ sketch: { hatchDensity: 3 } }, /sketch.hatchDensity: got 3; expected a number from 0.5 to 2/],
    [{ sketch: { hatchDensity: 0 } }, /sketch.hatchDensity: got 0;/],
    [{ sketch: { jitter: 1.5 } }, /sketch.jitter: got 1.5; expected a number from 0 to 1/],
    [{ sketch: { jitter: Number.NaN } }, /sketch.jitter: got NaN/],
    [{ sketch: { pressure: 1 } }, /sketch.pressure: got "an unknown field"; expected only inkColor, paperColor, hatchDensity, jitter/],
    [{ sketch: 'rough' }, /sketch: got "string"; expected an object with any of/],
    [{ seed: 1.5 }, /seed: got 1.5; expected a whole number from 0 to 65535/],
    [{ seed: 70000 }, /seed: got 70000;/],
  ];
  for (const [overrides, pattern] of cases) assert.throws(() => normalizeIconSettings({ ...sketchStyle, ...overrides }), pattern, JSON.stringify(overrides));
});

test('the sketch recipe carries a user pass the user-pass checker accepts, and the stage picks a breakdown step', () => {
  const settings = normalizeIconSettings({ ...valid, style: 'sketch', seed: 5 });
  const view = { azimuth: 35, elevation: 25 };
  const recipe = iconRecipe({ assetId: 'ab'.repeat(32), style: 'sketch', view, size: 64, sketch: settings.sketch, seed: settings.seed });
  const [pass] = normalizeUserPasses(recipe.postPasses);
  assert.equal(pass.name, 'icon-sketch');
  assert.equal(pass.uniforms.seed.value, 5);
  assert.equal(pass.uniforms.stage.value, 0);
  assert.equal(pass.uniforms.hatchPeriod.value, 3, 'a 64 px icon hatches in whole 3 px steps so the lines do not beat against the pixels');
  assert.equal(recipe.environment.lines, undefined, 'the outline is the pass, not line art');
  const outline = iconRecipe({ assetId: 'ab'.repeat(32), style: 'sketch', view, size: 64, sketch: settings.sketch, stage: 'outline' });
  assert.equal(normalizeUserPasses(outline.postPasses)[0].uniforms.stage.value, 1);
  assert.equal(iconRecipe({ assetId: 'ab'.repeat(32), style: 'clean', view, size: 64 }).postPasses, undefined);
});

test('angles take 1, 4 or 8 and the job must fit the atlas and the icon count', () => {
  assert.equal(normalizeIconSettings({ ...valid, angles: 8 }).frameCount, 8);
  assert.throws(() => normalizeIconSettings({ ...valid, angles: 3 }), /angles: got "3"; expected one of 1, 4, 8/);
  assert.equal(itemCapacity(256, 1), 256);
  assert.equal(itemCapacity(512, 8), 8);
  assert.equal(itemCapacity(64, 8), 32);
  const items = count => Array.from({ length: count }, (_, index) => `item-${index}.glb`);
  assert.equal(normalizeIconSettings({ kind: 'icons', items: items(32), angles: 8, size: 64 }).frameCount, 256);
  assert.throws(() => normalizeIconSettings({ kind: 'icons', items: items(33), angles: 8, size: 64 }), /items: got 33; expected at most 32 items at size 64 with 8 angles/);
  assert.throws(() => normalizeIconSettings({ kind: 'icons', items: items(9), angles: 4, size: 512 }), /items: got 9; expected at most 8 items at size 512 with 4 angles/);
});

test('a turnaround starts at the viewpoint azimuth and walks round in equal steps, wrapped to -180 to 180', () => {
  assert.deepEqual([0, 1, 2, 3].map(index => turnaroundAzimuth(35, index, 4)), [35, 125, -145, -55]);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map(index => turnaroundAzimuth(0, index, 8)), [0, 45, 90, 135, 180, -135, -90, -45]);
  const settings = normalizeIconSettings({ kind: 'icons', items: ['a.glb', 'b.glb'], angles: 4, viewpoint: { azimuth: 0, elevation: 10 } });
  const frames = iconFrames(settings);
  assert.deepEqual(frames.map(frame => [frame.itemIndex, frame.angleIndex, frame.view.azimuth, frame.view.elevation]), [
    [0, 0, 0, 10], [0, 1, 90, 10], [0, 2, 180, 10], [0, 3, -90, 10], [1, 0, 0, 10], [1, 1, 90, 10], [1, 2, 180, 10], [1, 3, -90, 10]]);
});

test('breakdown needs the sketch style, which is drawn in steps', () => {
  assert.throws(() => normalizeIconSettings({ ...valid, breakdown: true }), /breakdown: got "true"; expected a style that is drawn in steps: set style to "sketch" \(the style is clean\)/);
  assert.throws(() => normalizeIconSettings({ ...valid, style: 'sketch', breakdown: 'yes' }), /breakdown: got "string"; expected true or false/);
  assert.equal(normalizeIconSettings({ ...valid, style: 'sketch', breakdown: false }).breakdown, undefined);
  assert.equal(normalizeIconSettings({ ...valid, style: 'sketch', breakdown: true }).breakdown, true);
});

test('a turnaround sheet has one row per item and one column per angle, and every entry names its angle', () => {
  const settings = normalizeIconSettings({ kind: 'icons', items: [{ source: 'sword.glb', asset: 'ab'.repeat(32) }, 'coin.glb'], angles: 4, size: 64, style: 'sketch', breakdown: true });
  const layout = layoutAtlas(settings.frameCount, 64, settings.angles);
  assert.deepEqual([layout.columns, layout.rows, layout.width, layout.height], [4, 2, 256, 128]);
  assert.deepEqual(layout.rectangles[5], { x: 64, y: 64, width: 64, height: 64 });
  const entries = Array.from({ length: 8 }, (_, index) => ({ bounds: { x: 1, y: 1, width: 5, height: 5 }, viewHeight: index + 1 }));
  const manifest = iconManifest({ settings, layout, entries });
  assert.equal(manifest.angles, 4);
  assert.equal(manifest.seed, 0);
  assert.deepEqual(manifest.sketch, settings.sketch);
  assert.deepEqual(manifest.icons.map(icon => [icon.name, icon.item, icon.turn, icon.angle, icon.file]).slice(2, 6), [
    ['sword', 0, 2, -145, 'icon-2.png'], ['sword', 0, 3, -55, 'icon-3.png'], ['coin', 1, 0, 35, 'icon-4.png'], ['coin', 1, 1, 125, 'icon-5.png']]);
  assert.deepEqual(manifest.icons.filter(icon => icon.breakdown).map(icon => [icon.name, icon.breakdown]), [['sword', 'breakdown-0.png'], ['coin', 'breakdown-1.png']]);
  assert.deepEqual(manifest.icons[4].rect, { x: 0, y: 64, width: 64, height: 64 });
});

test('the artifact list is one PNG per frame, a strip per item when asked, then the atlas and icons.json', () => {
  assert.deepEqual(iconArtifactNames(2), ['icon-0.png', 'icon-1.png', 'atlas.png', 'icons.json']);
  assert.deepEqual(iconArtifactNames(4, { itemCount: 2 }), ['icon-0.png', 'icon-1.png', 'icon-2.png', 'icon-3.png', 'breakdown-0.png', 'breakdown-1.png', 'atlas.png', 'icons.json']);
});
