import { applyProjection } from './camera.js';
import { createAgentScene, loadAgentSceneModules } from './agent-scene.js';
import { agentEnvironmentMap, fitAgentShadow, resolveAgentShadow } from './agent-look.js';
import { agentSceneModulesNeeded } from './agent-scene-modules.js';
import { LIGHTING_SETUP_NAMES } from './agent-scene-capabilities.js';
import { VIEW_TRANSFORM_NAMES } from './view-transform-names.js';
import { CrucibleRenderer } from './renderer.js';
import { exportGlb } from './export.js';
import { encodePack } from './scene-pack-format.js';
import { PACK_SHADER_MODULES, PACK_UNSUPPORTED_MODULES } from './scene-pack-shaders.js';
import { STUDIO_CSS } from './studio-styles.js';
import { studioIconPath } from './studio-icons.js';
import {
  STUDIO_LENS_PRESETS,
  STUDIO_MATERIAL_PRESETS,
  STUDIO_PRIMITIVES,
  STUDIO_TABS,
  STUDIO_TEMPLATES,
  STUDIO_TOOLS,
  STUDIO_VIEW_PRESETS,
  buildTemplateRecipe,
} from './studio-templates.js';
import {
  createStudioController,
  directionToSunAngles,
  hasAnimatedData,
  linearRgbToHex,
  quaternionToEulerDegrees,
  roundValue,
} from './studio-controller.js';

export {
  STUDIO_LENS_PRESETS,
  STUDIO_MATERIAL_PRESETS,
  STUDIO_PRIMITIVES,
  STUDIO_TABS,
  STUDIO_TEMPLATES,
  STUDIO_TOOLS,
  STUDIO_VIEW_PRESETS,
  buildTemplateRecipe,
  createStudioController,
};

const AXIS_NAMES = Object.freeze(['x', 'y', 'z']);
const AXIS_COLORS = Object.freeze({ x: '#ee7a6c', y: '#5fc48a', z: '#5ea8ff' });
const DEGREE_PRECISION = 100;
const ROUND_PRECISION = 10000;
const STUDIO_STYLE_ID = 'crucible-studio-styles';
const COMPACT_WIDTH = 820;

function injectStudioStyles(documentReference) {
  let style = documentReference.getElementById(STUDIO_STYLE_ID);
  if (!style) {
    style = documentReference.createElement('style');
    style.id = STUDIO_STYLE_ID;
    documentReference.head.append(style);
  }
  style.textContent = STUDIO_CSS;
}

function createElement(documentReference, tagName, properties = {}, ...children) {
  const element = documentReference.createElement(tagName);
  for (const [key, value] of Object.entries(properties)) {
    if (key === 'attributes') {
      for (const [attributeName, attributeValue] of Object.entries(value)) {
        if (attributeValue !== null && attributeValue !== undefined) {
          element.setAttribute(attributeName, String(attributeValue));
        }
      }
    } else if (key === 'dataset') {
      Object.assign(element.dataset, value);
    } else {
      element[key] = value;
    }
  }
  element.append(...children);
  return element;
}

function createSvgElement(documentReference, tagName, attributes = {}) {
  const element = documentReference.createElementNS('http://www.w3.org/2000/svg', tagName);
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, String(value));
  }
  return element;
}

function createIcon(documentReference, iconName) {
  const icon = createSvgElement(documentReference, 'svg', { viewBox: '0 0 24 24', class: 'crucible-studio-icon', 'aria-hidden': 'true' });
  icon.append(createSvgElement(documentReference, 'path', { d: studioIconPath(iconName) }));
  return icon;
}

function setButtonIcon(button, iconName, label) {
  if (button.dataset.icon !== iconName) {
    button.dataset.icon = iconName;
    button.replaceChildren(createIcon(button.ownerDocument, iconName));
  }
  button.setAttribute('aria-label', label);
  button.title = label;
}

function createIconButton(documentReference, iconName, label, properties = {}) {
  const button = createElement(documentReference, 'button', { type: 'button', ...properties });
  setButtonIcon(button, iconName, label);
  return button;
}

function wireRovingFocusFallback(container, items, { vertical = false, followFocus = false, onSelect } = {}) {
  if ('focusGroup' in HTMLElement.prototype) {
    return;
  }
  items.forEach((item, index) => {
    item.tabIndex = index === 0 ? 0 : -1;
  });
  container.addEventListener('focusin', event => {
    if (!items.includes(event.target)) {
      return;
    }
    items.forEach(item => {
      item.tabIndex = item === event.target ? 0 : -1;
    });
  });
  container.addEventListener('keydown', event => {
    const currentIndex = items.indexOf(container.ownerDocument.activeElement);
    if (currentIndex < 0) {
      return;
    }
    const rightToLeft = getComputedStyle(container).direction === 'rtl';
    const nextKey = vertical ? 'ArrowDown' : rightToLeft ? 'ArrowLeft' : 'ArrowRight';
    const previousKey = vertical ? 'ArrowUp' : rightToLeft ? 'ArrowRight' : 'ArrowLeft';
    let targetIndex = null;
    if (event.key === nextKey) targetIndex = (currentIndex + 1) % items.length;
    else if (event.key === previousKey) targetIndex = (currentIndex - 1 + items.length) % items.length;
    else if (event.key === 'Home') targetIndex = 0;
    else if (event.key === 'End') targetIndex = items.length - 1;
    if (targetIndex === null) {
      return;
    }
    event.preventDefault();
    const targetItem = items[targetIndex];
    targetItem.focus();
    if (followFocus && onSelect) {
      onSelect(targetItem);
    }
  });
}

function createVectorRow(documentReference, title, onInput, { sensitivity = 0.02, minimumComponent = -Infinity, lockToggle = null } = {}) {
  let latestValues = [0, 0, 0];
  let locked = false;
  const inputs = AXIS_NAMES.map(axis => createElement(documentReference, 'input', {
    type: 'number',
    step: '0.05',
    attributes: { 'aria-label': `${title} ${axis.toUpperCase()}` },
  }));

  function emitEditedAxis(axisIndex, rawNumeric) {
    const clamped = Math.max(minimumComponent, rawNumeric);
    if (locked && latestValues[axisIndex] > 0) {
      const ratio = clamped / latestValues[axisIndex];
      const scaled = latestValues.map(component => Math.max(minimumComponent, component * ratio));
      onInput(scaled, axisIndex);
      return;
    }
    const parsed = inputs.map((field, index) => (index === axisIndex ? clamped : Number(field.value)));
    if (parsed.every(Number.isFinite)) {
      onInput(parsed, axisIndex);
    }
  }

  inputs.forEach((input, axisIndex) => {
    input.addEventListener('change', () => {
      const numeric = Number(input.value);
      if (Number.isFinite(numeric)) {
        emitEditedAxis(axisIndex, numeric);
      }
    });
  });

  const axisLabels = AXIS_NAMES.map((axis, axisIndex) => {
    const badge = createElement(documentReference, 'span', {
      className: 'crucible-studio-axis-scrub',
      textContent: axis.toUpperCase(),
      title: 'Drag horizontally to scrub value',
    });
    badge.style.color = AXIS_COLORS[axis];
    let scrubState = null;
    badge.addEventListener('pointerdown', event => {
      event.preventDefault();
      scrubState = { startX: event.clientX, startValue: Number(inputs[axisIndex].value) || 0 };
      badge.setPointerCapture?.(event.pointerId);
    });
    badge.addEventListener('pointermove', event => {
      if (!scrubState) return;
      const stepFactor = event.shiftKey ? sensitivity * 0.2 : sensitivity;
      const nextValue = roundValue(scrubState.startValue + (event.clientX - scrubState.startX) * stepFactor, 100);
      emitEditedAxis(axisIndex, nextValue);
    });
    const finishScrub = () => {
      scrubState = null;
    };
    badge.addEventListener('pointerup', finishScrub);
    badge.addEventListener('pointercancel', finishScrub);
    return badge;
  });

  const head = createElement(
    documentReference,
    'div',
    { className: 'crucible-studio-field-head' },
    createElement(documentReference, 'span', { textContent: title }),
  );
  if (lockToggle) {
    const lockButton = createIconButton(documentReference, 'link', 'Keep the three axes together', {
      className: 'crucible-studio-mini-btn',
      attributes: { 'aria-pressed': 'false' },
    });
    lockButton.addEventListener('click', () => {
      locked = !locked;
      lockButton.setAttribute('aria-pressed', locked ? 'true' : 'false');
    });
    head.append(lockButton);
  }

  const container = createElement(
    documentReference,
    'div',
    { className: 'crucible-studio-field' },
    head,
    createElement(
      documentReference,
      'div',
      { className: 'crucible-studio-vector' },
      ...inputs.map((input, axisIndex) => createElement(
        documentReference,
        'label',
        {},
        axisLabels[axisIndex],
        input,
      )),
    ),
  );
  return {
    container,
    inputs,
    setValues(values, precision = ROUND_PRECISION) {
      latestValues = Array.from(values, component => Number(component) || 0);
      inputs.forEach((input, index) => {
        input.value = String(roundValue(values[index] ?? 0, precision));
      });
    },
  };
}

function createSliderField(documentReference, labelText, { min, max, step, value = 0 }, onChange) {
  const decimals = step < 0.01 ? 3 : step < 0.1 ? 2 : step < 1 ? 1 : 0;
  const output = createElement(documentReference, 'output', { textContent: Number(value).toFixed(decimals) });
  const input = createElement(documentReference, 'input', {
    type: 'range',
    min: String(min),
    max: String(max),
    step: String(step),
    value: String(value),
    attributes: { 'aria-label': labelText },
  });
  input.addEventListener('input', () => {
    const numeric = Number(input.value);
    output.textContent = numeric.toFixed(decimals);
    onChange(numeric);
  });
  const container = createElement(
    documentReference,
    'div',
    { className: 'crucible-studio-field' },
    createElement(documentReference, 'div', { className: 'crucible-studio-field-head' }, createElement(documentReference, 'span', { textContent: labelText }), output),
    input,
  );
  return {
    container,
    input,
    output,
    setValue(nextValue) {
      input.value = String(nextValue);
      output.textContent = Number(nextValue).toFixed(decimals);
    },
  };
}

function createSunPad(documentReference, onSunChange, { onDragStart, onDragEnd } = {}) {
  const padSvg = createSvgElement(documentReference, 'svg', {
    class: 'crucible-studio-sunpad',
    viewBox: '0 0 120 120',
    'aria-label': 'Sun direction pad. Drag to move key light azimuth and elevation.',
    role: 'application',
  });
  const outerRing = createSvgElement(documentReference, 'circle', {
    cx: '60',
    cy: '60',
    r: '52',
    fill: 'none',
    stroke: 'color-mix(in srgb, var(--studio-text) 12%, transparent)',
    'stroke-width': '1',
  });
  const midRing = createSvgElement(documentReference, 'circle', {
    cx: '60',
    cy: '60',
    r: '28',
    fill: 'none',
    stroke: 'color-mix(in srgb, var(--studio-text) 8%, transparent)',
    'stroke-dasharray': '3 3',
    'stroke-width': '1',
  });
  const sunRay = createSvgElement(documentReference, 'line', {
    x1: '60',
    y1: '60',
    x2: '40',
    y2: '34',
    stroke: '#f0b34aaa',
    'stroke-width': '2',
  });
  const sunKnob = createSvgElement(documentReference, 'circle', {
    cx: '40',
    cy: '34',
    r: '7',
    fill: '#f0b34a',
    stroke: 'var(--studio-bg)',
    'stroke-width': '2',
  });
  padSvg.append(outerRing, midRing, sunRay, sunKnob);

  let dragging = false;
  function updateFromPointer(event) {
    const bounds = padSvg.getBoundingClientRect();
    const normalizedX = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    const normalizedY = ((event.clientY - bounds.top) / bounds.height) * 2 - 1;
    const radial = Math.min(1, Math.hypot(normalizedX, normalizedY));
    const azimuthDegrees = Math.round((Math.atan2(normalizedX, -normalizedY) * 180) / Math.PI);
    const elevationDegrees = Math.round(Math.max(4, Math.min(88, (1 - radial * 0.88) * 88)));
    onSunChange({ azimuthDegrees, elevationDegrees });
  }
  padSvg.addEventListener('pointerdown', event => {
    dragging = true;
    onDragStart?.();
    padSvg.setPointerCapture?.(event.pointerId);
    updateFromPointer(event);
  });
  padSvg.addEventListener('pointermove', event => {
    if (dragging) updateFromPointer(event);
  });
  const endDrag = () => {
    if (dragging) onDragEnd?.();
    dragging = false;
  };
  padSvg.addEventListener('pointerup', endDrag);
  padSvg.addEventListener('pointercancel', endDrag);

  return {
    element: padSvg,
    setAngles(azimuthDegrees, elevationDegrees) {
      const radial = Math.max(0.05, Math.min(1, (88 - elevationDegrees) / (88 * 0.88))) * 50;
      const radians = (azimuthDegrees * Math.PI) / 180;
      const knobX = 60 + Math.sin(radians) * radial;
      const knobY = 60 - Math.cos(radians) * radial;
      sunRay.setAttribute('x2', knobX.toFixed(1));
      sunRay.setAttribute('y2', knobY.toFixed(1));
      sunKnob.setAttribute('cx', knobX.toFixed(1));
      sunKnob.setAttribute('cy', knobY.toFixed(1));
    },
  };
}

function buildBrandMarkSvg(documentReference) {
  const mark = createSvgElement(documentReference, 'svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' });
  mark.append(
    createSvgElement(documentReference, 'polygon', {
      points: '12,2 21,7 21,17 12,22 3,17 3,7',
      fill: 'color-mix(in srgb, var(--studio-accent) 13%, transparent)',
      stroke: 'var(--studio-accent)',
      'stroke-width': '1.8',
    }),
    createSvgElement(documentReference, 'polygon', {
      points: '12,6.5 17,9.5 17,15 12,18 7,15 7,9.5',
      fill: 'var(--studio-accent)',
    }),
  );
  return mark;
}

function renderGizmoMarkup(documentReference, gizmoSvg, controller) {
  gizmoSvg.replaceChildren();
  const width = controller.viewportWidth;
  const height = controller.viewportHeight;
  gizmoSvg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  const outline = controller.selectionOutline();
  if (outline) {
    gizmoSvg.append(createSvgElement(documentReference, 'polygon', {
      class: 'crucible-studio-selection-outline',
      points: outline.map(point => `${point[0].toFixed(1)},${point[1].toFixed(1)}`).join(' '),
    }));
  }
  const handles = controller.gizmoHandles();
  if (!handles || !handles.origin.visible) {
    return;
  }
  const origin = handles.origin;
  const tool = controller.tool;

  if (tool === 'select') {
    gizmoSvg.append(createSvgElement(documentReference, 'circle', {
      cx: origin.x.toFixed(1),
      cy: origin.y.toFixed(1),
      r: '8',
      fill: 'color-mix(in srgb, var(--studio-accent) 15%, transparent)',
      stroke: 'var(--studio-accent)',
      'stroke-width': '2',
      'data-gizmo-axis': 'screen',
    }));
    return;
  }

  if (tool === 'rotate') {
    for (const axis of AXIS_NAMES) {
      const ring = handles.rings[axis];
      const pointString = ring.filter(point => point.visible).map(point => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
      if (!pointString) continue;
      gizmoSvg.append(createSvgElement(documentReference, 'polyline', {
        points: pointString,
        fill: 'none',
        stroke: AXIS_COLORS[axis],
        'stroke-width': '3',
        'stroke-opacity': '0.92',
        'data-gizmo-axis': axis,
      }));
    }
    gizmoSvg.append(createSvgElement(documentReference, 'circle', {
      cx: origin.x.toFixed(1),
      cy: origin.y.toFixed(1),
      r: '5',
      fill: 'var(--studio-text)',
      stroke: 'var(--studio-bg)',
      'stroke-width': '1.8',
    }));
    return;
  }

  if (tool === 'translate') {
    const planeColors = { xy: '#5ea8ff', xz: '#5fc48a', yz: '#ee7a6c' };
    for (const planeAxis of ['xy', 'xz', 'yz']) {
      const corners = handles.planes[planeAxis];
      if (!corners || corners.some(point => !point.visible)) continue;
      gizmoSvg.append(createSvgElement(documentReference, 'polygon', {
        points: corners.map(point => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' '),
        fill: planeColors[planeAxis],
        'fill-opacity': '0.24',
        stroke: planeColors[planeAxis],
        'stroke-width': '1.2',
        'data-gizmo-axis': planeAxis,
      }));
    }
  }

  for (const axis of AXIS_NAMES) {
    const tip = handles.axes[axis];
    if (!tip.visible) continue;
    gizmoSvg.append(createSvgElement(documentReference, 'line', {
      x1: origin.x.toFixed(1),
      y1: origin.y.toFixed(1),
      x2: tip.x.toFixed(1),
      y2: tip.y.toFixed(1),
      stroke: AXIS_COLORS[axis],
      'stroke-width': '3',
      'stroke-linecap': 'round',
      'data-gizmo-axis': axis,
    }));
    if (tool === 'scale') {
      gizmoSvg.append(createSvgElement(documentReference, 'rect', {
        x: (tip.x - 6).toFixed(1),
        y: (tip.y - 6).toFixed(1),
        width: '12',
        height: '12',
        rx: '2',
        fill: AXIS_COLORS[axis],
        stroke: 'var(--studio-bg)',
        'stroke-width': '1.5',
        'data-gizmo-axis': axis,
      }));
    } else {
      gizmoSvg.append(createSvgElement(documentReference, 'circle', {
        cx: tip.x.toFixed(1),
        cy: tip.y.toFixed(1),
        r: '7',
        fill: AXIS_COLORS[axis],
        stroke: 'var(--studio-bg)',
        'stroke-width': '1.5',
        'data-gizmo-axis': axis,
      }));
    }
  }

  gizmoSvg.append(createSvgElement(documentReference, 'circle', {
    cx: origin.x.toFixed(1),
    cy: origin.y.toFixed(1),
    r: '6.5',
    fill: tool === 'snap' ? '#5fc48a' : 'var(--studio-text)',
    stroke: 'var(--studio-bg)',
    'stroke-width': '2',
    'data-gizmo-axis': tool === 'scale' ? 'uniform' : tool === 'snap' ? 'surface' : 'screen',
  }));
}

function buildPackReadyRecipe(recipe) {
  const cloned = structuredClone(recipe);
  const stripped = [];
  for (const field of ['motion', 'timeline', 'physics', 'cloth', 'particles', 'game', 'postPasses', 'armatures']) {
    if (cloned[field] !== undefined) {
      delete cloned[field];
      stripped.push(field);
    }
  }
  if (cloned.environment) {
    for (const envField of ['sky', 'hdri', 'spotLights', 'areaLights', 'shadowCascades', 'sunAngularRadius', 'lines']) {
      if (cloned.environment[envField] !== undefined) {
        delete cloned.environment[envField];
        stripped.push(`environment.${envField}`);
      }
    }
  }
  return { stillRecipe: cloned, stripped };
}

function depthSortedNodes(nodes) {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const ordered = [];
  const visited = new Set();
  function walk(parentId, depth) {
    for (const node of nodes) {
      if (node.assetPart || visited.has(node.id)) continue;
      if ((node.parent ?? null) !== parentId) continue;
      visited.add(node.id);
      ordered.push({ node, depth });
      walk(node.id, depth + 1);
    }
  }
  walk(null, 0);
  for (const node of nodes) {
    if (!node.assetPart && !visited.has(node.id)) {
      ordered.push({ node, depth: 0 });
    }
  }
  return ordered;
}

/**
 * Mounts Crucible Studio: 3-zone 3D editor with outliner, SVG 3D gizmos, 4-tab inspector, timeline and desktop IPC hooks.
 */
export function createStudio(container, {
  scene: suppliedScene,
  recipe: suppliedRecipe,
  template = 'showcase',
  canvas: suppliedCanvas,
  renderer: suppliedRenderer,
  rendererOptions = {},
  desktop = null,
  fileName: initialFileName = 'untitled.scene.json',
  homeHref = null,
  watchedPath: initialWatchedPath = null,
  onDirtyChange,
} = {}) {
  if (!container || typeof container.append !== 'function') {
    throw new TypeError('createStudio requires a DOM container element.');
  }
  const documentReference = container.ownerDocument;
  injectStudioStyles(documentReference);

  const initialRecipe = suppliedRecipe ?? (suppliedScene ? null : buildTemplateRecipe(template));
  const initialScene = suppliedScene ?? createAgentScene(initialRecipe);
  let handleChange = () => {};
  const controller = createStudioController({ scene: initialScene, onChange: detail => handleChange(detail) });

  let activeFilePath = initialWatchedPath;
  let activeFileName = initialFileName;
  let isDirty = false;
  let autoReloadWatch = true;
  let renderer = suppliedRenderer ?? null;
  let renderedScene = initialScene;
  let renderedTopology = initialScene.topologyRevision;
  let renderedShadowKey = null;
  let resizeObserver = null;
  let intersectionObserver = null;
  let frameHandle = 0;
  let playing = false;
  let lastFrameTime = 0;
  let isVisible = true;
  let insideDraw = false;
  let pointerState = null;
  let statusTimer = 0;
  let liveDeltaLabel = '';

  const root = createElement(documentReference, 'div', {
    className: 'crucible-studio',
    dataset: {
      desktop: desktop ? 'true' : 'false',
      outlinerCollapsed: 'false',
      inspectorCollapsed: 'false',
    },
  });
  // A slider or colour drag fires many input events; they are one undo step, closed by the change event.
  const isContinuousInput = target => target?.tagName === 'INPUT' && (target.type === 'range' || target.type === 'color');
  root.addEventListener('input', event => {
    if (isContinuousInput(event.target)) controller.beginUndoGroup();
  }, true);
  root.addEventListener('change', event => {
    if (isContinuousInput(event.target)) controller.endUndoGroup();
  });

  // Top Workspace Header Bar
  const filePill = createElement(documentReference, 'button', { type: 'button', className: 'crucible-studio-filepill', textContent: activeFileName, attributes: { popovertarget: 'crucible-studio-pop-new' } });
  const watchPill = createElement(documentReference, 'span', {
    className: 'crucible-studio-watch-pill',
    hidden: !activeFilePath,
    title: 'Reloads when the agent edits this file',
    attributes: { role: 'img', 'aria-label': 'Reloads when the agent edits this file' },
  });
  const openButton = createElement(documentReference, 'button', { type: 'button', textContent: 'Open…' });
  const saveButton = createElement(documentReference, 'button', { type: 'button', textContent: 'Save' });
  const saveAsButton = createElement(documentReference, 'button', { type: 'button', textContent: 'Save as…' });
  const addMenuButton = createIconButton(documentReference, 'add', 'Add an object or a light', { attributes: { popovertarget: 'crucible-studio-pop-add' } });
  const aiSyncMenuButton = createIconButton(documentReference, 'agent', 'Work with an AI agent', { attributes: { popovertarget: 'crucible-studio-pop-sync' } });
  const exportMenuButton = createElement(
    documentReference,
    'button',
    { type: 'button', className: 'crucible-studio-primary-btn', attributes: { popovertarget: 'crucible-studio-pop-export' } },
    createIcon(documentReference, 'export'),
    createElement(documentReference, 'span', { textContent: 'Export' }),
  );
  const shortcutsButton = createIconButton(documentReference, 'help', 'Keyboard shortcuts');

  const newPopover = createElement(documentReference, 'div', {
    id: 'crucible-studio-pop-new',
    className: 'crucible-studio-popover',
    attributes: { popover: 'auto' },
  });
  for (const [templateKey, spec] of Object.entries(STUDIO_TEMPLATES)) {
    const templateButton = createElement(documentReference, 'button', { type: 'button', textContent: spec.label, title: spec.description });
    templateButton.addEventListener('click', async () => {
      newPopover.hidePopover?.();
      const recipe = buildTemplateRecipe(templateKey);
      await loadAgentSceneModules(recipe);
      controller.loadRecipe(recipe);
      activeFilePath = null;
      activeFileName = `${templateKey}.scene.json`;
      isDirty = false;
      syncFileBanner();
      announce(`New ${spec.label}`);
    });
    newPopover.append(templateButton);
  }

  const addPopover = createElement(documentReference, 'div', {
    id: 'crucible-studio-pop-add',
    className: 'crucible-studio-popover',
    attributes: { popover: 'auto' },
  });
  const primitiveGrid = createElement(documentReference, 'div', { className: 'crucible-studio-popover-grid' });
  for (const primitiveType of STUDIO_PRIMITIVES) {
    const label = primitiveType === 'icoSphere' ? 'Icosphere' : primitiveType[0].toUpperCase() + primitiveType.slice(1);
    const addPrimitiveButton = createElement(documentReference, 'button', { type: 'button', textContent: label });
    addPrimitiveButton.addEventListener('click', async () => {
      addPopover.hidePopover?.();
      try {
        if (primitiveType === 'terrain') {
          await loadAgentSceneModules({ geometries: [{ type: 'terrain' }] });
        }
        const created = controller.addPrimitive(primitiveType);
        announce(`Added ${created.label}`);
      } catch (error) {
        announce(error.message);
      }
    });
    primitiveGrid.append(addPrimitiveButton);
  }
  const addPointLightButton = createElement(documentReference, 'button', { type: 'button', textContent: 'Point light' });
  const addSpotLightButton = createElement(documentReference, 'button', { type: 'button', textContent: 'Spot light' });
  addPointLightButton.addEventListener('click', () => {
    addPopover.hidePopover?.();
    try {
      const count = controller.addSceneLight('point');
      announce(`Point lights: ${count}`);
    } catch (error) {
      announce(error.message);
    }
  });
  addSpotLightButton.addEventListener('click', () => {
    addPopover.hidePopover?.();
    try {
      const count = controller.addSceneLight('spot');
      announce(`Spot lights: ${count}`);
    } catch (error) {
      announce(error.message);
    }
  });
  addPopover.append(primitiveGrid, addPointLightButton, addSpotLightButton);

  const syncStatusNote = createElement(documentReference, 'p', {
    className: 'crucible-studio-popover-note',
    textContent: activeFilePath ? `Watching: ${activeFilePath}` : 'Save the scene to a file and the agent can edit it while you watch.',
  });
  const autoReloadButton = createElement(documentReference, 'button', {
    type: 'button',
    textContent: 'Reload when the agent edits',
    attributes: { 'aria-pressed': 'true' },
  });
  autoReloadButton.addEventListener('click', () => {
    autoReloadWatch = !autoReloadWatch;
    autoReloadButton.setAttribute('aria-pressed', autoReloadWatch ? 'true' : 'false');
    announce(autoReloadWatch ? 'Auto-reload enabled' : 'Auto-reload paused');
  });
  const copyPromptButton = createElement(documentReference, 'button', { type: 'button', textContent: 'Copy a prompt for the agent' });
  copyPromptButton.addEventListener('click', async () => {
    aiSyncPopover.hidePopover?.();
    const target = activeFilePath ?? activeFileName;
    const promptText = `Edit Crucible scene "${target}" (format crucible.scene v1, currently at revision ${controller.scene.revision}, selected node: ${controller.selectedNodeId ?? 'none'}). Save JSON updates directly back to this path.`;
    try {
      await navigator.clipboard.writeText(promptText);
      announce('Copied AI prompt to clipboard');
    } catch {
      openImportDialog(promptText);
    }
  });
  const aiSyncPopover = createElement(documentReference, 'div', {
    id: 'crucible-studio-pop-sync',
    className: 'crucible-studio-popover',
    attributes: { popover: 'auto' },
  }, syncStatusNote, autoReloadButton, copyPromptButton);

  const exportPngButton = createElement(documentReference, 'button', { type: 'button', textContent: 'PNG image' });
  const exportGlbButton = createElement(documentReference, 'button', { type: 'button', textContent: 'GLB model' });
  const exportPackButton = createElement(documentReference, 'button', { type: 'button', textContent: 'Web pack' });
  const editJsonButton = createElement(documentReference, 'button', { type: 'button', textContent: 'Recipe JSON' });
  const exportPopover = createElement(documentReference, 'div', {
    id: 'crucible-studio-pop-export',
    className: 'crucible-studio-popover',
    attributes: { popover: 'auto' },
  }, exportPngButton, exportGlbButton, exportPackButton);
  newPopover.prepend(
    openButton,
    saveButton,
    saveAsButton,
    editJsonButton,
    createElement(documentReference, 'p', { className: 'crucible-studio-popover-note', textContent: 'New scene' }),
  );
  for (const popoverElement of [newPopover, addPopover, exportPopover]) {
    popoverElement.addEventListener('click', event => {
      if (event.target.closest?.('button')) popoverElement.hidePopover?.();
    });
  }

  const menubarElement = createElement(
    documentReference,
    'header',
    { className: 'crucible-studio-menubar', attributes: { 'aria-label': 'Studio' } },
    createElement(
      documentReference,
      'div',
      { className: 'crucible-studio-island' },
      createElement(
        documentReference,
        homeHref ? 'a' : 'span',
        homeHref
          ? { className: 'crucible-studio-brand', href: homeHref, attributes: { 'aria-label': 'Crucible home' } }
          : { className: 'crucible-studio-brand' },
        buildBrandMarkSvg(documentReference),
      ),
      filePill,
      watchPill,
    ),
    createElement(documentReference, 'span', { className: 'crucible-studio-spacer' }),
    createElement(documentReference, 'div', { className: 'crucible-studio-island' }, aiSyncMenuButton, shortcutsButton, exportMenuButton),
    newPopover,
    addPopover,
    aiSyncPopover,
    exportPopover,
  );

  function bindPopoverAnchor(triggerButton, popoverElement, { beside = false } = {}) {
    popoverElement.addEventListener('beforetoggle', event => {
      if (event.newState !== 'open') return;
      const rectangle = triggerButton.getBoundingClientRect();
      const viewportWidth = documentReference.defaultView?.innerWidth ?? 1280;
      const viewportHeight = documentReference.defaultView?.innerHeight ?? 800;
      const wantedLeft = beside ? rectangle.right + 16 : rectangle.left - 5;
      const wantedTop = beside ? rectangle.top - 8 : rectangle.bottom + 14;
      const clampedLeft = Math.max(8, Math.min(wantedLeft, Math.max(8, viewportWidth - 256)));
      const clampedTop = Math.max(8, Math.min(wantedTop, Math.max(8, viewportHeight - 300)));
      // A trigger in the right half opens towards the left, so the menu never leaves the window.
      const opensLeftward = !beside && rectangle.left > viewportWidth / 2;
      popoverElement.style.left = opensLeftward ? 'auto' : `${Math.round(clampedLeft)}px`;
      popoverElement.style.right = opensLeftward ? `${Math.round(Math.max(8, viewportWidth - rectangle.right - 5))}px` : 'auto';
      popoverElement.style.top = `${Math.round(clampedTop)}px`;
    });
  }
  bindPopoverAnchor(filePill, newPopover);
  bindPopoverAnchor(addMenuButton, addPopover, { beside: true });
  bindPopoverAnchor(aiSyncMenuButton, aiSyncPopover);
  bindPopoverAnchor(exportMenuButton, exportPopover);

  // Left Outliner + Material Palette Dock
  const outlinerSearch = createElement(documentReference, 'input', { type: 'search', placeholder: 'Filter', attributes: { 'aria-label': 'Filter the scene list' } });
  const outlinerTree = createElement(documentReference, 'div', { className: 'crucible-studio-tree', attributes: { role: 'tree', 'aria-label': 'Scene hierarchy' } });
  const swatchContainer = createElement(documentReference, 'div', { className: 'crucible-studio-swatches' });
  const newMaterialQuickButton = createIconButton(documentReference, 'add', 'New material', { className: 'crucible-studio-swatch-add' });
  newMaterialQuickButton.addEventListener('click', () => {
    const created = controller.createMaterial({ assignToNodeId: controller.selectedNodeId });
    selectInspectorTab('material');
    announce(`Created ${created.id}`);
  });

  const outlinerDock = createElement(
    documentReference,
    'aside',
    { className: 'crucible-studio-dock crucible-studio-outliner', attributes: { 'aria-label': 'Scene outliner' } },
    createElement(documentReference, 'div', { className: 'crucible-studio-dock-head' }, createElement(documentReference, 'span', { textContent: 'Scene' }), outlinerSearch),
    outlinerTree,
    createElement(documentReference, 'div', { className: 'crucible-studio-palette-section' }, swatchContainer),
  );
  outlinerSearch.addEventListener('input', () => syncUi());

  // Center Viewport
  const viewportElement = createElement(documentReference, 'div', { className: 'crucible-studio-viewport' });
  const canvas = suppliedCanvas ?? createElement(documentReference, 'canvas', {
    className: 'crucible-studio-canvas',
    tabIndex: 0,
    attributes: { 'aria-label': '3D viewport. Click to select, drag to orbit, scroll to zoom.' },
  });
  if (!canvas.id) {
    canvas.id = `crucible-studio-canvas-${Math.random().toString(36).slice(2, 8)}`;
  }
  const gizmoSvg = createSvgElement(documentReference, 'svg', { class: 'crucible-studio-gizmo', 'aria-hidden': 'true' });
  const statusRegion = createElement(documentReference, 'p', { className: 'crucible-studio-status', attributes: { role: 'status' } });
  const hintBar = createElement(documentReference, 'div', { className: 'crucible-studio-hintbar' });
  const dropOverlay = createElement(documentReference, 'div', { className: 'crucible-studio-drop-overlay', textContent: 'Drop a scene.json to open it' });

  function announce(message) {
    statusRegion.textContent = message;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      statusRegion.textContent = '';
    }, 3400);
  }

  // Viewport Top-Left Toolbar (Modern Web Guidance: toolbar pattern)
  const toolLabels = { select: 'Select', translate: 'Move', rotate: 'Rotate', scale: 'Scale', snap: 'Snap' };
  const toolShortcuts = { select: 'Q', translate: 'G', rotate: 'R', scale: 'S', snap: 'T' };
  const toolButtons = STUDIO_TOOLS.map(tool => createIconButton(documentReference, tool, `${toolLabels[tool]} (${toolShortcuts[tool]})`, {
    dataset: { tool },
    attributes: { 'aria-pressed': tool === controller.tool ? 'true' : 'false' },
  }));
  toolButtons.forEach(button => {
    button.addEventListener('click', () => controller.setTool(button.dataset.tool));
  });

  const undoButton = createIconButton(documentReference, 'undo', 'Undo (Ctrl+Z)', { attributes: { 'aria-disabled': 'true' } });
  const redoButton = createIconButton(documentReference, 'redo', 'Redo (Ctrl+Shift+Z)', { attributes: { 'aria-disabled': 'true' } });
  const duplicateButton = createIconButton(documentReference, 'duplicate', 'Duplicate (Ctrl+D)');
  const deleteButton = createIconButton(documentReference, 'remove', 'Delete (Del)');
  const frameButton = createIconButton(documentReference, 'frame', 'Frame in view (F)');
  const toggleDocksButton = createIconButton(documentReference, 'panels', 'Show or hide the panels', { attributes: { 'aria-pressed': 'true' } });

  undoButton.addEventListener('click', () => {
    if (undoButton.getAttribute('aria-disabled') === 'true') return;
    if (controller.undo()) announce('Undid edit');
  });
  redoButton.addEventListener('click', () => {
    if (redoButton.getAttribute('aria-disabled') === 'true') return;
    if (controller.redo()) announce('Redid edit');
  });
  duplicateButton.addEventListener('click', () => {
    if (duplicateButton.getAttribute('aria-disabled') === 'true') return;
    try {
      const cloned = controller.duplicateSelected();
      announce(`Duplicated to ${cloned.label}`);
    } catch (error) {
      announce(error.message);
    }
  });
  deleteButton.addEventListener('click', () => {
    if (deleteButton.getAttribute('aria-disabled') === 'true') return;
    try {
      controller.deleteSelected();
      announce('Deleted node');
    } catch (error) {
      announce(error.message);
    }
  });
  frameButton.addEventListener('click', () => {
    controller.frameSelection();
    announce('Framed selection');
  });
  toggleDocksButton.addEventListener('click', () => {
    const collapsed = root.dataset.outlinerCollapsed === 'true' && root.dataset.inspectorCollapsed === 'true';
    setOutlinerCollapsed(!collapsed);
    setInspectorCollapsed(!collapsed);
  });

  const toolbarElement = createElement(
    documentReference,
    'div',
    {
      className: 'crucible-studio-toolbar crucible-studio-island',
      attributes: { role: 'toolbar', focusgroup: 'toolbar wrap', 'aria-orientation': 'vertical', 'aria-label': 'Tools', 'aria-controls': canvas.id },
    },
    createElement(documentReference, 'div', { className: 'crucible-studio-group', attributes: { role: 'group', 'aria-label': 'Transform tool' } }, ...toolButtons),
    createElement(documentReference, 'div', { className: 'crucible-studio-group', attributes: { role: 'group', 'aria-label': 'History' } }, undoButton, redoButton),
    createElement(documentReference, 'div', { className: 'crucible-studio-group', attributes: { role: 'group', 'aria-label': 'Scene' } }, addMenuButton, toggleDocksButton),
  );
  wireRovingFocusFallback(toolbarElement, [...toolButtons, undoButton, redoButton, addMenuButton, toggleDocksButton], { vertical: true });

  // Viewport Top-Right 3D View Widget
  const viewPresetButtons = ['front', 'right', 'top', 'isometric'].map(preset => {
    const shortLabels = { front: 'Front', right: 'Right', top: 'Top', isometric: 'Iso' };
    const button = createElement(documentReference, 'button', { type: 'button', textContent: shortLabels[preset] });
    button.addEventListener('click', () => {
      controller.setCameraViewPreset(preset);
      announce(`${shortLabels[preset]} view`);
    });
    return button;
  });
  const projectionPillButton = createElement(documentReference, 'button', { type: 'button', textContent: 'Perspective', attributes: { 'aria-pressed': 'false' } });
  projectionPillButton.addEventListener('click', () => {
    const camera = controller.toggleCameraProjection();
    announce(camera.projection === 'orthographic' ? 'Orthographic view' : 'Perspective view');
  });
  const viewCubeElement = createElement(
    documentReference,
    'div',
    { className: 'crucible-studio-viewcube', attributes: { role: 'group', 'aria-label': 'Camera view presets' } },
    createElement(documentReference, 'div', { className: 'crucible-studio-viewcube-row' }, ...viewPresetButtons),
    projectionPillButton,
  );

  viewportElement.append(canvas, gizmoSvg, hintBar, statusRegion, dropOverlay);

  // Right 4-Tab Inspector Dock (Modern Web Guidance: tabs pattern)
  const tabLabels = { node: 'Object', material: 'Material', look: 'Look', camera: 'Camera' };
  const tabButtons = STUDIO_TABS.map(tab => createIconButton(documentReference, tab, tabLabels[tab], {
    id: `crucible-studio-tab-${tab}`,
    dataset: { tab },
    attributes: {
      'aria-selected': tab === controller.activeTab ? 'true' : 'false',
      ...(tab === controller.activeTab ? { focusgroupstart: '' } : {}),
    },
  }));
  const tabListElement = createElement(
    documentReference,
    'div',
    { className: 'crucible-studio-tablist', attributes: { focusgroup: 'tablist nomemory', 'aria-label': 'Inspector tabs' } },
    ...tabButtons,
  );
  if (!('focusGroup' in HTMLElement.prototype)) {
    tabListElement.setAttribute('role', 'tablist');
    tabButtons.forEach(button => button.setAttribute('role', 'tab'));
  }

  // Tab 1: Object Panel
  const nodeLabelInput = createElement(documentReference, 'input', { type: 'text', placeholder: 'Node label', attributes: { 'aria-label': 'Node label' } });
  const nodeParentSelect = createElement(documentReference, 'select', { attributes: { 'aria-label': 'Parent node' } });
  const visibleToggle = createIconButton(documentReference, 'eye', 'Hide');
  const castShadowToggle = createElement(documentReference, 'button', { type: 'button', textContent: 'Casts shadow', attributes: { 'aria-pressed': 'true' } });
  const receiveShadowToggle = createElement(documentReference, 'button', { type: 'button', textContent: 'Receives shadow', attributes: { 'aria-pressed': 'true' } });

  nodeLabelInput.addEventListener('change', () => {
    if (controller.selectedNodeId) controller.updateNodeTransform(controller.selectedNodeId, { label: nodeLabelInput.value });
  });
  nodeParentSelect.addEventListener('change', () => {
    if (!controller.selectedNodeId) return;
    try {
      controller.updateNodeTransform(controller.selectedNodeId, { parent: nodeParentSelect.value || null });
    } catch (error) {
      announce(error.message);
      syncUi();
    }
  });
  visibleToggle.addEventListener('click', () => {
    if (!controller.selectedNodeId) return;
    const node = controller.exportRecipe().nodes.find(candidate => candidate.id === controller.selectedNodeId);
    controller.updateNodeTransform(controller.selectedNodeId, { visible: !(node?.visible ?? true) });
  });
  castShadowToggle.addEventListener('click', () => {
    if (!controller.selectedNodeId) return;
    const node = controller.exportRecipe().nodes.find(candidate => candidate.id === controller.selectedNodeId);
    controller.updateNodeTransform(controller.selectedNodeId, { castShadow: !(node?.castShadow ?? true) });
  });
  receiveShadowToggle.addEventListener('click', () => {
    if (!controller.selectedNodeId) return;
    const node = controller.exportRecipe().nodes.find(candidate => candidate.id === controller.selectedNodeId);
    controller.updateNodeTransform(controller.selectedNodeId, { receiveShadow: !(node?.receiveShadow ?? true) });
  });

  const positionRow = createVectorRow(documentReference, 'Position', values => {
    if (controller.selectedNodeId) controller.updateNodeTransform(controller.selectedNodeId, { translation: values });
  }, { sensitivity: 0.015 });
  const rotationRow = createVectorRow(documentReference, 'Rotation °', values => {
    if (controller.selectedNodeId) controller.updateNodeTransform(controller.selectedNodeId, { rotationDegrees: values });
  }, { sensitivity: 0.5 });
  const scaleRow = createVectorRow(documentReference, 'Scale', values => {
    if (controller.selectedNodeId && values.every(component => component > 0.001)) {
      controller.updateNodeTransform(controller.selectedNodeId, { scale: values });
    }
  }, { sensitivity: 0.01, minimumComponent: 0.02, lockToggle: true });

  const nodePanelBody = createElement(
    documentReference,
    'div',
    { className: 'crucible-studio-panel-body' },
    createElement(documentReference, 'div', { className: 'crucible-studio-name-row' }, nodeLabelInput, visibleToggle, frameButton, duplicateButton, deleteButton),
    createElement(documentReference, 'div', { className: 'crucible-studio-field' }, createElement(documentReference, 'span', { className: 'crucible-studio-field-head', textContent: 'Parent' }), nodeParentSelect),
    positionRow.container,
    rotationRow.container,
    scaleRow.container,
    createElement(documentReference, 'div', { className: 'crucible-studio-chips' }, castShadowToggle, receiveShadowToggle),
  );

  // Tab 2: Material Panel
  const materialSelect = createElement(documentReference, 'select', { attributes: { 'aria-label': 'Assigned material' } });
  materialSelect.addEventListener('change', () => {
    if (controller.selectedNodeId && materialSelect.value) {
      try {
        controller.assignNodeMaterial(controller.selectedNodeId, materialSelect.value);
      } catch (error) {
        announce(error.message);
      }
    }
  });
  const materialPresetChips = Object.entries(STUDIO_MATERIAL_PRESETS).map(([presetKey, preset]) => {
    const button = createElement(documentReference, 'button', { type: 'button', textContent: preset.label, dataset: { preset: presetKey } });
    button.addEventListener('click', () => {
      const targetNode = controller.exportRecipe().nodes.find(candidate => candidate.id === controller.selectedNodeId);
      const materialId = targetNode?.material ?? materialSelect.value;
      if (materialId) {
        controller.applyMaterialPreset(materialId, presetKey);
        announce(`Applied ${preset.label} preset`);
      }
    });
    return button;
  });
  const activeMaterialId = () => {
    const selected = controller.exportRecipe().nodes.find(candidate => candidate.id === controller.selectedNodeId);
    return selected?.material ?? materialSelect.value;
  };
  const colorInput = createElement(documentReference, 'input', { type: 'color', value: '#cccccc', attributes: { 'aria-label': 'Base color' } });
  const emissiveColorInput = createElement(documentReference, 'input', { type: 'color', value: '#000000', attributes: { 'aria-label': 'Emissive color' } });
  colorInput.addEventListener('input', () => {
    const materialId = activeMaterialId();
    if (materialId) controller.updateMaterial(materialId, { hexColor: colorInput.value });
  });
  emissiveColorInput.addEventListener('input', () => {
    const materialId = activeMaterialId();
    if (materialId) controller.updateMaterial(materialId, { emissiveHex: emissiveColorInput.value });
  });
  const roughnessField = createSliderField(documentReference, 'Roughness', { min: 0.02, max: 1, step: 0.02, value: 0.5 }, value => {
    const materialId = activeMaterialId();
    if (materialId) controller.updateMaterial(materialId, { roughness: value });
  });
  const metallicField = createSliderField(documentReference, 'Metallic', { min: 0, max: 1, step: 0.02, value: 0 }, value => {
    const materialId = activeMaterialId();
    if (materialId) controller.updateMaterial(materialId, { metallic: value });
  });
  const clearcoatField = createSliderField(documentReference, 'Clearcoat', { min: 0, max: 1, step: 0.02, value: 0 }, value => {
    const materialId = activeMaterialId();
    if (materialId) controller.updateMaterial(materialId, { clearcoat: value, clearcoatRoughness: 0.08 });
  });
  const opacityField = createSliderField(documentReference, 'Opacity', { min: 0.05, max: 1, step: 0.02, value: 1 }, value => {
    const materialId = activeMaterialId();
    if (materialId) controller.updateMaterial(materialId, { opacity: value });
  });
  const emissionField = createSliderField(documentReference, 'Emission', { min: 0, max: 12, step: 0.1, value: 0 }, value => {
    const materialId = activeMaterialId();
    if (materialId) controller.updateMaterial(materialId, { emission: value });
  });
  const materialPanelBody = createElement(
    documentReference,
    'div',
    { className: 'crucible-studio-panel-body' },
    createElement(documentReference, 'div', { className: 'crucible-studio-field' }, createElement(documentReference, 'span', { className: 'crucible-studio-field-head', textContent: 'Material' }), materialSelect),
    createElement(documentReference, 'div', { className: 'crucible-studio-field' }, createElement(documentReference, 'span', { className: 'crucible-studio-field-head', textContent: 'Presets' }), createElement(documentReference, 'div', { className: 'crucible-studio-chips' }, ...materialPresetChips)),
    createElement(documentReference, 'div', { className: 'crucible-studio-field' }, createElement(documentReference, 'span', { className: 'crucible-studio-field-head', textContent: 'Color' }), colorInput),
    roughnessField.container,
    metallicField.container,
    clearcoatField.container,
    opacityField.container,
    emissionField.container,
    createElement(documentReference, 'div', { className: 'crucible-studio-field' }, createElement(documentReference, 'span', { className: 'crucible-studio-field-head', textContent: 'Glow color' }), emissiveColorInput),
  );

  // Tab 3: Look Panel
  const setupButtons = LIGHTING_SETUP_NAMES.map(setup => {
    const button = createElement(documentReference, 'button', { type: 'button', textContent: setup, dataset: { setup }, attributes: { 'aria-pressed': 'false' } });
    button.addEventListener('click', () => controller.updateLook({ environment: { setup } }));
    return button;
  });
  const sunPad = createSunPad(documentReference, angles => controller.setSunAngles(angles), {
    onDragStart: () => controller.beginUndoGroup(),
    onDragEnd: () => controller.endUndoGroup(),
  });
  const keyIntensityField = createSliderField(documentReference, 'Sun strength', { min: 0, max: 8, step: 0.1, value: 1.7 }, value => controller.updateLook({ environment: { keyIntensity: value } }));
  const exposureField = createSliderField(documentReference, 'Exposure', { min: 0.2, max: 3, step: 0.05, value: 1 }, value => controller.updateLook({ effects: { exposure: value } }));
  const contrastField = createSliderField(documentReference, 'Contrast', { min: 0.4, max: 1.8, step: 0.02, value: 1 }, value => controller.updateLook({ effects: { contrast: value } }));
  const saturationField = createSliderField(documentReference, 'Saturation', { min: 0, max: 2, step: 0.02, value: 1 }, value => controller.updateLook({ effects: { saturation: value } }));
  const viewTransformSelect = createElement(
    documentReference,
    'select',
    { attributes: { 'aria-label': 'View transform' } },
    ...VIEW_TRANSFORM_NAMES.map(name => createElement(documentReference, 'option', { value: name, textContent: name })),
  );
  viewTransformSelect.addEventListener('change', async () => {
    const viewTransform = viewTransformSelect.value;
    await loadAgentSceneModules({ environment: { viewTransform } });
    controller.updateLook({ environment: { viewTransform } });
  });
  const bloomField = createSliderField(documentReference, 'Bloom', { min: 0, max: 1, step: 0.02, value: 0.1 }, value => controller.updateLook({ effects: { bloom: { strength: value } } }));
  const fogField = createSliderField(documentReference, 'Fog', { min: 0, max: 0.1, step: 0.002, value: 0 }, value => controller.updateLook({ environment: { fogDensity: value } }));

  const lookPanelBody = createElement(
    documentReference,
    'div',
    { className: 'crucible-studio-panel-body' },
    createElement(documentReference, 'div', { className: 'crucible-studio-field' }, createElement(documentReference, 'span', { className: 'crucible-studio-field-head', textContent: 'Lighting' }), createElement(documentReference, 'div', { className: 'crucible-studio-chips' }, ...setupButtons)),
    createElement(documentReference, 'div', { className: 'crucible-studio-field' }, createElement(documentReference, 'span', { className: 'crucible-studio-field-head', textContent: 'Sun' }), sunPad.element),
    keyIntensityField.container,
    createElement(documentReference, 'div', { className: 'crucible-studio-field' }, createElement(documentReference, 'span', { className: 'crucible-studio-field-head', textContent: 'Color look' }), viewTransformSelect),
    exposureField.container,
    contrastField.container,
    saturationField.container,
    bloomField.container,
    fogField.container,
  );

  // Tab 4: Camera Panel
  const lensChips = STUDIO_LENS_PRESETS.map(millimetres => {
    const button = createElement(documentReference, 'button', { type: 'button', textContent: `${millimetres}mm`, dataset: { focal: String(millimetres) }, attributes: { 'aria-pressed': 'false' } });
    button.addEventListener('click', () => controller.setCameraLensMillimetres(millimetres));
    return button;
  });
  const fovField = createSliderField(documentReference, 'Field of view', { min: 15, max: 110, step: 1, value: 45 }, value => controller.updateCamera({ fov: value }));
  const orthoScaleField = createSliderField(documentReference, 'Orthographic size', { min: 1, max: 40, step: 0.5, value: 6 }, value => controller.updateCamera({ projection: 'orthographic', orthoScale: value }));
  const bookmarkNameInput = createElement(documentReference, 'input', { type: 'text', placeholder: 'Shot name', attributes: { 'aria-label': 'Shot name', maxlength: '24' } });
  const saveBookmarkButton = createElement(documentReference, 'button', { type: 'button', textContent: 'Save shot' });
  const bookmarkListElement = createElement(documentReference, 'div', { className: 'crucible-studio-field' });
  saveBookmarkButton.addEventListener('click', async () => {
    const name = bookmarkNameInput.value.trim().replace(/\s+/g, '-') || `shot-${controller.listBookmarks().length + 1}`;
    try {
      await loadAgentSceneModules({ timeline: { shots: [] } });
      controller.saveBookmark(name);
      bookmarkNameInput.value = '';
      announce(`Saved view ${name}`);
    } catch (error) {
      announce(error.message);
    }
  });
  const cameraPanelBody = createElement(
    documentReference,
    'div',
    { className: 'crucible-studio-panel-body' },
    viewCubeElement,
    createElement(documentReference, 'div', { className: 'crucible-studio-field' }, createElement(documentReference, 'span', { className: 'crucible-studio-field-head', textContent: 'Lens' }), createElement(documentReference, 'div', { className: 'crucible-studio-chips' }, ...lensChips)),
    fovField.container,
    orthoScaleField.container,
    createElement(documentReference, 'div', { className: 'crucible-studio-field' }, createElement(documentReference, 'span', { className: 'crucible-studio-field-head', textContent: 'Shots' }), createElement(documentReference, 'div', { className: 'crucible-studio-bookmark-row' }, bookmarkNameInput, saveBookmarkButton), bookmarkListElement),
  );

  const panelsByTab = {
    node: createElement(documentReference, 'div', { id: 'crucible-studio-panel-node', tabIndex: 0, attributes: { role: 'tabpanel', 'aria-labelledby': 'crucible-studio-tab-node' } }, nodePanelBody),
    material: createElement(documentReference, 'div', { id: 'crucible-studio-panel-material', attributes: { role: 'tabpanel', 'aria-labelledby': 'crucible-studio-tab-material', hidden: 'until-found' } }, materialPanelBody),
    look: createElement(documentReference, 'div', { id: 'crucible-studio-panel-look', attributes: { role: 'tabpanel', 'aria-labelledby': 'crucible-studio-tab-look', hidden: 'until-found' } }, lookPanelBody),
    camera: createElement(documentReference, 'div', { id: 'crucible-studio-panel-camera', attributes: { role: 'tabpanel', 'aria-labelledby': 'crucible-studio-tab-camera', hidden: 'until-found' } }, cameraPanelBody),
  };

  function selectInspectorTab(nextTab) {
    controller.setActiveTab(nextTab);
    for (const button of tabButtons) {
      const selected = button.dataset.tab === nextTab;
      button.setAttribute('aria-selected', selected ? 'true' : 'false');
      button.toggleAttribute('focusgroupstart', selected);
    }
    for (const [tab, panel] of Object.entries(panelsByTab)) {
      if (tab === nextTab) {
        panel.removeAttribute('hidden');
        panel.tabIndex = 0;
      } else {
        panel.setAttribute('hidden', 'until-found');
        panel.removeAttribute('tabindex');
      }
    }
  }
  tabButtons.forEach(button => {
    button.addEventListener('click', () => selectInspectorTab(button.dataset.tab));
  });
  for (const [tab, panel] of Object.entries(panelsByTab)) {
    panel.addEventListener('beforematch', () => selectInspectorTab(tab));
  }
  wireRovingFocusFallback(tabListElement, tabButtons, {
    followFocus: true,
    onSelect: button => selectInspectorTab(button.dataset.tab),
  });

  const inspectorElement = createElement(
    documentReference,
    'aside',
    { className: 'crucible-studio-dock crucible-studio-inspector', attributes: { 'aria-label': 'Scene inspector' } },
    tabListElement,
    createElement(documentReference, 'div', { className: 'crucible-studio-panels' }, panelsByTab.node, panelsByTab.material, panelsByTab.look, panelsByTab.camera),
  );

  // Bottom Timeline & Telemetry Bar
  const playButton = createIconButton(documentReference, 'play', 'Play (Space)', { attributes: { 'aria-pressed': 'false' } });
  const keyframeButton = createIconButton(documentReference, 'keyframe', 'Add a keyframe here (K)');
  const timeOutput = createElement(documentReference, 'output', { textContent: '0.00 s' });
  const scrubInput = createElement(documentReference, 'input', { type: 'range', min: '0', max: '4', step: '0.02', value: '0', attributes: { 'aria-label': 'Timeline scrub' } });
  const quickBookmarksRow = createElement(documentReference, 'div', { className: 'crucible-studio-shots' });
  const fileInput = createElement(documentReference, 'input', { type: 'file', accept: '.json,application/json', hidden: true });

  playButton.addEventListener('click', () => {
    if (!hasAnimatedData(controller.exportRecipe())) {
      announce('Add a keyframe first (K)');
      return;
    }
    playing = !playing;
    lastFrameTime = 0;
    playButton.setAttribute('aria-pressed', playing ? 'true' : 'false');
    setButtonIcon(playButton, playing ? 'pause' : 'play', playing ? 'Pause (Space)' : 'Play (Space)');
    if (playing) requestFrame();
  });
  keyframeButton.addEventListener('click', async () => {
    try {
      await loadAgentSceneModules({ motion: { duration: 1, tracks: [] } });
      controller.insertNodeKeyframe();
      announce(`Keyframed at ${controller.motionTime.toFixed(2)} s`);
    } catch (error) {
      announce(error.message);
    }
  });
  scrubInput.addEventListener('input', () => {
    const seconds = Number(scrubInput.value);
    if (hasAnimatedData(controller.exportRecipe())) {
      controller.setMotionTime(seconds);
    }
  });

  const bottomElement = createElement(
    documentReference,
    'footer',
    { className: 'crucible-studio-bottombar crucible-studio-island', attributes: { 'aria-label': 'Timeline' } },
    createElement(documentReference, 'div', { className: 'crucible-studio-scrub' }, playButton, keyframeButton, scrubInput, timeOutput),
    quickBookmarksRow,
  );

  // Native Dialogs (Modern Web Guidance: native <dialog>, aria-labelledby, form method="dialog", returnValue reset)
  const dialogHeading = createElement(documentReference, 'h2', { id: 'crucible-studio-json-title', textContent: 'Recipe JSON' });
  const dialogTextarea = createElement(documentReference, 'textarea', { rows: 14, autofocus: true, attributes: { 'aria-label': 'Scene recipe JSON' } });
  const dialogFileButton = createElement(documentReference, 'button', { type: 'button', textContent: 'Load file…' });
  const dialogCloseButton = createElement(documentReference, 'button', { type: 'submit', value: 'close', textContent: 'Close' });
  const dialogApplyButton = createElement(documentReference, 'button', { type: 'button', className: 'crucible-studio-primary-btn', textContent: 'Apply JSON' });
  const recipeDialog = createElement(
    documentReference,
    'dialog',
    { attributes: { 'aria-labelledby': 'crucible-studio-json-title', closedby: 'any' } },
    dialogHeading,
    dialogTextarea,
    createElement(documentReference, 'form', { method: 'dialog', className: 'crucible-studio-dialog-actions' }, dialogFileButton, dialogCloseButton, dialogApplyButton),
  );
  recipeDialog.addEventListener('close', () => {
    recipeDialog.returnValue = '';
  });

  function openImportDialog(initialText = '') {
    dialogTextarea.value = initialText || JSON.stringify(controller.exportRecipe(), null, 2);
    recipeDialog.showModal();
  }

  dialogFileButton.addEventListener('click', () => {
    recipeDialog.close('file');
    fileInput.click();
  });
  dialogApplyButton.addEventListener('click', async () => {
    try {
      const parsed = JSON.parse(dialogTextarea.value);
      await loadAgentSceneModules(parsed);
      controller.loadRecipe(parsed);
      recipeDialog.close('apply');
      announce('Recipe applied');
    } catch (error) {
      announce(error.message);
    }
  });

  const shortcutsHeading = createElement(documentReference, 'h2', { id: 'crucible-studio-shortcuts-title', textContent: 'Studio keyboard shortcuts' });
  const shortcutEntries = [
    ['Q', 'Select tool'],
    ['G / R / S / T', 'Move / Rotate / Scale / Snap'],
    ['F', 'Frame selected node'],
    ['5 / Numpad 5', 'Perspective or Orthographic'],
    ['Shift + Gizmo drag', 'Snap angle (15°) or step (0.25 m)'],
    ['Drag X / Y / Z label', 'Scrub vector number smoothly'],
    ['Ctrl+D / Delete', 'Duplicate or delete selected'],
    ['Ctrl+Z / Shift+Z', 'Undo / Redo edit'],
    ['Space / K', 'Play animation / Insert keyframe'],
    ['Ctrl+O / Ctrl+S', 'Open or Save recipe JSON'],
  ];
  const shortcutsGrid = createElement(
    documentReference,
    'div',
    { className: 'crucible-studio-shortcuts' },
    ...shortcutEntries.map(([keys, label]) => createElement(
      documentReference,
      'div',
      { className: 'crucible-studio-shortcut-item' },
      createElement(documentReference, 'span', { textContent: label }),
      createElement(documentReference, 'kbd', { textContent: keys }),
    )),
  );
  const shortcutsCloseButton = createElement(documentReference, 'button', { type: 'submit', value: 'close', autofocus: true, textContent: 'Done' });
  const shortcutsDialog = createElement(
    documentReference,
    'dialog',
    { attributes: { 'aria-labelledby': 'crucible-studio-shortcuts-title', closedby: 'any' } },
    shortcutsHeading,
    shortcutsGrid,
    createElement(documentReference, 'form', { method: 'dialog', className: 'crucible-studio-dialog-actions' }, shortcutsCloseButton),
  );
  shortcutsDialog.addEventListener('close', () => {
    shortcutsDialog.returnValue = '';
  });
  shortcutsButton.addEventListener('click', () => shortcutsDialog.showModal());

  root.append(viewportElement, menubarElement, toolbarElement, outlinerDock, inspectorElement, bottomElement, fileInput, recipeDialog, shortcutsDialog);
  container.append(root);

  function syncFileBanner() {
    filePill.textContent = activeFileName;
    filePill.dataset.dirty = isDirty ? 'true' : 'false';
    filePill.title = isDirty ? `${activeFileName} has changes that are not saved` : activeFileName;
    filePill.title = activeFilePath ?? activeFileName;
    watchPill.hidden = !activeFilePath;
    syncStatusNote.textContent = activeFilePath
      ? `Watching ${activeFilePath} (${autoReloadWatch ? 'auto-reload on' : 'paused'}).`
      : 'Save the scene to a file and the agent can edit it while you watch.';
    if (onDirtyChange) {
      onDirtyChange({ filePath: activeFilePath, fileName: activeFileName, dirty: isDirty });
    }
  }

  function triggerBlobDownload(bytes, filename, mimeType) {
    const blob = new Blob([bytes], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = createElement(documentReference, 'a', { href: url, download: filename });
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function capturePngDataUrl() {
    renderPass();
    return canvas.toDataURL('image/png');
  }

  function exportGlbBytes() {
    return exportGlb(controller.scene.parts);
  }

  async function buildWebPackPayload() {
    const { stillRecipe, stripped } = buildPackReadyRecipe(controller.exportRecipe());
    await loadAgentSceneModules(stillRecipe);
    const stillScene = createAgentScene(stillRecipe);
    const environment = stillScene.environment;
    const shaderModules = agentSceneModulesNeeded(stillRecipe).filter(name => Object.hasOwn(PACK_SHADER_MODULES, name));
    for (const moduleName of agentSceneModulesNeeded(stillRecipe)) {
      if (Object.hasOwn(PACK_UNSUPPORTED_MODULES, moduleName)) {
        stripped.push(PACK_UNSUPPORTED_MODULES[moduleName]);
      }
    }
    const packBytes = encodePack({
      shaderModules,
      camera: stillScene.camera,
      environment,
      effects: stillScene.effects,
      shadowBounds: resolveAgentShadow(fitAgentShadow(stillScene.shadow, stillScene.parts), environment.lightDirection),
      parts: stillScene.parts.map(part => ({
        name: part.name,
        geometry: part.geometry,
        material: part.material,
        matrix: part.matrix,
      })),
    });
    const posterDataUrl = capturePngDataUrl();
    const title = activeFileName.replace(/\.(scene\.)?json$/i, '') || 'Crucible scene';
    return { packBytes, posterDataUrl, title, stripped };
  }

  async function loadExternalTextFile(text, { filePath = null, fileName = 'scene.json', recordUndo = true } = {}) {
    const parsed = JSON.parse(text);
    await loadAgentSceneModules(parsed);
    controller.loadRecipe(parsed, { recordUndo });
    activeFilePath = filePath;
    activeFileName = fileName;
    isDirty = false;
    syncFileBanner();
  }

  async function performOpenFile() {
    if (desktop?.openFile) {
      const picked = await desktop.openFile();
      if (!picked || picked.canceled) return;
      try {
        await loadExternalTextFile(picked.text, { filePath: picked.filePath, fileName: picked.fileName });
        announce(`Opened ${picked.fileName}`);
      } catch (error) {
        announce(error.message);
      }
      return;
    }
    fileInput.click();
  }

  async function performSaveFile({ forceAs = false } = {}) {
    const recipeText = `${JSON.stringify(controller.exportRecipe(), null, 2)}\n`;
    if (desktop?.saveFile && desktop?.saveFileAs) {
      const response = forceAs || !activeFilePath
        ? await desktop.saveFileAs({ text: recipeText, suggestedName: activeFileName })
        : await desktop.saveFile({ filePath: activeFilePath, text: recipeText });
      if (!response || response.canceled) return;
      activeFilePath = response.filePath;
      activeFileName = response.fileName;
      isDirty = false;
      syncFileBanner();
      announce(`Saved ${activeFileName}`);
      return;
    }
    triggerBlobDownload(recipeText, activeFileName, 'application/json');
    isDirty = false;
    syncFileBanner();
    announce(`Downloaded ${activeFileName}`);
  }

  openButton.addEventListener('click', () => performOpenFile());
  saveButton.addEventListener('click', () => performSaveFile({ forceAs: false }));
  saveAsButton.addEventListener('click', () => performSaveFile({ forceAs: true }));

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    try {
      await loadExternalTextFile(await file.text(), { filePath: null, fileName: file.name });
      announce(`Loaded ${file.name}`);
    } catch (error) {
      announce(error.message);
    }
  });

  exportPngButton.addEventListener('click', async () => {
    exportPopover.hidePopover?.();
    const dataUrl = capturePngDataUrl();
    const baseName = activeFileName.replace(/\.(scene\.)?json$/i, '') || 'crucible-render';
    if (desktop?.savePng) {
      const response = await desktop.savePng({ dataUrl, suggestedName: `${baseName}.png` });
      if (!response?.canceled) announce(`Saved ${response.fileName}`);
      return;
    }
    const bytes = Uint8Array.from(atob(dataUrl.split(',')[1]), character => character.charCodeAt(0));
    triggerBlobDownload(bytes, `${baseName}.png`, 'image/png');
    announce('Saved PNG still');
  });

  exportGlbButton.addEventListener('click', async () => {
    exportPopover.hidePopover?.();
    try {
      const glbBytes = exportGlbBytes();
      const baseName = activeFileName.replace(/\.(scene\.)?json$/i, '') || 'crucible-scene';
      if (desktop?.saveGlb) {
        const response = await desktop.saveGlb({ bytes: glbBytes, suggestedName: `${baseName}.glb` });
        if (!response?.canceled) announce(`Exported ${response.fileName}`);
        return;
      }
      triggerBlobDownload(glbBytes, `${baseName}.glb`, 'model/gltf-binary');
      announce('Exported GLB mesh');
    } catch (error) {
      announce(error.message);
    }
  });

  exportPackButton.addEventListener('click', async () => {
    exportPopover.hidePopover?.();
    try {
      const payload = await buildWebPackPayload();
      if (desktop?.packWebBundle) {
        const response = await desktop.packWebBundle(payload);
        if (!response?.canceled) {
          const note = payload.stripped.length ? ` (static snapshot, omitted ${payload.stripped[0]})` : '';
          announce(`Packed web bundle to ${response.outDir}${note}`);
        }
        return;
      }
      triggerBlobDownload(payload.packBytes, `${payload.title}.pack`, 'application/octet-stream');
      announce('Downloaded scene.pack');
    } catch (error) {
      announce(error.message);
    }
  });

  editJsonButton.addEventListener('click', () => {
    exportPopover.hidePopover?.();
    openImportDialog();
  });

  // Renderer Lifecycle
  function ensureRenderer() {
    if (renderer) {
      return renderer;
    }
    const environment = controller.scene.environment;
    renderer = new CrucibleRenderer(canvas, controller.scene.parts, {
      hdr: true,
      world: environment.world,
      environment: { ...environment, map: agentEnvironmentMap(environment) },
      shadowBounds: resolveAgentShadow(fitAgentShadow(controller.scene.shadow, controller.scene.parts), environment.lightDirection),
      pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
      ...rendererOptions,
    });
    renderedScene = controller.scene;
    renderedTopology = controller.scene.topologyRevision;
    return renderer;
  }

  function syncViewportDimensions() {
    const bounds = viewportElement.getBoundingClientRect();
    const width = Math.max(1, Math.round(bounds.width || container.clientWidth || 960));
    const height = Math.max(1, Math.round(bounds.height || container.clientHeight || 540));
    if (width !== controller.viewportWidth || height !== controller.viewportHeight) {
      controller.setViewportSize(width, height);
    }
    if (renderer) {
      renderer.resize();
    }
  }

  function syncRendererParts(activeRenderer) {
    if (renderedScene !== controller.scene || renderedTopology !== controller.scene.topologyRevision) {
      activeRenderer.replaceParts(controller.scene.parts);
      renderedScene = controller.scene;
      renderedTopology = controller.scene.topologyRevision;
      return activeRenderer;
    }
    try {
      activeRenderer.updateParts(controller.scene.parts);
      return activeRenderer;
    } catch (error) {
      if (!suppliedRenderer && typeof renderer?.dispose === 'function') {
        renderer.dispose();
        renderer = null;
        return ensureRenderer();
      }
      throw error;
    }
  }

  function drawSceneFrame() {
    const activeRenderer = syncRendererParts(ensureRenderer());
    const environment = controller.scene.environment;
    const effects = controller.scene.effects;
    const shadow = fitAgentShadow(controller.scene.shadow, controller.scene.parts);
    const shadowKey = JSON.stringify([environment.lightDirection, shadow]);
    if (renderedShadowKey !== shadowKey) {
      activeRenderer.shadowBounds = resolveAgentShadow(shadow, environment.lightDirection);
      activeRenderer.shadowsDirty = true;
      renderedShadowKey = shadowKey;
    }
    activeRenderer.world = environment.world;
    activeRenderer.render({
      ...controller.scene.camera,
      environment: { ...environment, map: agentEnvironmentMap(environment) },
      effects,
      exposure: effects.exposure,
      time: controller.motionTime,
      lines: environment.lines,
    });
  }

  function renderPass() {
    insideDraw = true;
    try {
      syncViewportDimensions();
      drawSceneFrame();
      renderGizmoMarkup(documentReference, gizmoSvg, controller);
    } finally {
      insideDraw = false;
    }
  }

  function requestFrame() {
    if (frameHandle || !isVisible || documentReference.hidden) {
      return;
    }
    frameHandle = requestAnimationFrame(timestamp => {
      frameHandle = 0;
      if (!isVisible || documentReference.hidden) {
        return;
      }
      if (playing) {
        const deltaSeconds = lastFrameTime ? Math.min(0.05, (timestamp - lastFrameTime) / 1000) : 0;
        lastFrameTime = timestamp;
        const recipe = controller.exportRecipe();
        const duration = recipe.motion?.duration ?? 4;
        const nextTime = duration > 0 ? (controller.motionTime + deltaSeconds) % duration : 0;
        if (hasAnimatedData(recipe)) {
          controller.setMotionTime(roundValue(nextTime, 1000));
        } else {
          playing = false;
          syncUi();
        }
      } else {
        lastFrameTime = timestamp;
      }
      renderPass();
      if (playing && !frameHandle) {
        requestFrame();
      }
    });
  }

  // UI Synchronization
  let lastTreeKey = '';
  let lastSwatchesKey = '';
  let lastBookmarksKey = '';
  let lastParentOptionsKey = '';

  function renderOutliner(recipe) {
    const queryText = outlinerSearch.value.trim().toLowerCase();
    const materialsById = new Map(recipe.materials.map(material => [material.id, material]));
    const ordered = depthSortedNodes(recipe.nodes).filter(({ node }) => {
      if (!queryText) return true;
      return (node.label ?? node.id).toLowerCase().includes(queryText) || node.id.toLowerCase().includes(queryText);
    });
    const treeKey = `${controller.selectedNodeId ?? ''}|${queryText}|${ordered.map(({ node, depth }) => `${depth}:${node.id}:${node.label ?? ''}:${node.visible ?? true}:${node.material ?? ''}`).join('|')}`;
    if (treeKey === lastTreeKey) {
      return;
    }
    lastTreeKey = treeKey;
    outlinerTree.replaceChildren(...ordered.map(({ node, depth }) => {
      const material = node.material ? materialsById.get(node.material) : null;
      const swatchHex = material ? linearRgbToHex(material.color) : 'var(--studio-muted)';
      const selected = node.id === controller.selectedNodeId;
      const badge = createElement(documentReference, 'span', { className: 'crucible-studio-tree-badge' });
      badge.style.background = swatchHex;
      const selectButton = createElement(
        documentReference,
        'button',
        { type: 'button', className: 'crucible-studio-tree-select', dataset: { hidden: node.visible === false ? 'true' : 'false' } },
        badge,
        createElement(documentReference, 'span', { className: 'crucible-studio-tree-label', textContent: node.label ?? node.id }),
      );
      selectButton.style.paddingLeft = `${4 + depth * 12}px`;
      selectButton.addEventListener('click', () => controller.selectNode(node.id));
      selectButton.addEventListener('dblclick', () => {
        controller.selectNode(node.id);
        selectInspectorTab('node');
        nodeLabelInput.focus();
        nodeLabelInput.select();
      });
      const hidden = node.visible === false;
      const eyeButton = createIconButton(documentReference, hidden ? 'eyeOff' : 'eye', `${hidden ? 'Show' : 'Hide'} ${node.label ?? node.id}`, {
        className: 'crucible-studio-tree-eye',
        dataset: { hidden: hidden ? 'true' : 'false' },
      });
      eyeButton.addEventListener('click', () => controller.updateNodeTransform(node.id, { visible: !(node.visible ?? true) }));
      return createElement(
        documentReference,
        'div',
        { className: 'crucible-studio-tree-row', dataset: { selected: selected ? 'true' : 'false' }, attributes: { role: 'treeitem', 'aria-selected': selected ? 'true' : 'false' } },
        selectButton,
        eyeButton,
      );
    }));
  }

  function renderPaletteSwatches(recipe, boundMaterialId) {
    const swatchesKey = `${boundMaterialId ?? ''}|${recipe.materials.map(material => `${material.id}:${linearRgbToHex(material.color)}`).join('|')}`;
    if (swatchesKey === lastSwatchesKey) {
      return;
    }
    lastSwatchesKey = swatchesKey;
    swatchContainer.replaceChildren(...recipe.materials.map(material => {
      const hex = linearRgbToHex(material.color);
      const swatch = createElement(documentReference, 'button', {
        type: 'button',
        className: 'crucible-studio-swatch-btn',
        title: material.id,
        attributes: { 'aria-pressed': material.id === boundMaterialId ? 'true' : 'false', 'aria-label': `Material ${material.id}` },
      });
      swatch.style.background = hex;
      swatch.addEventListener('click', () => {
        if (controller.selectedNodeId) {
          try {
            controller.assignNodeMaterial(controller.selectedNodeId, material.id);
          } catch {
            // group node has no geometry; still open material tab
          }
        }
        selectInspectorTab('material');
      });
      return swatch;
    }), newMaterialQuickButton);
  }

  function syncUi() {
    const recipe = controller.exportRecipe();
    toolButtons.forEach(button => button.setAttribute('aria-pressed', button.dataset.tool === controller.tool ? 'true' : 'false'));
    undoButton.setAttribute('aria-disabled', controller.canUndo ? 'false' : 'true');
    redoButton.setAttribute('aria-disabled', controller.canRedo ? 'false' : 'true');
    const selectedNode = recipe.nodes.find(node => node.id === controller.selectedNodeId) ?? null;
    const hasNode = Boolean(selectedNode);
    duplicateButton.setAttribute('aria-disabled', hasNode ? 'false' : 'true');
    frameButton.setAttribute('aria-disabled', hasNode ? 'false' : 'true');
    deleteButton.setAttribute('aria-disabled', hasNode ? 'false' : 'true');

    renderOutliner(recipe);

    const parentOptionsKey = `${controller.selectedNodeId ?? ''}|${recipe.nodes.map(node => `${node.id}:${node.label ?? ''}`).join('|')}`;
    if (parentOptionsKey !== lastParentOptionsKey) {
      lastParentOptionsKey = parentOptionsKey;
      nodeParentSelect.replaceChildren(
        createElement(documentReference, 'option', { value: '', textContent: 'Scene root' }),
        ...recipe.nodes
          .filter(node => node.id !== controller.selectedNodeId && !node.assetPart)
          .map(node => createElement(documentReference, 'option', { value: node.id, textContent: node.label ?? node.id })),
      );
      materialSelect.replaceChildren(
        ...recipe.materials.map(material => createElement(documentReference, 'option', { value: material.id, textContent: material.id })),
      );
    }

    nodeLabelInput.disabled = !hasNode;
    nodeParentSelect.disabled = !hasNode;
    visibleToggle.setAttribute('aria-disabled', hasNode ? 'false' : 'true');
    castShadowToggle.setAttribute('aria-disabled', hasNode ? 'false' : 'true');
    receiveShadowToggle.setAttribute('aria-disabled', hasNode ? 'false' : 'true');
    if (selectedNode) {
      nodeLabelInput.value = selectedNode.label ?? selectedNode.id;
      nodeParentSelect.value = selectedNode.parent ?? '';
      setButtonIcon(visibleToggle, selectedNode.visible === false ? 'eyeOff' : 'eye', selectedNode.visible === false ? 'Show' : 'Hide');
      castShadowToggle.setAttribute('aria-pressed', selectedNode.castShadow === false ? 'false' : 'true');
      receiveShadowToggle.setAttribute('aria-pressed', selectedNode.receiveShadow === false ? 'false' : 'true');
    } else {
      nodeLabelInput.value = '';
      nodeParentSelect.value = '';
    }
    positionRow.setValues(selectedNode?.translation ?? [0, 0, 0]);
    rotationRow.setValues(quaternionToEulerDegrees(selectedNode?.rotation ?? [0, 0, 0, 1]), DEGREE_PRECISION);
    scaleRow.setValues(selectedNode?.scale ?? [1, 1, 1]);

    const boundMaterial = selectedNode?.material ? recipe.materials.find(material => material.id === selectedNode.material) : null;
    renderPaletteSwatches(recipe, boundMaterial?.id ?? null);
    const activeMaterial = boundMaterial ?? recipe.materials[0] ?? null;
    const hasMaterial = Boolean(activeMaterial);
    materialSelect.disabled = !hasMaterial;
    colorInput.disabled = !hasMaterial;
    emissiveColorInput.disabled = !hasMaterial;
    roughnessField.input.disabled = !hasMaterial;
    metallicField.input.disabled = !hasMaterial;
    clearcoatField.input.disabled = !hasMaterial;
    opacityField.input.disabled = !hasMaterial;
    emissionField.input.disabled = !hasMaterial;
    if (activeMaterial) {
      materialSelect.value = activeMaterial.id;
      colorInput.value = linearRgbToHex(activeMaterial.color);
      emissiveColorInput.value = linearRgbToHex(activeMaterial.emissiveColor ?? activeMaterial.color);
      roughnessField.setValue(activeMaterial.roughness ?? 0.5);
      metallicField.setValue(activeMaterial.metallic ?? 0);
      clearcoatField.setValue(activeMaterial.clearcoat ?? 0);
      opacityField.setValue(activeMaterial.opacity ?? 1);
      emissionField.setValue(activeMaterial.emission ?? 0);
    }

    const environment = recipe.environment ?? {};
    const effects = recipe.effects ?? {};
    const activeSetup = environment.setup ?? 'daylight';
    setupButtons.forEach(button => button.setAttribute('aria-pressed', button.dataset.setup === activeSetup ? 'true' : 'false'));
    const sunAngles = directionToSunAngles(environment.lightDirection);
    sunPad.setAngles(sunAngles.azimuthDegrees, sunAngles.elevationDegrees);
    keyIntensityField.setValue(environment.keyIntensity ?? 1.5);
    viewTransformSelect.value = environment.viewTransform ?? 'aces';
    exposureField.setValue(effects.exposure ?? 1);
    contrastField.setValue(effects.contrast ?? 1);
    saturationField.setValue(effects.saturation ?? 1);
    bloomField.setValue(effects.bloom?.strength ?? 0);
    fogField.setValue(environment.fogDensity ?? 0);

    const camera = controller.scene.camera;
    const isOrthographic = camera.projection === 'orthographic';
    projectionPillButton.textContent = isOrthographic ? 'Orthographic' : 'Perspective';
    projectionPillButton.setAttribute('aria-pressed', isOrthographic ? 'true' : 'false');
    fovField.setValue(Math.round(camera.fov ?? 45));
    orthoScaleField.setValue(roundValue(camera.orthoScale ?? 6, 10));
    lensChips.forEach(chip => chip.setAttribute('aria-pressed', !isOrthographic && Number(chip.dataset.focal) === Math.round(camera.focalLength ?? 0) ? 'true' : 'false'));

    const bookmarks = controller.listBookmarks();
    const bookmarksKey = bookmarks.map(shot => shot.name).join('|');
    if (bookmarksKey !== lastBookmarksKey) {
      lastBookmarksKey = bookmarksKey;
      bookmarkListElement.replaceChildren(...bookmarks.map(shot => {
        const applyButton = createElement(documentReference, 'button', { type: 'button', textContent: shot.name });
        const removeButton = createElement(documentReference, 'button', { type: 'button', textContent: '×', attributes: { 'aria-label': `Remove bookmark ${shot.name}` } });
        applyButton.addEventListener('click', () => controller.applyBookmark(shot.name));
        removeButton.addEventListener('click', () => controller.removeBookmark(shot.name));
        return createElement(documentReference, 'div', { className: 'crucible-studio-bookmark-row' }, applyButton, removeButton);
      }));
      quickBookmarksRow.replaceChildren(...bookmarks.slice(0, 5).map(shot => {
        const pill = createElement(documentReference, 'button', { type: 'button', textContent: shot.name, title: `Jump to shot ${shot.name}` });
        pill.addEventListener('click', () => controller.applyBookmark(shot.name));
        return pill;
      }));
    }

    const duration = recipe.motion?.duration ?? 4;
    const animated = hasAnimatedData(recipe);
    scrubInput.max = String(Math.max(0.1, duration));
    scrubInput.value = String(controller.motionTime);
    scrubInput.disabled = !animated;
    playButton.setAttribute('aria-disabled', animated ? 'false' : 'true');
    playButton.setAttribute('aria-pressed', playing ? 'true' : 'false');
    setButtonIcon(playButton, playing ? 'pause' : 'play', playing ? 'Pause (Space)' : 'Play (Space)');
    timeOutput.textContent = `${controller.motionTime.toFixed(1)} / ${duration.toFixed(1)} s`;
    hintBar.textContent = liveDeltaLabel;
    syncFileBanner();
  }

  // Viewport Interaction: Gizmo Drag, Pick, Orbit, Pan, Zoom, File Drop
  function localCoordinates(event) {
    const bounds = viewportElement.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }

  gizmoSvg.addEventListener('pointerdown', event => {
    const axis = event.target?.getAttribute?.('data-gizmo-axis');
    if (!axis) return;
    event.preventDefault();
    event.stopPropagation();
    const coordinates = localCoordinates(event);
    controller.beginGizmoDrag(axis, coordinates.x, coordinates.y);
    pointerState = { mode: 'gizmo', pointerId: event.pointerId };
    viewportElement.setPointerCapture?.(event.pointerId);
  });

  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0 && event.button !== 1 && event.button !== 2) return;
    const coordinates = localCoordinates(event);
    pointerState = {
      mode: event.shiftKey || event.button === 2 || event.button === 1 ? 'pan' : 'orbit',
      startX: coordinates.x,
      startY: coordinates.y,
      lastX: coordinates.x,
      lastY: coordinates.y,
      moved: false,
      pointerId: event.pointerId,
    };
    canvas.setPointerCapture?.(event.pointerId);
  });

  viewportElement.addEventListener('pointermove', event => {
    if (!pointerState) return;
    const coordinates = localCoordinates(event);
    if (pointerState.mode === 'gizmo') {
      controller.updateGizmoDrag(coordinates.x, coordinates.y, { shiftKey: event.shiftKey });
      return;
    }
    const deltaX = coordinates.x - pointerState.lastX;
    const deltaY = coordinates.y - pointerState.lastY;
    if (Math.hypot(coordinates.x - pointerState.startX, coordinates.y - pointerState.startY) > 4) {
      pointerState.moved = true;
    }
    pointerState.lastX = coordinates.x;
    pointerState.lastY = coordinates.y;
    if (!pointerState.moved) return;
    if (pointerState.mode === 'pan') {
      controller.orbitCamera({ panX: -deltaX * 0.002, panY: deltaY * 0.002 });
    } else {
      controller.orbitCamera({ deltaAzimuth: -deltaX * 0.008, deltaElevation: deltaY * 0.008 });
    }
  });

  function finishPointer(event) {
    if (!pointerState) return;
    const finished = pointerState;
    pointerState = null;
    if (finished.mode === 'gizmo') {
      controller.endGizmoDrag();
      return;
    }
    if (!finished.moved) {
      const coordinates = localCoordinates(event);
      if (controller.tool === 'snap' && controller.selectedNodeId && event.altKey) {
        controller.snapSelectedToAt(coordinates.x, coordinates.y);
      } else {
        controller.pickAt(coordinates.x, coordinates.y);
      }
    }
  }
  viewportElement.addEventListener('pointerup', finishPointer);
  viewportElement.addEventListener('pointercancel', finishPointer);
  canvas.addEventListener('contextmenu', event => event.preventDefault());
  canvas.addEventListener('wheel', event => {
    event.preventDefault();
    controller.orbitCamera({ zoomScale: 1 + Math.max(-0.35, Math.min(0.35, event.deltaY * 0.0012)) });
  }, { passive: false });

  viewportElement.addEventListener('dragover', event => {
    event.preventDefault();
    viewportElement.dataset.dropActive = 'true';
  });
  viewportElement.addEventListener('dragleave', () => {
    delete viewportElement.dataset.dropActive;
  });
  viewportElement.addEventListener('drop', async event => {
    event.preventDefault();
    delete viewportElement.dataset.dropActive;
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    try {
      await loadExternalTextFile(await file.text(), { filePath: file.path || null, fileName: file.name });
      announce(`Loaded ${file.name}`);
    } catch (error) {
      announce(error.message);
    }
  });

  function isEditableTarget(target) {
    const tag = target?.tagName?.toLowerCase?.();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || Boolean(target?.isContentEditable);
  }

  const onWindowKeyDown = async event => {
    if (!root.isConnected || isEditableTarget(event.target)) {
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      performSaveFile({ forceAs: event.shiftKey });
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'o') {
      event.preventDefault();
      performOpenFile();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'd') {
      event.preventDefault();
      if (controller.selectedNodeId) {
        const cloned = controller.duplicateSelected();
        announce(`Duplicated to ${cloned.label}`);
      }
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) controller.redo();
      else controller.undo();
      return;
    }
    const lowerKey = event.key.toLowerCase();
    if (lowerKey === 'q') controller.setTool('select');
    else if (lowerKey === 'g') controller.setTool('translate');
    else if (lowerKey === 'r') controller.setTool('rotate');
    else if (lowerKey === 's') controller.setTool('scale');
    else if (lowerKey === 't') controller.setTool('snap');
    else if (lowerKey === 'f') controller.frameSelection();
    else if (event.key === '5') controller.toggleCameraProjection();
    else if (event.key === '?') shortcutsDialog.showModal();
    else if (lowerKey === 'k') keyframeButton.click();
    else if (event.key === ' ') {
      event.preventDefault();
      playButton.click();
    } else if ((event.key === 'Delete' || event.key === 'Backspace') && controller.selectedNodeId) {
      event.preventDefault();
      controller.deleteSelected();
      announce('Deleted node');
    }
  };
  documentReference.addEventListener('keydown', onWindowKeyDown);

  const onVisibilityChange = () => {
    if (!documentReference.hidden && isVisible) requestFrame();
  };
  documentReference.addEventListener('visibilitychange', onVisibilityChange);

  function setOutlinerCollapsed(collapsed) {
    root.dataset.outlinerCollapsed = collapsed ? 'true' : 'false';
    toggleDocksButton.setAttribute('aria-pressed', root.dataset.outlinerCollapsed === 'false' || root.dataset.inspectorCollapsed === 'false' ? 'true' : 'false');
    requestFrame();
  }

  function setInspectorCollapsed(collapsed) {
    root.dataset.inspectorCollapsed = collapsed ? 'true' : 'false';
    toggleDocksButton.setAttribute('aria-pressed', root.dataset.outlinerCollapsed === 'false' || root.dataset.inspectorCollapsed === 'false' ? 'true' : 'false');
    requestFrame();
  }

  handleChange = detail => {
    if (detail.deltaLabel !== undefined) {
      liveDeltaLabel = detail.deltaLabel;
    }
    if (['topology', 'transform', 'transformCommit', 'material', 'look', 'undo', 'redo'].includes(detail.kind)) {
      isDirty = true;
    }
    syncUi();
    if (detail.kind === 'tab' || insideDraw) return;
    requestFrame();
  };

  // Below the compact width the panels start closed, so the scene keeps the screen.
  function syncCompactLayout() {
    const compact = root.clientWidth > 0 && root.clientWidth < COMPACT_WIDTH;
    if ((root.dataset.compact === 'true') === compact) {
      return;
    }
    root.dataset.compact = compact ? 'true' : 'false';
    setOutlinerCollapsed(compact);
    setInspectorCollapsed(compact);
  }
  syncCompactLayout();

  if (typeof ResizeObserver === 'function') {
    resizeObserver = new ResizeObserver(() => {
      syncCompactLayout();
      requestFrame();
    });
    resizeObserver.observe(viewportElement);
  }
  if (typeof IntersectionObserver === 'function') {
    intersectionObserver = new IntersectionObserver(entries => {
      isVisible = entries.some(entry => entry.isIntersecting);
      if (isVisible) requestFrame();
    }, { threshold: 0.01 });
    intersectionObserver.observe(viewportElement);
  }

  // Initial Draw
  syncUi();
  renderPass();

  return {
    get controller() { return controller; },
    get scene() { return controller.scene; },
    get renderer() { return renderer; },
    get dirty() { return isDirty; },
    exportRecipe: () => controller.exportRecipe(),
    loadRecipe: (recipeInput, options) => controller.loadRecipe(recipeInput, options),
    loadExternalTextFile,
    selectNode: nodeId => controller.selectNode(nodeId),
    setTool: tool => controller.setTool(tool),
    setActiveTab: tab => selectInspectorTab(tab),
    pickAt: (pixelX, pixelY) => controller.pickAt(pixelX, pixelY),
    setOutlinerCollapsed,
    setInspectorCollapsed,
    capturePngDataUrl,
    exportGlbBytes,
    buildWebPackPayload,
    shouldAutoReloadExternal() {
      return autoReloadWatch;
    },
    setFileContext({ filePath, fileName, dirty }) {
      if (filePath !== undefined) activeFilePath = filePath;
      if (fileName !== undefined) activeFileName = fileName;
      if (dirty !== undefined) isDirty = Boolean(dirty);
      syncFileBanner();
    },
    renderNow() {
      renderPass();
    },
    dispose() {
      clearTimeout(statusTimer);
      if (frameHandle) cancelAnimationFrame(frameHandle);
      documentReference.removeEventListener('keydown', onWindowKeyDown);
      documentReference.removeEventListener('visibilitychange', onVisibilityChange);
      resizeObserver?.disconnect();
      intersectionObserver?.disconnect();
      controller.dispose();
      renderer?.dispose();
      root.remove();
    },
  };
}
