// Studio trees: the preset picker and the tree controls of the inspector. Both write the recipe field `vegetation`
// that agents write, so a tree made here opens the same over MCP. Studio loads this file on first use, so the core
// entry carries none of it.
import { TREE_PRESETS } from './vegetation-presets.js';
import { SPECIES } from './vegetation-species.js';

export const TREE_PRESET_NAMES = Object.freeze(Object.keys(TREE_PRESETS));

export const TREE_HEIGHT_RANGE = Object.freeze({ min: 0.5, max: 30, step: 0.1 });
export const TREE_SEASON_RANGE = Object.freeze({ min: 0, max: 1, step: 0.01 });
export const TREE_LEAF_DENSITY_RANGE = Object.freeze({ min: 0.5, max: 20, step: 0.5 });

const SEED_CEILING = 100000;
const THUMBNAIL_SIZE = 168;
const THUMBNAIL_VIEW_DIRECTION = Object.freeze([0.38, 0.16, 1]);
const THUMBNAIL_DISTANCE_PER_METRE = 2.1;

/** The vegetation field of a node that grows exactly one tree, or null for any other node. */
export function singleTreeOf(node) {
  const vegetation = node?.vegetation;
  if (!vegetation || vegetation.mix || vegetation.scatter) {
    return null;
  }
  return vegetation.preset || vegetation.species ? vegetation : null;
}

function speciesOf(vegetation) {
  return vegetation.preset ? TREE_PRESETS[vegetation.preset].species : vegetation.species;
}

function middleOf(range) {
  return (range[0] + range[1]) / 2;
}

function roundTo(value, step) {
  return Math.round(value / step) * step;
}

/** The height the tree grows to when the recipe sets none: the middle of its preset or species range. */
export function defaultTreeHeight(vegetation) {
  const presetRange = vegetation.preset ? TREE_PRESETS[vegetation.preset].height : null;
  return middleOf(presetRange ?? SPECIES[speciesOf(vegetation)].height);
}

/** The leaf sites per metre of twig the tree grows with when the recipe sets none. */
export function defaultLeafDensity(vegetation) {
  const presetTree = vegetation.preset ? TREE_PRESETS[vegetation.preset].tree : null;
  return presetTree?.leafCount ?? SPECIES[speciesOf(vegetation)].leaf.sitesPerMeter;
}

/** The values the inspector controls show for one tree. */
export function treeControlValues(vegetation) {
  return {
    height: vegetation.height ?? roundTo(defaultTreeHeight(vegetation), TREE_HEIGHT_RANGE.step),
    season: vegetation.season ?? 0,
    leafDensity: vegetation.tree?.leafCount ?? defaultLeafDensity(vegetation),
    seed: vegetation.seed ?? 1,
  };
}

/** The vegetation field after one control moved; every other field of it stays as it was. */
export function vegetationAfterChange(vegetation, change) {
  const { leafDensity, ...direct } = change;
  const next = { ...vegetation, ...direct };
  if (leafDensity !== undefined) {
    next.tree = { ...vegetation.tree, leafCount: leafDensity };
  }
  return next;
}

/** A seed other than the current one, whole and small enough to type. */
export function nextTreeSeed(currentSeed, random = Math.random) {
  let seed = currentSeed;
  while (seed === currentSeed) {
    seed = 1 + Math.floor(random() * SEED_CEILING);
  }
  return seed;
}

function uniqueNodeId(recipe, baseName) {
  const taken = new Set(recipe.nodes.map(node => node.id));
  let count = 1;
  while (taken.has(`${baseName}-${count}`)) {
    count += 1;
  }
  return `${baseName}-${count}`;
}

/** The add-node operation that plants a preset tree at `translation`, and the ID the new node gets. */
export function addTreeOperation(recipe, presetName, translation) {
  if (!TREE_PRESETS[presetName]) {
    throw new RangeError(`Unknown tree preset "${String(presetName)}"; expected one of ${TREE_PRESET_NAMES.join(', ')}.`);
  }
  const nodeId = uniqueNodeId(recipe, presetName);
  const labelNumber = nodeId.split('-').pop();
  const node = {
    id: nodeId,
    label: `${TREE_PRESETS[presetName].label} ${labelNumber}`,
    translation,
    vegetation: { preset: presetName, seed: 1 },
  };
  return { operation: { type: 'add-node', node }, nodeId };
}

/**
 * Plants a preset tree where Studio puts new objects and selects it, as one undo step.
 * `findFreeSpot(translation, nodes)` is the controller's free spawn point finder; the vegetation code loads before the edit.
 */
export async function addTree({ controller, loadAgentSceneModules, findFreeSpot }, presetName) {
  const recipe = controller.exportRecipe();
  const { operation, nodeId } = addTreeOperation(recipe, presetName, findFreeSpot([0, 0, 0], recipe.nodes));
  await loadAgentSceneModules({ nodes: [operation.node] });
  controller.applyImportOperations([operation], { selectNodeId: nodeId });
  return operation.node;
}

/** Writes one control change into a tree node through the same edit path as the other inspector fields. */
export function changeSelectedTree(controller, nodeId, change) {
  const node = controller.exportRecipe().nodes.find(candidate => candidate.id === nodeId);
  const vegetation = singleTreeOf(node);
  if (!vegetation) {
    throw new RangeError(`Node "${nodeId}" does not grow a single tree.`);
  }
  controller.updateNodeTransform(nodeId, { vegetation: vegetationAfterChange(vegetation, change) });
}

function thumbnailRecipe(presetName) {
  const vegetation = { preset: presetName, seed: 1 };
  const height = defaultTreeHeight(vegetation);
  const distance = height * THUMBNAIL_DISTANCE_PER_METRE;
  const length = Math.hypot(...THUMBNAIL_VIEW_DIRECTION);
  const eye = THUMBNAIL_VIEW_DIRECTION.map(component => (component / length) * distance);
  eye[1] += height * 0.5;
  return {
    format: 'crucible.scene',
    schemaVersion: 1,
    nodes: [{ id: 'tree', vegetation }],
    camera: { eye, target: [0, height * 0.5, 0], up: [0, 1, 0], fov: 38, near: 0.1, far: height * 20 },
  };
}

/**
 * One picture of each preset, drawn by Crucible's own renderer into a canvas that sits off screen only while it draws.
 * Resolves a map from preset name to an image data URL; a preset that fails to draw is left out.
 */
export async function renderPresetPictures({
  documentReference,
  createAgentScene,
  loadAgentSceneModules,
  createRenderer,
  agentEnvironmentMap,
  fitAgentShadow,
  resolveAgentShadow,
  presetNames = TREE_PRESET_NAMES,
}) {
  const pictures = new Map();
  const canvas = documentReference.createElement('canvas');
  Object.assign(canvas.style, { position: 'fixed', left: '-10000px', top: '0', width: `${THUMBNAIL_SIZE}px`, height: `${THUMBNAIL_SIZE}px` });
  documentReference.body.append(canvas);
  try {
    for (const presetName of presetNames) {
      const recipe = thumbnailRecipe(presetName);
      await loadAgentSceneModules(recipe);
      const scene = createAgentScene(recipe);
      const { environment, effects } = scene;
      const lighting = { ...environment, map: agentEnvironmentMap(environment) };
      const renderer = createRenderer(canvas, scene.parts, {
        hdr: true,
        ground: false,
        world: environment.world,
        environment: lighting,
        shadowBounds: resolveAgentShadow(fitAgentShadow(scene.shadow, scene.parts), environment.lightDirection),
        pixelRatio: 1,
        samples: 4,
      });
      try {
        renderer.resize();
        renderer.render({ ...scene.camera, environment: lighting, effects, exposure: effects.exposure, time: 0, lines: environment.lines });
        pictures.set(presetName, canvas.toDataURL('image/png'));
      } catch {
        // A preset that cannot draw here still gets its tile, with the name only.
      } finally {
        renderer.dispose?.();
      }
    }
  } finally {
    canvas.remove();
  }
  return pictures;
}

function createTreeTile(documentReference, createElement, presetName, onPick) {
  const picture = createElement(documentReference, 'img', { alt: '', draggable: false, className: 'crucible-studio-tree-picture' });
  picture.hidden = true;
  const tile = createElement(
    documentReference,
    'button',
    { type: 'button', className: 'crucible-studio-tree-tile', attributes: { 'aria-label': `Add ${TREE_PRESETS[presetName].label}` } },
    picture,
    createElement(documentReference, 'span', { textContent: TREE_PRESETS[presetName].label }),
  );
  tile.addEventListener('click', () => onPick(presetName));
  return { tile, picture };
}

/** The tiles of the picker: one button per preset, each filled with its picture when `load` has drawn them. */
export function createTreePicker({ documentReference, createElement, loadPictures, onPick }) {
  const tiles = TREE_PRESET_NAMES.map(presetName => ({ presetName, ...createTreeTile(documentReference, createElement, presetName, onPick) }));
  const element = createElement(
    documentReference,
    'div',
    { className: 'crucible-studio-popover-grid crucible-studio-tree-grid', attributes: { role: 'group', 'aria-label': 'Trees' } },
    ...tiles.map(entry => entry.tile),
  );
  let pending = null;
  return {
    element,
    /** Draws the pictures the first time it is called and keeps them for the session. */
    load() {
      pending ??= loadPictures().then(pictures => {
        for (const { presetName, picture } of tiles) {
          const source = pictures.get(presetName);
          if (source) {
            picture.src = source;
            picture.hidden = false;
          }
        }
      });
      return pending;
    },
  };
}

/** The tree rows of the node panel: height, leaf density, season and a seed with a new seed button. */
export function createTreeInspector({ documentReference, createElement, createSliderField, controller, announce }) {
  const write = change => {
    const nodeId = controller.selectedNodeId;
    if (!nodeId) {
      return;
    }
    try {
      changeSelectedTree(controller, nodeId, change);
    } catch (error) {
      announce(error.message);
    }
  };
  const heightField = createSliderField(documentReference, 'Height m', { ...TREE_HEIGHT_RANGE, value: 10 }, height => write({ height }));
  const leafField = createSliderField(documentReference, 'Leaf density', { ...TREE_LEAF_DENSITY_RANGE, value: 5 }, leafDensity => write({ leafDensity }));
  const seasonField = createSliderField(documentReference, 'Season', { ...TREE_SEASON_RANGE, value: 0 }, season => write({ season }));
  const seedInput = createElement(documentReference, 'input', { type: 'number', min: '-2147483648', max: '2147483647', step: '1', attributes: { 'aria-label': 'Seed' } });
  const newSeedButton = createElement(documentReference, 'button', { type: 'button', textContent: 'New seed' });
  seedInput.addEventListener('change', () => {
    const seed = Number(seedInput.value);
    if (Number.isInteger(seed)) {
      write({ seed });
    }
  });
  newSeedButton.addEventListener('click', () => write({ seed: nextTreeSeed(Number(seedInput.value)) }));
  const element = createElement(
    documentReference,
    'div',
    { className: 'crucible-studio-tree-controls' },
    heightField.container,
    leafField.container,
    seasonField.container,
    createElement(documentReference, 'div', { className: 'crucible-studio-tree-seed' }, seedInput, newSeedButton),
  );
  element.hidden = true;
  return {
    element,
    /** Shows the rows for a node that grows one tree and hides them for any other. */
    sync(node) {
      const vegetation = singleTreeOf(node);
      element.hidden = !vegetation;
      if (!vegetation) {
        return;
      }
      const values = treeControlValues(vegetation);
      heightField.setValue(values.height);
      leafField.setValue(values.leafDensity);
      seasonField.setValue(values.season);
      seedInput.value = String(values.seed);
    },
  };
}
