import './support/load-agent-scene-modules.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { STUDIO_CSS } from '../src/studio-styles.js';
import { createStudio, createStudioController, STUDIO_PRIMITIVES, STUDIO_TABS, STUDIO_TEMPLATES, STUDIO_TOOLS } from '../src/studio.js';
import { LIGHTING_SETUP_NAMES } from '../src/agent-scene-capabilities.js';
import { directionToSunAngles } from '../src/studio-controller.js';
import { buildGridParts } from '../src/studio-viewport-aids.js';
import { VIEW_TRANSFORM_NAMES } from '../src/view-transform-names.js';
import {
  byDataset,
  byLabel,
  byText,
  createFakeRenderer,
  dispatch,
  installStudioDom,
} from './support/studio-dom.mjs';

function makeRecipe() {
  return {
    format: 'crucible.scene',
    schemaVersion: 1,
    geometries: [
      { id: 'floor', type: 'box', bevel: 0 },
      { id: 'cube', type: 'box', bevel: 0.04 },
      { id: 'sphere', type: 'sphere', segments: 16, rings: 12 },
    ],
    materials: [
      { id: 'stone', tag: 'surface', color: [0.3, 0.32, 0.35], roughness: 0.8, metallic: 0 },
      { id: 'paint', tag: 'surface', color: [0.8, 0.25, 0.2], roughness: 0.4, metallic: 0.1 },
    ],
    nodes: [
      { id: 'ground', geometry: 'floor', material: 'stone', translation: [0, -0.2, 0], scale: [10, 0.4, 10] },
      { id: 'hero', geometry: 'cube', material: 'paint', translation: [0, 0.5, 0] },
      { id: 'orb', geometry: 'sphere', material: 'paint', translation: [2.2, 0.5, 0], scale: [0.5, 0.5, 0.5] },
    ],
    camera: { eye: [0, 2, 6], target: [0, 0.5, 0], up: [0, 1, 0], fov: 45, near: 0.1, far: 100 },
    environment: { setup: 'studio', lightDirection: [-2, 5, 3] },
  };
}

const VIEWPORT_BOX = { left: 40, top: 30, width: 800, height: 600, right: 840, bottom: 630 };

/** Mounts Studio on the fake DOM with a fake renderer and returns the handles tests use. */
const GRID_LINE_COUNT = buildGridParts().length;

function mountStudio(testContext, { recipe = makeRecipe(), containerWidth = 0, domOptions, sharedDom = null, ...options } = {}) {
  const dom = sharedDom ?? installStudioDom(domOptions);
  const container = sharedDom ? dom.document.createElement('div') : dom.container;
  if (sharedDom) dom.document.body.append(container);
  container.clientWidth = containerWidth;
  const renderer = createFakeRenderer();
  const studio = createStudio(container, { recipe, renderer, ...options });
  testContext.after(() => {
    studio.dispose();
    if (!sharedDom) dom.uninstall();
  });
  const root = container.firstElementChild;
  const viewport = root.querySelector('.crucible-studio-viewport');
  viewport.box = VIEWPORT_BOX;
  studio.renderNow();
  const ui = {
    dom,
    studio,
    renderer,
    root,
    viewport,
    canvas: viewport.querySelector('canvas'),
    gizmo: viewport.querySelector('.crucible-studio-gizmo'),
    controller: studio.controller,
    label: label => byLabel(root, label),
    button: text => root.querySelectorAll('button').find(candidate => candidate.textContent === text),
    tool: tool => byDataset(root, 'tool', tool),
    tab: tab => byDataset(root, 'tab', tab),
    panel: tab => root.querySelector(`#crucible-studio-panel-${tab}`),
    status: () => root.querySelector('.crucible-studio-status').textContent,
    rows: () => root.querySelectorAll('.crucible-studio-tree-row'),
    rowLabels: () => root.querySelectorAll('.crucible-studio-tree-label').map(element => element.textContent),
    node: nodeId => studio.exportRecipe().nodes.find(node => node.id === nodeId),
    material: materialId => studio.exportRecipe().materials.find(material => material.id === materialId),
    selectRow: nodeId => {
      const row = ui.rows().find(candidate => candidate.querySelector('.crucible-studio-tree-label').textContent === nodeId);
      row.querySelector('.crucible-studio-tree-select').click();
    },
    gizmoPart: axis => ui.gizmo.descendants().find(element => element.getAttribute('data-gizmo-axis') === axis),
    clientPoint: point => ({ clientX: point.x + VIEWPORT_BOX.left, clientY: point.y + VIEWPORT_BOX.top }),
    setSlider: (label, value) => {
      const slider = ui.label(label);
      slider.value = String(value);
      dispatch(slider, 'input');
      dispatch(slider, 'change');
    },
  };
  return ui;
}

test('mounting Studio builds the three zones, the styles and the first frame', testContext => {
  const ui = mountStudio(testContext);
  assert.equal(ui.root.className, 'crucible-studio');
  assert.equal(ui.root.dataset.desktop, 'false');
  assert.equal(ui.root.dataset.outlinerCollapsed, 'false');
  assert.equal(ui.root.dataset.compact, undefined);
  assert.equal(ui.dom.document.head.querySelectorAll('style').length, 1);
  assert.ok(ui.dom.document.getElementById('crucible-studio-styles').textContent.length > 100);
  assert.deepEqual(ui.rowLabels(), ['ground', 'hero', 'orb']);
  assert.equal(ui.root.querySelector('.crucible-studio-filepill').textContent, 'untitled.scene.json');
  assert.equal(ui.root.querySelector('.crucible-studio-filepill').dataset.dirty, 'false');
  assert.equal(ui.root.querySelector('.crucible-studio-watch-pill').hidden, true);
  assert.equal(ui.studio.dirty, false);
  assert.equal(ui.studio.renderer, ui.renderer);
  assert.equal(ui.studio.scene, ui.controller.scene);
  assert.ok(ui.renderer.calls.includes('render'));
  assert.equal(ui.renderer.frames.at(-1).exposure, ui.controller.scene.effects.exposure);
  assert.equal(ui.controller.viewportWidth, 800);
  assert.equal(ui.controller.viewportHeight, 600);
  assert.ok(ui.renderer.calls.includes('resize'));
  assert.equal(ui.canvas.getAttribute('aria-label'), '3D viewport. Click to select, drag to orbit, scroll to zoom.');
  assert.ok(ui.canvas.id.startsWith('crucible-studio-canvas-'));
  assert.equal(ui.dom.observers.resize.length, 1);
  assert.equal(ui.dom.observers.resize[0].observed[0], ui.viewport);
  assert.equal(ui.dom.observers.intersection.length, 1);

  assert.throws(() => createStudio(null), /requires a DOM container element/);
  const secondContainer = ui.dom.document.createElement('div');
  ui.dom.document.body.append(secondContainer);
  const secondStudio = createStudio(secondContainer, { renderer: createFakeRenderer(), template: 'showcase' });
  assert.equal(ui.dom.document.head.querySelectorAll('style').length, 1);
  assert.ok(secondStudio.exportRecipe().nodes.length > 0);
  secondStudio.dispose();
});

test('Studio mounts from a ready scene and from the smaller templates without building a renderer', testContext => {
  const dom = installStudioDom();
  testContext.after(() => dom.uninstall());
  for (const templateKey of ['courtyard', 'empty']) {
    const studio = createStudio(dom.container, { template: templateKey, renderer: createFakeRenderer() });
    assert.equal(studio.exportRecipe().format, 'crucible.scene', templateKey);
    studio.dispose();
  }
  const scene = createStudioController({ scene: createStudio(dom.container, { recipe: makeRecipe(), renderer: createFakeRenderer() }).scene }).scene;
  const fromScene = createStudio(dom.container, { scene, renderer: createFakeRenderer() });
  assert.equal(fromScene.scene, scene);
  fromScene.dispose();
});

test('tool buttons, tab buttons and tool keys switch the active tool and inspector tab', testContext => {
  const ui = mountStudio(testContext);
  for (const tool of STUDIO_TOOLS) {
    ui.tool(tool).click();
    assert.equal(ui.controller.tool, tool);
    for (const other of STUDIO_TOOLS) {
      assert.equal(ui.tool(other).getAttribute('aria-pressed'), other === tool ? 'true' : 'false');
    }
  }
  const keyToTool = { q: 'select', g: 'translate', r: 'rotate', s: 'scale', t: 'snap', G: 'translate' };
  for (const [key, tool] of Object.entries(keyToTool)) {
    dispatch(ui.dom.document, 'keydown', { key });
    assert.equal(ui.controller.tool, tool, `key ${key}`);
  }

  for (const tab of STUDIO_TABS) {
    ui.tab(tab).click();
    assert.equal(ui.controller.activeTab, tab);
    for (const other of STUDIO_TABS) {
      assert.equal(ui.tab(other).getAttribute('aria-selected'), other === tab ? 'true' : 'false');
      assert.equal(ui.tab(other).hasAttribute('focusgroupstart'), other === tab);
      assert.equal(ui.panel(other).hasAttribute('hidden'), other !== tab);
      assert.equal(ui.panel(other).tabIndex === 0, other === tab);
    }
  }
  ui.studio.setActiveTab('node');
  assert.equal(ui.tab('node').getAttribute('aria-selected'), 'true');
  ui.panel('look').dispatchEvent(ui.dom.document.createEvent('beforematch'));
  assert.equal(ui.controller.activeTab, 'look');
  ui.studio.setTool('rotate');
  assert.equal(ui.tool('rotate').getAttribute('aria-pressed'), 'true');
});

test('arrow keys move focus along the toolbar and the tab list when the browser has no focus groups', testContext => {
  const ui = mountStudio(testContext);
  const toolbar = ui.root.querySelector('.crucible-studio-toolbar');
  const tabList = ui.root.querySelector('.crucible-studio-tablist');
  assert.equal(tabList.getAttribute('role'), 'tablist');
  assert.equal(ui.tab('look').getAttribute('role'), 'tab');

  ui.tool('select').focus();
  assert.equal(ui.tool('select').tabIndex, 0);
  assert.equal(ui.tool('translate').tabIndex, -1);
  const down = dispatch(ui.tool('select'), 'keydown', { key: 'ArrowDown' });
  assert.equal(down.defaultPrevented, true);
  assert.equal(ui.dom.document.activeElement, ui.tool('translate'));
  assert.equal(ui.tool('translate').tabIndex, 0);
  dispatch(ui.tool('translate'), 'keydown', { key: 'ArrowUp' });
  assert.equal(ui.dom.document.activeElement, ui.tool('select'));
  dispatch(ui.tool('select'), 'keydown', { key: 'ArrowUp' });
  assert.equal(ui.dom.document.activeElement, byLabel(toolbar, 'Show or hide the panels'));
  dispatch(ui.dom.document.activeElement, 'keydown', { key: 'Home' });
  assert.equal(ui.dom.document.activeElement, ui.tool('select'));
  dispatch(ui.tool('select'), 'keydown', { key: 'End' });
  assert.equal(ui.dom.document.activeElement, byLabel(toolbar, 'Show or hide the panels'));
  const ignored = dispatch(ui.dom.document.activeElement, 'keydown', { key: 'a' });
  assert.equal(ignored.defaultPrevented, false);

  // Arrow keys walk only the tabs of the open workspace: Look holds Material and Look.
  ui.tab('material').click();
  ui.tab('material').focus();
  dispatch(ui.tab('material'), 'keydown', { key: 'ArrowRight' });
  assert.ok(ui.dom.document.activeElement === ui.tab('look'));
  assert.equal(ui.controller.activeTab, 'look');
  dispatch(ui.tab('look'), 'keydown', { key: 'ArrowRight' });
  assert.equal(ui.controller.activeTab, 'material', 'the walk wraps inside the workspace and skips the hidden tabs');
  dispatch(ui.tab('material'), 'keydown', { key: 'ArrowLeft' });
  assert.equal(ui.controller.activeTab, 'look');

  ui.dom.document.activeElement = null;
  const stray = dispatch(tabList, 'keydown', { key: 'ArrowRight' });
  assert.equal(stray.defaultPrevented, false);
  const outsideFocus = ui.dom.document.createEvent('focusin', { target: ui.root });
  tabList.dispatchEvent(outsideFocus);
  assert.equal(ui.tab('look').tabIndex, 0);
});

test('the outliner selects, hides, filters and renames nodes', testContext => {
  const ui = mountStudio(testContext);
  assert.equal(ui.controller.selectedNodeId, 'ground');
  assert.equal(ui.rows()[0].dataset.selected, 'true');
  assert.equal(ui.rows().filter(row => row.dataset.selected === 'true').length, 1);
  ui.selectRow('hero');
  assert.equal(ui.controller.selectedNodeId, 'hero');
  assert.equal(ui.rows()[1].dataset.selected, 'true');
  assert.equal(ui.rows()[1].getAttribute('aria-selected'), 'true');
  assert.equal(ui.label('Node label').value, 'hero');
  assert.equal(ui.label('Node label').disabled, false);
  assert.equal(ui.label('Position Y').value, '0.5');

  const eye = ui.rows()[1].querySelector('.crucible-studio-tree-eye');
  assert.equal(eye.getAttribute('aria-label'), 'Hide hero');
  eye.click();
  assert.equal(ui.node('hero').visible, false);
  const hiddenEye = ui.rows()[1].querySelector('.crucible-studio-tree-eye');
  assert.equal(hiddenEye.getAttribute('aria-label'), 'Show hero');
  assert.equal(hiddenEye.dataset.hidden, 'true');
  assert.equal(ui.rows()[1].querySelector('.crucible-studio-tree-select').dataset.hidden, 'true');
  assert.equal(ui.studio.dirty, true);
  assert.equal(ui.root.querySelector('.crucible-studio-filepill').dataset.dirty, 'true');
  hiddenEye.click();
  assert.notEqual(ui.node('hero').visible, false);

  const search = ui.label('Filter the scene list');
  search.value = 'OR';
  dispatch(search, 'input');
  assert.deepEqual(ui.rowLabels(), ['orb']);
  search.value = 'nothing-matches';
  dispatch(search, 'input');
  assert.deepEqual(ui.rowLabels(), []);
  search.value = '';
  dispatch(search, 'input');
  assert.deepEqual(ui.rowLabels(), ['ground', 'hero', 'orb']);

  ui.rows()[2].querySelector('.crucible-studio-tree-select').dispatchEvent(ui.dom.document.createEvent('dblclick'));
  assert.equal(ui.controller.selectedNodeId, 'orb');
  assert.equal(ui.controller.activeTab, 'node');
  assert.equal(ui.dom.document.activeElement, ui.label('Node label'));
  assert.equal(ui.label('Node label').selected, true);

  const nameInput = ui.label('Node label');
  nameInput.value = 'Moon';
  dispatch(nameInput, 'change');
  assert.equal(ui.node('orb').label, 'Moon');
  assert.deepEqual(ui.rowLabels(), ['ground', 'hero', 'Moon']);
});

test('the Object tab edits visibility, shadows, parent and the three vector fields', testContext => {
  const ui = mountStudio(testContext);
  ui.controller.selectNode(null);
  const nameInput = ui.label('Node label');
  assert.equal(nameInput.disabled, true);
  assert.equal(ui.label('Parent node').disabled, true);
  nameInput.value = 'ignored';
  dispatch(nameInput, 'change');
  dispatch(ui.label('Parent node'), 'change');
  ui.root.querySelectorAll('button').find(button => button.textContent === 'Casts shadow').click();
  assert.equal(ui.controller.selectedNodeId, null);

  ui.selectRow('hero');
  const castShadow = ui.root.querySelectorAll('button').find(button => button.textContent === 'Casts shadow');
  const receiveShadow = ui.root.querySelectorAll('button').find(button => button.textContent === 'Receives shadow');
  castShadow.click();
  assert.equal(ui.node('hero').castShadow, false);
  assert.equal(castShadow.getAttribute('aria-pressed'), 'false');
  castShadow.click();
  assert.notEqual(ui.node('hero').castShadow, false);
  receiveShadow.click();
  assert.equal(ui.node('hero').receiveShadow, false);
  assert.equal(receiveShadow.getAttribute('aria-pressed'), 'false');

  const visibility = ui.label('Hide');
  visibility.click();
  assert.equal(ui.node('hero').visible, false);
  assert.equal(visibility.getAttribute('aria-label'), 'Show');
  assert.equal(visibility.dataset.icon, 'eyeOff');
  ui.label('Show').click();
  assert.notEqual(ui.node('hero').visible, false);

  const parentSelect = ui.label('Parent node');
  assert.deepEqual(parentSelect.children.map(option => option.value), ['', 'ground', 'orb']);
  parentSelect.value = 'ground';
  dispatch(parentSelect, 'change');
  assert.equal(ui.node('hero').parent, 'ground');
  parentSelect.value = '';
  dispatch(parentSelect, 'change');
  assert.equal(ui.node('hero').parent ?? null, null);

  const positionX = ui.label('Position X');
  positionX.value = '1.5';
  dispatch(positionX, 'change');
  assert.deepEqual(ui.node('hero').translation, [1.5, 0.5, 0]);
  positionX.value = 'not a number';
  dispatch(positionX, 'change');
  assert.equal(ui.node('hero').translation[0], 1.5);

  const rotationY = ui.label('Rotation ° Y');
  rotationY.value = '45';
  dispatch(rotationY, 'change');
  const quaternion = ui.node('hero').rotation;
  assert.ok(Math.abs(quaternion[1] - Math.sin(Math.PI / 8)) < 1e-3);
  assert.equal(ui.label('Rotation ° Y').value, '45');

  const scaleZ = ui.label('Scale Z');
  scaleZ.value = '3';
  dispatch(scaleZ, 'change');
  assert.deepEqual(ui.node('hero').scale, [1, 1, 3]);
  scaleZ.value = '0';
  dispatch(scaleZ, 'change');
  assert.deepEqual(ui.node('hero').scale, [1, 1, 0.02]);
});

test('the scale lock keeps the three axes together and axis labels scrub the value', testContext => {
  const ui = mountStudio(testContext);
  ui.selectRow('hero');
  const lock = ui.label('Keep the three axes together');
  assert.equal(lock.getAttribute('aria-pressed'), 'false');
  lock.click();
  assert.equal(lock.getAttribute('aria-pressed'), 'true');
  const scaleX = ui.label('Scale X');
  scaleX.value = '2';
  dispatch(scaleX, 'change');
  assert.deepEqual(ui.node('hero').scale, [2, 2, 2]);
  lock.click();
  assert.equal(lock.getAttribute('aria-pressed'), 'false');

  const scrubLabel = ui.root.querySelectorAll('.crucible-studio-axis-scrub')[0];
  assert.equal(scrubLabel.textContent, 'X');
  const pointerDown = dispatch(scrubLabel, 'pointerdown', { clientX: 100, pointerId: 7 });
  assert.equal(pointerDown.defaultPrevented, true);
  assert.deepEqual(scrubLabel.capturedPointerIds, [7]);
  dispatch(scrubLabel, 'pointermove', { clientX: 140 });
  assert.equal(ui.node('hero').translation[0], 0.6);
  dispatch(scrubLabel, 'pointermove', { clientX: 140, shiftKey: true });
  assert.equal(ui.node('hero').translation[0], 0.12);
  dispatch(scrubLabel, 'pointerup', {});
  dispatch(scrubLabel, 'pointermove', { clientX: 300 });
  assert.equal(ui.node('hero').translation[0], 0.12);
  dispatch(scrubLabel, 'pointerdown', { clientX: 0 });
  dispatch(scrubLabel, 'pointercancel', {});
  dispatch(scrubLabel, 'pointermove', { clientX: 90 });
  assert.equal(ui.node('hero').translation[0], 0.12);
});

test('toolbar buttons undo, redo, duplicate, delete and frame the selection', testContext => {
  const ui = mountStudio(testContext);
  ui.controller.selectNode(null);
  const undoButton = ui.label('Undo (Ctrl+Z)');
  const redoButton = ui.label('Redo (Ctrl+Shift+Z)');
  const duplicateButton = ui.label('Duplicate (Ctrl+D)');
  const deleteButton = ui.label('Delete (Del)');
  const frameButton = ui.label('Frame in view (F)');
  assert.equal(undoButton.getAttribute('aria-disabled'), 'true');
  assert.equal(duplicateButton.getAttribute('aria-disabled'), 'true');
  undoButton.click();
  redoButton.click();
  duplicateButton.click();
  deleteButton.click();
  assert.equal(ui.status(), '');
  assert.equal(ui.studio.exportRecipe().nodes.length, 3);

  ui.selectRow('hero');
  assert.equal(duplicateButton.getAttribute('aria-disabled'), 'false');
  assert.equal(deleteButton.getAttribute('aria-disabled'), 'false');
  const eyeBefore = ui.controller.scene.camera.eye.slice();
  frameButton.click();
  assert.equal(ui.status(), 'Framed selection');
  ui.dom.runAnimationFrames(0);
  ui.dom.runAnimationFrames(500);
  assert.notDeepEqual(ui.controller.scene.camera.eye, eyeBefore);

  duplicateButton.click();
  assert.equal(ui.studio.exportRecipe().nodes.length, 4);
  assert.match(ui.status(), /^Duplicated to /);
  assert.equal(undoButton.getAttribute('aria-disabled'), 'false');
  undoButton.click();
  assert.equal(ui.status(), 'Undid edit');
  assert.equal(ui.studio.exportRecipe().nodes.length, 3);
  assert.equal(redoButton.getAttribute('aria-disabled'), 'false');
  redoButton.click();
  assert.equal(ui.status(), 'Redid edit');
  assert.equal(ui.studio.exportRecipe().nodes.length, 4);

  ui.selectRow('hero');
  deleteButton.click();
  assert.equal(ui.status(), 'Deleted node');
  assert.equal(ui.studio.exportRecipe().nodes.some(node => node.id === 'hero'), false);
  assert.equal(ui.controller.selectedNodeId, 'ground');
  assert.equal(ui.dom.pendingTimerCount > 0, true);
  ui.dom.runTimers();
  assert.equal(ui.status(), '');
});

test('the add menu opens beside its button and adds every primitive and both lights', async testContext => {
  const ui = mountStudio(testContext);
  const addButton = ui.label('Add an object or a light');
  addButton.click();
  const addPopover = ui.root.querySelector('#crucible-studio-pop-add');
  assert.equal(addPopover.popoverOpen, true);
  assert.match(addPopover.style.left, /px$/);
  assert.match(addPopover.style.top, /px$/);

  let expectedNodes = 3;
  for (const primitive of STUDIO_PRIMITIVES) {
    const label = primitive === 'icoSphere' ? 'Icosphere' : primitive[0].toUpperCase() + primitive.slice(1);
    byText(addPopover, label).click();
    await ui.dom.settle();
    expectedNodes += 1;
    assert.equal(addPopover.popoverOpen, false);
    assert.equal(ui.studio.exportRecipe().nodes.length, expectedNodes, label);
    assert.match(ui.status(), /^Added /, label);
    assert.equal(ui.controller.selectedNodeId, ui.studio.exportRecipe().nodes.at(-1).id);
  }
  assert.ok(ui.studio.exportRecipe().geometries.some(geometry => geometry.type === 'terrain'));

  byText(addPopover, 'Point light').click();
  assert.equal(ui.status(), 'Point lights: 1');
  byText(addPopover, 'Spot light').click();
  assert.equal(ui.status(), 'Spot lights: 1');
  assert.equal(ui.studio.exportRecipe().environment.pointLights.length, 1);
  assert.equal(ui.studio.exportRecipe().environment.spotLights.length, 1);
  byText(addPopover, 'Area light').click();
  assert.equal(ui.status(), 'Area lights: 1');
  assert.equal(ui.studio.exportRecipe().environment.areaLights.length, 1);
  assert.deepEqual(ui.studio.exportRecipe().environment.areaLights[0].direction, [0, -1, 0], 'a new area light shines down');
  for (let added = 1; added < 7; added += 1) {
    byText(addPopover, 'Area light').click();
  }
  assert.equal(ui.status(), 'Area lights: 7');
  byText(addPopover, 'Area light').click();
  assert.match(ui.status(), /limit of 7 area lights/, 'one more than the limit says why it was not added');
  assert.equal(ui.studio.exportRecipe().environment.areaLights.length, 7);
  for (const type of ['circle', 'lathe', 'extrude', 'text']) {
    assert.ok(ui.studio.exportRecipe().geometries.some(geometry => geometry.type === type), type);
  }
});

test('popover buttons open each menu, close it again on a click inside and stay inside the window', testContext => {
  const ui = mountStudio(testContext);
  const filePill = ui.root.querySelector('.crucible-studio-filepill');
  filePill.box = { left: 20, top: 10, width: 120, height: 24, right: 140, bottom: 34 };
  filePill.click();
  const newPopover = ui.root.querySelector('#crucible-studio-pop-new');
  assert.equal(newPopover.popoverOpen, true);
  assert.equal(newPopover.style.left, '15px');
  assert.equal(newPopover.style.right, 'auto');
  assert.equal(newPopover.style.top, '48px');
  byText(newPopover, 'New scene').dispatchEvent(ui.dom.document.createEvent('click', { bubbles: true }));
  assert.equal(newPopover.popoverOpen, true);

  const exportButton = byText(ui.root, 'Export').parentNode;
  exportButton.box = { left: 1100, top: 8, width: 90, height: 30, right: 1190, bottom: 38 };
  exportButton.click();
  const exportPopover = ui.root.querySelector('#crucible-studio-pop-export');
  assert.equal(exportPopover.style.left, 'auto');
  assert.equal(exportPopover.style.right, '85px');
  byText(exportPopover, 'PNG image').click();
  assert.equal(exportPopover.popoverOpen, false);

  const syncButton = ui.label('Work with an AI agent');
  syncButton.box = { left: 1000, top: 700, width: 30, height: 30, right: 1030, bottom: 730 };
  syncButton.click();
  const syncPopover = ui.root.querySelector('#crucible-studio-pop-sync');
  assert.equal(syncPopover.style.top, '500px');
});

test('a material swatch assigns its material and opens the Material tab', testContext => {
  const ui = mountStudio(testContext);
  const swatches = ui.root.querySelectorAll('.crucible-studio-swatch-btn');
  assert.deepEqual(swatches.map(swatch => swatch.title), ['stone', 'paint']);
  assert.equal(swatches[0].getAttribute('aria-pressed'), 'true');
  assert.equal(swatches[1].getAttribute('aria-pressed'), 'false');
  swatches[1].click();
  assert.equal(ui.controller.activeTab, 'material');
  assert.equal(ui.node('ground').material, 'paint');
  assert.equal(ui.label('Assigned material').value, 'paint');
  assert.equal(ui.root.querySelectorAll('.crucible-studio-swatch-btn')[1].getAttribute('aria-pressed'), 'true');

  ui.controller.selectNode(null);
  ui.root.querySelectorAll('.crucible-studio-swatch-btn')[0].click();
  assert.equal(ui.controller.activeTab, 'material');
  assert.equal(ui.node('ground').material, 'paint');
});

test('Material tab edits colours and sliders as single undo steps', testContext => {
  const ui = mountStudio(testContext);
  ui.selectRow('hero');
  ui.tab('material').click();
  assert.equal(ui.label('Roughness').value, '0.4');
  assert.equal(ui.label('Roughness').parentNode.querySelector('output').textContent, '0.40');

  const colorInput = ui.label('Base color');
  colorInput.value = '#336699';
  dispatch(colorInput, 'input');
  dispatch(colorInput, 'input');
  dispatch(colorInput, 'change');
  assert.notDeepEqual(ui.material('paint').color, [0.8, 0.25, 0.2]);
  ui.controller.undo();
  assert.deepEqual(ui.material('paint').color, [0.8, 0.25, 0.2]);
  assert.equal(ui.controller.canUndo, false);

  const glowInput = ui.label('Emissive color');
  glowInput.value = '#ff8800';
  dispatch(glowInput, 'input');
  dispatch(glowInput, 'change');
  assert.ok(ui.material('paint').emissiveColor);

  const expectations = [
    ['Roughness', 0.9, 'roughness', 0.9],
    ['Metallic', 0.6, 'metallic', 0.6],
    ['Clearcoat', 0.5, 'clearcoat', 0.5],
    ['Opacity', 0.7, 'opacity', 0.7],
    ['Emission', 3.5, 'emission', 3.5],
  ];
  for (const [label, sliderValue, property, expected] of expectations) {
    ui.setSlider(label, sliderValue);
    assert.equal(ui.material('paint')[property], expected, property);
  }
  assert.equal(ui.material('paint').clearcoatRoughness, 0.08);
  assert.equal(ui.label('Emission').parentNode.querySelector('output').textContent, '3.5');

  ui.controller.undo();
  assert.equal(ui.material('paint').emission ?? 0, 0);
  assert.equal(ui.material('paint').opacity, 0.7);
  ui.controller.undo();
  assert.equal(ui.material('paint').opacity ?? 1, 1);

  assert.equal(ui.label('Roughness').disabled, false);
});

test('material presets, the material list and new materials work from the Material tab', testContext => {
  const ui = mountStudio(testContext);
  ui.selectRow('orb');
  ui.tab('material').click();
  byDataset(ui.root, 'preset', 'gold').click();
  assert.equal(ui.status(), 'Applied Gold preset');
  assert.equal(ui.material('paint').metallic, 0.96);
  assert.equal(ui.label('Metallic').value, '0.96');

  const materialSelect = ui.label('Assigned material');
  assert.deepEqual(materialSelect.children.map(option => option.value), ['stone', 'paint']);
  materialSelect.value = 'stone';
  dispatch(materialSelect, 'change');
  assert.equal(ui.node('orb').material, 'stone');
  materialSelect.value = '';
  dispatch(materialSelect, 'change');
  assert.equal(ui.node('orb').material, 'stone');

  ui.tab('node').click();
  ui.label('New material').click();
  assert.equal(ui.controller.activeTab, 'material');
  assert.match(ui.status(), /^Created /);
  assert.equal(ui.studio.exportRecipe().materials.length, 3);
  assert.equal(ui.node('orb').material, ui.studio.exportRecipe().materials[2].id);
  assert.equal(ui.root.querySelectorAll('.crucible-studio-swatch-btn').length, 3);
});

test('material controls without a selection act on the first material', testContext => {
  const ui = mountStudio(testContext);
  ui.controller.selectNode(null);
  assert.equal(ui.label('Assigned material').value, 'stone');
  ui.setSlider('Metallic', 0.3);
  assert.equal(ui.material('stone').metallic, 0.3);
  byDataset(ui.root, 'preset', 'gold').click();
  assert.equal(ui.material('stone').metallic, 0.96);
});

test('Look tab picks a lighting setup, drags the sun pad as one undo step and moves its sliders', testContext => {
  const ui = mountStudio(testContext);
  ui.tab('look').click();
  const setupButtons = LIGHTING_SETUP_NAMES.map(setup => byDataset(ui.root, 'setup', setup));
  const initialSetup = ui.studio.exportRecipe().environment.setup;
  assert.equal(setupButtons.filter(button => button.getAttribute('aria-pressed') === 'true').length, 1);
  const otherSetup = LIGHTING_SETUP_NAMES.find(setup => setup !== initialSetup);
  byDataset(ui.root, 'setup', otherSetup).click();
  assert.equal(ui.studio.exportRecipe().environment.setup, otherSetup);
  assert.equal(byDataset(ui.root, 'setup', otherSetup).getAttribute('aria-pressed'), 'true');
  assert.equal(byDataset(ui.root, 'setup', initialSetup).getAttribute('aria-pressed'), 'false');

  const sunPad = ui.root.querySelector('.crucible-studio-sunpad');
  sunPad.box = { left: 0, top: 0, width: 120, height: 120, right: 120, bottom: 120 };
  dispatch(sunPad, 'pointermove', { clientX: 60, clientY: 10 });
  dispatch(sunPad, 'pointerdown', { clientX: 60, clientY: 10, pointerId: 3 });
  assert.deepEqual(sunPad.capturedPointerIds, [3]);
  let angles = directionToSunAngles(ui.studio.exportRecipe().environment.lightDirection);
  assert.equal(angles.azimuthDegrees, 0);
  assert.ok(Math.abs(angles.elevationDegrees - 24) <= 1, `elevation ${angles.elevationDegrees}`);
  dispatch(sunPad, 'pointermove', { clientX: 110, clientY: 60 });
  angles = directionToSunAngles(ui.studio.exportRecipe().environment.lightDirection);
  assert.equal(angles.azimuthDegrees, 90);
  dispatch(sunPad, 'pointerup', {});
  dispatch(sunPad, 'pointermove', { clientX: 10, clientY: 60 });
  assert.equal(directionToSunAngles(ui.studio.exportRecipe().environment.lightDirection).azimuthDegrees, 90);
  dispatch(sunPad, 'pointerup', {});
  dispatch(sunPad, 'pointercancel', {});
  ui.controller.undo();
  assert.equal(ui.studio.exportRecipe().environment.setup, otherSetup);
  assert.notEqual(directionToSunAngles(ui.studio.exportRecipe().environment.lightDirection).azimuthDegrees, 90);

  ui.setSlider('Sun strength', 4.5);
  assert.equal(ui.studio.exportRecipe().environment.keyIntensity, 4.5);
  ui.setSlider('Exposure', 1.4);
  assert.equal(ui.studio.exportRecipe().effects.exposure, 1.4);
  ui.setSlider('Contrast', 1.2);
  assert.equal(ui.studio.exportRecipe().effects.contrast, 1.2);
  ui.setSlider('Saturation', 0.6);
  assert.equal(ui.studio.exportRecipe().effects.saturation, 0.6);
  ui.setSlider('Bloom', 0.5);
  assert.equal(ui.studio.exportRecipe().effects.bloom.strength, 0.5);
  ui.setSlider('Fog', 0.02);
  assert.equal(ui.studio.exportRecipe().environment.fogDensity, 0.02);
  assert.equal(ui.label('Fog').parentNode.querySelector('output').textContent, '0.020');
  ui.dom.runAnimationFrames(10);
  assert.equal(ui.renderer.frames.at(-1).exposure, 1.4);
});

test('the colour look select applies a view transform after loading its module', async testContext => {
  const ui = mountStudio(testContext);
  ui.tab('look').click();
  const select = ui.label('View transform');
  assert.deepEqual(select.children.map(option => option.value), [...VIEW_TRANSFORM_NAMES]);
  const chosen = VIEW_TRANSFORM_NAMES.find(name => name !== select.value);
  select.value = chosen;
  dispatch(select, 'change');
  await ui.dom.settle();
  assert.equal(ui.studio.exportRecipe().environment.viewTransform, chosen);
  assert.equal(select.value, chosen);
});

test('Camera tab sets view presets, projection, lens, field of view and orthographic size', testContext => {
  const ui = mountStudio(testContext);
  ui.tab('camera').click();
  const eyeBefore = ui.controller.scene.camera.eye.slice();
  for (const [text, announcement] of [['Front', 'Front view'], ['Right', 'Right view'], ['Top', 'Top view'], ['Iso', 'Iso view']]) {
    byText(ui.root, text).click();
    assert.equal(ui.status(), announcement);
  }
  assert.notDeepEqual(ui.controller.scene.camera.eye, eyeBefore);

  const projectionPill = byText(ui.root, 'Perspective');
  projectionPill.click();
  assert.equal(ui.status(), 'Orthographic view');
  assert.equal(projectionPill.textContent, 'Orthographic');
  assert.equal(projectionPill.getAttribute('aria-pressed'), 'true');
  assert.equal(ui.controller.scene.camera.projection, 'orthographic');
  ui.setSlider('Orthographic size', 12);
  assert.equal(ui.controller.scene.camera.orthoScale, 12);
  projectionPill.click();
  assert.equal(ui.status(), 'Perspective view');
  assert.equal(ui.controller.scene.camera.projection, 'perspective');

  const lensButton = byDataset(ui.root, 'focal', '85');
  lensButton.click();
  assert.equal(lensButton.getAttribute('aria-pressed'), 'true');
  assert.equal(byDataset(ui.root, 'focal', '35').getAttribute('aria-pressed'), 'false');
  ui.setSlider('Field of view', 70);
  assert.equal(ui.controller.scene.camera.fov, 70);
  assert.equal(ui.label('Field of view').parentNode.querySelector('output').textContent, '70');
});

test('camera shots are saved, jumped to and removed from the Camera tab and the shot pills', async testContext => {
  const ui = mountStudio(testContext);
  ui.tab('camera').click();
  const nameInput = ui.label('Shot name');
  nameInput.value = ' wide  open ';
  byText(ui.root, 'Save shot').click();
  await ui.dom.settle();
  assert.equal(ui.status(), 'Saved view wide-open');
  assert.equal(nameInput.value, '');
  byText(ui.root, 'Save shot').click();
  await ui.dom.settle();
  assert.equal(ui.status(), 'Saved view shot-2');
  assert.deepEqual(ui.controller.listBookmarks().map(shot => shot.name), ['wide-open', 'shot-2']);
  const pills = ui.root.querySelectorAll('.crucible-studio-shots button');
  assert.deepEqual(pills.map(pill => pill.textContent), ['wide-open', 'shot-2']);

  const eyeAtShot = ui.controller.scene.camera.eye.slice();
  ui.controller.orbitCamera({ deltaAzimuth: 0.5 });
  assert.notDeepEqual(ui.controller.scene.camera.eye, eyeAtShot);
  pills[0].click();
  ui.controller.scene.camera.eye.forEach((value, index) => assert.ok(Math.abs(value - eyeAtShot[index]) < 1e-6));

  ui.controller.orbitCamera({ deltaAzimuth: 0.5 });
  const listButton = ui.root.querySelectorAll('.crucible-studio-bookmark-row button').find(button => button.textContent === 'wide-open');
  listButton.click();
  ui.controller.scene.camera.eye.forEach((value, index) => assert.ok(Math.abs(value - eyeAtShot[index]) < 1e-6));
  byLabel(ui.root, 'Remove bookmark wide-open').click();
  assert.deepEqual(ui.controller.listBookmarks().map(shot => shot.name), ['shot-2']);
  assert.equal(ui.root.querySelectorAll('.crucible-studio-shots button').length, 1);
});

test('the timeline needs a keyframe before it plays, then plays, loops, scrubs and pauses', async testContext => {
  const ui = mountStudio(testContext);
  const playButton = ui.label('Play (Space)');
  const scrub = ui.label('Timeline scrub');
  assert.equal(playButton.getAttribute('aria-disabled'), 'true');
  assert.equal(scrub.disabled, true);
  playButton.click();
  assert.equal(ui.status(), 'Add a keyframe first (K)');
  assert.equal(playButton.getAttribute('aria-pressed'), 'false');
  dispatch(scrub, 'input');
  assert.equal(ui.controller.motionTime, 0);

  ui.selectRow('hero');
  ui.label('Add a keyframe here (K)').click();
  await ui.dom.settle();
  assert.match(ui.status(), /^Keyframed at 0\.00 s$/);
  assert.equal(playButton.getAttribute('aria-disabled'), 'false');
  assert.equal(scrub.disabled, false);
  const duration = ui.studio.exportRecipe().motion.duration;
  assert.equal(scrub.max, String(duration));
  assert.equal(byText(ui.root, `0.0 / ${duration.toFixed(1)} s`).tagName, 'OUTPUT');

  ui.dom.runAnimationFrames(10);
  playButton.click();
  assert.equal(playButton.getAttribute('aria-pressed'), 'true');
  assert.equal(playButton.getAttribute('aria-label'), 'Pause (Space)');
  assert.equal(ui.dom.pendingAnimationFrameCount, 1);
  const framesBefore = ui.renderer.frames.length;
  ui.dom.runAnimationFrames(1000);
  assert.equal(ui.controller.motionTime, 0);
  ui.dom.runAnimationFrames(1030);
  assert.ok(Math.abs(ui.controller.motionTime - 0.03) < 1e-6, `time ${ui.controller.motionTime}`);
  ui.dom.runAnimationFrames(1500);
  assert.ok(Math.abs(ui.controller.motionTime - 0.08) < 1e-6, 'a long gap advances at most 0.05 s');
  assert.ok(ui.renderer.frames.length > framesBefore);
  assert.equal(ui.renderer.frames.at(-1).time, ui.controller.motionTime);
  assert.equal(ui.dom.pendingAnimationFrameCount, 1);

  ui.controller.setMotionTime(duration - 0.01);
  ui.dom.runAnimationFrames(1550);
  assert.ok(ui.controller.motionTime < 0.1, 'playback wraps to the start');

  playButton.click();
  assert.equal(playButton.getAttribute('aria-pressed'), 'false');
  assert.equal(playButton.getAttribute('aria-label'), 'Play (Space)');

  scrub.value = '0.5';
  dispatch(scrub, 'input');
  assert.equal(ui.controller.motionTime, 0.5);
  assert.equal(byText(ui.root, `0.5 / ${duration.toFixed(1)} s`).tagName, 'OUTPUT');
});

test('playback stops by itself when the animation is deleted while playing', async testContext => {
  const ui = mountStudio(testContext);
  ui.selectRow('hero');
  ui.label('Add a keyframe here (K)').click();
  await ui.dom.settle();
  ui.label('Play (Space)').click();
  assert.equal(ui.label('Pause (Space)').getAttribute('aria-pressed'), 'true');
  const withoutMotion = ui.studio.exportRecipe();
  delete withoutMotion.motion;
  ui.controller.loadRecipe(withoutMotion);
  ui.dom.runAnimationFrames(100);
  ui.dom.runAnimationFrames(130);
  assert.equal(ui.label('Play (Space)').getAttribute('aria-pressed'), 'false');
  assert.equal(ui.label('Play (Space)').getAttribute('aria-disabled'), 'true');
});

test('the gizmo draws handles for each tool and clears them when nothing is selected', testContext => {
  const ui = mountStudio(testContext);
  const axesDrawn = () => new Set(ui.gizmo.descendants().map(element => element.getAttribute('data-gizmo-axis')).filter(Boolean));
  ui.controller.selectNode(null);
  ui.studio.renderNow();
  assert.equal(ui.gizmo.children.length, 0);

  ui.selectRow('hero');
  ui.tool('select').click();
  ui.studio.renderNow();
  assert.equal(ui.gizmo.getAttribute('viewBox'), '0 0 800 600');
  const silhouette = ui.gizmo.querySelector('.crucible-studio-selection-silhouette');
  assert.ok(silhouette.getAttribute('d').startsWith('M') && silhouette.getAttribute('d').includes('L'), 'the selection is drawn from the triangles of the object');
  const filterId = ui.gizmo.querySelector('filter').getAttribute('id');
  assert.ok(filterId.startsWith('crucible-studio-silhouette-'), 'each Studio has its own filter');
  assert.equal(silhouette.getAttribute('filter'), `url(#${filterId})`);
  assert.equal(ui.gizmo.querySelector('.crucible-studio-selection-outline'), null, 'the hull is only the fallback');
  assert.deepEqual([...axesDrawn()], ['screen']);

  ui.tool('translate').click();
  ui.studio.renderNow();
  assert.deepEqual([...axesDrawn()].sort(), ['screen', 'x', 'xy', 'xz', 'y', 'yz', 'z']);
  ui.tool('rotate').click();
  ui.studio.renderNow();
  assert.deepEqual([...axesDrawn()].sort(), ['x', 'y', 'z']);
  assert.equal(ui.gizmo.querySelectorAll('polyline').filter(element => !element.getAttribute('data-gizmo-hit')).length, 3);
  ui.tool('scale').click();
  ui.studio.renderNow();
  assert.deepEqual([...axesDrawn()].sort(), ['uniform', 'x', 'y', 'z']);
  assert.equal(ui.gizmo.querySelectorAll('rect').length, 3);
  ui.tool('snap').click();
  ui.studio.renderNow();
  assert.deepEqual([...axesDrawn()].sort(), ['surface', 'x', 'y', 'z']);
});

test('dragging a gizmo handle with the pointer moves the node, and undo puts it back', testContext => {
  const ui = mountStudio(testContext);
  ui.selectRow('hero');
  ui.tool('translate').click();
  ui.studio.renderNow();
  const handles = ui.controller.gizmoHandles();
  const along = (axis, distance) => ui.controller.projectWorldPoint(handles.pivot.map((value, index) => value + handles.basis[axis][index] * distance));
  const grab = along('x', handles.handleLength);
  const release = along('x', handles.handleLength + 0.8);

  const down = dispatch(ui.gizmoPart('x'), 'pointerdown', { ...ui.clientPoint(grab), pointerId: 5 });
  assert.equal(down.defaultPrevented, true);
  assert.equal(down.propagationStopped, true);
  assert.deepEqual(ui.viewport.capturedPointerIds, [5]);
  dispatch(ui.canvas, 'pointermove', ui.clientPoint(release));
  assert.ok(Math.abs(ui.node('hero').translation[0] - 0.8) < 0.01, `x ${ui.node('hero').translation[0]}`);
  assert.equal(ui.controller.selectedNodeId, 'hero');
  dispatch(ui.canvas, 'pointerup', ui.clientPoint(release));
  assert.equal(ui.studio.dirty, true);

  dispatch(ui.canvas, 'pointermove', ui.clientPoint(grab));
  assert.ok(Math.abs(ui.node('hero').translation[0] - 0.8) < 0.01, 'a finished drag ignores further movement');
  ui.controller.undo();
  assert.deepEqual(ui.node('hero').translation, [0, 0.5, 0]);

  const missed = dispatch(ui.gizmo, 'pointerdown', ui.clientPoint(grab));
  assert.equal(missed.defaultPrevented, false);
  dispatch(ui.canvas, 'pointermove', ui.clientPoint(release));
  assert.deepEqual(ui.node('hero').translation, [0, 0.5, 0]);
});

test('rotate and scale handles turn and stretch the node, and shift snaps the turn', testContext => {
  const ui = mountStudio(testContext);
  ui.selectRow('hero');
  ui.tool('rotate').click();
  ui.studio.renderNow();
  let handles = ui.controller.gizmoHandles();
  const ringPoint = degrees => ui.controller.projectWorldPoint([
    handles.pivot[0] + Math.cos((degrees * Math.PI) / 180),
    handles.pivot[1],
    handles.pivot[2] - Math.sin((degrees * Math.PI) / 180),
  ]);
  dispatch(ui.gizmoPart('y'), 'pointerdown', ui.clientPoint(ringPoint(0)));
  dispatch(ui.canvas, 'pointermove', { ...ui.clientPoint(ringPoint(33)), shiftKey: true });
  dispatch(ui.canvas, 'pointerup', ui.clientPoint(ringPoint(33)));
  assert.ok(Math.abs(ui.node('hero').rotation[1] - Math.sin((15 * Math.PI) / 180)) < 1e-3);
  assert.ok(Math.abs(ui.label('Rotation ° Y').value - 30) < 0.5);

  ui.tool('scale').click();
  ui.studio.renderNow();
  handles = ui.controller.gizmoHandles();
  dispatch(ui.gizmoPart('uniform'), 'pointerdown', ui.clientPoint(handles.origin));
  dispatch(ui.canvas, 'pointermove', ui.clientPoint({ x: handles.origin.x + 74, y: handles.origin.y }));
  dispatch(ui.canvas, 'pointerup', ui.clientPoint(handles.origin));
  assert.ok(Math.abs(ui.node('hero').scale[0] - 2) < 0.01);
  assert.ok(Math.abs(ui.node('hero').scale[2] - 2) < 0.01);
});

test('clicking the canvas picks an object or clears the selection, and dragging orbits or pans', testContext => {
  const ui = mountStudio(testContext);
  const orbPoint = ui.controller.projectWorldPoint([2.2, 0.5, 0]);
  dispatch(ui.canvas, 'pointerdown', ui.clientPoint(orbPoint));
  dispatch(ui.canvas, 'pointerup', ui.clientPoint(orbPoint));
  assert.equal(ui.controller.selectedNodeId, 'orb');
  assert.equal(ui.rows()[2].dataset.selected, 'true');

  dispatch(ui.canvas, 'pointerdown', ui.clientPoint({ x: 12, y: 12 }));
  dispatch(ui.canvas, 'pointerup', ui.clientPoint({ x: 12, y: 12 }));
  assert.equal(ui.controller.selectedNodeId, null);

  dispatch(ui.canvas, 'pointerup', ui.clientPoint(orbPoint));
  dispatch(ui.canvas, 'pointermove', ui.clientPoint(orbPoint));
  dispatch(ui.canvas, 'pointerdown', { ...ui.clientPoint(orbPoint), button: 7 });
  dispatch(ui.canvas, 'pointerup', ui.clientPoint(orbPoint));
  assert.equal(ui.controller.selectedNodeId, null);

  const start = { x: 400, y: 300 };
  const eyeBefore = ui.controller.scene.camera.eye.slice();
  dispatch(ui.canvas, 'pointerdown', ui.clientPoint(start));
  assert.equal(ui.canvas.capturedPointerIds.at(-1), 1);
  dispatch(ui.canvas, 'pointermove', ui.clientPoint({ x: 402, y: 301 }));
  assert.deepEqual(ui.controller.scene.camera.eye, eyeBefore);
  dispatch(ui.canvas, 'pointermove', ui.clientPoint({ x: 460, y: 330 }));
  assert.notDeepEqual(ui.controller.scene.camera.eye, eyeBefore);
  dispatch(ui.canvas, 'pointerup', ui.clientPoint({ x: 460, y: 330 }));
  assert.equal(ui.controller.selectedNodeId, null, 'a drag is not a click');

  for (const panGesture of [{ shiftKey: true }, { button: 2 }, { button: 1 }]) {
    const targetBefore = ui.controller.scene.camera.target.slice();
    dispatch(ui.canvas, 'pointerdown', { ...ui.clientPoint(start), ...panGesture });
    dispatch(ui.canvas, 'pointermove', ui.clientPoint({ x: 480, y: 340 }));
    dispatch(ui.canvas, 'pointercancel', ui.clientPoint({ x: 480, y: 340 }));
    assert.notDeepEqual(ui.controller.scene.camera.target, targetBefore, JSON.stringify(panGesture));
  }
  assert.equal(dispatch(ui.canvas, 'contextmenu').defaultPrevented, true);
});

test('the mouse wheel zooms the camera and the page does not scroll', testContext => {
  const ui = mountStudio(testContext);
  const distance = () => Math.hypot(...ui.controller.scene.camera.eye.map((value, index) => value - ui.controller.scene.camera.target[index]));
  const before = distance();
  const zoomOut = dispatch(ui.canvas, 'wheel', { deltaY: 100 });
  assert.equal(zoomOut.defaultPrevented, true);
  const afterOut = distance();
  assert.ok(afterOut > before);
  dispatch(ui.canvas, 'wheel', { deltaY: -100 });
  assert.ok(distance() < afterOut);
  const beforeHuge = distance();
  dispatch(ui.canvas, 'wheel', { deltaY: 100000 });
  assert.ok(distance() / beforeHuge <= 1.35 + 1e-3, 'one wheel step is limited to 35 percent');
});

test('alt-clicking with the snap tool drops the selection onto the surface under the pointer', testContext => {
  const ui = mountStudio(testContext);
  ui.selectRow('hero');
  ui.controller.updateNodeTransform('hero', { translation: [0, 5, 0] });
  ui.tool('snap').click();
  const floorPoint = ui.controller.projectWorldPoint([0, 0, -2]);
  dispatch(ui.canvas, 'pointerdown', ui.clientPoint(floorPoint));
  dispatch(ui.canvas, 'pointerup', { ...ui.clientPoint(floorPoint), altKey: true });
  assert.ok(ui.node('hero').translation[1] < 1.2, `y ${ui.node('hero').translation[1]}`);
  assert.equal(ui.controller.selectedNodeId, 'hero');

  const heroPoint = ui.controller.projectWorldPoint(ui.node('hero').translation);
  dispatch(ui.canvas, 'pointerdown', ui.clientPoint(heroPoint));
  dispatch(ui.canvas, 'pointerup', ui.clientPoint(heroPoint));
  assert.equal(ui.controller.selectedNodeId, 'hero');
});

function findFileInput(ui) {
  return ui.root.descendants().find(element => element.type === 'file');
}

function createDesktop(overrides = {}) {
  const calls = [];
  const record = (name, response) => async argument => {
    calls.push({ name, argument });
    return typeof response === 'function' ? response(argument) : response;
  };
  return {
    calls,
    openFile: record('openFile', { text: JSON.stringify(makeRecipe()), filePath: 'C:/scenes/opened.scene.json', fileName: 'opened.scene.json' }),
    saveFile: record('saveFile', argument => ({ filePath: argument.filePath, fileName: 'again.scene.json' })),
    saveFileAs: record('saveFileAs', { filePath: 'C:/scenes/saved.scene.json', fileName: 'saved.scene.json' }),
    savePng: record('savePng', { fileName: 'shot.png' }),
    saveGlb: record('saveGlb', { fileName: 'model.glb' }),
    packWebBundle: record('packWebBundle', { outDir: 'C:/out/web' }),
    ...overrides,
  };
}

function animatedRecipe() {
  return {
    ...makeRecipe(),
    motion: {
      duration: 1.5,
      loop: true,
      tracks: [
        {
          kind: 'node',
          id: 'hero',
          property: 'translation',
          keyframes: [
            { time: 0, value: [0, 0.5, 0] },
            { time: 1.5, value: [0, 1.5, 0] },
          ],
        },
      ],
    },
  };
}

test('keyboard shortcuts edit, undo, redo, duplicate and delete from anywhere in the page', testContext => {
  const ui = mountStudio(testContext);
  const press = (key, properties = {}) => dispatch(ui.canvas, 'keydown', { key, ...properties });
  ui.selectRow('hero');

  ui.controller.updateNodeTransform('hero', { translation: [3, 0.5, 0] });
  assert.equal(press('z', { ctrlKey: true }).defaultPrevented, true);
  assert.deepEqual(ui.node('hero').translation, [0, 0.5, 0]);
  press('Z', { ctrlKey: true, shiftKey: true });
  assert.deepEqual(ui.node('hero').translation, [3, 0.5, 0]);
  press('z', { metaKey: true });
  assert.deepEqual(ui.node('hero').translation, [0, 0.5, 0]);

  press('d', { ctrlKey: true });
  assert.equal(ui.studio.exportRecipe().nodes.length, 4);
  assert.match(ui.status(), /^Duplicated to /);
  const copyId = ui.controller.selectedNodeId;
  assert.notEqual(copyId, 'hero');
  assert.equal(press('Delete').defaultPrevented, true);
  assert.equal(ui.studio.exportRecipe().nodes.some(node => node.id === copyId), false);
  ui.selectRow('orb');
  press('Backspace');
  assert.equal(ui.studio.exportRecipe().nodes.some(node => node.id === 'orb'), false);
  assert.equal(ui.status(), 'Deleted node');

  ui.controller.selectNode(null);
  const nodeCount = ui.studio.exportRecipe().nodes.length;
  press('d', { ctrlKey: true });
  press('Delete');
  assert.equal(ui.studio.exportRecipe().nodes.length, nodeCount);

  ui.selectRow('hero');
  const eyeBefore = ui.controller.scene.camera.eye.slice();
  press('f');
  ui.dom.runAnimationFrames(0);
  ui.dom.runAnimationFrames(500);
  assert.notDeepEqual(ui.controller.scene.camera.eye, eyeBefore);
  press('5');
  assert.equal(ui.controller.scene.camera.projection, 'orthographic');
  press('5');
  assert.equal(ui.controller.scene.camera.projection, 'perspective');
  press('z');
  press('?');
  assert.equal(ui.root.querySelectorAll('dialog')[1].open, true);
  assert.equal(press(' ').defaultPrevented, false, 'keys wait while a dialog is open');
  ui.root.querySelectorAll('dialog')[1].close();
  assert.equal(press(' ').defaultPrevented, true);
  assert.equal(ui.status(), 'Add a keyframe first (K)');
});

test('keyboard shortcuts are ignored while typing and after the Studio left the page', testContext => {
  const ui = mountStudio(testContext);
  const nameInput = ui.label('Node label');
  for (const editable of [nameInput, ui.label('Parent node'), ui.root.querySelector('dialog textarea')]) {
    dispatch(editable, 'keydown', { key: 'r' });
    assert.equal(ui.controller.tool, 'translate', editable.tagName);
  }
  const contentEditable = ui.dom.document.createElement('div');
  contentEditable.isContentEditable = true;
  ui.root.append(contentEditable);
  dispatch(contentEditable, 'keydown', { key: 'r' });
  assert.equal(ui.controller.tool, 'translate');
  dispatch(ui.dom.document, 'keydown', { key: 'r' });
  assert.equal(ui.controller.tool, 'rotate');

  ui.root.remove();
  dispatch(ui.dom.document, 'keydown', { key: 'g' });
  assert.equal(ui.controller.tool, 'rotate');
});

test('the space key and K work the timeline from the keyboard', async testContext => {
  const ui = mountStudio(testContext);
  ui.selectRow('hero');
  dispatch(ui.canvas, 'keydown', { key: 'k' });
  await ui.dom.settle();
  assert.equal(ui.studio.exportRecipe().motion.tracks.length > 0, true);
  dispatch(ui.canvas, 'keydown', { key: ' ' });
  assert.equal(ui.label('Pause (Space)').getAttribute('aria-pressed'), 'true');
  dispatch(ui.canvas, 'keydown', { key: ' ' });
  assert.equal(ui.label('Play (Space)').getAttribute('aria-pressed'), 'false');
});

test('the Recipe JSON dialog shows the recipe, applies edits and reports bad JSON', async testContext => {
  const ui = mountStudio(testContext);
  const [recipeDialog, shortcutsDialog] = ui.root.querySelectorAll('dialog');
  const textarea = recipeDialog.querySelector('textarea');
  ui.button('Recipe JSON').click();
  assert.equal(recipeDialog.open, true);
  assert.deepEqual(JSON.parse(textarea.value), ui.studio.exportRecipe());

  textarea.value = '{ not json';
  byText(recipeDialog, 'Apply JSON').click();
  await ui.dom.settle();
  assert.match(ui.status(), /JSON/);
  assert.equal(recipeDialog.open, true);

  textarea.value = '{}';
  byText(recipeDialog, 'Apply JSON').click();
  await ui.dom.settle();
  assert.equal(recipeDialog.open, true);
  assert.equal(ui.studio.exportRecipe().nodes.length, 3);

  const edited = ui.studio.exportRecipe();
  edited.nodes = edited.nodes.filter(node => node.id !== 'orb');
  textarea.value = JSON.stringify(edited);
  byText(recipeDialog, 'Apply JSON').click();
  await ui.dom.settle();
  assert.equal(ui.status(), 'Recipe applied');
  assert.equal(recipeDialog.open, false);
  assert.equal(recipeDialog.returnValue, '');
  assert.deepEqual(ui.rowLabels(), ['ground', 'hero']);

  ui.button('Recipe JSON').click();
  const fileInput = findFileInput(ui);
  const clicksBefore = fileInput.clicks;
  byText(recipeDialog, 'Load file\u2026').click();
  assert.equal(recipeDialog.open, false);
  assert.equal(fileInput.clicks, clicksBefore + 1);

  byText(ui.root, 'Keyboard shortcuts').click();
  assert.equal(shortcutsDialog.open, true);
  assert.ok(shortcutsDialog.querySelectorAll('.crucible-studio-shortcut-item').length >= 8);
  shortcutsDialog.close('close');
  assert.equal(shortcutsDialog.returnValue, '');
});

test('Save downloads the recipe in the browser and clears the unsaved mark', async testContext => {
  const changes = [];
  const ui = mountStudio(testContext, { onDirtyChange: change => changes.push(change) });
  assert.deepEqual(changes.at(-1), { filePath: null, fileName: 'untitled.scene.json', dirty: false });
  ui.controller.updateNodeTransform('hero', { translation: [1, 0.5, 0] });
  assert.equal(changes.at(-1).dirty, true);
  const filePill = ui.root.querySelector('.crucible-studio-filepill');
  assert.equal(filePill.dataset.dirty, 'true');

  byText(ui.root, 'Save').click();
  await ui.dom.settle();
  assert.equal(ui.status(), 'Downloaded untitled.scene.json');
  assert.equal(filePill.dataset.dirty, 'false');
  assert.equal(changes.at(-1).dirty, false);
  const [download] = ui.dom.document.downloads;
  assert.equal(download.filename, 'untitled.scene.json');
  assert.equal(download.blob.type, 'application/json');
  const saved = JSON.parse(await download.blob.text());
  assert.deepEqual(saved.nodes.find(node => node.id === 'hero').translation, [1, 0.5, 0]);
  assert.equal(ui.dom.runTimers() > 0, true);

  dispatch(ui.canvas, 'keydown', { key: 's', ctrlKey: true });
  await ui.dom.settle();
  dispatch(ui.canvas, 'keydown', { key: 'S', metaKey: true, shiftKey: true });
  await ui.dom.settle();
  byText(ui.root, 'Save as\u2026').click();
  await ui.dom.settle();
  assert.equal(ui.dom.document.downloads.length, 4);
});

test('Save, Save as and Open go through the desktop shell when there is one', async testContext => {
  const desktop = createDesktop();
  const changes = [];
  const ui = mountStudio(testContext, { desktop, onDirtyChange: change => changes.push(change) });
  assert.equal(ui.root.dataset.desktop, 'true');
  const watchPill = ui.root.querySelector('.crucible-studio-watch-pill');
  assert.equal(watchPill.hidden, true);

  byText(ui.root, 'Save').click();
  await ui.dom.settle();
  assert.equal(desktop.calls[0].name, 'saveFileAs');
  assert.equal(desktop.calls[0].argument.suggestedName, 'untitled.scene.json');
  assert.deepEqual(JSON.parse(desktop.calls[0].argument.text), ui.studio.exportRecipe());
  assert.equal(ui.status(), 'Saved saved.scene.json');
  assert.equal(ui.root.querySelector('.crucible-studio-filepill').textContent, 'saved.scene.json');
  assert.equal(ui.root.querySelector('.crucible-studio-filepill').title, 'C:/scenes/saved.scene.json');
  assert.equal(watchPill.hidden, false);
  assert.deepEqual(changes.at(-1), { filePath: 'C:/scenes/saved.scene.json', fileName: 'saved.scene.json', dirty: false });
  assert.match(ui.root.querySelector('#crucible-studio-pop-sync .crucible-studio-popover-note').textContent, /Watching C:\/scenes\/saved.scene.json \(auto-reload on\)\./);

  byText(ui.root, 'Save').click();
  await ui.dom.settle();
  assert.equal(desktop.calls[1].name, 'saveFile');
  assert.equal(desktop.calls[1].argument.filePath, 'C:/scenes/saved.scene.json');
  byText(ui.root, 'Save as\u2026').click();
  await ui.dom.settle();
  assert.equal(desktop.calls[2].name, 'saveFileAs');

  desktop.saveFileAs = async () => ({ canceled: true });
  desktop.saveFile = async () => null;
  const nameBeforeCancel = ui.root.querySelector('.crucible-studio-filepill').textContent;
  byText(ui.root, 'Save as\u2026').click();
  await ui.dom.settle();
  byText(ui.root, 'Save').click();
  await ui.dom.settle();
  assert.equal(ui.root.querySelector('.crucible-studio-filepill').textContent, nameBeforeCancel);

  desktop.openFile = async () => ({ canceled: true });
  byText(ui.root, 'Open\u2026').click();
  await ui.dom.settle();
  assert.equal(ui.root.querySelector('.crucible-studio-filepill').textContent, nameBeforeCancel);
  desktop.openFile = async () => null;
  byText(ui.root, 'Open\u2026').click();
  await ui.dom.settle();
  desktop.openFile = async () => ({ text: '{ broken', filePath: 'C:/bad.json', fileName: 'bad.json' });
  byText(ui.root, 'Open\u2026').click();
  await ui.dom.settle();
  assert.match(ui.status(), /JSON/);
  assert.equal(ui.root.querySelector('.crucible-studio-filepill').textContent, nameBeforeCancel);

  const opened = animatedRecipe();
  opened.nodes = opened.nodes.slice(0, 2);
  desktop.openFile = async () => ({ text: JSON.stringify(opened), filePath: 'C:/scenes/opened.scene.json', fileName: 'opened.scene.json' });
  dispatch(ui.canvas, 'keydown', { key: 'o', ctrlKey: true });
  await ui.dom.settle();
  assert.equal(ui.status(), 'Opened opened.scene.json');
  assert.deepEqual(ui.rowLabels(), ['ground', 'hero']);
  assert.equal(ui.root.querySelector('.crucible-studio-filepill').textContent, 'opened.scene.json');
});

test('Open without a desktop shell uses the file picker, and a dropped file loads too', async testContext => {
  const ui = mountStudio(testContext);
  const fileInput = findFileInput(ui);
  byText(ui.root, 'Open\u2026').click();
  assert.equal(fileInput.clicks, 1);

  dispatch(fileInput, 'change');
  await ui.dom.settle();
  assert.equal(ui.status(), '');

  const smaller = makeRecipe();
  smaller.nodes = smaller.nodes.slice(0, 1);
  fileInput.files = [{ name: 'small.scene.json', text: async () => JSON.stringify(smaller) }];
  dispatch(fileInput, 'change');
  await ui.dom.settle();
  assert.equal(ui.status(), 'Loaded small.scene.json');
  assert.equal(fileInput.value, '');
  assert.deepEqual(ui.rowLabels(), ['ground']);
  assert.equal(ui.root.querySelector('.crucible-studio-filepill').textContent, 'small.scene.json');

  fileInput.files = [{ name: 'broken.json', text: async () => 'nope' }];
  dispatch(fileInput, 'change');
  await ui.dom.settle();
  assert.match(ui.status(), /JSON/);
  assert.deepEqual(ui.rowLabels(), ['ground']);

  const dragOver = dispatch(ui.viewport, 'dragover');
  assert.equal(dragOver.defaultPrevented, true);
  assert.equal(ui.viewport.dataset.dropActive, 'true');
  dispatch(ui.viewport, 'dragleave');
  assert.equal(ui.viewport.dataset.dropActive, undefined);
  dispatch(ui.viewport, 'drop', { dataTransfer: { files: [] } });
  dispatch(ui.viewport, 'drop', {});
  await ui.dom.settle();
  assert.deepEqual(ui.rowLabels(), ['ground']);
  dispatch(ui.viewport, 'drop', { dataTransfer: { files: [{ name: 'dropped.scene.json', path: 'C:/drop/dropped.scene.json', text: async () => JSON.stringify(makeRecipe()) }] } });
  await ui.dom.settle();
  assert.equal(ui.status(), 'Loaded dropped.scene.json');
  assert.deepEqual(ui.rowLabels(), ['ground', 'hero', 'orb']);
  assert.equal(ui.root.querySelector('.crucible-studio-filepill').title, 'C:/drop/dropped.scene.json');
  dispatch(ui.viewport, 'dragover');
  dispatch(ui.viewport, 'drop', { dataTransfer: { files: [{ name: 'bad.json', text: async () => '[' }] } });
  await ui.dom.settle();
  assert.match(ui.status(), /JSON|Unexpected/);
  assert.equal(ui.viewport.dataset.dropActive, undefined);
});

test('file context set from outside shows in the file pill and the watch note', testContext => {
  const changes = [];
  const ui = mountStudio(testContext, { watchedPath: 'C:/agent/live.scene.json', fileName: 'live.scene.json', onDirtyChange: change => changes.push(change) });
  const filePill = ui.root.querySelector('.crucible-studio-filepill');
  assert.equal(ui.root.querySelector('.crucible-studio-watch-pill').hidden, false);
  assert.equal(filePill.title, 'C:/agent/live.scene.json');
  assert.equal(ui.studio.shouldAutoReloadExternal(), true);

  ui.studio.setFileContext({ fileName: 'renamed.scene.json', dirty: true });
  assert.equal(filePill.textContent, 'renamed.scene.json');
  assert.equal(filePill.dataset.dirty, 'true');
  assert.equal(ui.studio.dirty, true);
  ui.studio.setFileContext({ filePath: null, dirty: false });
  assert.equal(ui.root.querySelector('.crucible-studio-watch-pill').hidden, true);
  assert.equal(changes.at(-1).dirty, false);
  ui.studio.setFileContext({});
  assert.equal(filePill.textContent, 'renamed.scene.json');

  ui.studio.setFileContext({ filePath: 'C:/agent/live.scene.json' });
  const reloadButton = byText(ui.root, 'Reload when the agent edits');
  reloadButton.click();
  assert.equal(ui.studio.shouldAutoReloadExternal(), false);
  assert.equal(reloadButton.getAttribute('aria-pressed'), 'false');
  assert.equal(ui.status(), 'Auto-reload paused');
  assert.match(ui.root.querySelector('#crucible-studio-pop-sync .crucible-studio-popover-note').textContent, /paused/);
  reloadButton.click();
  assert.equal(ui.studio.shouldAutoReloadExternal(), true);
  assert.equal(ui.status(), 'Auto-reload enabled');
});

test('loadExternalTextFile loads a recipe with or without an undo step and rejects bad text', async testContext => {
  const ui = mountStudio(testContext);
  const smaller = makeRecipe();
  smaller.nodes = smaller.nodes.slice(0, 2);
  await ui.studio.loadExternalTextFile(JSON.stringify(smaller), { filePath: 'C:/x.json', fileName: 'x.json', recordUndo: false });
  assert.deepEqual(ui.rowLabels(), ['ground', 'hero']);
  assert.equal(ui.controller.canUndo, false);
  assert.equal(ui.studio.dirty, false);
  await ui.studio.loadExternalTextFile(JSON.stringify(makeRecipe()));
  assert.equal(ui.controller.canUndo, true);
  assert.equal(ui.root.querySelector('.crucible-studio-filepill').textContent, 'scene.json');
  await assert.rejects(() => ui.studio.loadExternalTextFile('{'), SyntaxError);
  ui.studio.loadRecipe(smaller);
  assert.deepEqual(ui.rowLabels(), ['ground', 'hero']);
});

test('the New scene menu replaces the scene with a template and resets the file', async testContext => {
  const ui = mountStudio(testContext);
  const filePill = ui.root.querySelector('.crucible-studio-filepill');
  ui.controller.updateNodeTransform('hero', { translation: [1, 0.5, 0] });
  assert.equal(ui.studio.dirty, true);
  const templateKey = 'courtyard';
  const spec = STUDIO_TEMPLATES[templateKey];
  filePill.click();
  const newPopover = ui.root.querySelector('#crucible-studio-pop-new');
  byText(newPopover, spec.label).click();
  await ui.dom.settle();
  assert.equal(newPopover.popoverOpen, false);
  assert.equal(filePill.textContent, `${templateKey}.scene.json`);
  assert.equal(filePill.dataset.dirty, 'false');
  assert.equal(ui.status(), `New ${spec.label}`);
  assert.equal(ui.studio.exportRecipe().nodes.some(node => node.id === 'hero'), false);
});

test('Copy a prompt for the agent uses the clipboard and falls back to the recipe dialog', async testContext => {
  const ui = mountStudio(testContext);
  ui.selectRow('orb');
  byText(ui.root, 'Copy a prompt for the agent').click();
  await ui.dom.settle();
  assert.equal(ui.dom.clipboardTexts.length, 1);
  assert.match(ui.dom.clipboardTexts[0], /Edit Crucible scene "untitled.scene.json" \(format crucible.scene v1, currently at revision \d+, selected node: orb\)/);
  assert.equal(ui.status(), 'Copied AI prompt to clipboard');
  assert.equal(ui.root.querySelector('#crucible-studio-pop-sync').popoverOpen, false);

  const blockedUi = mountStudio(testContext, { domOptions: { clipboardFails: true }, watchedPath: 'C:/live.scene.json' });
  byText(blockedUi.root, 'Copy a prompt for the agent').click();
  await blockedUi.dom.settle();
  const dialog = blockedUi.root.querySelector('dialog');
  assert.equal(dialog.open, true);
  assert.match(dialog.querySelector('textarea').value, /Edit Crucible scene "C:\/live.scene.json"/);
});

test('Export saves a PNG still in the browser and through the desktop shell', async testContext => {
  const ui = mountStudio(testContext, { fileName: 'castle.scene.json' });
  const renderCountBefore = ui.renderer.frames.length;
  byText(ui.root, 'PNG image').click();
  await ui.dom.settle();
  assert.equal(ui.canvas.lastDataUrlType, 'image/png');
  assert.ok(ui.renderer.frames.length > renderCountBefore, 'a still renders a fresh frame first');
  const [download] = ui.dom.document.downloads;
  assert.equal(download.filename, 'castle.png');
  assert.equal(download.blob.type, 'image/png');
  const bytes = new Uint8Array(await download.blob.arrayBuffer());
  assert.deepEqual([...bytes.slice(1, 4)], [0x50, 0x4e, 0x47]);
  assert.equal(ui.status(), 'Saved PNG still');

  const desktop = createDesktop();
  const desktopUi = mountStudio(testContext, { sharedDom: ui.dom, desktop, fileName: 'castle.scene.json' });
  byText(desktopUi.root, 'PNG image').click();
  await desktopUi.dom.settle();
  assert.equal(desktop.calls[0].name, 'savePng');
  assert.equal(desktop.calls[0].argument.suggestedName, 'castle.png');
  assert.match(desktop.calls[0].argument.dataUrl, /^data:image\/png;base64,/);
  assert.equal(desktopUi.status(), 'Saved shot.png');
  desktop.savePng = async () => ({ canceled: true });
  desktopUi.dom.runTimers();
  byText(desktopUi.root, 'PNG image').click();
  await desktopUi.dom.settle();
  assert.equal(desktopUi.status(), '');
});

test('Export writes a GLB model of the scene and reports a desktop failure', async testContext => {
  const ui = mountStudio(testContext);
  byText(ui.root, 'GLB model').click();
  await ui.dom.settle();
  const [download] = ui.dom.document.downloads;
  assert.equal(download.filename, 'untitled.glb');
  assert.equal(download.blob.type, 'model/gltf-binary');
  const bytes = new Uint8Array(await download.blob.arrayBuffer());
  assert.equal(String.fromCharCode(...bytes.slice(0, 4)), 'glTF');
  assert.equal(ui.status(), 'Exported GLB mesh');
  assert.equal(ui.studio.exportGlbBytes().byteLength, bytes.byteLength);

  const desktop = createDesktop();
  const desktopUi = mountStudio(testContext, { sharedDom: ui.dom, desktop });
  byText(desktopUi.root, 'GLB model').click();
  await desktopUi.dom.settle();
  assert.equal(desktop.calls[0].name, 'saveGlb');
  assert.equal(desktop.calls[0].argument.suggestedName, 'untitled.glb');
  assert.equal(String.fromCharCode(...new Uint8Array(desktop.calls[0].argument.bytes).slice(0, 4)), 'glTF');
  assert.equal(desktopUi.status(), 'Exported model.glb');
  desktop.saveGlb = async () => {
    throw new Error('Disk is full.');
  };
  byText(desktopUi.root, 'GLB model').click();
  await desktopUi.dom.settle();
  assert.equal(desktopUi.status(), 'Disk is full.');
  desktop.saveGlb = async () => ({ canceled: true });
  desktopUi.dom.runTimers();
  byText(desktopUi.root, 'GLB model').click();
  await desktopUi.dom.settle();
  assert.equal(desktopUi.status(), '');
});

test('Export packs a web bundle, naming what a still pack leaves out', async testContext => {
  const ui = mountStudio(testContext, { recipe: animatedRecipe() });
  byText(ui.root, 'Web pack').click();
  await ui.dom.settle();
  const [download] = ui.dom.document.downloads;
  assert.equal(download.filename, 'untitled.pack');
  assert.equal(download.blob.type, 'application/octet-stream');
  assert.ok(download.blob.size > 100);
  assert.equal(ui.status(), 'Downloaded scene.pack');

  const payload = await ui.studio.buildWebPackPayload();
  assert.equal(payload.title, 'untitled');
  assert.deepEqual(payload.stripped, ['motion']);
  assert.match(payload.posterDataUrl, /^data:image\/png/);
  assert.ok(payload.packBytes.byteLength > 100);

  const desktop = createDesktop();
  const desktopUi = mountStudio(testContext, { sharedDom: ui.dom, desktop, recipe: animatedRecipe(), fileName: 'castle.scene.json' });
  byText(desktopUi.root, 'Web pack').click();
  await desktopUi.dom.settle();
  assert.equal(desktop.calls[0].name, 'packWebBundle');
  assert.equal(desktop.calls[0].argument.title, 'castle');
  assert.equal(desktopUi.status(), 'Packed web bundle to C:/out/web (static snapshot, omitted motion)');
  desktop.packWebBundle = async () => ({ canceled: true });
  desktopUi.dom.runTimers();
  byText(desktopUi.root, 'Web pack').click();
  await desktopUi.dom.settle();
  assert.equal(desktopUi.status(), '');
  desktop.packWebBundle = async () => {
    throw new Error('Out folder is not writable.');
  };
  byText(desktopUi.root, 'Web pack').click();
  await desktopUi.dom.settle();
  assert.equal(desktopUi.status(), 'Out folder is not writable.');

  const plainUi = mountStudio(testContext, { sharedDom: ui.dom });
  const plainPayload = await plainUi.studio.buildWebPackPayload();
  assert.deepEqual(plainPayload.stripped, []);
  const plainDesktop = createDesktop();
  const plainDesktopUi = mountStudio(testContext, { sharedDom: ui.dom, desktop: plainDesktop });
  byText(plainDesktopUi.root, 'Web pack').click();
  await plainDesktopUi.dom.settle();
  assert.equal(plainDesktopUi.status(), 'Packed web bundle to C:/out/web');
});

test('a narrow container starts with the panels closed and opens them when it grows', testContext => {
  const ui = mountStudio(testContext, { containerWidth: 600 });
  const toggleDocks = ui.label('Show or hide the panels');
  assert.equal(ui.root.dataset.compact, 'true');
  assert.equal(ui.root.dataset.outlinerCollapsed, 'true');
  assert.equal(ui.root.dataset.inspectorCollapsed, 'true');
  assert.equal(toggleDocks.getAttribute('aria-pressed'), 'false');

  toggleDocks.click();
  assert.equal(ui.root.dataset.outlinerCollapsed, 'false');
  assert.equal(ui.root.dataset.inspectorCollapsed, 'false');
  assert.equal(toggleDocks.getAttribute('aria-pressed'), 'true');
  toggleDocks.click();
  assert.equal(ui.root.dataset.outlinerCollapsed, 'true');
  assert.equal(toggleDocks.getAttribute('aria-pressed'), 'false');

  ui.dom.container.clientWidth = 1200;
  ui.dom.observers.resize[0].callback([]);
  assert.equal(ui.root.dataset.compact, 'false');
  assert.equal(ui.root.dataset.outlinerCollapsed, 'false');
  assert.equal(ui.root.dataset.inspectorCollapsed, 'false');
  ui.dom.observers.resize[0].callback([]);
  assert.equal(ui.root.dataset.compact, 'false');

  ui.studio.setOutlinerCollapsed(true);
  assert.equal(toggleDocks.getAttribute('aria-pressed'), 'true');
  ui.studio.setInspectorCollapsed(true);
  assert.equal(toggleDocks.getAttribute('aria-pressed'), 'false');
  ui.studio.setOutlinerCollapsed(false);
  assert.equal(toggleDocks.getAttribute('aria-pressed'), 'true');
  assert.equal(ui.root.dataset.inspectorCollapsed, 'true');
});

test('drawing pauses while the Studio is off screen or the tab is hidden, and resumes after', testContext => {
  const ui = mountStudio(testContext);
  const observer = ui.dom.observers.intersection[0];
  ui.dom.runAnimationFrames(1);
  assert.equal(ui.dom.pendingAnimationFrameCount, 0);
  ui.selectRow('hero');
  assert.equal(ui.dom.pendingAnimationFrameCount, 1);
  const framesBefore = ui.renderer.frames.length;
  observer.callback([{ isIntersecting: false }]);
  ui.dom.runAnimationFrames(2);
  assert.equal(ui.renderer.frames.length, framesBefore, 'a queued frame is dropped once the view is off screen');
  ui.selectRow('orb');
  assert.equal(ui.dom.pendingAnimationFrameCount, 0);
  observer.callback([{ isIntersecting: true }]);
  assert.equal(ui.dom.pendingAnimationFrameCount, 1);
  ui.dom.runAnimationFrames(3);
  assert.equal(ui.renderer.frames.length, framesBefore + 1);

  ui.dom.document.hidden = true;
  ui.selectRow('hero');
  assert.equal(ui.dom.pendingAnimationFrameCount, 0);
  dispatch(ui.dom.document, 'visibilitychange');
  assert.equal(ui.dom.pendingAnimationFrameCount, 0);
  ui.dom.document.hidden = false;
  dispatch(ui.dom.document, 'visibilitychange');
  assert.equal(ui.dom.pendingAnimationFrameCount, 1);
  ui.dom.document.hidden = true;
  ui.dom.runAnimationFrames(4);
  assert.equal(ui.renderer.frames.length, framesBefore + 1);
});

test('the viewport follows its element size, and the renderer is kept in step with the scene', testContext => {
  const ui = mountStudio(testContext);
  ui.viewport.box = { left: 0, top: 0, width: 640, height: 360, right: 640, bottom: 360 };
  ui.studio.renderNow();
  assert.equal(ui.controller.viewportWidth, 640);
  assert.equal(ui.controller.viewportHeight, 360);
  assert.equal(ui.gizmo.getAttribute('viewBox'), '0 0 640 360');

  const callsBefore = ui.renderer.calls.length;
  ui.controller.addPrimitive('box');
  ui.studio.renderNow();
  assert.ok(ui.renderer.calls.slice(callsBefore).includes('replaceParts'));
  assert.equal(ui.renderer.partCount, ui.controller.scene.parts.length + GRID_LINE_COUNT);
  assert.ok(ui.renderer.shadowBounds);
  assert.equal(ui.renderer.shadowsDirty, true);
  assert.equal(ui.renderer.world, ui.controller.scene.environment.world);
  const frame = ui.renderer.frames.at(-1);
  assert.deepEqual(frame.eye, ui.controller.scene.camera.eye);
  assert.deepEqual(frame.effects, ui.controller.scene.effects);

  ui.renderer.updateFailure = new Error('The GPU was lost.');
  assert.throws(() => ui.studio.renderNow(), /The GPU was lost\./);
  ui.renderer.updateFailure = null;
  ui.studio.renderNow();
  assert.ok(ui.studio.capturePngDataUrl().startsWith('data:image/png'));
});

test('F flies the camera to the selection in under half a second, without an undo step, and a wheel turn stops it', testContext => {
  const ui = mountStudio(testContext);
  ui.selectRow('hero');
  ui.controller.orbitCamera({ zoomScale: 6 });
  const start = ui.controller.scene.camera.eye.slice();
  const goal = ui.controller.frameSelectionPose();
  const undoBefore = ui.controller.canUndo;
  const distanceToGoal = () => Math.hypot(...ui.controller.scene.camera.eye.map((value, axis) => value - goal.eye[axis]));
  dispatch(ui.dom.document, 'keydown', { key: 'f' });
  assert.deepEqual(ui.controller.scene.camera.eye, start, 'nothing moves before the first frame');
  ui.dom.runAnimationFrames(1000);
  ui.dom.runAnimationFrames(1100);
  const midway = distanceToGoal();
  assert.ok(midway > 0.01 && midway < Math.hypot(...start.map((value, axis) => value - goal.eye[axis])), 'part of the way there after 100 ms');
  ui.dom.runAnimationFrames(1490);
  assert.ok(distanceToGoal() < 1e-6, 'there before half a second has passed');
  assert.deepEqual(ui.controller.scene.camera.target, goal.target);
  assert.equal(ui.controller.canUndo, undoBefore, 'a flight is a view change, not an edit');

  ui.controller.orbitCamera({ zoomScale: 6 });
  dispatch(ui.dom.document, 'keydown', { key: 'f' });
  ui.dom.runAnimationFrames(2000);
  ui.dom.runAnimationFrames(2100);
  dispatch(ui.canvas, 'wheel', { deltaY: 100 });
  const stopped = ui.controller.scene.camera.eye.slice();
  ui.dom.runAnimationFrames(2400);
  assert.deepEqual(ui.controller.scene.camera.eye, stopped, 'the wheel takes the camera back');

  ui.dom.document.defaultView.matchMedia = () => ({ matches: true });
  dispatch(ui.dom.document, 'keydown', { key: 'f' });
  assert.ok(distanceToGoal() < 1e-6, 'with reduced motion the view jumps');
});

test('the viewport still draws the floor and the scene when the camera is as far out as it goes', testContext => {
  const ui = mountStudio(testContext);
  for (let turn = 0; turn < 12; turn += 1) {
    ui.controller.orbitCamera({ zoomScale: 3 });
  }
  ui.studio.renderNow();
  const camera = ui.controller.scene.camera;
  const distance = Math.hypot(...camera.eye.map((value, axis) => value - camera.target[axis]));
  const frame = ui.renderer.frames.at(-1);
  assert.ok(distance > 300, 'the camera is far past the 120 m the scene camera reaches');
  assert.ok(frame.far > distance * 10, 'the frame reaches far behind the scene, so nothing is cut away');
  assert.ok(frame.near < distance / 10);
  ui.selectRow('hero');
  assert.ok(ui.controller.selectionOutline(), 'and the selection can still be outlined from there');
  assert.ok(ui.controller.projectWorldPoint([0, 0.5, 0]).visible);
});

test('the readout names the grid step, which grows as the camera pulls back', testContext => {
  const ui = mountStudio(testContext);
  const readout = ui.dom.document.querySelector('.crucible-studio-readout');
  assert.match(readout.textContent, /Grid 1 m/);
  ui.controller.orbitCamera({ zoomScale: 12 });
  ui.studio.renderNow();
  assert.match(readout.textContent, /Grid 10 m/);
});

test('dispose removes the Studio and every listener it added to the page', testContext => {
  const ui = mountStudio(testContext);
  ui.selectRow('hero');
  ui.label('Frame in view (F)').click();
  assert.equal(ui.dom.pendingAnimationFrameCount, 2, 'the next draw and the flight to the framed object');
  assert.equal(ui.dom.pendingTimerCount > 0, true);
  const keydownListeners = ui.dom.document.listeners.filter(entry => entry.type === 'keydown').length;
  assert.equal(keydownListeners, 1);

  ui.studio.dispose();
  assert.equal(ui.dom.container.children.length, 0);
  assert.equal(ui.dom.pendingAnimationFrameCount, 0);
  assert.equal(ui.dom.pendingTimerCount, 0);
  assert.equal(ui.dom.document.listeners.filter(entry => entry.type === 'keydown' || entry.type === 'visibilitychange').length, 0);
  assert.equal(ui.dom.observers.resize[0].disconnected, true);
  assert.equal(ui.dom.observers.intersection[0].disconnected, true);
  assert.equal(ui.renderer.disposed, true);
  dispatch(ui.dom.document, 'keydown', { key: 'r' });
  assert.equal(ui.controller.tool, 'translate');
});

test('a reload of the watched file walks a named agent cursor over the objects it changed', async testContext => {
  const ui = mountStudio(testContext, { watchedPath: 'C:/agent/live.scene.json', agentName: 'Claude' });
  const cursor = ui.viewport.querySelector('.crucible-studio-agent-cursor');
  const outlines = () => ui.gizmo.descendants().filter(element => element.getAttribute('class') === 'crucible-studio-agent-outline');
  assert.equal(cursor.hidden, true);
  const edited = makeRecipe();
  edited.nodes[1].translation = [-1.5, 0.5, 0];
  edited.nodes[2].scale = [0.8, 0.8, 0.8];
  await ui.studio.loadExternalTextFile(JSON.stringify(edited), { filePath: 'C:/agent/live.scene.json', fileName: 'live.scene.json', recordUndo: false });
  assert.equal(cursor.hidden, false);
  assert.equal(cursor.querySelector('.crucible-studio-agent-name').textContent, 'Claude');
  assert.equal(cursor.dataset.nodeId, 'hero');
  assert.equal(ui.status(), 'Claude edited hero, orb');
  ui.studio.renderNow();
  assert.equal(outlines().length, 1);
  const heroLeft = Number.parseFloat(cursor.style.left);
  assert.ok(heroLeft > 0 && heroLeft < 50, `the cursor sits on the hero, left of centre: ${cursor.style.left}`);
  ui.dom.runTimers();
  assert.equal(cursor.dataset.nodeId, 'orb');
  assert.ok(Number.parseFloat(cursor.style.left) > 50, `the cursor moved to the orb: ${cursor.style.left}`);
  ui.dom.runTimers();
  assert.equal(cursor.hidden, true);
  ui.studio.renderNow();
  assert.equal(outlines().length, 0);
});

test('the agent cursor stays away for a file the person opens and takes a name per edit', async testContext => {
  const ui = mountStudio(testContext, { watchedPath: 'C:/agent/live.scene.json' });
  const cursor = ui.viewport.querySelector('.crucible-studio-agent-cursor');
  const edited = makeRecipe();
  edited.nodes[1].translation = [1, 0.5, 0];
  await ui.studio.loadExternalTextFile(JSON.stringify(edited), { filePath: 'C:/other.scene.json', fileName: 'other.scene.json' });
  assert.equal(cursor.hidden, true);
  await ui.studio.loadExternalTextFile(JSON.stringify(makeRecipe()), { filePath: 'C:/other.scene.json', agent: { name: 'Builder' } });
  assert.equal(cursor.hidden, false);
  assert.equal(cursor.querySelector('.crucible-studio-agent-name').textContent, 'Builder');
  const builderColor = cursor.style.color;
  assert.equal(cursor.querySelector('.crucible-studio-agent-name').style.background, builderColor);
  ui.studio.renderNow();
  assert.equal(ui.gizmo.descendants().find(element => element.getAttribute('class') === 'crucible-studio-agent-outline').getAttribute('stroke'), builderColor);
  ui.studio.showAgentEdit({ name: 'Claude', nodeIds: ['orb'] });
  assert.notEqual(cursor.style.color, builderColor, 'another agent gets another colour');
  await ui.studio.loadExternalTextFile(JSON.stringify(edited), { filePath: 'C:/other.scene.json', agent: false });
  assert.equal(cursor.hidden, true);
  const relit = makeRecipe();
  relit.nodes = edited.nodes;
  relit.environment.setup = 'sunset';
  await ui.studio.loadExternalTextFile(JSON.stringify(relit), { agent: true });
  assert.equal(cursor.hidden, true);
  assert.equal(ui.status(), 'Agent changed the scene look');
});

test('showAgentEdit points at named objects, skips unknown ones and rejects bad input', testContext => {
  const ui = mountStudio(testContext);
  const cursor = ui.viewport.querySelector('.crucible-studio-agent-cursor');
  ui.studio.showAgentEdit({ name: 'Claude', nodeIds: ['missing', 'orb'] });
  assert.equal(cursor.dataset.nodeId, 'orb');
  assert.equal(ui.status(), 'Claude edited missing, orb');
  const before = cursor.style.left;
  ui.controller.orbitCamera({ deltaAzimuth: 0.6 });
  ui.studio.renderNow();
  assert.notEqual(cursor.style.left, before, 'the cursor follows its object when the camera moves');
  ui.studio.showAgentEdit({ nodeIds: [] });
  assert.equal(cursor.hidden, true);
  assert.throws(() => ui.studio.showAgentEdit({ name: '', nodeIds: [] }), /agent name must be a string/);
  assert.throws(() => ui.studio.showAgentEdit({ nodeIds: [7] }), /nodeIds must be an array of node id strings/);
  assert.throws(() => ui.studio.showAgentEdit({ nodeIds: 'orb' }), /nodeIds must be an array of node id strings/);
  assert.throws(() => ui.controller.nodeOutline(''), /nodeOutline requires a node id string/);
  assert.throws(() => mountStudio(testContext, { sharedDom: ui.dom, agentName: '' }), /agent name must be a string/);
});

test('the ground grid is drawn with the scene, leaves with its button and stays out of a captured still', testContext => {
  const ui = mountStudio(testContext);
  const sceneParts = ui.controller.scene.parts.length;
  const gridButton = ui.label('Show or hide the grid');
  const readout = ui.viewport.querySelector('.crucible-studio-readout');
  assert.equal(ui.studio.gridVisible, true);
  assert.equal(gridButton.getAttribute('aria-pressed'), 'true');
  assert.equal(ui.renderer.partCount, sceneParts + GRID_LINE_COUNT);
  assert.match(readout.textContent, /Grid 1 m/);

  ui.studio.capturePngDataUrl();
  assert.equal(ui.renderer.partCount, sceneParts, 'a still shows the scene alone');
  ui.studio.renderNow();
  assert.equal(ui.renderer.partCount, sceneParts + GRID_LINE_COUNT);

  gridButton.click();
  ui.studio.renderNow();
  assert.equal(ui.studio.gridVisible, false);
  assert.equal(gridButton.getAttribute('aria-pressed'), 'false');
  assert.equal(ui.renderer.partCount, sceneParts);
  assert.doesNotMatch(readout.textContent, /Grid/);
  ui.studio.setGridVisible(true);
  ui.studio.renderNow();
  assert.equal(ui.renderer.partCount, sceneParts + GRID_LINE_COUNT);
});

test('the view widget follows the camera and its ends snap to the main views', testContext => {
  const ui = mountStudio(testContext);
  const widget = ui.viewport.querySelector('.crucible-studio-view-widget');
  const end = name => widget.descendants().find(element => element.getAttribute('data-axis-end') === name);
  const letters = widget.descendants().filter(element => element.getAttribute('class') === 'crucible-studio-view-letter').map(element => element.textContent);
  assert.deepEqual(letters.sort(), ['X', 'Y', 'Z']);
  assert.equal(end('-y').getAttribute('data-view'), null, 'there is no view from below');
  const xBefore = end('+x').getAttribute('cx');
  ui.controller.orbitCamera({ deltaAzimuth: 0.7 });
  ui.studio.renderNow();
  assert.notEqual(end('+x').getAttribute('cx'), xBefore);

  end('+y').click();
  ui.studio.renderNow();
  const camera = ui.controller.scene.camera;
  assert.ok(camera.eye[1] - camera.target[1] > 1, 'the camera looks down from above');
  assert.ok(Math.abs(camera.eye[0] - camera.target[0]) < 0.1);
  end('+x').click();
  ui.studio.renderNow();
  assert.ok(ui.controller.scene.camera.eye[0] - ui.controller.scene.camera.target[0] > 1, 'the camera looks from the right');
});

test('the readout names the camera and gives the size of the selection in metres', testContext => {
  const ui = mountStudio(testContext);
  const selection = ui.viewport.querySelector('.crucible-studio-readout-selection');
  const readout = ui.viewport.querySelector('.crucible-studio-readout');
  assert.match(readout.textContent, /^Perspective · \d+ ?(mm|°)/u);
  ui.controller.selectNode('hero');
  ui.studio.renderNow();
  assert.match(selection.textContent, /^hero · \d+\.\d\d × \d+\.\d\d × \d+\.\d\d m$/u);
  const bounds = ui.controller.nodeBounds('hero');
  assert.deepEqual(bounds.size.map(value => Number(value.toFixed(4))), bounds.max.map((value, axis) => Number((value - bounds.min[axis]).toFixed(4))));
  const sizeText = selection.textContent;
  ui.controller.updateNodeTransform('hero', { scale: [2, 2, 2] });
  ui.studio.renderNow();
  assert.ok(ui.controller.nodeBounds('hero').size[0] > bounds.size[0] * 1.9, 'the size follows the scale');
  assert.notEqual(selection.textContent, sizeText);
  ui.controller.selectNode(null);
  ui.studio.renderNow();
  assert.equal(selection.textContent, '');
  assert.equal(ui.controller.nodeBounds('missing'), null);
  assert.throws(() => ui.controller.nodeBounds(''), /nodeBounds requires a node id string/);
  ui.controller.toggleCameraProjection();
  ui.studio.renderNow();
  assert.match(readout.textContent, /^Orthographic/u);
});

test('move handles end in arrows, scale handles in squares and an axis that faces the viewer falls back to a dot', testContext => {
  const ui = mountStudio(testContext);
  ui.controller.selectNode('hero');
  const shapes = () => ui.gizmo.descendants().filter(element => ['x', 'y', 'z'].includes(element.getAttribute('data-gizmo-axis')) && !element.getAttribute('data-gizmo-hit') && element.tagName.toLowerCase() !== 'line').map(element => element.tagName.toLowerCase());
  ui.tool('translate').click();
  ui.studio.renderNow();
  assert.deepEqual(shapes(), ['polygon', 'polygon', 'polygon']);
  const arrow = ui.gizmoPart('x');
  const handles = ui.controller.gizmoHandles();
  const head = ui.gizmo.descendants().find(element => element.getAttribute('data-gizmo-shape') === 'arrow' && element.getAttribute('data-gizmo-axis') === 'x');
  const [point] = head.getAttribute('points').split(' ').map(pair => pair.split(',').map(Number));
  const tipDistance = Math.hypot(handles.axes.x.x - handles.origin.x, handles.axes.x.y - handles.origin.y);
  assert.ok(Math.hypot(point[0] - handles.origin.x, point[1] - handles.origin.y) > tipDistance, 'the arrow points away from the origin');
  assert.ok(arrow);
  ui.tool('scale').click();
  ui.studio.renderNow();
  assert.deepEqual(shapes(), ['rect', 'rect', 'rect']);
  ui.tool('translate').click();
  ui.controller.setCameraViewPreset('front');
  ui.studio.renderNow();
  assert.deepEqual(shapes().sort(), ['circle', 'polygon', 'polygon'], 'the Z axis points at the viewer');
});

test('the View menu rows that switch something say whether it is on', testContext => {
  const ui = mountStudio(testContext);
  const toggleRow = label => ui.root.descendants().find(element => element.getAttribute('role') === 'menuitemcheckbox' && element.textContent === label);
  const grid = toggleRow('Grid');
  assert.ok(grid);
  assert.equal(grid.getAttribute('aria-checked'), 'true');
  grid.click();
  assert.equal(grid.getAttribute('aria-checked'), 'false');
  assert.equal(ui.studio.preferences.gridVisible, false);
  const properties = toggleRow('Properties');
  assert.equal(properties.getAttribute('aria-checked'), 'true');
  properties.click();
  assert.equal(properties.getAttribute('aria-checked'), 'false');
  assert.equal(ui.root.dataset.inspectorCollapsed, 'true');
});

test('the handle under the pointer is marked, stays marked through its drag and clears after', testContext => {
  const ui = mountStudio(testContext);
  ui.selectRow('hero');
  ui.tool('translate').click();
  ui.studio.renderNow();
  assert.equal(ui.gizmo.dataset.hoverAxis, undefined);
  dispatch(ui.gizmoPart('y'), 'pointermove', { bubbles: true });
  assert.equal(ui.gizmo.dataset.hoverAxis, 'y');
  dispatch(ui.gizmoPart('x'), 'pointermove', { bubbles: true });
  assert.equal(ui.gizmo.dataset.hoverAxis, 'x');
  dispatch(ui.gizmo, 'pointerleave');
  assert.equal(ui.gizmo.dataset.hoverAxis, undefined);

  const handles = ui.controller.gizmoHandles();
  const along = distance => ui.controller.projectWorldPoint(handles.pivot.map((value, index) => value + handles.basis.z[index] * distance));
  dispatch(ui.gizmoPart('z'), 'pointerdown', ui.clientPoint(along(handles.handleLength)));
  assert.equal(ui.gizmo.dataset.hoverAxis, 'z');
  dispatch(ui.gizmo, 'pointerleave');
  assert.equal(ui.gizmo.dataset.hoverAxis, 'z', 'the handle being dragged stays lit');
  dispatch(ui.canvas, 'pointerup', ui.clientPoint(along(handles.handleLength)));
  assert.equal(ui.gizmo.dataset.hoverAxis, undefined);
  for (const axis of ['x', 'xy', 'screen']) {
    assert.ok(STUDIO_CSS.includes(`.crucible-studio-gizmo[data-hover-axis="${axis}"] [data-gizmo-axis="${axis}"]`), `the stylesheet lights ${axis}`);
  }
});

test('Studio opens on the blockout scene when it gets no recipe', testContext => {
  const dom = installStudioDom();
  testContext.after(() => dom.uninstall());
  const studio = createStudio(dom.container, { renderer: createFakeRenderer() });
  testContext.after(() => studio.dispose());
  assert.deepEqual(studio.exportRecipe().nodes.map(node => node.id), ['cube', 'sphere', 'cone']);
  assert.equal(Object.keys(STUDIO_TEMPLATES)[0], 'blockout');
  for (const nodeId of ['cube', 'sphere', 'cone']) {
    const bounds = studio.controller.nodeBounds(nodeId);
    assert.ok(Math.abs(bounds.min[1]) < 1e-3, `${nodeId} rests on the ground`);
    assert.ok(bounds.size.every(length => Math.abs(length - 1) < 1e-3), `${nodeId} is one metre across`);
  }
});

test('turning a ring shows where the turn began, how far it has gone and hides the other rings', testContext => {
  const ui = mountStudio(testContext);
  ui.selectRow('hero');
  ui.tool('rotate').click();
  ui.studio.renderNow();
  const handles = ui.controller.gizmoHandles();
  const ringPoint = degrees => ui.controller.projectWorldPoint([
    handles.pivot[0] + Math.cos((degrees * Math.PI) / 180),
    handles.pivot[1],
    handles.pivot[2] - Math.sin((degrees * Math.PI) / 180),
  ]);
  const sweepPart = part => ui.gizmo.descendants().find(element => element.getAttribute('data-rotation-sweep') === part);
  const rings = () => ui.gizmo.descendants().filter(element => element.tagName.toLowerCase() === 'polyline' && !element.getAttribute('data-gizmo-hit')).map(element => element.getAttribute('data-gizmo-axis'));
  assert.equal(ui.controller.rotationSweep(), null);
  assert.equal(sweepPart('wedge'), undefined);
  assert.deepEqual(rings(), ['x', 'y', 'z']);

  dispatch(ui.gizmoPart('y'), 'pointerdown', ui.clientPoint(ringPoint(0)));
  dispatch(ui.canvas, 'pointermove', ui.clientPoint(ringPoint(40)));
  ui.studio.renderNow();
  let sweep = ui.controller.rotationSweep();
  assert.equal(sweep.axis, 'y');
  assert.ok(Math.abs(sweep.degrees - 40) < 0.5);
  const reach = point => Math.hypot(point.x - sweep.centre.x, point.y - sweep.centre.y);
  assert.ok(sweep.arc.every(point => reach(point) > 10), 'the arc runs along the ring, away from the centre');
  const start = ringPoint(0);
  const now = ringPoint(40);
  const bearing = (from, to) => Math.atan2(to.y - from.y, to.x - from.x);
  assert.ok(Math.abs(bearing(sweep.centre, sweep.arc[0]) - bearing(sweep.centre, start)) < 0.02, 'the first spoke points at the grab');
  assert.ok(Math.abs(bearing(sweep.centre, sweep.arc.at(-1)) - bearing(sweep.centre, now)) < 0.02, 'the last spoke follows the pointer');
  assert.deepEqual(rings(), ['y']);
  assert.equal(sweepPart('wedge').getAttribute('pointer-events'), 'none');
  assert.ok(Number(sweepPart('wedge').getAttribute('fill-opacity')) < 0.25, 'the wedge stays faint');
  assert.equal(sweepPart('wedge').getAttribute('points').split(' ').length, sweep.arc.length + 1);
  assert.ok(sweepPart('start').getAttribute('stroke-dasharray'));
  assert.equal(sweepPart('now').getAttribute('stroke-dasharray'), null);

  for (const degrees of [100, 170, 230]) {
    dispatch(ui.canvas, 'pointermove', ui.clientPoint(ringPoint(degrees)));
  }
  sweep = ui.controller.rotationSweep();
  assert.ok(Math.abs(sweep.degrees - 230) < 0.5, 'a turn past half a circle keeps counting');
  dispatch(ui.canvas, 'pointermove', { ...ui.clientPoint(ringPoint(228)), shiftKey: true });
  assert.equal(ui.controller.rotationSweep().degrees, 225);

  dispatch(ui.canvas, 'pointerup', ui.clientPoint(ringPoint(228)));
  ui.studio.renderNow();
  assert.equal(ui.controller.rotationSweep(), null);
  assert.equal(sweepPart('wedge'), undefined);
  assert.deepEqual(rings(), ['x', 'y', 'z']);
});

test('a drag leaves a ghost where the object was, and a move draws the line it has travelled', testContext => {
  const ui = mountStudio(testContext);
  ui.selectRow('hero');
  ui.tool('translate').click();
  ui.studio.renderNow();
  const handles = ui.controller.gizmoHandles();
  const along = distance => ui.controller.projectWorldPoint(handles.pivot.map((value, index) => value + handles.basis.x[index] * distance));
  const tracePart = part => ui.gizmo.descendants().find(element => element.getAttribute('data-drag-trace') === part);
  const outlineBefore = ui.controller.selectionOutline();
  assert.equal(ui.controller.dragTrace(), null);

  dispatch(ui.gizmoPart('x'), 'pointerdown', ui.clientPoint(along(handles.handleLength)));
  ui.studio.renderNow();
  assert.equal(ui.controller.dragTrace(), null, 'nothing to trace until the object has moved');
  assert.equal(tracePart('ghost'), undefined);

  dispatch(ui.canvas, 'pointermove', ui.clientPoint(along(handles.handleLength + 0.8)));
  ui.studio.renderNow();
  const trace = ui.controller.dragTrace();
  assert.equal(trace.tool, 'translate');
  assert.deepEqual(trace.outline, outlineBefore);
  assert.ok(Math.abs(trace.from.x - handles.origin.x) < 0.01 && Math.abs(trace.from.y - handles.origin.y) < 0.01);
  const pivotNow = ui.controller.gizmoHandles().origin;
  assert.ok(Math.abs(trace.to.x - pivotNow.x) < 0.01 && Math.abs(trace.to.y - pivotNow.y) < 0.01);
  assert.ok(Math.hypot(trace.to.x - trace.from.x, trace.to.y - trace.from.y) > 5);
  assert.equal(tracePart('ghost').getAttribute('points').split(' ').length, outlineBefore.length);
  assert.equal(tracePart('ghost').getAttribute('fill'), 'none');
  for (const part of ['ghost', 'travel', 'start']) {
    assert.equal(tracePart(part).getAttribute('pointer-events'), 'none');
  }
  assert.equal(Number(tracePart('travel').getAttribute('x2')).toFixed(1), trace.to.x.toFixed(1));
  const haloPart = part => ui.gizmo.descendants().find(element => element.getAttribute('data-drag-halo') === part);
  for (const part of ['ghost', 'travel']) {
    assert.equal(haloPart(part).getAttribute('stroke'), 'var(--studio-trace-edge)', 'a dark line lies under the pale dashed one');
    assert.equal(tracePart(part).getAttribute('stroke'), 'var(--studio-trace)');
    assert.ok(Number(haloPart(part).getAttribute('stroke-width')) > Number(tracePart(part).getAttribute('stroke-width')));
    assert.ok(ui.gizmo.descendants().indexOf(haloPart(part)) < ui.gizmo.descendants().indexOf(tracePart(part)), 'the halo is drawn first');
  }
  assert.equal(tracePart('start').getAttribute('stroke'), 'var(--studio-trace-edge)');

  dispatch(ui.canvas, 'pointerup', ui.clientPoint(along(handles.handleLength + 0.8)));
  ui.studio.renderNow();
  assert.equal(ui.controller.dragTrace(), null);
  assert.equal(tracePart('ghost'), undefined);
  assert.equal(tracePart('travel'), undefined);

  ui.tool('scale').click();
  ui.studio.renderNow();
  const origin = ui.controller.gizmoHandles().origin;
  dispatch(ui.gizmoPart('uniform'), 'pointerdown', ui.clientPoint(origin));
  dispatch(ui.canvas, 'pointermove', ui.clientPoint({ x: origin.x + 40, y: origin.y }));
  ui.studio.renderNow();
  assert.ok(tracePart('ghost'), 'a scale drag keeps the old outline');
  assert.equal(tracePart('travel'), undefined, 'only a move has a line of travel');
  dispatch(ui.canvas, 'pointerup', ui.clientPoint(origin));
});

test('a new object lands beside the ones already there, and ground pieces stay at the centre', testContext => {
  const dom = installStudioDom();
  testContext.after(() => dom.uninstall());
  const studio = createStudio(dom.container, { renderer: createFakeRenderer() });
  testContext.after(() => studio.dispose());
  const first = studio.controller.addPrimitive('box');
  assert.deepEqual(first.translation, [2.5, 0.5, 0], 'the cube holds the centre and the cone the next spot');
  const second = studio.controller.addPrimitive('sphere');
  assert.deepEqual(second.translation, [3.75, 0.5, 0]);
  assert.ok(Math.abs(studio.controller.nodeBounds(second.id).min[1]) < 1e-3, 'it rests on the ground');
  assert.deepEqual(studio.controller.addPrimitive('plane').translation, [0, 0.02, 0]);
  assert.deepEqual(studio.controller.addPrimitive('box', { translation: [0, 0.5, 0] }).translation, [0, 0.5, 0], 'a given place is kept');
});

test('workspaces run Build, Look, Animate and each shows only the panels its step needs', testContext => {
  const ui = mountStudio(testContext);
  const workspaceTab = id => byDataset(ui.root, 'workspace', id);
  const shownTabs = () => STUDIO_TABS.filter(tab => !ui.tab(tab).hasAttribute('hidden'));
  const tabList = ui.root.querySelector('.crucible-studio-tablist');
  const workspaceList = ui.root.querySelector('.crucible-studio-workspaces');
  assert.deepEqual(workspaceList.querySelectorAll('.crucible-studio-workspace-label').map(label => label.textContent), ['Build', 'Look', 'Animate']);
  assert.deepEqual(workspaceList.querySelectorAll('button').map(button => button.querySelector('svg') !== null), [true, true, true], 'each workspace tab leads with an icon');
  assert.deepEqual(workspaceList.querySelectorAll('button').map(button => button.getAttribute('aria-label')), ['Build', 'Look', 'Animate']);
  assert.equal(workspaceList.getAttribute('role'), 'tablist');
  assert.equal(workspaceList.parentNode.className, 'crucible-studio-menubar', 'the tabs share the menu bar, not a row of their own');

  assert.equal(ui.root.dataset.workspace, 'build');
  assert.equal(workspaceTab('build').getAttribute('aria-selected'), 'true');
  assert.deepEqual(shownTabs(), ['node']);
  assert.ok(tabList.hasAttribute('hidden'), 'one panel needs no tab row');

  const recipeBefore = JSON.stringify(ui.studio.exportRecipe());
  workspaceTab('look').click();
  assert.equal(ui.root.dataset.workspace, 'look');
  assert.equal(workspaceTab('build').getAttribute('aria-selected'), 'false');
  assert.equal(workspaceTab('build').hasAttribute('aria-pressed'), false);
  assert.deepEqual(shownTabs(), ['material', 'look']);
  assert.equal(tabList.hasAttribute('hidden'), false);
  assert.equal(ui.controller.activeTab, 'material');
  ui.tab('look').click();
  assert.equal(ui.root.dataset.workspace, 'look');
  assert.equal(ui.controller.activeTab, 'look');

  workspaceTab('animate').click();
  assert.deepEqual(shownTabs(), ['camera']);
  assert.equal(ui.controller.activeTab, 'camera');
  workspaceTab('look').click();
  assert.equal(ui.controller.activeTab, 'material');
  assert.equal(JSON.stringify(ui.studio.exportRecipe()), recipeBefore, 'a workspace is not part of the scene');
  assert.equal(ui.controller.canUndo, false);

  ui.studio.setActiveTab('node');
  assert.equal(ui.root.dataset.workspace, 'build', 'opening a panel brings its workspace forward');
  dispatch(ui.dom.document, 'keydown', { key: 'k' });
  assert.equal(ui.root.dataset.workspace, 'animate', 'a keyframe opens the timeline');
});

test('each scene row draws the shape of its object in the colour of its material', testContext => {
  const recipe = makeRecipe();
  recipe.nodes.push({ id: 'set', label: 'Set' });
  const ui = mountStudio(testContext, { recipe });
  const shapes = Object.fromEntries(ui.rows().map(row => [
    row.querySelector('.crucible-studio-tree-label').textContent,
    row.querySelector('.crucible-studio-tree-badge'),
  ]));
  assert.equal(shapes.hero.getAttribute('data-shape'), 'node');
  assert.equal(shapes.orb.getAttribute('data-shape'), 'sphere');
  assert.equal(shapes.Set.getAttribute('data-shape'), 'group');
  assert.match(shapes.hero.style.fill, /^#[0-9a-f]{6}$/);
  assert.equal(shapes.Set.style.fill, undefined, 'a group has no material to show');
  assert.equal(shapes.orb.tagName.toLowerCase(), 'svg');
});

test('Blender keys add, duplicate, delete, deselect, turn the view and fold Properties', testContext => {
  const ui = mountStudio(testContext);
  const press = (key, properties = {}) => dispatch(ui.dom.document, 'keydown', { key, ...properties });
  ui.selectRow('hero');
  const countBefore = ui.studio.exportRecipe().nodes.length;
  press('D', { shiftKey: true });
  assert.equal(ui.studio.exportRecipe().nodes.length, countBefore + 1, 'Shift+D duplicates');
  press('x');
  assert.equal(ui.studio.exportRecipe().nodes.length, countBefore, 'X deletes the selection');

  ui.selectRow('hero');
  press('Escape');
  assert.equal(ui.controller.selectedNodeId, null, 'Esc deselects');
  press('x');
  assert.equal(ui.studio.exportRecipe().nodes.length, countBefore, 'X does nothing with no selection');

  const offset = () => ui.controller.scene.camera.eye.map((value, index) => value - ui.controller.scene.camera.target[index]);
  press('7');
  assert.ok(offset()[1] > Math.abs(offset()[0]) * 20 && offset()[1] > Math.abs(offset()[2]) * 20, 'top view looks straight down');
  assert.equal(ui.status(), 'Top view');
  press('1');
  assert.ok(offset()[2] > 0 && Math.abs(offset()[0]) < 1e-3 && Math.abs(offset()[1]) < 1e-3, 'front view looks along Z');
  press('3');
  assert.ok(offset()[0] > 0 && Math.abs(offset()[2]) < 1e-3, 'right view looks along X');

  press('n');
  assert.equal(ui.root.dataset.inspectorCollapsed, 'true');
  press('n');
  assert.equal(ui.root.dataset.inspectorCollapsed, 'false');

  let addClicks = 0;
  ui.label('Add an object or a light').addEventListener('click', () => { addClicks += 1; });
  press('A', { shiftKey: true });
  assert.equal(addClicks, 1, 'Shift+A opens the Add menu');

  const toolBefore = ui.controller.tool;
  press('g', { ctrlKey: true });
  assert.equal(ui.controller.tool, toolBefore, 'a browser shortcut is not taken for a tool key');
  press(',', { ctrlKey: true });
  assert.equal(ui.root.querySelector('.crucible-studio-settings-dialog').open, true, 'Ctrl+, opens Settings');
});

test('Settings change the snap, the handles and what the viewport shows, and are kept for the next visit', testContext => {
  const saved = new Map();
  const preferenceStorage = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) };
  const ui = mountStudio(testContext, { preferenceStorage });
  const control = name => ui.root.querySelector('.crucible-studio-settings-dialog').descendants().find(element => element.dataset?.setting === name);
  const choose = (name, value) => {
    control(name).value = String(value);
    dispatch(control(name), 'change');
  };
  const toggle = (name, checked) => {
    control(name).checked = checked;
    dispatch(control(name), 'change');
  };
  assert.deepEqual(ui.controller.interactionSettings, { moveSnapStep: 0.25, rotateSnapDegrees: 15, gizmoPixels: 74 });
  assert.equal(control('moveSnapStep').value, '0.25');
  assert.equal(control('gridVisible').checked, true);

  byText(ui.root, 'Settings…').click();
  assert.equal(ui.root.querySelector('.crucible-studio-settings-dialog').open, true);
  choose('moveSnapStep', 1);
  choose('rotateSnapDegrees', 45);
  choose('gizmoSize', 'large');
  assert.deepEqual(ui.controller.interactionSettings, { moveSnapStep: 1, rotateSnapDegrees: 45, gizmoPixels: 92 });
  toggle('gridVisible', false);
  assert.equal(ui.studio.gridVisible, false);
  assert.equal(ui.label('Show or hide the grid').getAttribute('aria-pressed'), 'false');
  toggle('readoutVisible', false);
  toggle('viewWidgetVisible', false);
  assert.equal(ui.root.dataset.readout, 'off');
  assert.equal(ui.root.dataset.viewWidget, 'off');
  choose('startWorkspace', 'animate');
  assert.equal(ui.root.dataset.workspace, 'build', 'the workspace in use is left alone');
  assert.deepEqual(JSON.parse(saved.get('crucible-studio-preferences')), {
    panelWidth: 284,
    sceneShare: 0,
    sceneMinimized: false,
    propertiesMinimized: false,
    panelsFloating: true,
    moveSnapStep: 1,
    rotateSnapDegrees: 45,
    gizmoSize: 'large',
    startWorkspace: 'animate',
    gridVisible: false,
    readoutVisible: false,
    viewWidgetVisible: false,
    agentCursorVisible: true,
  });

  ui.label('Show or hide the grid').click();
  assert.equal(control('gridVisible').checked, true, 'the grid button and the setting are one switch');

  const next = mountStudio(testContext, { preferenceStorage, sharedDom: ui.dom });
  assert.equal(next.root.dataset.workspace, 'animate', 'the next visit opens in the chosen workspace');
  assert.equal(next.controller.interactionSettings.moveSnapStep, 1);
  assert.equal(next.root.dataset.readout, 'off');

  next.button('Reset').click();
  assert.deepEqual(next.controller.interactionSettings, { moveSnapStep: 0.25, rotateSnapDegrees: 15, gizmoPixels: 74 });
  assert.equal(next.root.dataset.readout, 'on');
  assert.equal(JSON.parse(saved.get('crucible-studio-preferences')).startWorkspace, 'build');
  assert.throws(() => next.studio.setPreference('theme', 'pink'), /Unknown Studio preference/);
});

test('a Shift drag snaps a move to the step chosen in Settings', testContext => {
  const ui = mountStudio(testContext, { preferences: { moveSnapStep: 1 } });
  ui.selectRow('hero');
  ui.tool('translate').click();
  ui.studio.renderNow();
  const handles = ui.controller.gizmoHandles();
  const along = distance => ui.controller.projectWorldPoint(handles.pivot.map((value, index) => value + handles.basis.x[index] * distance));
  const startX = ui.node('hero').translation[0];
  dispatch(ui.gizmoPart('x'), 'pointerdown', ui.clientPoint(along(handles.handleLength)));
  dispatch(ui.canvas, 'pointermove', { ...ui.clientPoint(along(handles.handleLength + 1.3)), shiftKey: true });
  dispatch(ui.canvas, 'pointerup', ui.clientPoint(along(handles.handleLength + 1.3)));
  const travelled = ui.node('hero').translation[0] - startX;
  assert.ok(Math.abs(travelled - Math.round(travelled)) < 1e-6 && Math.abs(travelled) >= 1, `moved ${travelled} m in whole metres`);
});

test('Scene and Properties share one column and the Scene head carries its icons', testContext => {
  const ui = mountStudio(testContext);
  const side = ui.root.querySelector('.crucible-studio-side');
  const docks = side.children.map(child => child.getAttribute('aria-label'));
  assert.deepEqual(docks, ['Panel width', 'Scene outliner', 'Scene card height', 'Scene inspector']);
  const head = side.querySelector('.crucible-studio-dock-head');
  assert.ok(head.querySelector('.crucible-studio-dock-title').querySelector('svg'));
  const sideRule = STUDIO_CSS.slice(STUDIO_CSS.indexOf('.crucible-studio-side {'), STUDIO_CSS.indexOf('.crucible-studio-side > .crucible-studio-dock {'));
  assert.ok(sideRule.includes('inset-inline-end: var(--studio-edge);') && !sideRule.includes('inset-inline-start'), 'the column sits on the right, across from the tool rail');

  const filterRow = side.querySelector('.crucible-studio-filter');
  const search = ui.label('Filter the scene list');
  const findButton = ui.label('Find an object in the scene');
  assert.ok(head.children.includes(findButton) && findButton.querySelector('svg'));
  assert.equal(filterRow.hidden, true, 'the filter box stays away until asked for');
  findButton.click();
  assert.equal(filterRow.hidden, false);
  assert.equal(findButton.getAttribute('aria-pressed'), 'true');
  search.value = 'or';
  dispatch(search, 'input');
  assert.deepEqual(ui.rowLabels(), ['orb']);
  dispatch(search, 'keydown', { key: 'Escape' });
  assert.equal(filterRow.hidden, true);
  assert.equal(search.value, '', 'closing the box clears the filter');
  assert.ok(ui.rowLabels().length > 1);
  assert.equal(findButton.getAttribute('aria-pressed'), 'false');

  const addButton = ui.label('Add to the scene');
  assert.ok(head.children.includes(addButton));
  assert.equal(addButton.getAttribute('popovertarget'), 'crucible-studio-pop-add');
});

test('the top left shows the Crucible mark from the brand kit', testContext => {
  const ui = mountStudio(testContext);
  const mark = ui.root.querySelector('.crucible-studio-brand').querySelector('svg');
  const layers = mark.children.map(path => path.getAttribute('class'));
  assert.deepEqual(layers, ['body', 'shadow', 'molten-deep', 'molten', 'face-shadow', 'face', 'eye'].map(layer => 'crucible-studio-mark-' + layer));
  const kit = readFileSync(new URL('../public/brand/crucible-mark.svg', import.meta.url), 'utf8');
  assert.ok(kit.includes('viewBox="' + mark.getAttribute('viewBox') + '"'));
  for (const path of mark.children) {
    assert.ok(kit.includes(' d="' + path.getAttribute('d') + '"'), 'every path is the kit path, untouched');
  }
});

test('handle heads have no border until the pointer is on them', testContext => {
  const ui = mountStudio(testContext);
  ui.selectRow('hero');
  ui.tool('translate').click();
  ui.studio.renderNow();
  const heads = ['x', 'y', 'z'].map(axis => ui.gizmo.descendants().find(element => element.tagName.toLowerCase() === 'polygon' && element.getAttribute('data-gizmo-axis') === axis));
  for (const head of heads) {
    assert.equal(head.getAttribute('stroke'), 'none');
  }
  const hoverRule = STUDIO_CSS.slice(STUDIO_CSS.indexOf('[data-gizmo-axis="surface"]:is(polygon, rect, circle) {'));
  assert.ok(hoverRule.slice(0, 120).includes('stroke: var(--studio-trace);'), 'the border under the pointer is pale');
});

test('the top bar has File, Edit, View, Agent and Help menus that do what their rows say', testContext => {
  const ui = mountStudio(testContext);
  const menus = ui.root.querySelector('.crucible-studio-menus').children.map(button => button.textContent);
  assert.deepEqual(menus, ['File', 'Edit', 'View', 'Agent', 'Help']);
  const menuButton = label => ui.root.querySelector('.crucible-studio-menus').children.find(button => button.textContent === label);
  const popover = id => ui.root.querySelector(`#crucible-studio-pop-${id}`);
  const rows = id => popover(id).querySelectorAll('button').map(button => button.textContent);

  menuButton('File').click();
  assert.equal(popover('new').popoverOpen, true);
  assert.deepEqual(rows('new').slice(0, 7), ['Open…', 'Save', 'Save as…', 'Recipe JSON', 'Export PNG image', 'Export GLB model', 'Export web pack']);
  assert.equal(byText(popover('new'), 'Save').dataset.shortcut, 'Ctrl+S');

  menuButton('Edit').click();
  assert.deepEqual(rows('edit'), ['Undo', 'Redo', 'Duplicate', 'Delete', 'Deselect', 'Hide', 'Show all', 'Reset position', 'Reset rotation', 'Reset scale', 'Settings…']);
  ui.selectRow('hero');
  const countBefore = ui.studio.exportRecipe().nodes.length;
  byText(popover('edit'), 'Duplicate').click();
  assert.equal(popover('edit').popoverOpen, false, 'a row closes its menu');
  assert.equal(ui.studio.exportRecipe().nodes.length, countBefore + 1);
  byText(popover('edit'), 'Undo').click();
  assert.equal(ui.studio.exportRecipe().nodes.length, countBefore);
  byText(popover('edit'), 'Redo').click();
  byText(popover('edit'), 'Delete').click();
  assert.equal(ui.studio.exportRecipe().nodes.length, countBefore);
  ui.selectRow('hero');
  byText(popover('edit'), 'Deselect').click();
  assert.equal(ui.controller.selectedNodeId, null);

  menuButton('View').click();
  byText(popover('view'), 'Top view').click();
  assert.equal(ui.status(), 'Top view');
  byText(popover('view'), 'Perspective / Orthographic').click();
  assert.equal(ui.controller.scene.camera.projection, 'orthographic');
  byText(popover('view'), 'Grid').click();
  assert.equal(ui.studio.gridVisible, false);
  byText(popover('view'), 'Properties').click();
  assert.equal(ui.root.dataset.inspectorCollapsed, 'true');

  byText(popover('help'), 'Keyboard shortcuts').click();
  assert.equal(ui.root.querySelector('.crucible-studio-shortcuts-dialog').open, true);
  assert.equal(ui.root.querySelectorAll('button').filter(button => ['Settings (Ctrl+,)', 'Keyboard shortcuts (?)'].includes(button.getAttribute('aria-label'))).length, 0);
});

test('the rail keeps scene tools above one line and the show and hide switches below it', testContext => {
  const ui = mountStudio(testContext);
  const toolbar = ui.root.querySelector('.crucible-studio-toolbar');
  const rows = toolbar.children.map(child => child.getAttribute('role') === 'separator' ? 'line' : child.getAttribute('aria-label'));
  assert.deepEqual(rows, ['Transform tool', 'Edit the scene', 'line', 'Show or hide']);
  const below = toolbar.children.at(-1).children.map(button => button.getAttribute('aria-label'));
  assert.deepEqual(below, ['Show or hide the grid', 'Show or hide the panels']);
  const above = toolbar.children[1].children.map(button => button.dataset.icon);
  assert.deepEqual(above, ['add', 'undo', 'redo']);
});

test('each card minimizes to its head, apart from the panels switch, and stays that way on the next visit', testContext => {
  const saved = new Map();
  const preferenceStorage = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) };
  const ui = mountStudio(testContext, { preferenceStorage });
  assert.equal(ui.root.dataset.outlinerMinimized, 'false');
  const minimizeScene = ui.label('Minimize Scene');
  assert.equal(minimizeScene.getAttribute('aria-expanded'), 'true');
  minimizeScene.click();
  assert.equal(ui.root.dataset.outlinerMinimized, 'true');
  assert.equal(ui.root.dataset.outlinerCollapsed, 'false', 'a minimized card is still shown');
  assert.equal(minimizeScene.getAttribute('aria-label'), 'Expand Scene');
  assert.equal(minimizeScene.getAttribute('aria-expanded'), 'false');
  assert.equal(minimizeScene.dataset.icon, 'expand');
  ui.label('Minimize Properties').click();
  assert.equal(ui.root.dataset.inspectorMinimized, 'true');

  ui.label('Show or hide the panels').click();
  ui.label('Show or hide the panels').click();
  assert.equal(ui.root.dataset.outlinerMinimized, 'true', 'hiding and showing the panels keeps a card minimized');

  const next = mountStudio(testContext, { preferenceStorage, sharedDom: ui.dom });
  assert.equal(next.root.dataset.outlinerMinimized, 'true');
  assert.equal(next.root.dataset.inspectorMinimized, 'true');
  next.label('Expand Scene').click();
  assert.equal(next.root.dataset.outlinerMinimized, 'false');
  assert.ok(STUDIO_CSS.includes('[data-outliner-minimized="true"] .crucible-studio-outliner > :not(.crucible-studio-dock-head)'));
});

test('the panel column resizes by dragging its grips or with the arrow keys, inside its limits, and keeps the size', testContext => {
  const saved = new Map();
  const preferenceStorage = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) };
  const ui = mountStudio(testContext, { preferenceStorage });
  const widthGrip = ui.label('Panel width');
  const splitGrip = ui.label('Scene card height');
  const savedPreferences = () => JSON.parse(saved.get('crucible-studio-preferences'));
  assert.equal(widthGrip.getAttribute('aria-valuenow'), '284');
  assert.equal(ui.root.dataset.sceneSized, 'false', 'the Scene card sizes itself until someone drags the split');

  dispatch(widthGrip, 'pointerdown', { clientX: 600 });
  dispatch(widthGrip, 'pointermove', { clientX: 540 });
  assert.equal(widthGrip.getAttribute('aria-valuenow'), '344', 'the drag previews the width');
  assert.equal(saved.has('crucible-studio-preferences'), false, 'and saves nothing until the pointer lets go');
  dispatch(widthGrip, 'pointerup', { clientX: 540 });
  assert.equal(ui.studio.preferences.panelWidth, 344);
  assert.equal(savedPreferences().panelWidth, 344);

  dispatch(widthGrip, 'pointerdown', { clientX: 540 });
  dispatch(widthGrip, 'pointermove', { clientX: -900 });
  dispatch(widthGrip, 'pointerup', { clientX: -900 });
  assert.equal(ui.studio.preferences.panelWidth, 520, 'the column stops at its widest');
  dispatch(widthGrip, 'pointerdown', { clientX: 0 });
  dispatch(widthGrip, 'pointermove', { clientX: 900 });
  dispatch(widthGrip, 'pointerup', { clientX: 900 });
  assert.equal(ui.studio.preferences.panelWidth, 240, 'and at its narrowest');

  const widen = dispatch(widthGrip, 'keydown', { key: 'ArrowLeft' });
  assert.equal(widen.defaultPrevented, true);
  assert.equal(ui.studio.preferences.panelWidth, 256);
  dispatch(widthGrip, 'keydown', { key: 'ArrowRight' });
  assert.equal(ui.studio.preferences.panelWidth, 240);
  assert.equal(dispatch(widthGrip, 'keydown', { key: 'a' }).defaultPrevented, false);
  dispatch(widthGrip, 'dblclick');
  assert.equal(ui.studio.preferences.panelWidth, 284, 'a double click goes back to the opening width');

  dispatch(splitGrip, 'keydown', { key: 'ArrowDown' });
  assert.equal(ui.studio.preferences.sceneShare, 47);
  assert.equal(ui.root.dataset.sceneSized, 'true');
  dispatch(splitGrip, 'keydown', { key: 'ArrowUp' });
  assert.equal(ui.studio.preferences.sceneShare, 42);
  dispatch(splitGrip, 'dblclick');
  assert.equal(ui.studio.preferences.sceneShare, 0);
  assert.equal(ui.root.dataset.sceneSized, 'false');

  const next = mountStudio(testContext, { preferenceStorage, sharedDom: ui.dom, preferences: { panelWidth: 9000, sceneShare: 3 } });
  assert.equal(next.studio.preferences.panelWidth, 520, 'a saved width outside the limits is pulled back in');
  assert.equal(next.studio.preferences.sceneShare, 15);
  assert.equal(mountStudio(testContext, { sharedDom: ui.dom, preferences: { panelWidth: Number.NaN } }).studio.preferences.panelWidth, 284);
});
test('panels float over the scene by default and dock to the window edges from the View menu or Settings', testContext => {
  const saved = new Map();
  const preferenceStorage = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) };
  const ui = mountStudio(testContext, { preferenceStorage });
  assert.equal(ui.root.dataset.floating, 'true');
  const viewMenu = ui.root.descendants().find(element => element.id === 'crucible-studio-pop-view');
  byText(viewMenu, 'Floating panels').click();
  assert.equal(ui.root.dataset.floating, 'false');
  assert.equal(ui.studio.preferences.panelsFloating, false);
  assert.equal(JSON.parse(saved.get('crucible-studio-preferences')).panelsFloating, false);

  const next = mountStudio(testContext, { preferenceStorage, sharedDom: ui.dom });
  assert.equal(next.root.dataset.floating, 'false', 'the next visit opens docked');
  const control = next.root.querySelector('.crucible-studio-settings-dialog').descendants().find(element => element.dataset?.setting === 'panelsFloating');
  assert.equal(control.checked, false);
  control.checked = true;
  dispatch(control, 'change');
  assert.equal(next.root.dataset.floating, 'true');

  const docked = '.crucible-studio[data-floating="false"]:not([data-compact="true"])';
  const viewportRule = STUDIO_CSS.slice(STUDIO_CSS.indexOf(docked + ' .crucible-studio-viewport {'));
  assert.ok(viewportRule.startsWith(docked), 'the docked viewport has a rule of its own');
  assert.ok(viewportRule.slice(0, viewportRule.indexOf('}')).includes('inset: var(--studio-dock-bar) var(--studio-dock-side) 0 var(--studio-rail)'), 'the viewport is the room the panels leave, so the scene is drawn at that size');
});

test('G picks the selected object up under the pointer; X locks an axis, Esc puts it back and a click places it', testContext => {
  const ui = mountStudio(testContext);
  const hintBar = ui.root.querySelector('.crucible-studio-hintbar');
  const heroNode = () => ui.controller.exportRecipe().nodes.find(node => node.id === ui.controller.selectedNodeId);
  const press = key => dispatch(ui.dom.document, 'keydown', { key });

  // With nothing selected, or the pointer away from the viewport, the key only switches the tool.
  press('g');
  assert.equal(ui.root.dataset.modal, undefined);
  ui.controller.selectNode(ui.controller.exportRecipe().nodes[0].id);
  press('g');
  assert.equal(ui.root.dataset.modal, undefined);

  const before = structuredClone(heroNode().translation);
  dispatch(ui.viewport, 'pointermove', { clientX: 300, clientY: 200 });
  press('g');
  assert.equal(ui.root.dataset.modal, 'translate');
  assert.equal(ui.controller.dragging, true);
  dispatch(ui.dom.document, 'pointermove', { clientX: 380, clientY: 150 });
  assert.notDeepEqual(heroNode().translation, before);
  assert.equal(hintBar.querySelectorAll('kbd').filter(key => key.getAttribute('aria-pressed') === 'true').length, 0);

  press('x');
  const pressed = hintBar.querySelectorAll('kbd').filter(key => key.getAttribute('aria-pressed') === 'true');
  assert.deepEqual(pressed.map(key => key.textContent), ['X']);
  assert.equal(heroNode().translation[1], before[1]);
  assert.equal(heroNode().translation[2], before[2]);
  press('x');
  assert.equal(hintBar.querySelectorAll('kbd').filter(key => key.getAttribute('aria-pressed') === 'true').length, 0);

  press('Escape');
  assert.equal(ui.root.dataset.modal, undefined);
  assert.deepEqual(heroNode().translation, before);
  assert.equal(ui.controller.canUndo, false);
  assert.equal(hintBar.textContent, '');

  // Placed with a click: one undo step takes the whole move back, axis changes included.
  press('g');
  dispatch(ui.dom.document, 'pointermove', { clientX: 380, clientY: 150 });
  press('y');
  press('z');
  dispatch(ui.dom.document, 'pointermove', { clientX: 420, clientY: 120 });
  const placing = dispatch(ui.dom.document, 'pointerdown', { button: 0, clientX: 420, clientY: 120 });
  assert.equal(placing.defaultPrevented, true);
  assert.equal(ui.root.dataset.modal, undefined);
  assert.notDeepEqual(heroNode().translation, before);
  ui.controller.undo();
  assert.deepEqual(heroNode().translation, before);
  assert.equal(ui.controller.canUndo, false);

  // R while holding swaps the tool; a right press cancels.
  press('s');
  assert.equal(ui.root.dataset.modal, 'scale');
  press('r');
  assert.equal(ui.root.dataset.modal, 'rotate');
  assert.equal(ui.controller.tool, 'rotate');
  dispatch(ui.dom.document, 'pointerdown', { button: 2, clientX: 420, clientY: 120 });
  assert.equal(ui.root.dataset.modal, undefined);
  assert.equal(ui.controller.canUndo, false);
});

test('a right click on an object opens its menu; H hides, Alt+H shows all and Alt+G, R and S reset the transform', testContext => {
  const ui = mountStudio(testContext);
  const menu = ui.root.querySelector('#crucible-studio-pop-object');
  const heroNode = () => ui.controller.exportRecipe().nodes.find(node => node.id === 'hero');
  const press = (key, modifiers = {}) => dispatch(ui.dom.document, 'keydown', { key, ...modifiers });
  assert.deepEqual(menu.querySelectorAll('button').map(button => button.textContent), ['Frame', 'Duplicate', 'Hide', 'Reset position', 'Reset rotation', 'Reset scale', 'Delete']);

  // In the Scene list the row is selected first, then the menu opens on it.
  const heroRow = ui.rows().find(row => row.textContent.includes(heroNode().label ?? 'hero'));
  const opened = dispatch(heroRow.querySelector('.crucible-studio-tree-select'), 'contextmenu', { clientX: 900, clientY: 120 });
  assert.equal(opened.defaultPrevented, true);
  assert.equal(ui.controller.selectedNodeId, 'hero');
  assert.equal(menu.popoverOpen, true);
  assert.equal(menu.style.left, '900px');
  assert.equal(menu.style.top, '120px');

  byText(menu, 'Hide').click();
  assert.equal(menu.popoverOpen, false);
  assert.equal(heroNode().visible, false);
  press('h', { altKey: true });
  assert.notEqual(heroNode().visible, false);
  assert.match(ui.status(), /Showing 1 hidden object/);
  press('h');
  assert.equal(heroNode().visible, false);
  ui.controller.undo();
  assert.notEqual(heroNode().visible, false);
  press('h', { altKey: true });
  assert.equal(ui.status(), 'Nothing is hidden');

  ui.controller.updateNodeTransform('hero', { translation: [2, 3, 4], scale: [2, 2, 2], rotation: [0, 0.7071068, 0, 0.7071068] });
  press('g', { altKey: true });
  assert.deepEqual(heroNode().translation, [0, 0, 0]);
  assert.equal(ui.root.dataset.modal, undefined);
  press('r', { altKey: true });
  assert.deepEqual(heroNode().rotation ?? [0, 0, 0, 1], [0, 0, 0, 1]);
  byText(menu, 'Reset scale').click();
  assert.deepEqual(heroNode().scale ?? [1, 1, 1], [1, 1, 1]);
  assert.equal(ui.status(), 'Scale reset');
});

test('the press that ends a held move reaches nothing under it, and held or modified keys leave the lock alone', testContext => {
  const ui = mountStudio(testContext);
  const hintBar = ui.root.querySelector('.crucible-studio-hintbar');
  const menu = ui.root.querySelector('#crucible-studio-pop-object');
  const press = (key, modifiers = {}) => dispatch(ui.dom.document, 'keydown', { key, ...modifiers });
  const lockedKeys = () => hintBar.querySelectorAll('kbd').filter(key => key.getAttribute('aria-pressed') === 'true').map(key => key.textContent);
  const hold = key => {
    dispatch(ui.viewport, 'pointermove', { clientX: 300, clientY: 200 });
    press(key);
    dispatch(ui.dom.document, 'pointermove', { clientX: 360, clientY: 170 });
  };
  ui.controller.selectNode('hero');
  const nodeCount = ui.controller.exportRecipe().nodes.length;

  hold('g');
  press('x');
  press('x', { repeat: true });
  assert.deepEqual(lockedKeys(), ['X']);
  press('z', { ctrlKey: true });
  press('s', { ctrlKey: true });
  assert.deepEqual(lockedKeys(), ['X']);
  assert.equal(ui.root.dataset.modal, 'translate');

  // Placed over the Delete button: the click that follows the press must not delete the object.
  const deleteButton = ui.label('Delete (Del)');
  dispatch(ui.dom.document, 'pointerdown', { button: 0, clientX: 900, clientY: 300 });
  const strayClick = dispatch(deleteButton, 'click', {});
  assert.equal(strayClick.defaultPrevented, true);
  assert.equal(ui.controller.exportRecipe().nodes.length, nodeCount);
  assert.equal(ui.controller.canUndo, true);

  // Enter places too.
  hold('r');
  press('Enter');
  assert.equal(ui.root.dataset.modal, undefined);

  // A right press on a handle cancels and its context menu does not open the object's menu.
  hold('s');
  dispatch(ui.dom.document, 'pointerdown', { button: 2, clientX: 300, clientY: 200 });
  const swallowed = dispatch(ui.gizmo, 'contextmenu', { clientX: 300, clientY: 200 });
  assert.equal(swallowed.defaultPrevented, true);
  assert.notEqual(menu.popoverOpen, true);
  // The next right click on a handle is a real one.
  dispatch(ui.dom.document, 'pointerdown', { button: 2, clientX: 300, clientY: 200 });
  dispatch(ui.gizmo, 'contextmenu', { clientX: 300, clientY: 200 });
  assert.equal(menu.popoverOpen, true);

  // A middle press cancels and leaves the next right click alone.
  menu.hidePopover();
  hold('g');
  dispatch(ui.dom.document, 'pointerdown', { button: 1, clientX: 300, clientY: 200 });
  assert.equal(ui.root.dataset.modal, undefined);
  dispatch(ui.gizmo, 'contextmenu', { clientX: 300, clientY: 200 });
  assert.equal(menu.popoverOpen, true);

  // The window losing focus lets go.
  const windowListeners = new Map();
  ui.dom.document.defaultView.addEventListener = (type, listener) => windowListeners.set(type, listener);
  ui.dom.document.defaultView.removeEventListener = type => windowListeners.delete(type);
  const beforeBlur = structuredClone(ui.controller.exportRecipe().nodes.find(node => node.id === 'hero').translation);
  hold('g');
  windowListeners.get('blur')();
  assert.equal(ui.root.dataset.modal, undefined);
  assert.equal(windowListeners.has('blur'), false);
  assert.deepEqual(ui.controller.exportRecipe().nodes.find(node => node.id === 'hero').translation, beforeBlur);
});

test('a right click on an object in the viewport selects it and opens its menu; a right drag only pans', testContext => {
  const ui = mountStudio(testContext);
  const menu = ui.root.querySelector('#crucible-studio-pop-object');
  ui.controller.selectNode('hero');
  const onHero = ui.clientPoint(ui.controller.projectWorldPoint(ui.controller.gizmoHandles().pivot));
  ui.controller.selectNode(null);

  dispatch(ui.canvas, 'pointerdown', { button: 2, pointerId: 3, ...onHero });
  dispatch(ui.canvas, 'pointermove', { clientX: onHero.clientX + 60, clientY: onHero.clientY + 40 });
  dispatch(ui.canvas, 'pointerup', { button: 2, clientX: onHero.clientX + 60, clientY: onHero.clientY + 40 });
  ui.dom.runTimers();
  assert.notEqual(menu.popoverOpen, true);

  ui.controller.selectNode(null);
  const heroNow = (() => {
    ui.controller.selectNode('hero');
    const point = ui.clientPoint(ui.controller.projectWorldPoint(ui.controller.gizmoHandles().pivot));
    ui.controller.selectNode(null);
    return point;
  })();
  dispatch(ui.canvas, 'pointerdown', { button: 2, pointerId: 4, ...heroNow });
  dispatch(ui.canvas, 'pointerup', { button: 2, ...heroNow });
  assert.equal(ui.controller.selectedNodeId, 'hero');
  ui.dom.runTimers();
  assert.equal(menu.popoverOpen, true);
  assert.equal(menu.style.left, `${Math.round(heroNow.clientX)}px`);
});

test('menu rows start with their icon or an empty square, so the labels line up', testContext => {
  const ui = mountStudio(testContext);
  const menuIds = ['crucible-studio-pop-new', 'crucible-studio-pop-edit', 'crucible-studio-pop-object', 'crucible-studio-pop-view', 'crucible-studio-pop-help'];
  for (const menuId of menuIds) {
    const menu = ui.root.descendants().find(element => element.id === menuId);
    const rows = menu.children.filter(element => element.tagName === 'BUTTON');
    assert.ok(rows.length > 0, menuId);
    for (const row of rows) {
      const lead = row.children[0];
      const leadClass = lead.getAttribute('class') ?? lead.className;
      assert.match(String(leadClass), /crucible-studio-icon|crucible-studio-menu-gap/, `${menuId}: ${row.textContent}`);
    }
  }
});

test('each handle answers a press well outside what is drawn, and a drawn handle still lies on top', testContext => {
  const ui = mountStudio(testContext);
  const hitAreas = () => ui.gizmo.descendants().filter(element => element.getAttribute('data-gizmo-hit'));
  const axesOf = kind => hitAreas().filter(element => element.getAttribute('data-gizmo-hit') === kind).map(element => element.getAttribute('data-gizmo-axis'));
  ui.tool('translate').click();
  ui.studio.renderNow();
  assert.deepEqual(axesOf('line'), ['x', 'y', 'z']);
  assert.deepEqual(axesOf('disc'), ['x', 'y', 'z', 'screen']);
  const parts = ui.gizmo.descendants().filter(element => element.getAttribute('data-gizmo-axis'));
  const lastHit = Math.max(...hitAreas().map(element => parts.indexOf(element)));
  const firstDrawn = parts.findIndex(element => !element.getAttribute('data-gizmo-hit'));
  assert.ok(lastHit < firstDrawn, 'unseen areas come first, so drawn handles win a press');
  assert.ok(Number(hitAreas().find(element => element.getAttribute('data-gizmo-hit') === 'disc').getAttribute('r')) >= 13);
  assert.ok(STUDIO_CSS.includes('[data-gizmo-hit="line"] { stroke-width: 22px !important; }'));
  ui.tool('scale').click();
  ui.studio.renderNow();
  assert.deepEqual(axesOf('disc'), ['x', 'y', 'z', 'uniform']);
  ui.tool('rotate').click();
  ui.studio.renderNow();
  assert.deepEqual(axesOf('line'), ['x', 'y', 'z']);
  assert.deepEqual(axesOf('disc'), []);
});

test('the Animated camera row shows only when a track drives the camera, and switches the free view', testContext => {
  const viewRow = ui => ui.root.descendants().find(element => element.getAttribute('role') === 'menuitemcheckbox' && element.textContent === 'Animated camera');
  const openViewMenu = ui => dispatch(ui.root.descendants().find(element => element.id === 'crucible-studio-pop-view'), 'toggle');
  const plain = mountStudio(testContext);
  openViewMenu(plain);
  assert.equal(viewRow(plain).hidden, true);

  const drivenRecipe = makeRecipe();
  drivenRecipe.motion = {
    duration: 4,
    loop: false,
    tracks: [{ kind: 'camera', property: 'fov', interpolation: 'LINEAR', keyframes: [{ time: 0, value: 40 }, { time: 4, value: 30 }] }],
  };
  const sharedDom = plain.dom;
  const driven = mountStudio(testContext, { recipe: drivenRecipe, sharedDom });
  openViewMenu(driven);
  const row = viewRow(driven);
  assert.equal(row.hidden, false);
  assert.equal(row.getAttribute('aria-checked'), 'true');
  const sceneEye = Array.from(driven.controller.scene.camera.eye);
  row.click();
  assert.equal(driven.controller.freeView, true);
  assert.equal(row.getAttribute('aria-checked'), 'false');
  assert.deepEqual([...driven.controller.viewCamera.eye], sceneEye, 'the free view starts where the animated camera stands');
  driven.controller.orbitCamera({ zoomScale: 0.5 });
  driven.studio.renderNow();
  assert.deepEqual([...driven.renderer.frames.at(-1).eye], [...driven.controller.viewCamera.eye], 'the frame is drawn from the free view');
  assert.deepEqual(Array.from(driven.controller.scene.camera.eye), sceneEye);
  row.click();
  assert.equal(driven.controller.freeView, false);
  assert.equal(row.getAttribute('aria-checked'), 'true');
});
