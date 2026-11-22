import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const homePage = readFileSync(new URL('../site/index.html', import.meta.url), 'utf8');
const landingStyles = readFileSync(new URL('../src/landing.css', import.meta.url), 'utf8');

test('the home hero tells visitors that 67js is now Crucible and names the new package', () => {
  const heroStart = homePage.indexOf('<div class="actions">');
  const noteMatch = homePage.match(/<p class="rename-note"><a href="([^"]+)">(.*?)<\/a><\/p>/);
  assert.ok(noteMatch, 'the hero copy needs a p.rename-note with one link');
  assert.equal(noteMatch[1], '/changelog.html');
  assert.match(noteMatch[2], /67js is now Crucible/);
  assert.match(noteMatch[2], /<code>@codepawlhq\/crucible<\/code>/);
  assert.ok(heroStart >= 0 && heroStart < homePage.indexOf('class="rename-note"'), 'the note sits under the hero actions');
});

test('the rename note is styled in the landing stylesheet without borders or rules', () => {
  const noteRules = landingStyles.split('\n').filter((line) => line.includes('.rename-note'));
  assert.ok(noteRules.length > 0);
  for (const rule of noteRules) {
    assert.doesNotMatch(rule, /border/);
  }
});
