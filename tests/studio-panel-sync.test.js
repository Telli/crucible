import './support/load-agent-scene-modules.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createStudio } from '../src/studio.js';
import { FakeNode, createFakeRenderer, installStudioDom } from './support/studio-dom.mjs';

function sceneRecipe() {
  return {
    format: 'crucible.scene',
    schemaVersion: 1,
    geometries: [{ id: 'cube', type: 'box', bevel: 0 }, { id: 'ball', type: 'sphere', segments: 8, rings: 6 }],
    materials: [
      { id: 'stone', color: [0.3, 0.32, 0.35] },
      { id: 'paint', color: [0.8, 0.25, 0.2] },
      { id: 'moss', color: [0.1, 0.5, 0.2] },
    ],
    nodes: [
      { id: 'ground', geometry: 'cube', material: 'stone', scale: [10, 0.4, 10] },
      { id: 'hero', geometry: 'cube', material: 'paint', translation: [0, 0.5, 0] },
      { id: 'orb', geometry: 'ball', material: 'paint', translation: [2, 0.5, 0] },
      { id: 'tree', geometry: 'cube', material: 'moss', translation: [-2, 0.5, 0] },
    ],
    camera: { eye: [0, 2, 6], target: [0, 0.5, 0], up: [0, 1, 0], fov: 45, near: 0.1, far: 100 },
  };
}

// The fake browser is removed only after every panel mounted in it has been disposed.
function installDom(testContext) {
  const dom = installStudioDom();
  dom.mountedStudios = [];
  testContext.after(() => {
    for (const studio of dom.mountedStudios) studio.dispose();
    dom.uninstall();
  });
  return dom;
}

// A second panel in the same fake document lets a test compare an edited panel with one built from the same recipe.
function mountPanel(testContext, { recipe = sceneRecipe(), sharedDom = null } = {}) {
  const dom = sharedDom ?? installDom(testContext);
  const container = sharedDom ? dom.document.createElement('div') : dom.container;
  if (sharedDom) dom.document.body.append(container);
  const studio = createStudio(container, { recipe, renderer: createFakeRenderer() });
  dom.mountedStudios.push(studio);
  const root = container.firstElementChild;
  return {
    dom,
    studio,
    root,
    tree: root.querySelector('.crucible-studio-tree'),
    swatchStrip: root.querySelector('.crucible-studio-swatches'),
    nodeRows: () => root.querySelectorAll('.crucible-studio-tree-row').filter(row => row.dataset.sceneObject === undefined),
    rowByLabel: label => root.querySelectorAll('.crucible-studio-tree-row').find(row => row.querySelector('.crucible-studio-tree-label').textContent === label),
    swatches: () => root.querySelectorAll('.crucible-studio-swatch-btn'),
  };
}

// Tag, attributes, dataset, own text and inline style of every element below this one, in order.
function describeElement(element, depth = 0) {
  const attributes = [...element.attributeMap].sort(([first], [second]) => first.localeCompare(second));
  const self = `${' '.repeat(depth)}${element.tagName} ${JSON.stringify(attributes)} ${JSON.stringify(element.dataset)} ${JSON.stringify(element.style)} ${JSON.stringify(element.ownText)}`;
  return [self, ...element.children.flatMap(child => describeElement(child, depth + 1))];
}

function describePanel(panel) {
  return [...describeElement(panel.tree), ...describeElement(panel.swatchStrip)].join('\n');
}

function countReads(elements, property) {
  const counter = { reads: 0 };
  for (const element of elements) {
    Object.defineProperty(element, property, {
      configurable: true,
      get() {
        counter.reads += 1;
        return 0;
      },
    });
  }
  return counter;
}

// Compared by identity: a failed deepEqual of two DOM nodes prints both element trees and never finishes.
function assertSameElements(actual, expected, message) {
  assert.ok(actual.length === expected.length && actual.every((element, index) => element === expected[index]), message);
}

function rowLabel(row) {
  return row.querySelector('.crucible-studio-tree-label').textContent;
}

test('adding a node builds one row and keeps every other row element', testContext => {
  const panel = mountPanel(testContext);
  const rowsBefore = new Map(panel.nodeRows().map(row => [rowLabel(row), row]));
  panel.studio.controller.addPrimitive('box');
  const rowsAfter = panel.nodeRows();
  assert.equal(rowsAfter.length, rowsBefore.size + 1);
  assert.equal(rowsAfter.filter(row => !rowsBefore.has(rowLabel(row))).length, 1, 'one new row for the new node');
  for (const [label, row] of rowsBefore) {
    assert.ok(panel.rowByLabel(label) === row, `the row of ${label} is the same element`);
  }
});

test('selecting a node only moves the selected mark between two existing rows', testContext => {
  const panel = mountPanel(testContext);
  const rowsBefore = panel.nodeRows();
  panel.studio.selectNode('orb');
  assertSameElements(panel.nodeRows(), rowsBefore, 'every row is the same element');
  assert.deepEqual(rowsBefore.map(row => row.dataset.selected), ['false', 'false', 'true', 'false']);
  assert.equal(panel.rowByLabel('orb').getAttribute('aria-selected'), 'true');
  assert.equal(panel.rowByLabel('hero').getAttribute('aria-selected'), 'false');
});

test('a hidden node rebuilds its own row and no other', testContext => {
  const panel = mountPanel(testContext);
  const rowsBefore = new Map(panel.nodeRows().map(row => [rowLabel(row), row]));
  panel.studio.controller.updateNodeTransform('hero', { visible: false });
  assert.ok(panel.rowByLabel('hero') !== rowsBefore.get('hero'));
  assert.equal(panel.rowByLabel('hero').querySelector('.crucible-studio-tree-select').dataset.hidden, 'true');
  for (const label of ['ground', 'orb', 'tree']) {
    assert.ok(panel.rowByLabel(label) === rowsBefore.get(label), `the row of ${label} is the same element`);
  }
});

test('a recoloured material repaints the row badges without rebuilding the rows', testContext => {
  const panel = mountPanel(testContext);
  const rowsBefore = panel.nodeRows();
  const badgeOf = label => panel.rowByLabel(label).querySelector('.crucible-studio-tree-badge');
  const fillBefore = badgeOf('hero').style.fill;
  panel.studio.controller.updateMaterial('paint', { color: [0.1, 0.2, 0.9] });
  assertSameElements(panel.nodeRows(), rowsBefore, 'every row is the same element');
  assert.notEqual(badgeOf('hero').style.fill, fillBefore);
  assert.equal(badgeOf('orb').style.fill, badgeOf('hero').style.fill);
});

test('the strip scrolls to the pressed swatch only when the pressed swatch moved', testContext => {
  const panel = mountPanel(testContext);
  panel.studio.selectNode('hero');
  const swatchesBefore = panel.swatches();
  const reads = countReads(swatchesBefore, 'offsetLeft');
  panel.studio.selectNode('orb');
  assert.equal(reads.reads, 0, 'hero and orb share a material, so nothing scrolls');
  panel.studio.controller.updateNodeTransform('orb', { translation: [3, 0.5, 0] });
  assert.equal(reads.reads, 0, 'a move leaves the strip alone');
  panel.studio.selectNode('tree');
  assert.ok(reads.reads > 0, 'the pressed swatch moved to another material');
  assert.deepEqual(panel.swatches().map(swatch => swatch.getAttribute('aria-pressed')), ['false', 'false', 'true']);
  assertSameElements(panel.swatches(), swatchesBefore, 'the swatch elements stay');
});

test('the Scene list measures its rows once, not once per edit', testContext => {
  const dom = installDom(testContext);
  testContext.after(() => {
    delete FakeNode.prototype.offsetHeight;
  });
  dom.document.defaultView.getComputedStyle = () => ({ paddingTop: '4px', paddingBottom: '0px' });
  const measured = { reads: 0 };
  Object.defineProperty(FakeNode.prototype, 'offsetHeight', {
    configurable: true,
    get() {
      measured.reads += 1;
      return 28;
    },
  });
  const properties = new Map();
  const panel = mountPanel(testContext, { sharedDom: dom });
  panel.tree.clientHeight = 90;
  panel.tree.style.removeProperty = name => properties.delete(name);
  panel.tree.style.setProperty = (name, value) => properties.set(name, value);
  const controller = panel.studio.controller;
  controller.addPrimitive('box');
  const readsAfterFirstFit = measured.reads;
  assert.ok(readsAfterFirstFit > 0);
  controller.addPrimitive('box');
  controller.addPrimitive('sphere');
  panel.studio.selectNode('hero');
  assert.equal(measured.reads, readsAfterFirstFit, 'no more reads of the row height');
  assert.ok(parseFloat(properties.get('--studio-tree-row-size')) >= 28, 'the rows of a list that scrolls grow to fill whole rows');
  dom.observers.resize.find(observer => observer.observed.includes(panel.tree)).callback([]);
  assert.ok(measured.reads > readsAfterFirstFit, 'a resize measures again');
});

test('after a run of edits the Scene list and the swatches equal a freshly built panel', testContext => {
  const panel = mountPanel(testContext);
  const controller = panel.studio.controller;
  controller.addPrimitive('box');
  controller.addPrimitive('sphere');
  panel.studio.selectNode('orb');
  controller.updateNodeTransform('hero', { visible: false });
  controller.updateMaterial('paint', { color: [0.1, 0.2, 0.9] });
  controller.updateNodeTransform('tree', { parent: 'hero' });
  controller.updateNodeTransform('ground', { label: 'floor' });
  controller.undo();
  controller.undo();
  controller.redo();
  controller.createMaterial({ color: [0.9, 0.9, 0.1] });
  panel.studio.selectNode('ground');
  const fresh = mountPanel(testContext, { recipe: panel.studio.exportRecipe(), sharedDom: panel.dom });
  fresh.studio.selectNode(controller.selectedNodeId);
  assert.equal(describePanel(panel), describePanel(fresh));
});
