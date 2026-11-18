import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { documentationGroups } from '../src/documentation-topics.js';

const projectRoot = new URL('../', import.meta.url);
const learnFiles = readdirSync(new URL('docs/learn/', projectRoot)).filter(file => file.endsWith('.md'));
const listedIds = new Set(documentationGroups.flatMap(group => group.ids));

test('every learn page sits in a navigation group, so none falls into "More guides"', () => {
  for (const file of learnFiles) {
    const id = file.slice(0, -'.md'.length);
    assert.ok(listedIds.has(id), `docs/learn/${file} is in no group of src/documentation-topics.js; add '${id}' to the group it belongs to`);
  }
});

test('the look and web groups exist and name pages that exist', () => {
  for (const title of ['Look and light', 'Ship to the web']) {
    const group = documentationGroups.find(entry => entry.title === title);
    assert.ok(group, `the navigation has no "${title}" group`);
    for (const id of group.ids) assert.ok(learnFiles.includes(`${id}.md`), `${title} lists ${id}, which has no docs/learn page`);
  }
});

test('every preview picture that a docs page or the home page names exists', () => {
  const sources = [
    ...learnFiles.map(file => readFileSync(new URL(`docs/learn/${file}`, projectRoot), 'utf8')),
    readFileSync(new URL('site/index.html', projectRoot), 'utf8'),
  ];
  for (const text of sources) {
    for (const [, name] of text.matchAll(/\/previews\/([\w.-]+)|\.\/previews\/([\w.-]+)/g)) {
      if (name) assert.ok(existsSync(new URL(`public/previews/${name}`, projectRoot)), `public/previews/${name} is named but missing`);
    }
  }
});

test('every showcase tab opens: its scene file has a camera', () => {
  const source = readFileSync(new URL('src/showcase.js', projectRoot), 'utf8');
  const labels = source.match(/const SCENE_LABELS = \{([^}]*)\}/)[1];
  for (const [, id] of labels.matchAll(/(\w+): '/g)) {
    const scene = JSON.parse(readFileSync(new URL(`public/showcase/${id}/scene.json`, projectRoot), 'utf8'));
    assert.equal(scene.eye?.length, 3, `public/showcase/${id}/scene.json needs "eye" for the showcase page`);
    assert.equal(scene.target?.length, 3, `public/showcase/${id}/scene.json needs "target" for the showcase page`);
  }
});
