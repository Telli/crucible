import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { ADDON_AREAS, ADDON_CATALOG } from '../src/addon-catalog.js';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const exportedAddons = Object.keys(packageJson.exports)
  .filter(key => key.startsWith('./addons/'))
  .map(key => key.slice('./addons/'.length));
const areaIds = new Set(ADDON_AREAS.map(area => area.id));

test('every addon export has a row in the marketplace catalog', () => {
  const listed = new Set(ADDON_CATALOG.map(addon => addon.name));
  const missing = exportedAddons.filter(name => !listed.has(name));
  assert.deepEqual(missing, [], `Add a row to src/addon-catalog.js (name, area, summary) for: ${missing.join(', ')}`);
});

test('every catalog row names a real addon export, once', () => {
  const names = ADDON_CATALOG.map(addon => addon.name);
  assert.equal(new Set(names).size, names.length, 'src/addon-catalog.js lists an addon twice');
  const unknown = names.filter(name => !exportedAddons.includes(name));
  assert.deepEqual(unknown, [], `Remove rows with no ./addons/* export in package.json: ${unknown.join(', ')}`);
});

test('every row has a one-line summary and a known area', () => {
  for (const addon of ADDON_CATALOG) {
    assert.ok(typeof addon.summary === 'string' && addon.summary.trim().length > 0, `${addon.name} needs a summary`);
    assert.ok(addon.summary.length <= 90, `${addon.name} summary is ${addon.summary.length} characters; keep it to one short line (90)`);
    assert.ok(areaIds.has(addon.area), `${addon.name} has area ${JSON.stringify(addon.area)}; pass one of ${[...areaIds].join(', ')}`);
  }
});

test('a row marked doc: true has its docs page, and a docs page is never left unlinked', () => {
  for (const addon of ADDON_CATALOG) {
    const hasPage = existsSync(new URL(`../docs/${addon.name}.md`, import.meta.url));
    assert.equal(Boolean(addon.doc), hasPage, `${addon.name}: doc is ${Boolean(addon.doc)} but docs/${addon.name}.md ${hasPage ? 'exists' : 'does not exist'}`);
  }
});
