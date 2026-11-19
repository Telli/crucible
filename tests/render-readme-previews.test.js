import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { PREVIEWS, PREVIEW_STILL_WIDTH, needsCook, parseArguments, previewNamesInReadme, renderSize, selectPreviews } from '../scripts/readme-previews-plan.mjs';

const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

test('the plan lists exactly the pictures README.md shows, each with a published file', () => {
  assert.deepEqual([...PREVIEWS.map(preview => preview.name)].sort(), [...new Set(previewNamesInReadme(readme))].sort());
  for (const preview of PREVIEWS) assert.ok(existsSync(new URL(`../public/previews/${preview.name}.webp`, import.meta.url)), `${preview.name}.webp is missing`);
});

test('every recipe preview has its recipe file and every clip states its frame budget', () => {
  for (const preview of PREVIEWS.filter(entry => entry.renderer === 'recipe')) {
    assert.ok(existsSync(new URL(`../scripts/readme-previews/${preview.recipe}.recipe.mjs`, import.meta.url)), `${preview.recipe}.recipe.mjs is missing`);
  }
  for (const preview of PREVIEWS.filter(entry => entry.kind === 'clip')) {
    assert.ok(preview.renderFps > 0 && preview.renderSeconds > 0 && preview.playFps > 0 && preview.maxBytes > 0, `${preview.name} lacks clip timing`);
  }
});

test('parseArguments reads names and options and rejects what it cannot use', () => {
  const options = parseArguments(['wall-e', 'cook-monk', '--preview', 'out', '--pairs', 'pairs', '--skip-cook']);
  assert.deepEqual(options.names, ['wall-e', 'cook-monk']);
  assert.equal(options.preview, 'out');
  assert.equal(options.pairs, 'pairs');
  assert.equal(options.skipCook, true);
  assert.throws(() => parseArguments(['not-a-preview']), /Unknown preview "not-a-preview"\. Pass one of: hero-classroom/);
  assert.throws(() => parseArguments(['--preview']), /--preview needs a folder/);
  assert.throws(() => parseArguments(['--fast']), /Unknown option --fast/);
});

test('selectPreviews keeps table order and --skip-cook drops the Cook previews', () => {
  assert.equal(selectPreviews(parseArguments([])).length, PREVIEWS.length);
  assert.deepEqual(selectPreviews(parseArguments(['wall-e', 'hero-classroom'])).map(preview => preview.name), ['hero-classroom', 'wall-e']);
  const withoutCook = selectPreviews(parseArguments(['--skip-cook']));
  assert.deepEqual(PREVIEWS.filter(needsCook).map(preview => preview.name), ['hero-classroom', 'feature-cook-dof', 'cook-monk']);
  assert.ok(withoutCook.every(preview => !needsCook(preview)));
  assert.equal(withoutCook.length, PREVIEWS.length - 3);
});

test('renderSize keeps the published size, and shrinks only wide stills in preview mode', () => {
  const byName = name => PREVIEWS.find(preview => preview.name === name);
  assert.deepEqual(renderSize(byName('cook-monk'), false), { width: 1600, height: 1200 });
  assert.deepEqual(renderSize(byName('cook-monk'), true), { width: PREVIEW_STILL_WIDTH, height: 480 });
  assert.deepEqual(renderSize(byName('hero-classroom'), true), { width: PREVIEW_STILL_WIDTH, height: 360 });
  assert.deepEqual(renderSize(byName('feature-clockwork'), true), { width: 480, height: 270 });
  assert.deepEqual(renderSize(byName('showcase-port'), true), { width: 632, height: 355 });
});
