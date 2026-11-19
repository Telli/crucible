import './site.css';
import './brand.js';
import './marketplace.css';
import { ADDON_AREAS, ADDON_CATALOG, PACKAGE_NAME } from './addon-catalog.js';
import { addonPackages, firstPartyPackages, npmManifestPath } from './marketplace-npm.js';

const NPM_SEARCH_URL = 'https://registry.npmjs.org/-/v1/search?text=keywords:crucible-addon&size=50';
const NPM_MANIFEST_URL = 'https://registry.npmjs.org/';
const FIRST_PARTY_SEARCH_URL = 'https://registry.npmjs.org/-/v1/search?text=@codepawlhq&size=50';
const MAXIMUM_RANGE_LOOKUPS = 20;
const CONCURRENT_RANGE_LOOKUPS = 5;
const ADDONS_DOC_URL = 'https://github.com/codepawl/crucible/blob/main/docs/addons.md';
const KIND_LABELS = {
  assets: ['model', 'models'],
  images: ['image', 'images'],
  looks: ['look', 'looks'],
  environments: ['HDRI', 'HDRIs'],
  materials: ['material', 'materials'],
  recipes: ['recipe', 'recipes'],
};
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
// One shape per state, so the state reads without the text: a ring, a magnifier, a warning triangle.
const STATE_ICONS = {
  loading: 'M12 3a9 9 0 1 0 9 9',
  empty: 'M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Zm5 11.5L21 21M8 10.5h5',
  error: 'M12 3 2 20h20L12 3Zm0 6v5m0 3h.01',
};

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function icon(path, className = 'market-icon') {
  const svg = document.createElementNS(SVG_NAMESPACE, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  const shape = document.createElementNS(SVG_NAMESPACE, 'path');
  shape.setAttribute('d', path);
  svg.append(shape);
  return svg;
}

function link(text, href, className) {
  const anchor = element('a', className, text);
  anchor.href = href;
  return anchor;
}

function showState(container, state, message, ...links) {
  const notice = element('p', `market-state market-state-${state}`);
  notice.setAttribute('role', state === 'error' ? 'alert' : 'status');
  notice.append(icon(STATE_ICONS[state]), element('span', '', message), ...links);
  container.replaceChildren(notice);
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function countLabel(kind, count) {
  const [singular, plural] = KIND_LABELS[kind] ?? [kind, kind];
  return `${count} ${count === 1 ? singular : plural}`;
}

async function copyText(button, text) {
  const label = button.textContent;
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = 'Copied';
  } catch {
    button.textContent = 'Copy failed';
  }
  setTimeout(() => { button.textContent = label; }, 1800);
}

function copyButton(text, label = 'Copy') {
  const button = element('button', 'market-copy', label);
  button.type = 'button';
  button.addEventListener('click', () => copyText(button, text));
  return button;
}

function packCard(pack) {
  const card = element('article', 'market-card pack-card');
  if (pack.preview) {
    const preview = element('img', 'pack-preview');
    preview.src = pack.preview;
    preview.alt = `Preview of ${pack.name}`;
    preview.loading = 'lazy';
    card.append(preview);
  } else {
    const placeholder = element('div', 'pack-preview pack-preview-empty');
    placeholder.append(icon('M3 7 12 2l9 5v10l-9 5-9-5V7Zm0 0 9 5 9-5M12 12v10'));
    card.append(placeholder);
  }
  const body = element('div', 'pack-body');
  const title = element('h3', '', pack.name);
  title.append(element('span', 'market-version', pack.version));
  const facts = element('ul', 'market-facts');
  const factTexts = [...Object.entries(pack.items).map(([kind, count]) => countLabel(kind, count)), pack.license, `Crucible ${pack.engines}`, formatBytes(pack.bytes), `by ${pack.author}`];
  for (const text of factTexts) facts.append(element('li', '', text));
  const download = link('Download', pack.zip, 'market-button');
  download.setAttribute('download', '');
  download.prepend(icon('M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4', 'market-icon market-button-icon'));
  const checksum = element('div', 'pack-checksum');
  checksum.append(element('span', '', 'SHA-256'), element('code', '', pack.sha256), copyButton(pack.sha256));
  const actions = element('div', 'pack-actions');
  actions.append(download, checksum);
  body.append(title, element('p', 'market-description', pack.description), facts, actions);
  card.append(body);
  return card;
}

async function loadPacks(container) {
  showState(container, 'loading', 'Loading packs');
  try {
    const response = await fetch('/packs/index.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const { packs } = await response.json();
    if (!Array.isArray(packs) || packs.length === 0) {
      showState(container, 'empty', 'No packs are published yet.', link('How to make one', 'https://github.com/codepawl/crucible/blob/main/docs/packs.md'));
      return;
    }
    container.replaceChildren(...packs.map(packCard));
  } catch {
    showState(container, 'error', 'The pack list did not load. Reload the page to try again.');
  }
}

function npmUrl(name) {
  return `https://www.npmjs.com/package/${name}`;
}

// The npm link sits on the title row, after the name and the version, so a card is one column.
function npmLink(name) {
  const npm = link('npm', npmUrl(name), 'market-npm-link');
  const logo = element('span', 'package-logo package-logo-npm');
  logo.setAttribute('aria-hidden', 'true');
  npm.prepend(logo);
  npm.setAttribute('aria-label', `${name} on npm`);
  return npm;
}

function addonCard(addon) {
  const card = element('article', 'market-card addon-card');
  card.dataset.addon = addon.name;
  const title = element('h3');
  title.append(link(addon.name, npmUrl(addon.name)), element('span', 'market-version', addon.version), npmLink(addon.name));
  const body = element('div', 'addon-body');
  body.append(title);
  if (addon.description) body.append(element('p', 'market-description', addon.description));
  const facts = element('ul', 'market-facts');
  facts.append(element('li', '', addon.range ? `Crucible ${addon.range}` : 'Range not stated'));
  body.append(facts);
  card.append(body);
  return card;
}

async function fetchLatestRange(name) {
  const path = npmManifestPath(name);
  if (!path) return null;
  try {
    const response = await fetch(`${NPM_MANIFEST_URL}${path}`);
    if (!response.ok) return null;
    const manifest = await response.json();
    return typeof manifest['crucible']?.range === 'string' ? manifest['crucible'].range : null;
  } catch {
    return null;
  }
}

// The search result carries no `crucible` field, so the latest manifest of each listed package is read, a few at a time.
async function fillRanges(addons, container) {
  const queue = addons.slice(0, MAXIMUM_RANGE_LOOKUPS);
  const workers = Array.from({ length: Math.min(CONCURRENT_RANGE_LOOKUPS, queue.length) }, async () => {
    while (queue.length > 0) {
      const addon = queue.shift();
      addon.range = await fetchLatestRange(addon.name);
      const row = container.querySelector(`[data-addon="${CSS.escape(addon.name)}"]`);
      if (row) row.replaceWith(addonCard(addon));
    }
  });
  await Promise.all(workers);
}

async function loadAddons(container) {
  showState(container, 'loading', 'Searching npm for addons');
  try {
    const response = await fetch(NPM_SEARCH_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const { objects } = await response.json();
    const addons = addonPackages(objects);
    if (addons.length === 0) {
      showState(container, 'empty', 'No third-party addons on npm yet.', link('Write an addon', ADDONS_DOC_URL));
      return;
    }
    container.replaceChildren(...addons.map(addonCard));
    await fillRanges(addons, container);
  } catch {
    showState(container, 'error', 'npm did not answer, so the addon list is missing. Search npm for crucible-addon instead.', link('Open the npm search', 'https://www.npmjs.com/search?q=keywords%3Acrucible-addon'));
  }
}

function packageCard(entry) {
  const card = element('article', 'market-card addon-card');
  const title = element('h3');
  title.append(link(entry.name, npmUrl(entry.name)), element('span', 'market-version', entry.version), npmLink(entry.name));
  const body = element('div', 'addon-body');
  body.append(title);
  if (entry.description) body.append(element('p', 'market-description', entry.description));
  const command = `npm install ${entry.name}`;
  const row = element('div', 'command-row');
  row.append(element('code', '', command), copyButton(command));
  body.append(row);
  card.append(body);
  return card;
}

async function loadFirstPartyPackages(container) {
  showState(container, 'loading', 'Searching npm for packages');
  try {
    const response = await fetch(FIRST_PARTY_SEARCH_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const { objects } = await response.json();
    const packages = firstPartyPackages(objects);
    if (packages.length === 0) {
      showState(container, 'empty', 'No companion packages are published yet.');
      return;
    }
    container.replaceChildren(...packages.map(packageCard));
  } catch {
    showState(container, 'error', 'npm did not answer, so the package list is missing.', link('Open the npm search', 'https://www.npmjs.com/search?q=%40codepawlhq%2Fcrucible-'));
  }
}

const REPOSITORY_URL = 'https://github.com/codepawl/crucible/blob/main';

function camelCase(name) {
  return name.replace(/-(w)/g, (_match, letter) => letter.toUpperCase());
}

function importLine(addon) {
  return `import * as ${camelCase(addon.name)} from '${PACKAGE_NAME}/addons/${addon.name}';`;
}

function builtinRow(addon) {
  const row = element('article', 'builtin-row');
  row.dataset.search = `${addon.name} ${addon.area} ${addon.summary}`.toLowerCase();
  const docUrl = addon.doc ? `${REPOSITORY_URL}/docs/${addon.name}.md` : `${REPOSITORY_URL}/src/${addon.name}.js`;
  const heading = element('h4', 'builtin-name');
  heading.append(link(addon.name, docUrl));
  const command = element('div', 'command-row');
  const line = importLine(addon);
  command.append(element('code', '', line), copyButton(line));
  row.append(heading, element('p', 'market-description', addon.summary), command);
  return row;
}

function builtinGroup(area) {
  const group = element('section', 'builtin-group');
  const addons = ADDON_CATALOG.filter(addon => addon.area === area.id);
  const heading = element('h4', 'builtin-area', area.label);
  heading.append(element('span', 'market-version', String(addons.length)));
  group.append(heading, ...addons.map(builtinRow));
  return group;
}

function applyBuiltinFilter(container, query) {
  const words = query.toLowerCase().split(/s+/).filter(Boolean);
  let shown = 0;
  for (const group of container.querySelectorAll('.builtin-group')) {
    let groupShown = 0;
    for (const row of group.querySelectorAll('.builtin-row')) {
      const matches = words.every(word => row.dataset.search.includes(word));
      row.hidden = !matches;
      if (matches) groupShown += 1;
    }
    group.hidden = groupShown === 0;
    shown += groupShown;
  }
  container.querySelector('.market-state')?.remove();
  if (shown === 0) {
    const notice = element('p', 'market-state market-state-empty');
    notice.setAttribute('role', 'status');
    notice.append(icon(STATE_ICONS.empty), element('span', '', `No built-in addon matches "${query.trim()}".`));
    container.append(notice);
  }
}

function loadBuiltinAddons(container, filter) {
  container.replaceChildren(...ADDON_AREAS.map(builtinGroup));
  filter.addEventListener('input', () => applyBuiltinFilter(container, filter.value));
}

document.querySelectorAll('[data-copy]').forEach(button => {
  button.addEventListener('click', () => copyText(button, button.dataset.copy));
});
loadPacks(document.querySelector('#pack-list'));
loadBuiltinAddons(document.querySelector('#builtin-list'), document.querySelector('#builtin-filter'));
loadAddons(document.querySelector('#addon-list'));
loadFirstPartyPackages(document.querySelector('#package-list'));
