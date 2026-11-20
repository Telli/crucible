import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { BEAT_STARTS, beatIndexAt, prefersStillStory } from '../src/landing-story.js';

const landingPage = readFileSync(new URL('../site/index.html', import.meta.url), 'utf8');

test('each beat takes over the text column at its own scroll progress', () => {
  assert.equal(beatIndexAt(0), 0);
  assert.equal(beatIndexAt(0.09), 0);
  BEAT_STARTS.forEach((start, index) => assert.equal(beatIndexAt(start), index));
  assert.equal(beatIndexAt(0.5), 2);
  assert.equal(beatIndexAt(1), BEAT_STARTS.length - 1);
});

test('a visitor on a light connection or a small device gets the stills', () => {
  assert.equal(prefersStillStory({ connection: { saveData: true } }), true);
  assert.equal(prefersStillStory({ connection: { effectiveType: '3g' } }), true);
  assert.equal(prefersStillStory({ connection: { effectiveType: 'slow-2g' } }), true);
  assert.equal(prefersStillStory({ deviceMemory: 4 }), true);
});

test('a fast connection with enough memory gets the live scene', () => {
  assert.equal(prefersStillStory({ connection: { effectiveType: '4g' }, deviceMemory: 8 }), false);
  assert.equal(prefersStillStory({}), false);
  assert.equal(prefersStillStory(), false);
});

test('a capture, measure or scout page always shows the live scene', () => {
  for (const name of ['capture', 'measure', 'scout']) {
    assert.equal(prefersStillStory({ connection: { saveData: true }, deviceMemory: 2, search: `?${name}=1` }), false);
  }
});

test('the page ships five beats and a fallback still for each one', () => {
  assert.equal((landingPage.match(/class="beat/g) ?? []).length, BEAT_STARTS.length);
  const stills = [...landingPage.matchAll(/src="(\/previews\/foundry-splats-\d\.png)"/g)].map((match) => match[1]);
  assert.equal(stills.length, BEAT_STARTS.length);
  stills.forEach((still) => assert.ok(existsSync(new URL(`../public${still}`, import.meta.url)), `${still} is missing`));
});

test('the page keeps the sections, release hooks and install paths of the old home page', () => {
  for (const id of ['content', 'install', 'code', 'showcase', 'agents', 'tiers']) {
    assert.match(landingPage, new RegExp(`id="${id}"`), `section #${id} is missing`);
  }
  for (const href of ['/docs.html', '/recipes.html', '/showcase.html', '/marketplace.html', '/changelog.html', 'https://github.com/codepawl/crucible']) {
    assert.ok(landingPage.includes(`href="${href}"`), `link ${href} is missing`);
  }
  for (const manager of ['npm', 'pnpm', 'yarn', 'bun']) {
    assert.ok(landingPage.includes(`data-package-manager="${manager}"`), `${manager} switch is missing`);
  }
  assert.ok(landingPage.includes('data-release-version'));
  assert.ok(landingPage.includes('data-release-commit'));
  assert.ok(landingPage.includes('npx crucible-mcp'));
});
