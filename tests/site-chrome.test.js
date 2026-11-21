import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { applyChrome, CHROME_PAGES, FOOTERLESS_PAGES, renderFooter, renderHeader } from '../scripts/site-chrome.mjs';

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
    if (FOOTERLESS_PAGES.has(pageName)) continue;
    assert.equal(region(source, 'footer'), renderFooter(), `${pageName} footer`);
  }
});

test('the top bar has the same links in the same order on every page', () => {
  const linkLists = CHROME_PAGES.map((pageName) => [...region(readPage(pageName), 'header').matchAll(/href="([^"]+)"/g)].map((match) => match[1].replace(/^\/#install$/, '#install')));
  for (const links of linkLists) assert.deepEqual(links, linkLists[0]);
});

test('the footer lists every page, since the phone top bar keeps only Docs, GitHub and Install', () => {
  const footer = renderFooter();
  for (const href of ['/docs.html', '/recipes.html', '/showcase.html', '/marketplace.html', '/tiers.html', '/changelog.html']) {
    assert.ok(footer.includes(`<a href="${href}">`), `${href} is missing from the footer`);
  }
});

test('full-screen viewer pages carry the top bar and no footer, and the canvas page keeps its footer where it scrolls', () => {
  assert.deepEqual([...FOOTERLESS_PAGES].sort(), ['assets', 'film', 'motion', 'nature', 'object', 'view2d']);
  for (const pageName of FOOTERLESS_PAGES) assert.ok(!readPage(pageName).includes('site-chrome:footer'), `${pageName} must not carry a footer`);
  assert.ok(readPage('modeling').includes('site-chrome:footer'));
  const pageWithFooter = ['<!-- site-chrome:header -->', '<!-- /site-chrome:header -->', '<!-- site-chrome:footer -->', '<!-- /site-chrome:footer -->'].join('\n');
  assert.throws(() => applyChrome(pageWithFooter, 'film'), /carries no footer/);
});

test('every viewer page loads the shared chrome and viewer styles, wears the viewer class and keeps no top bar of its own', () => {
  const viewerScripts = { film: 'film-player', motion: 'motion-player', modeling: 'modeling-player', nature: 'nature-viewer', object: 'main', view2d: 'view2d', assets: 'asset-viewer' };
  const oldHeaders = ['class="navigation"', 'class="film-header', 'class="world-header"', 'class="motion-header', 'class="studio-nav"', 'class="site-footer"'];
  for (const [pageName, scriptName] of Object.entries(viewerScripts)) {
    const html = readPage(pageName);
    assert.match(html, /<body class="themed viewer/, `${pageName} body needs the themed and viewer classes`);
    for (const oldHeader of oldHeaders) assert.ok(!html.includes(oldHeader), `${pageName} still carries ${oldHeader}`);
    const script = readFileSync(new URL(`../src/${scriptName}.js`, import.meta.url), 'utf8');
    assert.ok(script.includes("import './site-chrome.js';"), `src/${scriptName}.js must load the shared chrome`);
  }
  for (const stylesheet of ['film-style', 'motion-style', 'modeling-style', 'nature-style', 'style', 'view2d']) {
    const css = readFileSync(new URL(`../src/${stylesheet}.css`, import.meta.url), 'utf8');
    assert.ok(css.startsWith("@import './viewer-chrome.css';"), `${stylesheet}.css must start with the shared viewer styles`);
  }
});

test('no page head still carries the unused color script', () => {
  for (const pageName of CHROME_PAGES) assert.ok(!readPage(pageName).includes('crucible-color'), pageName);
});

test('each page marks its own place in the top bar with aria-current', () => {
  const expected = { index: null, film: null, motion: null, modeling: null, nature: null, object: null, view2d: null, assets: null, docs: '/docs.html', changelog: '/changelog.html', recipes: '/recipes.html', 'recipe-dolly-zoom': '/recipes.html', marketplace: '/marketplace.html', showcase: '/showcase.html', tiers: null };
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
