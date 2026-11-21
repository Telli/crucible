import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { applyChrome, CHROME_PAGES, renderFooter, renderHeader } from '../scripts/site-chrome.mjs';

function readPage(pageName) {
  return readFileSync(new URL(`../site/${pageName}.html`, import.meta.url), 'utf8');
}

function region(source, part) {
  const match = source.match(new RegExp(`<!-- site-chrome:${part} -->\\n([\\s\\S]*?)\\n<!-- /site-chrome:${part} -->`));
  assert.ok(match, `the ${part} markers are missing`);
  return match[1];
}

test('every site page carries the shared top bar and footer, written by scripts/site-chrome.mjs', () => {
  for (const pageName of CHROME_PAGES) {
    const source = readPage(pageName);
    assert.equal(applyChrome(source, pageName), source, `site/${pageName}.html differs from the shared chrome: run node scripts/site-chrome.mjs`);
    assert.equal(region(source, 'footer'), renderFooter(), `${pageName} footer`);
  }
});

test('the top bar has the same links in the same order on every page', () => {
  const linkLists = CHROME_PAGES.map((pageName) => [...region(readPage(pageName), 'header').matchAll(/href="([^"]+)"/g)].map((match) => match[1].replace(/^\/#install$/, '#install')));
  for (const links of linkLists) assert.deepEqual(links, linkLists[0]);
});

test('each page marks its own place in the top bar with aria-current', () => {
  const expected = { index: null, docs: '/docs.html', changelog: '/changelog.html', recipes: '/recipes.html', 'recipe-dolly-zoom': '/recipes.html', marketplace: '/marketplace.html', showcase: '/showcase.html', tiers: null };
  for (const [pageName, href] of Object.entries(expected)) {
    const marked = [...renderHeader(pageName).matchAll(/<a[^>]*href="([^"]+)" aria-current="page"/g)].map((match) => match[1]);
    assert.deepEqual(marked, href ? [href] : [], pageName);
  }
});

test('every page wears the shared theme class and loads the shared styles', () => {
  for (const pageName of CHROME_PAGES) {
    assert.match(readPage(pageName), /<body class="[^"]*\bthemed\b/, `${pageName} body needs the themed class`);
  }
  const scripts = ['landing', 'documentation', 'changelog', 'recipes', 'marketplace', 'showcase', 'tiers'];
  for (const name of scripts) {
    const source = readFileSync(new URL(`../src/${name}.js`, import.meta.url), 'utf8');
    assert.match(source, /site-chrome\.(css|js)'/, `src/${name}.js must load the shared chrome`);
  }
});
