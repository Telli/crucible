import { mat4, quat, vec3 } from 'gl-matrix';
import { applyProjection } from './camera.js';
import { createAgentScene, loadAgentSceneModules } from './agent-scene.js';
import { agentEnvironmentMap, fitAgentShadow, resolveAgentShadow } from './agent-look.js';
import { LIGHTING_SETUP_NAMES } from './agent-scene-capabilities.js';
import { VIEW_TRANSFORM_NAMES } from './view-transform-names.js';
import { CrucibleRenderer } from './renderer.js';
import { createSceneQuery } from './scene-query.js';

export const STUDIO_TOOLS = Object.freeze(['translate', 'rotate', 'scale', 'snap']);
export const STUDIO_TABS = Object.freeze(['node', 'look', 'camera']);

const AXIS_NAMES = Object.freeze(['x', 'y', 'z']);
const GIZMO_AXES = Object.freeze(['x', 'y', 'z', 'uniform', 'surface']);
const SHOT_NAME_PATTERN = /^[A-Za-z0-9_-]{1,24}$/;
const GIZMO_SCREEN_PIXELS = 72;
const ROTATION_DEGREES_PER_PIXEL = 0.75;
const ROTATION_SNAP_DEGREES = 15;
const SCALE_PIXELS_PER_UNIT = 90;
const MINIMUM_SCALE = 0.05;
const MAXIMUM_SCALE = 100;
const MINIMUM_DISTANCE = 0.25;
const MAXIMUM_DISTANCE = 400;
const MAXIMUM_ELEVATION = 1.53;
const ROUND_PRECISION = 10000;
const DEGREE_PRECISION = 100;

function roundValue(value, precision = ROUND_PRECISION) {
  return Math.round(value * precision) / precision;
}

function roundVector(values, precision = ROUND_PRECISION) {
  return Array.from(values, component => roundValue(component, precision));
}

function assertPositiveFinite(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive finite number, got ${JSON.stringify(value)}.`);
  }
  return value;
}

function assertFiniteVector(values, length, label) {
  if (!Array.isArray(values) || values.length !== length || values.some(component => typeof component !== 'number' || !Number.isFinite(component))) {
    throw new TypeError(`${label} must be an array of ${length} finite numbers.`);
  }
  return Array.from(values);
}

function validateSceneHandle(scene) {
  if (!scene || typeof scene !== 'object') {
    throw new TypeError('Studio requires a scene object from createAgentScene.');
  }
  for (const method of ['apply', 'exportRecipe', 'inspect']) {
    if (typeof scene[method] !== 'function') {
      throw new TypeError(`Studio scene must provide ${method}().`);
    }
  }
  if (!Array.isArray(scene.parts) || !scene.camera) {
    throw new TypeError('Studio scene must provide parts and camera.');
  }
  return scene;
}

function normalizeQuaternion(rotation) {
  const result = quat.fromValues(rotation[0], rotation[1], rotation[2], rotation[3]);
  if (quat.length(result) < 1e-8) {
    return [0, 0, 0, 1];
  }
  quat.normalize(result, result);
  return roundVector(result);
}

function quaternionToEulerDegrees(quaternion) {
  const [valueX, valueY, valueZ, valueW] = normalizeQuaternion(quaternion);
  const sinRoll = 2 * (valueW * valueX + valueY * valueZ);
  const cosRoll = 1 - 2 * (valueX * valueX + valueY * valueY);
  const roll = Math.atan2(sinRoll, cosRoll);
  const sinPitch = Math.max(-1, Math.min(1, 2 * (valueW * valueY - valueZ * valueX)));
  const pitch = Math.asin(sinPitch);
  const sinYaw = 2 * (valueW * valueZ + valueX * valueY);
  const cosYaw = 1 - 2 * (valueY * valueY + valueZ * valueZ);
  const yaw = Math.atan2(sinYaw, cosYaw);
  const radiansToDegrees = 180 / Math.PI;
  return [
    roundValue(roll * radiansToDegrees, DEGREE_PRECISION),
    roundValue(pitch * radiansToDegrees, DEGREE_PRECISION),
    roundValue(yaw * radiansToDegrees, DEGREE_PRECISION),
  ];
}

function eulerDegreesToQuaternion(angles) {
  const result = quat.create();
  quat.fromEuler(result, angles[0], angles[1], angles[2]);
  quat.normalize(result, result);
  return roundVector(result);
}

function srgbChannelToLinear(channel) {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function linearChannelToSrgb(channel) {
  const clamped = Math.max(0, Math.min(1, channel));
  return clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * (clamped ** (1 / 2.4)) - 0.055;
}

function linearRgbToHex(rgb) {
  const values = Array.isArray(rgb) ? rgb : [0.8, 0.8, 0.8];
  const hex = values.slice(0, 3).map(channel => {
    const byte = Math.max(0, Math.min(255, Math.round(linearChannelToSrgb(channel) * 255)));
    return byte.toString(16).padStart(2, '0');
  });
  return `#${hex.join('')}`;
}

function hexToLinearRgb(hexText) {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(hexText).trim());
  if (!match) {
    throw new TypeError(`Color must be a #rrggbb hex string, got ${JSON.stringify(hexText)}.`);
  }
  const value = parseInt(match[1], 16);
  return [
    roundValue(srgbChannelToLinear(((value >> 16) & 255) / 255)),
    roundValue(srgbChannelToLinear(((value >> 8) & 255) / 255)),
    roundValue(srgbChannelToLinear((value & 255) / 255)),
  ];
}

function directionToSunAngles(direction) {
  const values = Array.isArray(direction) && direction.length === 3 ? direction : [-3, 6, 4];
  const length = Math.hypot(values[0], values[1], values[2]) || 1;
  const horizontal = Math.hypot(values[0], values[2]);
  const elevationDegrees = roundValue(Math.asin(Math.max(-1, Math.min(1, values[1] / length))) * 180 / Math.PI, DEGREE_PRECISION);
  const azimuthDegrees = roundValue(Math.atan2(values[0], values[2]) * 180 / Math.PI, DEGREE_PRECISION);
  return {
    azimuthDegrees,
    elevationDegrees: horizontal < 1e-6 && values[1] > 0 ? 90 : elevationDegrees,
  };
}

function sunAnglesToDirection(azimuthDegrees, elevationDegrees) {
  const azimuth = (azimuthDegrees * Math.PI) / 180;
  const elevation = (elevationDegrees * Math.PI) / 180;
  const cosineElevation = Math.cos(elevation);
  return [
    roundValue(cosineElevation * Math.sin(azimuth) * 6),
    roundValue(Math.sin(elevation) * 6),
    roundValue(cosineElevation * Math.cos(azimuth) * 6),
  ];
}

function cameraMatrices(camera, aspect, worldMode) {
  const view = mat4.lookAt(mat4.create(), camera.eye, camera.target, camera.up ?? [0, 1, 0]);
  const projection = mat4.create();
  applyProjection(projection, { projection: camera.projection ?? 'perspective', fov: camera.fov, focalLength: camera.focalLength, sensorWidth: camera.sensorWidth, orthoScale: camera.orthoScale, shift: camera.shift, near: camera.near ?? 0.1, far: camera.far ?? (worldMode ? 600 : 100) }, aspect, { world: worldMode });
  const viewProjection = mat4.multiply(mat4.create(), projection, view);
  return { view, projection, viewProjection };
}

function projectPointWithMatrix(viewProjection, point, width, height) {
  const worldX = point[0];
  const worldY = point[1];
  const worldZ = point[2];
  const clipX = viewProjection[0] * worldX + viewProjection[4] * worldY + viewProjection[8] * worldZ + viewProjection[12];
  const clipY = viewProjection[1] * worldX + viewProjection[5] * worldY + viewProjection[9] * worldZ + viewProjection[13];
  const clipZ = viewProjection[2] * worldX + viewProjection[6] * worldY + viewProjection[10] * worldZ + viewProjection[14];
  const clipW = viewProjection[3] * worldX + viewProjection[7] * worldY + viewProjection[11] * worldZ + viewProjection[15];
  if (clipW <= 1e-6) {
    return { x: 0, y: 0, depth: 1, visible: false };
  }
  const normalizedX = clipX / clipW;
  const normalizedY = clipY / clipW;
  const normalizedZ = clipZ / clipW;
  return {
    x: (normalizedX * 0.5 + 0.5) * width,
    y: (0.5 - normalizedY * 0.5) * height,
    depth: normalizedZ,
    visible: normalizedZ >= -1 && normalizedZ <= 1,
  };
}

function buildNodeWorldMatrices(nodes) {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const worldMatrices = new Map();
  function resolveWorldMatrix(nodeId, stack) {
    if (worldMatrices.has(nodeId)) {
      return worldMatrices.get(nodeId);
    }
    const node = byId.get(nodeId);
    if (!node || stack.has(nodeId)) {
      return mat4.create();
    }
    stack.add(nodeId);
    const localMatrix = mat4.fromRotationTranslationScale(
      mat4.create(),
      node.rotation ?? [0, 0, 0, 1],
      node.translation ?? [0, 0, 0],
      node.scale ?? [1, 1, 1],
    );
    const worldMatrix = node.parent
      ? mat4.multiply(mat4.create(), resolveWorldMatrix(node.parent, stack), localMatrix)
      : localMatrix;
    stack.delete(nodeId);
    worldMatrices.set(nodeId, worldMatrix);
    return worldMatrix;
  }
  for (const node of nodes) {
    resolveWorldMatrix(node.id, new Set());
  }
  return worldMatrices;
}

function descendantIdsOf(nodes, rootId) {
  const descendants = new Set([rootId]);
  let added = true;
  while (added) {
    added = false;
    for (const node of nodes) {
      if (node.parent && descendants.has(node.parent) && !descendants.has(node.id)) {
        descendants.add(node.id);
        added = true;
      }
    }
  }
  return descendants;
}

function partClearanceAlongNormal(parts, excludedIds, worldNormal, nodes, worldMatrices) {
  let minimumProjection = Infinity;
  let maximumProjection = -Infinity;
  const point = vec3.create();
  for (const part of parts) {
    if (!excludedIds.has(part.name) || !part.geometry?.positions) {
      continue;
    }
    const positions = part.geometry.positions;
    const matrix = part.matrix ?? worldMatrices.get(part.name);
    if (!matrix) {
      continue;
    }
    for (let offset = 0; offset < positions.length; offset += 3) {
      vec3.set(point, positions[offset], positions[offset + 1], positions[offset + 2]);
      vec3.transformMat4(point, point, matrix);
      const projection = vec3.dot(point, worldNormal);
      if (projection < minimumProjection) minimumProjection = projection;
      if (projection > maximumProjection) maximumProjection = projection;
    }
  }
  if (!Number.isFinite(minimumProjection)) {
    return 0.5;
  }
  const pivotMatrix = worldMatrices.get(nodes[0]?.id) ?? parts.find(part => excludedIds.has(part.name))?.matrix;
  if (!pivotMatrix) {
    return Math.max(0, (maximumProjection - minimumProjection) * 0.5);
  }
  const pivotProjection = pivotMatrix[12] * worldNormal[0] + pivotMatrix[13] * worldNormal[1] + pivotMatrix[14] * worldNormal[2];
  return Math.max(0, pivotProjection - minimumProjection);
}

function cameraBookmarkPayload(camera) {
  const payload = {
    eye: roundVector(camera.eye),
    target: roundVector(camera.target),
    up: roundVector(camera.up ?? [0, 1, 0]),
  };
  if (camera.focalLength === undefined && camera.fov !== undefined) {
    payload.fov = roundValue(camera.fov, DEGREE_PRECISION);
  }
  if (camera.near !== undefined) {
    payload.near = roundValue(camera.near);
  }
  if (camera.far !== undefined) {
    payload.far = roundValue(camera.far);
  }
  return payload;
}

function buildTimelineShot(name, camera, recipe) {
  const hasMotion = Boolean(recipe.motion || recipe.physics || recipe.cloth);
  const nonLoopingDuration = recipe.motion && !recipe.motion.loop ? recipe.motion.duration : 2;
  const duration = Math.max(0.1, Math.min(2, nonLoopingDuration));
  const shot = { name, duration, camera: cameraBookmarkPayload(camera) };
  if (hasMotion) {
    shot.motionStart = 0;
  }
  return shot;
}

function hasAnimatedData(recipe) {
  return Boolean(
    recipe.motion ||
    recipe.physics ||
    recipe.cloth ||
    recipe.particles ||
    recipe.environment?.localVolumes?.some(volume => volume?.frames),
  );
}

function resolveRecipeNodeId(partId, recipe) {
  const direct = recipe.nodes.find(node => node.id === partId);
  if (direct) {
    return direct.id;
  }
  const prefixed = recipe.nodes.find(node => partId.startsWith(`${node.id}:`) || partId.startsWith(`${node.id}.`));
  return prefixed ? prefixed.id : null;
}

/**
 * Pure controller bridging interactive viewport actions and inspector edits to an AgentScene recipe.
 */
export function createStudioController({
  scene: initialScene,
  viewportWidth = 960,
  viewportHeight = 540,
  maxHistory = 32,
  onChange,
} = {}) {
  let currentScene = validateSceneHandle(initialScene);
  let width = assertPositiveFinite(viewportWidth, 'viewportWidth');
  let height = assertPositiveFinite(viewportHeight, 'viewportHeight');
  if (!Number.isInteger(maxHistory) || maxHistory < 1 || maxHistory > 128) {
    throw new RangeError(`maxHistory must be an integer from 1 to 128, got ${JSON.stringify(maxHistory)}.`);
  }
  if (onChange !== undefined && typeof onChange !== 'function') {
    throw new TypeError('onChange must be a function when provided.');
  }

  let selectedNodeId = currentScene.exportRecipe().nodes.find(node => node.geometry !== undefined)?.id
    ?? currentScene.exportRecipe().nodes[0]?.id
    ?? null;
  let activeTool = 'translate';
  let activeTab = 'node';
  let motionTime = currentScene.motionTime ?? 0;
  let queryCache = null;
  let dragState = null;
  const undoStack = [];
  const redoStack = [];

  function notify(detail = {}) {
    if (onChange) {
      onChange({
        revision: currentScene.revision,
        selectedNodeId,
        tool: activeTool,
        activeTab,
        motionTime,
        ...detail,
      });
    }
  }

  function invalidateQuery() {
    if (queryCache) {
      queryCache.query.dispose();
      queryCache = null;
    }
  }

  function ensureQuery() {
    if (queryCache && queryCache.topologyRevision === currentScene.topologyRevision) {
      return queryCache.query;
    }
    invalidateQuery();
    const query = createSceneQuery(currentScene.parts);
    queryCache = { topologyRevision: currentScene.topologyRevision, query };
    return query;
  }

  function pushUndoSnapshot(snapshot) {
    undoStack.push(snapshot);
    while (undoStack.length > maxHistory) {
      undoStack.shift();
    }
    redoStack.length = 0;
  }

  function applySceneOperations(operations, { recordUndo = true } = {}) {
    const before = recordUndo ? currentScene.exportRecipe() : null;
    currentScene.apply(operations, { expectedRevision: currentScene.revision });
    if (before) {
      pushUndoSnapshot(before);
    }
  }

  function swapRecipe(recipeInput) {
    invalidateQuery();
    currentScene = createAgentScene(recipeInput);
    const recipe = currentScene.exportRecipe();
    if (selectedNodeId && !recipe.nodes.some(node => node.id === selectedNodeId)) {
      selectedNodeId = recipe.nodes[0]?.id ?? null;
    }
    if (motionTime > 0 && hasAnimatedData(recipe)) {
      const limit = recipe.motion?.duration ?? motionTime;
      motionTime = Math.max(0, Math.min(limit, motionTime));
      currentScene.sampleMotion(motionTime);
    } else {
      motionTime = 0;
    }
  }

  function selectedPivotWorld() {
    if (!selectedNodeId) {
      return null;
    }
    const matchingPart = currentScene.parts.find(part => part.name === selectedNodeId);
    if (matchingPart?.matrix) {
      return [matchingPart.matrix[12], matchingPart.matrix[13], matchingPart.matrix[14]];
    }
    const recipe = currentScene.exportRecipe();
    const matrix = buildNodeWorldMatrices(recipe.nodes).get(selectedNodeId);
    if (!matrix) {
      return null;
    }
    return [matrix[12], matrix[13], matrix[14]];
  }

  function projectWorldPoint(worldPoint) {
    const coordinates = assertFiniteVector(worldPoint, 3, 'worldPoint');
    const { viewProjection } = cameraMatrices(currentScene.camera, width / height, Boolean(currentScene.environment?.world));
    return projectPointWithMatrix(viewProjection, coordinates, width, height);
  }

  function screenRay(pixelX, pixelY) {
    if (!Number.isFinite(pixelX) || !Number.isFinite(pixelY)) {
      throw new TypeError('screenRay requires finite pixelX and pixelY numbers.');
    }
    const { viewProjection } = cameraMatrices(currentScene.camera, width / height, Boolean(currentScene.environment?.world));
    const inverse = mat4.invert(mat4.create(), viewProjection);
    if (!inverse) {
      throw new Error('Cannot unproject ray from a singular camera matrix.');
    }
    const normalizedX = (pixelX / width) * 2 - 1;
    const normalizedY = 1 - (pixelY / height) * 2;
    const nearPoint = vec3.transformMat4(vec3.create(), [normalizedX, normalizedY, -1], inverse);
    const farPoint = vec3.transformMat4(vec3.create(), [normalizedX, normalizedY, 1], inverse);
    const direction = vec3.subtract(vec3.create(), farPoint, nearPoint);
    vec3.normalize(direction, direction);
    return {
      origin: [nearPoint[0], nearPoint[1], nearPoint[2]],
      direction: [direction[0], direction[1], direction[2]],
    };
  }

  function selectNode(nodeId) {
    if (nodeId !== null && typeof nodeId !== 'string') {
      throw new TypeError('selectNode expects a node ID string or null.');
    }
    if (nodeId !== null) {
      const exists = currentScene.exportRecipe().nodes.some(node => node.id === nodeId);
      if (!exists) {
        throw new RangeError(`Unknown node "${nodeId}". Select an existing node ID from scene.exportRecipe().nodes.`);
      }
    }
    selectedNodeId = nodeId;
    notify({ kind: 'selection' });
    return selectedNodeId;
  }

  function setTool(tool) {
    if (!STUDIO_TOOLS.includes(tool)) {
      throw new RangeError(`Unknown Studio tool "${String(tool)}". Use one of ${STUDIO_TOOLS.join(', ')}.`);
    }
    activeTool = tool;
    notify({ kind: 'tool' });
    return activeTool;
  }

  function setActiveTab(tab) {
    if (!STUDIO_TABS.includes(tab)) {
      throw new RangeError(`Unknown Studio tab "${String(tab)}". Use one of ${STUDIO_TABS.join(', ')}.`);
    }
    activeTab = tab;
    notify({ kind: 'tab' });
    return activeTab;
  }

  function pickAt(pixelX, pixelY) {
    const ray = screenRay(pixelX, pixelY);
    const hit = ensureQuery().raycast(ray);
    if (!hit) {
      selectedNodeId = null;
      notify({ kind: 'pick', hit: null });
      return null;
    }
    const recipe = currentScene.exportRecipe();
    const resolvedId = resolveRecipeNodeId(hit.id, recipe);
    selectedNodeId = resolvedId;
    const result = {
      id: resolvedId ?? hit.id,
      partId: hit.id,
      point: Array.from(hit.point),
      normal: Array.from(hit.normal),
      distance: hit.distance,
    };
    notify({ kind: 'pick', hit: result });
    return result;
  }

  function gizmoHandles() {
    const pivot = selectedPivotWorld();
    if (!pivot) {
      return null;
    }
    const camera = currentScene.camera;
    const distance = Math.max(0.5, vec3.distance(camera.eye, pivot));
    const fovRadians = ((camera.fov ?? 45) * Math.PI) / 180;
    const worldPerPixel = (2 * distance * Math.tan(fovRadians * 0.5)) / height;
    const handleLength = Math.max(0.25, worldPerPixel * GIZMO_SCREEN_PIXELS);
    const origin = projectWorldPoint(pivot);
    return {
      pivot,
      handleLength,
      origin,
      axes: {
        x: projectWorldPoint([pivot[0] + handleLength, pivot[1], pivot[2]]),
        y: projectWorldPoint([pivot[0], pivot[1] + handleLength, pivot[2]]),
        z: projectWorldPoint([pivot[0], pivot[1], pivot[2] + handleLength]),
      },
    };
  }

  function computeSnapTranslation(nodeId, pixelX, pixelY) {
    const recipe = currentScene.exportRecipe();
    const targetNode = recipe.nodes.find(node => node.id === nodeId);
    if (!targetNode) {
      return null;
    }
    const excluded = descendantIdsOf(recipe.nodes, nodeId);
    const supportParts = currentScene.parts.filter(part => !excluded.has(part.name));
    if (supportParts.length === 0) {
      return null;
    }
    const ray = screenRay(pixelX, pixelY);
    const snapQuery = createSceneQuery(supportParts);
    let hit = null;
    try {
      hit = snapQuery.raycast(ray);
    } finally {
      snapQuery.dispose();
    }
    if (!hit) {
      return null;
    }
    const worldMatrices = buildNodeWorldMatrices(recipe.nodes);
    const clearance = partClearanceAlongNormal(currentScene.parts, excluded, hit.normal, [targetNode], worldMatrices);
    const worldTarget = [
      hit.point[0] + hit.normal[0] * clearance,
      hit.point[1] + hit.normal[1] * clearance,
      hit.point[2] + hit.normal[2] * clearance,
    ];
    if (!targetNode.parent) {
      return roundVector(worldTarget);
    }
    const parentWorld = worldMatrices.get(targetNode.parent);
    const inverseParent = parentWorld ? mat4.invert(mat4.create(), parentWorld) : null;
    if (!inverseParent) {
      return roundVector(worldTarget);
    }
    const localTarget = vec3.transformMat4(vec3.create(), worldTarget, inverseParent);
    return roundVector(localTarget);
  }

  function snapSelectedToAt(pixelX, pixelY, { recordUndo = true } = {}) {
    if (!selectedNodeId) {
      throw new RangeError('Select a node before snapping it to a surface.');
    }
    const translation = computeSnapTranslation(selectedNodeId, pixelX, pixelY);
    if (!translation) {
      return null;
    }
    applySceneOperations([{ type: 'set-node', id: selectedNodeId, translation }], { recordUndo });
    notify({ kind: 'transform', nodeId: selectedNodeId });
    return translation;
  }

  function beginGizmoDrag(axis, pixelX, pixelY) {
    if (!selectedNodeId) {
      throw new RangeError('Select a node before starting a gizmo drag.');
    }
    if (!GIZMO_AXES.includes(axis)) {
      throw new RangeError(`Unsupported gizmo axis "${String(axis)}". Use ${GIZMO_AXES.join(', ')}.`);
    }
    if (!Number.isFinite(pixelX) || !Number.isFinite(pixelY)) {
      throw new TypeError('beginGizmoDrag requires finite pixel coordinates.');
    }
    const recipe = currentScene.exportRecipe();
    const node = recipe.nodes.find(candidate => candidate.id === selectedNodeId);
    const handles = gizmoHandles();
    const worldMatrices = buildNodeWorldMatrices(recipe.nodes);
    const parentWorld = node.parent ? worldMatrices.get(node.parent) : null;
    let axisScreen = [1, 0];
    if (axis !== 'uniform' && axis !== 'surface' && handles) {
      const axisPoint = handles.axes[axis];
      const deltaX = axisPoint.x - handles.origin.x;
      const deltaY = axisPoint.y - handles.origin.y;
      const length = Math.hypot(deltaX, deltaY);
      if (length > 1) {
        axisScreen = [deltaX / length, deltaY / length];
      }
    }
    const camera = currentScene.camera;
    const distance = handles ? Math.max(0.5, vec3.distance(camera.eye, handles.pivot)) : 5;
    const fovRadians = ((camera.fov ?? 45) * Math.PI) / 180;
    const worldPerPixel = (2 * distance * Math.tan(fovRadians * 0.5)) / height;
    dragState = {
      nodeId: selectedNodeId,
      tool: axis === 'surface' ? 'snap' : activeTool,
      axis,
      startX: pixelX,
      startY: pixelY,
      baseRecipe: recipe,
      baseTranslation: Array.from(node.translation ?? [0, 0, 0]),
      baseRotation: normalizeQuaternion(node.rotation ?? [0, 0, 0, 1]),
      baseScale: Array.from(node.scale ?? [1, 1, 1]),
      parentInverse: parentWorld ? mat4.invert(mat4.create(), parentWorld) : null,
      axisScreen,
      worldPerPixel,
      changed: false,
    };
    return { nodeId: dragState.nodeId, tool: dragState.tool, axis: dragState.axis };
  }

  function updateGizmoDrag(pixelX, pixelY, { shiftKey = false } = {}) {
    if (!dragState) {
      return null;
    }
    if (!Number.isFinite(pixelX) || !Number.isFinite(pixelY)) {
      throw new TypeError('updateGizmoDrag requires finite pixel coordinates.');
    }
    const deltaX = pixelX - dragState.startX;
    const deltaY = pixelY - dragState.startY;
    const axisIndex = AXIS_NAMES.indexOf(dragState.axis);
    if (dragState.tool === 'snap' || dragState.axis === 'surface') {
      const translation = computeSnapTranslation(dragState.nodeId, pixelX, pixelY);
      if (!translation) {
        return null;
      }
      applySceneOperations([{ type: 'set-node', id: dragState.nodeId, translation }], { recordUndo: false });
      dragState.changed = true;
      notify({ kind: 'transform', nodeId: dragState.nodeId, live: true });
      return { translation };
    }
    if (dragState.tool === 'translate' && axisIndex >= 0) {
      const projectedPixels = deltaX * dragState.axisScreen[0] + deltaY * dragState.axisScreen[1];
      const worldDelta = [0, 0, 0];
      worldDelta[axisIndex] = projectedPixels * dragState.worldPerPixel;
      let localDelta = worldDelta;
      if (dragState.parentInverse) {
        const rotated = vec3.fromValues(worldDelta[0], worldDelta[1], worldDelta[2]);
        const linearInverse = mat4.clone(dragState.parentInverse);
        linearInverse[12] = 0;
        linearInverse[13] = 0;
        linearInverse[14] = 0;
        vec3.transformMat4(rotated, rotated, linearInverse);
        localDelta = [rotated[0], rotated[1], rotated[2]];
      }
      const translation = roundVector([
        dragState.baseTranslation[0] + localDelta[0],
        dragState.baseTranslation[1] + localDelta[1],
        dragState.baseTranslation[2] + localDelta[2],
      ]);
      applySceneOperations([{ type: 'set-node', id: dragState.nodeId, translation }], { recordUndo: false });
      dragState.changed = true;
      notify({ kind: 'transform', nodeId: dragState.nodeId, live: true });
      return { translation };
    }
    if (dragState.tool === 'rotate') {
      const rawDegrees = (deltaX - deltaY) * ROTATION_DEGREES_PER_PIXEL;
      const degrees = shiftKey ? Math.round(rawDegrees / ROTATION_SNAP_DEGREES) * ROTATION_SNAP_DEGREES : rawDegrees;
      const radians = (degrees * Math.PI) / 180;
      const axisVector = axisIndex === 0 ? [1, 0, 0] : axisIndex === 1 ? [0, 1, 0] : [0, 0, 1];
      const deltaQuaternion = quat.setAxisAngle(quat.create(), axisVector, radians);
      const nextQuaternion = quat.multiply(quat.create(), deltaQuaternion, dragState.baseRotation);
      const rotation = normalizeQuaternion(nextQuaternion);
      applySceneOperations([{ type: 'set-node', id: dragState.nodeId, rotation }], { recordUndo: false });
      dragState.changed = true;
      notify({ kind: 'transform', nodeId: dragState.nodeId, live: true });
      return { rotation };
    }
    if (dragState.tool === 'scale') {
      const signedPixels = dragState.axis === 'uniform' ? deltaX - deltaY : deltaX * dragState.axisScreen[0] + deltaY * dragState.axisScreen[1];
      const factor = Math.max(MINIMUM_SCALE, Math.min(MAXIMUM_SCALE, 1 + signedPixels / SCALE_PIXELS_PER_UNIT));
      const scale = roundVector(dragState.baseScale.map((component, index) => (
        dragState.axis === 'uniform' || index === axisIndex
          ? Math.max(MINIMUM_SCALE, Math.min(MAXIMUM_SCALE, component * factor))
          : component
      )));
      applySceneOperations([{ type: 'set-node', id: dragState.nodeId, scale }], { recordUndo: false });
      dragState.changed = true;
      notify({ kind: 'transform', nodeId: dragState.nodeId, live: true });
      return { scale };
    }
    return null;
  }

  function endGizmoDrag() {
    if (!dragState) {
      return false;
    }
    const { baseRecipe, changed } = dragState;
    dragState = null;
    if (changed) {
      pushUndoSnapshot(baseRecipe);
      notify({ kind: 'transformCommit' });
    }
    return changed;
  }

  function updateNodeTransform(nodeId, patch) {
    if (!patch || typeof patch !== 'object') {
      throw new TypeError('updateNodeTransform expects a patch object.');
    }
    const operation = { type: 'set-node', id: nodeId };
    if (patch.translation !== undefined) {
      operation.translation = roundVector(assertFiniteVector(patch.translation, 3, 'translation'));
    }
    if (patch.rotationDegrees !== undefined) {
      operation.rotation = eulerDegreesToQuaternion(assertFiniteVector(patch.rotationDegrees, 3, 'rotationDegrees'));
    } else if (patch.rotation !== undefined) {
      operation.rotation = normalizeQuaternion(assertFiniteVector(patch.rotation, 4, 'rotation'));
    }
    if (patch.scale !== undefined) {
      const scale = assertFiniteVector(patch.scale, 3, 'scale');
      if (scale.some(component => component <= 0)) {
        throw new RangeError('Node scale components must stay positive.');
      }
      operation.scale = roundVector(scale);
    }
    if (patch.visible !== undefined) {
      if (typeof patch.visible !== 'boolean') {
        throw new TypeError('Node visible must be true or false.');
      }
      operation.visible = patch.visible;
    }
    applySceneOperations([operation]);
    notify({ kind: 'transform', nodeId });
    return operation;
  }

  function updateMaterial(materialId, patch) {
    if (!patch || typeof patch !== 'object') {
      throw new TypeError('updateMaterial expects a patch object.');
    }
    const operation = { type: 'set-material', id: materialId };
    if (patch.hexColor !== undefined) {
      operation.color = hexToLinearRgb(patch.hexColor);
    } else if (patch.color !== undefined) {
      operation.color = roundVector(assertFiniteVector(patch.color, 3, 'color'));
    }
    for (const scalarField of ['roughness', 'metallic', 'emission', 'opacity']) {
      if (patch[scalarField] !== undefined) {
        if (typeof patch[scalarField] !== 'number' || !Number.isFinite(patch[scalarField])) {
          throw new TypeError(`Material ${scalarField} must be a finite number.`);
        }
        operation[scalarField] = roundValue(patch[scalarField]);
      }
    }
    applySceneOperations([operation]);
    notify({ kind: 'material', materialId });
    return operation;
  }

  function updateLook({ environment, effects } = {}) {
    const operations = [];
    if (environment !== undefined) {
      operations.push({ type: 'set-environment', environment });
    }
    if (effects !== undefined) {
      operations.push({ type: 'set-effects', effects });
    }
    if (operations.length === 0) {
      return;
    }
    applySceneOperations(operations);
    notify({ kind: 'look' });
  }

  function setSunAngles({ azimuthDegrees, elevationDegrees, keyIntensity } = {}) {
    const currentEnvironment = currentScene.exportRecipe().environment ?? {};
    const currentAngles = directionToSunAngles(currentEnvironment.lightDirection);
    const nextAzimuth = azimuthDegrees ?? currentAngles.azimuthDegrees;
    const nextElevation = elevationDegrees ?? currentAngles.elevationDegrees;
    const patch = { lightDirection: sunAnglesToDirection(nextAzimuth, nextElevation) };
    if (keyIntensity !== undefined) {
      if (typeof keyIntensity !== 'number' || !Number.isFinite(keyIntensity) || keyIntensity < 0) {
        throw new RangeError('keyIntensity must be a non-negative finite number.');
      }
      patch.keyIntensity = roundValue(keyIntensity);
    }
    updateLook({ environment: patch });
    return patch;
  }

  function orbitCamera({ deltaAzimuth = 0, deltaElevation = 0, zoomScale = 1, panX = 0, panY = 0, recordUndo = false } = {}) {
    const camera = currentScene.camera;
    const offset = vec3.subtract(vec3.create(), camera.eye, camera.target);
    const radius = Math.max(MINIMUM_DISTANCE, Math.min(MAXIMUM_DISTANCE, vec3.length(offset) * zoomScale));
    const currentHorizontal = Math.hypot(offset[0], offset[2]);
    let azimuth = Math.atan2(offset[0], offset[2]) + deltaAzimuth;
    let elevation = Math.atan2(offset[1], currentHorizontal) + deltaElevation;
    elevation = Math.max(-MAXIMUM_ELEVATION, Math.min(MAXIMUM_ELEVATION, elevation));
    const upVector = camera.up ?? [0, 1, 0];
    const forward = vec3.normalize(vec3.create(), [-offset[0], -offset[1], -offset[2]]);
    const right = vec3.normalize(vec3.create(), vec3.cross(vec3.create(), forward, upVector));
    const cameraUp = vec3.normalize(vec3.create(), vec3.cross(vec3.create(), right, forward));
    const panOffset = [
      (right[0] * panX + cameraUp[0] * panY) * radius,
      (right[1] * panX + cameraUp[1] * panY) * radius,
      (right[2] * panX + cameraUp[2] * panY) * radius,
    ];
    const nextTarget = [
      camera.target[0] + panOffset[0],
      camera.target[1] + panOffset[1],
      camera.target[2] + panOffset[2],
    ];
    const horizontal = Math.cos(elevation) * radius;
    const nextEye = [
      nextTarget[0] + Math.sin(azimuth) * horizontal,
      nextTarget[1] + Math.sin(elevation) * radius,
      nextTarget[2] + Math.cos(azimuth) * horizontal,
    ];
    const operation = { type: 'set-camera', eye: roundVector(nextEye), target: roundVector(nextTarget) };
    applySceneOperations([operation], { recordUndo });
    notify({ kind: 'camera' });
    return currentScene.camera;
  }

  function updateCamera(patch) {
    if (!patch || typeof patch !== 'object') {
      throw new TypeError('updateCamera expects a camera patch object.');
    }
    applySceneOperations([{ type: 'set-camera', ...patch }]);
    notify({ kind: 'camera' });
    return currentScene.camera;
  }

  function frameSelection() {
    const pivot = selectedPivotWorld();
    const camera = currentScene.camera;
    const target = pivot ?? camera.target;
    const offset = vec3.subtract(vec3.create(), camera.eye, camera.target);
    const direction = vec3.normalize(vec3.create(), offset);
    if (vec3.length(direction) < 1e-6) {
      vec3.set(direction, 0.5, 0.4, 0.8);
      vec3.normalize(direction, direction);
    }
    const distance = Math.max(2.4, Math.min(20, vec3.length(offset) * 0.7));
    const eye = [
      target[0] + direction[0] * distance,
      target[1] + direction[1] * distance,
      target[2] + direction[2] * distance,
    ];
    return updateCamera({ eye: roundVector(eye), target: roundVector(target) });
  }

  function listBookmarks() {
    return structuredClone(currentScene.exportRecipe().timeline?.shots ?? []);
  }

  function saveBookmark(name) {
    if (typeof name !== 'string' || !SHOT_NAME_PATTERN.test(name)) {
      throw new RangeError('Bookmark name must be 1 to 24 letters, digits, - or _.');
    }
    const recipe = currentScene.exportRecipe();
    const existingShots = recipe.timeline?.shots ?? [];
    const shot = buildTimelineShot(name, currentScene.camera, recipe);
    const nextShots = existingShots.some(candidate => candidate.name === name)
      ? existingShots.map(candidate => (candidate.name === name ? shot : candidate))
      : [...existingShots, shot];
    applySceneOperations([{ type: 'set-timeline', timeline: { shots: nextShots } }]);
    notify({ kind: 'bookmark', name });
    return structuredClone(shot);
  }

  function applyBookmark(name) {
    const recipe = currentScene.exportRecipe();
    const shot = recipe.timeline?.shots?.find(candidate => candidate.name === name);
    if (!shot) {
      throw new RangeError(`Unknown camera bookmark "${String(name)}".`);
    }
    return updateCamera(structuredClone(shot.camera ?? {}));
  }

  function removeBookmark(name) {
    const recipe = currentScene.exportRecipe();
    const existingShots = recipe.timeline?.shots ?? [];
    if (!existingShots.some(candidate => candidate.name === name)) {
      throw new RangeError(`Unknown camera bookmark "${String(name)}".`);
    }
    const remaining = existingShots.filter(candidate => candidate.name !== name);
    applySceneOperations([{ type: 'set-timeline', timeline: remaining.length > 0 ? { shots: remaining } : null }]);
    notify({ kind: 'bookmark', removed: name });
    return remaining;
  }

  function setMotionTime(seconds) {
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0 || seconds > 3600) {
      throw new RangeError(`Motion time must be between 0 and 3600 seconds, got ${JSON.stringify(seconds)}.`);
    }
    const recipe = currentScene.exportRecipe();
    if (!hasAnimatedData(recipe)) {
      if (seconds === 0) {
        motionTime = 0;
        notify({ kind: 'motion' });
        return motionTime;
      }
    }
    motionTime = currentScene.sampleMotion(seconds);
    notify({ kind: 'motion' });
    return motionTime;
  }

  function undo() {
    if (undoStack.length === 0) {
      return false;
    }
    const previousRecipe = undoStack.pop();
    redoStack.push(currentScene.exportRecipe());
    swapRecipe(previousRecipe);
    notify({ kind: 'undo' });
    return true;
  }

  function redo() {
    if (redoStack.length === 0) {
      return false;
    }
    const nextRecipe = redoStack.pop();
    undoStack.push(currentScene.exportRecipe());
    swapRecipe(nextRecipe);
    notify({ kind: 'redo' });
    return true;
  }

  function loadRecipe(recipeInput, { recordUndo = true } = {}) {
    const before = recordUndo ? currentScene.exportRecipe() : null;
    swapRecipe(recipeInput);
    if (before) {
      pushUndoSnapshot(before);
    }
    notify({ kind: 'load' });
    return currentScene.revision;
  }

  return Object.freeze({
    get scene() { return currentScene; },
    get selectedNodeId() { return selectedNodeId; },
    get tool() { return activeTool; },
    get activeTab() { return activeTab; },
    get motionTime() { return motionTime; },
    get viewportWidth() { return width; },
    get viewportHeight() { return height; },
    get canUndo() { return undoStack.length > 0; },
    get canRedo() { return redoStack.length > 0; },
    setViewportSize(nextWidth, nextHeight) {
      width = assertPositiveFinite(nextWidth, 'viewportWidth');
      height = assertPositiveFinite(nextHeight, 'viewportHeight');
      notify({ kind: 'resize' });
    },
    selectNode,
    setTool,
    setActiveTab,
    projectWorldPoint,
    screenRay,
    pickAt,
    gizmoHandles,
    beginGizmoDrag,
    updateGizmoDrag,
    endGizmoDrag,
    snapSelectedToAt,
    updateNodeTransform,
    updateMaterial,
    updateLook,
    setSunAngles,
    orbitCamera,
    updateCamera,
    frameSelection,
    listBookmarks,
    saveBookmark,
    applyBookmark,
    removeBookmark,
    setMotionTime,
    undo,
    redo,
    loadRecipe,
    exportRecipe() {
      return currentScene.exportRecipe();
    },
    dispose() {
      invalidateQuery();
    },
  });
}

const STUDIO_STYLE_ID = 'crucible-studio-styles';
const STUDIO_CSS = `
.crucible-studio {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 520px;
  overflow: hidden;
  background: #1b1f23;
  color: #edf0ef;
  font-family: 'DM Sans', system-ui, sans-serif;
  font-size: 13px;
}
.crucible-studio * { box-sizing: border-box; }
.crucible-studio-viewport {
  position: absolute;
  inset: 0;
}
.crucible-studio-canvas {
  display: block;
  width: 100%;
  height: 100%;
  touch-action: none;
  cursor: grab;
}
.crucible-studio-canvas:active { cursor: grabbing; }
.crucible-studio-gizmo {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
.crucible-studio-gizmo [data-gizmo-axis] {
  pointer-events: all;
  cursor: pointer;
}
.crucible-studio-surface {
  background: #20262be0;
  backdrop-filter: blur(14px);
  border: 1px solid #ffffff14;
  border-radius: 12px;
}
.crucible-studio-toolbar {
  position: absolute;
  top: 18px;
  left: 20px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 6px;
  z-index: 4;
}
.crucible-studio-group {
  display: flex;
  align-items: center;
  gap: 4px;
}
.crucible-studio-separator {
  inline-size: 1px;
  block-size: 20px;
  margin-inline: 4px;
  border-inline-start: 1px solid #ffffff24;
  background: transparent;
}
.crucible-studio button,
.crucible-studio select,
.crucible-studio input {
  font: inherit;
  color: inherit;
}
.crucible-studio button {
  min-inline-size: 34px;
  min-block-size: 34px;
  padding: 6px 11px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: #ffffff0a;
  cursor: pointer;
}
.crucible-studio button[aria-pressed="true"] {
  background: #b7eddf22;
  border-color: #b7eddf66;
  color: #b7eddf;
}
.crucible-studio button[aria-disabled="true"] {
  opacity: 0.42;
  cursor: not-allowed;
}
.crucible-studio :focus-visible {
  outline: 2px solid #b7eddf;
  outline-offset: 2px;
}
@media (hover: hover) {
  .crucible-studio button:not([aria-disabled="true"]):hover {
    background: #ffffff18;
  }
}
@media (prefers-reduced-motion: no-preference) {
  .crucible-studio button {
    transition: background 140ms ease, border-color 140ms ease;
  }
}
@media (pointer: coarse) {
  .crucible-studio button {
    min-inline-size: 42px;
    min-block-size: 42px;
  }
}
.crucible-studio-inspector {
  position: absolute;
  top: 18px;
  right: 20px;
  width: 288px;
  max-height: calc(100% - 104px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  z-index: 4;
}
.crucible-studio-tablist {
  display: flex;
  gap: 4px;
  padding: 8px 10px 0;
  overflow-x: auto;
  scrollbar-width: none;
}
.crucible-studio-tablist button {
  position: relative;
  flex: 1 0 auto;
  background: transparent;
  border-radius: 8px 8px 0 0;
  color: #a6b1b6;
}
.crucible-studio-tablist button[aria-selected="true"] {
  color: #edf0ef;
}
.crucible-studio-tablist button[aria-selected="true"]::after {
  content: "";
  position: absolute;
  inset: auto 8px 0;
  border-block-end: 2px solid #b7eddf;
}
.crucible-studio-panels {
  overflow-y: auto;
}
.crucible-studio-panel-body {
  display: grid;
  gap: 14px;
  padding: 14px;
}
.crucible-studio-field {
  display: grid;
  gap: 6px;
}
.crucible-studio-field-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  color: #b7c2c7;
}
.crucible-studio-field output {
  font-variant-numeric: tabular-nums;
  color: #edf0ef;
}
.crucible-studio-vector {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
}
.crucible-studio-vector label {
  display: grid;
  gap: 3px;
  font-size: 11px;
  color: #96a4ac;
}
.crucible-studio input[type="number"],
.crucible-studio input[type="text"],
.crucible-studio select,
.crucible-studio textarea {
  width: 100%;
  padding: 7px 8px;
  border: 1px solid #ffffff1c;
  border-radius: 7px;
  background: #14181c;
  color: #edf0ef;
  font-variant-numeric: tabular-nums;
}
.crucible-studio input[type="range"] {
  width: 100%;
  accent-color: #b7eddf;
  cursor: pointer;
}
.crucible-studio input[type="color"] {
  width: 100%;
  height: 32px;
  padding: 2px;
  border: 1px solid #ffffff1c;
  border-radius: 7px;
  background: #14181c;
  cursor: pointer;
}
.crucible-studio-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.crucible-studio-bookmark-row {
  display: flex;
  gap: 6px;
  align-items: center;
}
.crucible-studio-bookmark-row button:first-child {
  flex: 1;
  text-align: left;
}
.crucible-studio-bottom {
  position: absolute;
  left: 20px;
  right: 20px;
  bottom: 16px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  z-index: 4;
}
.crucible-studio-scrub {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1 1 220px;
}
.crucible-studio-scrub output {
  white-space: nowrap;
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}
.crucible-studio-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 12px;
  color: #a4b0b6;
  font-variant-numeric: tabular-nums;
}
.crucible-studio-status {
  position: absolute;
  left: 20px;
  bottom: 76px;
  margin: 0;
  padding: 6px 10px;
  border-radius: 8px;
  background: #14181ce8;
  font-size: 12px;
  color: #b7eddf;
  pointer-events: none;
  z-index: 5;
}
.crucible-studio-status:empty { display: none; }
.crucible-studio dialog {
  width: min(560px, calc(100vw - 32px));
  padding: 18px;
  border: 1px solid #ffffff20;
  border-radius: 14px;
  background: #20262b;
  color: #edf0ef;
}
.crucible-studio dialog::backdrop { background: #0d1014b8; }
.crucible-studio-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
}
@media (max-width: 760px) {
  .crucible-studio-inspector {
    top: auto;
    left: 12px;
    right: 12px;
    bottom: 78px;
    width: auto;
    max-height: 36vh;
  }
  .crucible-studio-toolbar {
    top: 12px;
    left: 12px;
    right: 12px;
  }
  .crucible-studio-bottom {
    left: 12px;
    right: 12px;
    bottom: 12px;
  }
}
@media (forced-colors: active) {
  .crucible-studio button[aria-pressed="true"] {
    outline: 2px solid Highlight;
  }
}
`;

function injectStudioStyles(documentReference) {
  if (documentReference.getElementById(STUDIO_STYLE_ID)) {
    return;
  }
  const style = documentReference.createElement('style');
  style.id = STUDIO_STYLE_ID;
  style.textContent = STUDIO_CSS;
  documentReference.head.append(style);
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

function createVectorRow(documentReference, title, onInput) {
  const inputs = AXIS_NAMES.map(axis => createElement(documentReference, 'input', {
    type: 'number',
    step: '0.05',
    attributes: { 'aria-label': `${title} ${axis.toUpperCase()}` },
  }));
  inputs.forEach((input, axisIndex) => {
    input.addEventListener('change', () => {
      const parsed = inputs.map(field => Number(field.value));
      if (parsed.every(Number.isFinite)) {
        onInput(parsed, axisIndex);
      }
    });
  });
  const container = createElement(
    documentReference,
    'div',
    { className: 'crucible-studio-field' },
    createElement(documentReference, 'span', { className: 'crucible-studio-field-head', textContent: title }),
    createElement(
      documentReference,
      'div',
      { className: 'crucible-studio-vector' },
      ...inputs.map((input, axisIndex) => createElement(
        documentReference,
        'label',
        {},
        createElement(documentReference, 'span', { textContent: AXIS_NAMES[axisIndex].toUpperCase() }),
        input,
      )),
    ),
  );
  return {
    container,
    inputs,
    setValues(values, precision = ROUND_PRECISION) {
      inputs.forEach((input, index) => {
        input.value = String(roundValue(values[index] ?? 0, precision));
      });
    },
  };
}

function createSliderField(documentReference, labelText, { min, max, step, value = 0 }, onChange) {
  const output = createElement(documentReference, 'output', { textContent: String(value) });
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
    output.textContent = numeric.toFixed(step < 0.1 ? 2 : step < 1 ? 1 : 0);
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
      output.textContent = Number(nextValue).toFixed(step < 0.1 ? 2 : step < 1 ? 1 : 0);
    },
  };
}

/**
 * Mounts an interactive browser Studio with viewport picking, SVG transform gizmos, look controls and bookmarks.
 */
export function createStudio(container, { scene: suppliedScene, recipe: suppliedRecipe, canvas: suppliedCanvas, renderer: suppliedRenderer, rendererOptions = {} } = {}) {
  if (!container || typeof container.append !== 'function') {
    throw new TypeError('createStudio requires a DOM container element.');
  }
  const documentReference = container.ownerDocument;
  injectStudioStyles(documentReference);

  const initialScene = suppliedScene ?? createAgentScene(suppliedRecipe);
  let handleChange = () => {};
  const controller = createStudioController({ scene: initialScene, onChange: detail => handleChange(detail) });
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
  let statusTimer = 0;

  function announce(message) {
    statusRegion.textContent = message;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      statusRegion.textContent = '';
    }, 3200);
  }

  const root = createElement(documentReference, 'div', { className: 'crucible-studio' });
  viewportElement.append(canvas, gizmoSvg);
  root.append(viewportElement, statusRegion);
  container.append(root);

  let renderer = suppliedRenderer ?? null;
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

  function drawSceneFrame() {
    const activeRenderer = ensureRenderer();
    if (renderedTopology !== controller.scene.topologyRevision) {
      activeRenderer.replaceParts(controller.scene.parts);
      renderedTopology = controller.scene.topologyRevision;
    } else {
      activeRenderer.updateParts(controller.scene.parts);
    }
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

  function renderGizmoOverlay() {
    gizmoSvg.replaceChildren();
    const handles = controller.gizmoHandles();
    if (!handles || !handles.origin.visible) {
      return;
    }
    const width = controller.viewportWidth;
    const height = controller.viewportHeight;
    gizmoSvg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    const origin = handles.origin;
    const colors = { x: '#f26b5b', y: '#7be082', z: '#5ea8ff' };
    for (const axis of AXIS_NAMES) {
      const tip = handles.axes[axis];
      if (!tip.visible) {
        continue;
      }
      const line = createSvgElement(documentReference, 'line', {
        x1: origin.x.toFixed(1),
        y1: origin.y.toFixed(1),
        x2: tip.x.toFixed(1),
        y2: tip.y.toFixed(1),
        stroke: colors[axis],
        'stroke-width': '3',
        'stroke-linecap': 'round',
        'data-gizmo-axis': axis,
      });
      const handle = createSvgElement(documentReference, 'circle', {
        cx: tip.x.toFixed(1),
        cy: tip.y.toFixed(1),
        r: '7',
        fill: colors[axis],
        stroke: '#14181c',
        'stroke-width': '1.5',
        'data-gizmo-axis': axis,
      });
      gizmoSvg.append(line, handle);
    }
    const centerHandle = createSvgElement(documentReference, 'circle', {
      cx: origin.x.toFixed(1),
      cy: origin.y.toFixed(1),
      r: '6',
      fill: '#edf0ef',
      stroke: '#14181c',
      'stroke-width': '2',
      'data-gizmo-axis': controller.tool === 'scale' ? 'uniform' : 'surface',
    });
    gizmoSvg.append(centerHandle);
  }

  function renderPass() {
    insideDraw = true;
    try {
      syncViewportDimensions();
      drawSceneFrame();
      renderGizmoOverlay();
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

  // Toolbar construction (Modern Web Guidance: toolbar pattern)
  const toolLabels = { translate: 'Move', rotate: 'Rotate', scale: 'Scale', snap: 'Snap' };
  const toolButtons = STUDIO_TOOLS.map(tool => createElement(documentReference, 'button', {
    type: 'button',
    textContent: toolLabels[tool],
    dataset: { tool },
    attributes: { 'aria-pressed': tool === controller.tool ? 'true' : 'false' },
  }));
  toolButtons.forEach(button => {
    button.addEventListener('click', () => {
      controller.setTool(button.dataset.tool);
    });
  });

  const undoButton = createElement(documentReference, 'button', { type: 'button', textContent: 'Undo', attributes: { 'aria-disabled': 'true' } });
  const redoButton = createElement(documentReference, 'button', { type: 'button', textContent: 'Redo', attributes: { 'aria-disabled': 'true' } });
  const frameButton = createElement(documentReference, 'button', { type: 'button', textContent: 'Frame' });
  const copyButton = createElement(documentReference, 'button', { type: 'button', textContent: 'Copy JSON' });
  const importButton = createElement(documentReference, 'button', { type: 'button', textContent: 'Import JSON' });

  undoButton.addEventListener('click', () => {
    if (undoButton.getAttribute('aria-disabled') === 'true') return;
    if (controller.undo()) announce('Undid edit');
  });
  redoButton.addEventListener('click', () => {
    if (redoButton.getAttribute('aria-disabled') === 'true') return;
    if (controller.redo()) announce('Redid edit');
  });
  frameButton.addEventListener('click', () => {
    controller.frameSelection();
    announce('Framed view');
  });
  copyButton.addEventListener('click', async () => {
    const jsonText = JSON.stringify(controller.exportRecipe(), null, 2);
    try {
      await navigator.clipboard.writeText(jsonText);
      announce('Recipe copied');
    } catch {
      openImportDialog(jsonText);
      announce('Clipboard blocked; recipe shown');
    }
  });

  const toolbarElement = createElement(
    documentReference,
    'div',
    {
      className: 'crucible-studio-toolbar crucible-studio-surface',
      attributes: { role: 'toolbar', focusgroup: 'toolbar wrap', 'aria-label': 'Viewport tools', 'aria-controls': canvas.id },
    },
    createElement(documentReference, 'div', { className: 'crucible-studio-group', attributes: { role: 'group', 'aria-label': 'Transform mode' } }, ...toolButtons),
    createElement(documentReference, 'span', { className: 'crucible-studio-separator', attributes: { role: 'separator', 'aria-orientation': 'vertical' } }),
    createElement(documentReference, 'div', { className: 'crucible-studio-group', attributes: { role: 'group', 'aria-label': 'Scene actions' } }, undoButton, redoButton, frameButton, copyButton, importButton),
  );
  wireRovingFocusFallback(toolbarElement, [...toolButtons, undoButton, redoButton, frameButton, copyButton, importButton]);
  root.append(toolbarElement);

  // Inspector Tabs (Modern Web Guidance: tabs pattern)
  const tabLabels = { node: 'Object', look: 'Look', camera: 'Camera' };
  const tabButtons = STUDIO_TABS.map(tab => createElement(documentReference, 'button', {
    type: 'button',
    id: `crucible-studio-tab-${tab}`,
    textContent: tabLabels[tab],
    dataset: { tab },
    attributes: {
      'aria-selected': tab === controller.activeTab ? 'true' : 'false',
      ...(tab === controller.activeTab ? { focusgroupstart: '' } : {}),
    },
  }));
  const tabListElement = createElement(
    documentReference,
    'div',
    { className: 'crucible-studio-tablist', attributes: { focusgroup: 'tablist nomemory', 'aria-label': 'Inspector sections' } },
    ...tabButtons,
  );
  if (!('focusGroup' in HTMLElement.prototype)) {
    tabListElement.setAttribute('role', 'tablist');
    tabButtons.forEach(button => button.setAttribute('role', 'tab'));
  }

  // Object Panel
  const nodeSelect = createElement(documentReference, 'select', { attributes: { 'aria-label': 'Selected node' } });
  const visibleToggle = createElement(documentReference, 'button', { type: 'button', textContent: 'Visible', attributes: { 'aria-pressed': 'true' } });
  nodeSelect.addEventListener('change', () => controller.selectNode(nodeSelect.value || null));
  visibleToggle.addEventListener('click', () => {
    if (!controller.selectedNodeId) return;
    const node = controller.exportRecipe().nodes.find(candidate => candidate.id === controller.selectedNodeId);
    controller.updateNodeTransform(controller.selectedNodeId, { visible: !(node?.visible ?? true) });
  });

  const positionRow = createVectorRow(documentReference, 'Position', values => {
    if (controller.selectedNodeId) controller.updateNodeTransform(controller.selectedNodeId, { translation: values });
  });
  const rotationRow = createVectorRow(documentReference, 'Rotation', values => {
    if (controller.selectedNodeId) controller.updateNodeTransform(controller.selectedNodeId, { rotationDegrees: values });
  });
  const scaleRow = createVectorRow(documentReference, 'Scale', values => {
    if (controller.selectedNodeId && values.every(component => component > 0)) {
      controller.updateNodeTransform(controller.selectedNodeId, { scale: values });
    }
  });

  const colorInput = createElement(documentReference, 'input', { type: 'color', value: '#cccccc', attributes: { 'aria-label': 'Base color' } });
  colorInput.addEventListener('input', () => {
    const node = controller.exportRecipe().nodes.find(candidate => candidate.id === controller.selectedNodeId);
    if (node?.material) controller.updateMaterial(node.material, { hexColor: colorInput.value });
  });
  const roughnessField = createSliderField(documentReference, 'Roughness', { min: 0.02, max: 1, step: 0.02, value: 0.5 }, value => {
    const node = controller.exportRecipe().nodes.find(candidate => candidate.id === controller.selectedNodeId);
    if (node?.material) controller.updateMaterial(node.material, { roughness: value });
  });
  const metallicField = createSliderField(documentReference, 'Metallic', { min: 0, max: 1, step: 0.02, value: 0 }, value => {
    const node = controller.exportRecipe().nodes.find(candidate => candidate.id === controller.selectedNodeId);
    if (node?.material) controller.updateMaterial(node.material, { metallic: value });
  });
  const emissionField = createSliderField(documentReference, 'Emission', { min: 0, max: 12, step: 0.1, value: 0 }, value => {
    const node = controller.exportRecipe().nodes.find(candidate => candidate.id === controller.selectedNodeId);
    if (node?.material) controller.updateMaterial(node.material, { emission: value });
  });

  const nodePanelBody = createElement(
    documentReference,
    'div',
    { className: 'crucible-studio-panel-body' },
    createElement(documentReference, 'div', { className: 'crucible-studio-field' }, createElement(documentReference, 'div', { className: 'crucible-studio-field-head' }, createElement(documentReference, 'span', { textContent: 'Node' }), visibleToggle), nodeSelect),
    positionRow.container,
    rotationRow.container,
    scaleRow.container,
    createElement(documentReference, 'div', { className: 'crucible-studio-field' }, createElement(documentReference, 'span', { className: 'crucible-studio-field-head', textContent: 'Material color' }), colorInput),
    roughnessField.container,
    metallicField.container,
    emissionField.container,
  );

  // Look Panel
  const setupButtons = LIGHTING_SETUP_NAMES.map(setup => {
    const button = createElement(documentReference, 'button', {
      type: 'button',
      textContent: setup,
      dataset: { setup },
      attributes: { 'aria-pressed': 'false' },
    });
    button.addEventListener('click', () => controller.updateLook({ environment: { setup } }));
    return button;
  });
  const azimuthField = createSliderField(documentReference, 'Sun azimuth', { min: -180, max: 180, step: 1, value: -35 }, value => controller.setSunAngles({ azimuthDegrees: value }));
  const elevationField = createSliderField(documentReference, 'Sun elevation', { min: 2, max: 88, step: 1, value: 50 }, value => controller.setSunAngles({ elevationDegrees: value }));
  const exposureField = createSliderField(documentReference, 'Exposure', { min: 0.2, max: 3, step: 0.05, value: 1 }, value => controller.updateLook({ effects: { exposure: value } }));
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
  const fogField = createSliderField(documentReference, 'Fog density', { min: 0, max: 0.1, step: 0.002, value: 0 }, value => controller.updateLook({ environment: { fogDensity: value } }));

  const lookPanelBody = createElement(
    documentReference,
    'div',
    { className: 'crucible-studio-panel-body' },
    createElement(documentReference, 'div', { className: 'crucible-studio-field' }, createElement(documentReference, 'span', { className: 'crucible-studio-field-head', textContent: 'Lighting setup' }), createElement(documentReference, 'div', { className: 'crucible-studio-chips' }, ...setupButtons)),
    azimuthField.container,
    elevationField.container,
    exposureField.container,
    createElement(documentReference, 'div', { className: 'crucible-studio-field' }, createElement(documentReference, 'span', { className: 'crucible-studio-field-head', textContent: 'View transform' }), viewTransformSelect),
    bloomField.container,
    fogField.container,
  );

  // Camera Panel
  const fovField = createSliderField(documentReference, 'Field of view', { min: 15, max: 110, step: 1, value: 45 }, value => controller.updateCamera({ fov: value }));
  const bookmarkNameInput = createElement(documentReference, 'input', { type: 'text', placeholder: 'Bookmark name', attributes: { 'aria-label': 'Bookmark name', maxlength: '24' } });
  const saveBookmarkButton = createElement(documentReference, 'button', { type: 'button', textContent: 'Save view' });
  const bookmarkListElement = createElement(documentReference, 'div', { className: 'crucible-studio-field' });
  saveBookmarkButton.addEventListener('click', async () => {
    const name = bookmarkNameInput.value.trim().replace(/\s+/g, '-') || `shot-${controller.listBookmarks().length + 1}`;
    try {
      await loadAgentSceneModules({ timeline: { shots: [] } });
      controller.saveBookmark(name);
      bookmarkNameInput.value = '';
      announce(`Saved bookmark ${name}`);
    } catch (error) {
      announce(error.message);
    }
  });
  const cameraPanelBody = createElement(
    documentReference,
    'div',
    { className: 'crucible-studio-panel-body' },
    fovField.container,
    createElement(documentReference, 'div', { className: 'crucible-studio-field' }, createElement(documentReference, 'span', { className: 'crucible-studio-field-head', textContent: 'Bookmarks' }), createElement(documentReference, 'div', { className: 'crucible-studio-bookmark-row' }, bookmarkNameInput, saveBookmarkButton), bookmarkListElement),
  );

  const panelsByTab = {
    node: createElement(documentReference, 'div', { id: 'crucible-studio-panel-node', tabIndex: 0, attributes: { role: 'tabpanel', 'aria-labelledby': 'crucible-studio-tab-node' } }, nodePanelBody),
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
    { className: 'crucible-studio-inspector crucible-studio-surface', attributes: { 'aria-label': 'Scene inspector' } },
    tabListElement,
    createElement(documentReference, 'div', { className: 'crucible-studio-panels' }, panelsByTab.node, panelsByTab.look, panelsByTab.camera),
  );
  root.append(inspectorElement);

  // Bottom bar: Timeline scrub + Download / Import recipe
  const playButton = createElement(documentReference, 'button', { type: 'button', textContent: 'Play', attributes: { 'aria-pressed': 'false' } });
  const timeOutput = createElement(documentReference, 'output', { textContent: '0.00 s' });
  const scrubInput = createElement(documentReference, 'input', { type: 'range', min: '0', max: '4', step: '0.02', value: '0', attributes: { 'aria-label': 'Timeline time' } });
  const statsLabel = createElement(documentReference, 'span', {});
  const downloadButton = createElement(documentReference, 'button', { type: 'button', textContent: 'Download JSON' });
  const fileInput = createElement(documentReference, 'input', { type: 'file', accept: '.json,application/json', hidden: true });

  playButton.addEventListener('click', () => {
    if (!hasAnimatedData(controller.exportRecipe())) {
      announce('Scene has no motion tracks');
      return;
    }
    playing = !playing;
    lastFrameTime = 0;
    playButton.setAttribute('aria-pressed', playing ? 'true' : 'false');
    playButton.textContent = playing ? 'Pause' : 'Play';
    if (playing) requestFrame();
  });
  scrubInput.addEventListener('input', () => {
    const seconds = Number(scrubInput.value);
    if (hasAnimatedData(controller.exportRecipe())) {
      controller.setMotionTime(seconds);
    }
  });
  downloadButton.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(controller.exportRecipe(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = createElement(documentReference, 'a', { href: url, download: 'crucible-scene.json' });
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    announce('Downloaded recipe');
  });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      await loadAgentSceneModules(parsed);
      controller.loadRecipe(parsed);
      announce(`Loaded ${file.name}`);
    } catch (error) {
      announce(error.message);
    }
  });

  // Recipe JSON dialog for paste/view
  const dialogTextarea = createElement(documentReference, 'textarea', { rows: 14, attributes: { 'aria-label': 'Scene recipe JSON' } });
  const dialogApplyButton = createElement(documentReference, 'button', { type: 'button', textContent: 'Apply JSON' });
  const dialogFileButton = createElement(documentReference, 'button', { type: 'button', textContent: 'Choose file' });
  const dialogCloseButton = createElement(documentReference, 'button', { type: 'button', textContent: 'Close' });
  const recipeDialog = createElement(
    documentReference,
    'dialog',
    { attributes: { 'aria-label': 'Recipe JSON' } },
    dialogTextarea,
    createElement(documentReference, 'div', { className: 'crucible-studio-dialog-actions' }, dialogFileButton, dialogCloseButton, dialogApplyButton),
  );
  function openImportDialog(initialText = '') {
    dialogTextarea.value = initialText || JSON.stringify(controller.exportRecipe(), null, 2);
    recipeDialog.showModal();
  }
  importButton.addEventListener('click', () => openImportDialog());
  dialogFileButton.addEventListener('click', () => {
    recipeDialog.close();
    fileInput.click();
  });
  dialogCloseButton.addEventListener('click', () => recipeDialog.close());
  dialogApplyButton.addEventListener('click', async () => {
    try {
      const parsed = JSON.parse(dialogTextarea.value);
      await loadAgentSceneModules(parsed);
      controller.loadRecipe(parsed);
      recipeDialog.close();
      announce('Recipe loaded');
    } catch (error) {
      announce(error.message);
    }
  });
  root.append(fileInput, recipeDialog);

  const bottomElement = createElement(
    documentReference,
    'div',
    { className: 'crucible-studio-bottom crucible-studio-surface' },
    createElement(documentReference, 'div', { className: 'crucible-studio-scrub' }, playButton, scrubInput, timeOutput),
    createElement(documentReference, 'div', { className: 'crucible-studio-meta' }, statsLabel, downloadButton),
  );
  root.append(bottomElement);

  let lastNodesKey = '';
  let lastBookmarksKey = '';

  function syncUi() {
    const recipe = controller.exportRecipe();
    toolButtons.forEach(button => {
      button.setAttribute('aria-pressed', button.dataset.tool === controller.tool ? 'true' : 'false');
    });
    undoButton.setAttribute('aria-disabled', controller.canUndo ? 'false' : 'true');
    redoButton.setAttribute('aria-disabled', controller.canRedo ? 'false' : 'true');

    const nodesKey = recipe.nodes.map(node => `${node.id}:${node.label ?? ''}`).join('|');
    if (nodesKey !== lastNodesKey) {
      lastNodesKey = nodesKey;
      nodeSelect.replaceChildren(
        createElement(documentReference, 'option', { value: '', textContent: 'None' }),
        ...recipe.nodes.map(node => createElement(documentReference, 'option', { value: node.id, textContent: node.label ?? node.id })),
      );
    }
    nodeSelect.value = controller.selectedNodeId ?? '';
    const selectedNode = recipe.nodes.find(node => node.id === controller.selectedNodeId);
    const hasNode = Boolean(selectedNode);
    visibleToggle.setAttribute('aria-pressed', selectedNode?.visible === false ? 'false' : 'true');
    visibleToggle.setAttribute('aria-disabled', hasNode ? 'false' : 'true');
    positionRow.setValues(selectedNode?.translation ?? [0, 0, 0]);
    rotationRow.setValues(quaternionToEulerDegrees(selectedNode?.rotation ?? [0, 0, 0, 1]), DEGREE_PRECISION);
    scaleRow.setValues(selectedNode?.scale ?? [1, 1, 1]);

    const boundMaterial = selectedNode?.material ? recipe.materials.find(material => material.id === selectedNode.material) : null;
    colorInput.disabled = !boundMaterial;
    roughnessField.input.disabled = !boundMaterial;
    metallicField.input.disabled = !boundMaterial;
    emissionField.input.disabled = !boundMaterial;
    if (boundMaterial) {
      colorInput.value = linearRgbToHex(boundMaterial.color);
      roughnessField.setValue(boundMaterial.roughness ?? 0.5);
      metallicField.setValue(boundMaterial.metallic ?? 0);
      emissionField.setValue(boundMaterial.emission ?? 0);
    }

    const environment = recipe.environment ?? {};
    const effects = recipe.effects ?? {};
    const activeSetup = environment.setup ?? 'daylight';
    setupButtons.forEach(button => button.setAttribute('aria-pressed', button.dataset.setup === activeSetup ? 'true' : 'false'));
    const sunAngles = directionToSunAngles(environment.lightDirection);
    azimuthField.setValue(sunAngles.azimuthDegrees);
    elevationField.setValue(sunAngles.elevationDegrees);
    exposureField.setValue(effects.exposure ?? 1);
    viewTransformSelect.value = environment.viewTransform ?? 'aces';
    bloomField.setValue(effects.bloom?.strength ?? 0);
    fogField.setValue(environment.fogDensity ?? 0);

    const camera = controller.scene.camera;
    fovField.setValue(Math.round(camera.fov ?? 45));
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
    }

    const duration = recipe.motion?.duration ?? 4;
    const animated = hasAnimatedData(recipe);
    scrubInput.max = String(Math.max(0.1, duration));
    scrubInput.value = String(controller.motionTime);
    scrubInput.disabled = !animated;
    playButton.setAttribute('aria-disabled', animated ? 'false' : 'true');
    playButton.setAttribute('aria-pressed', playing ? 'true' : 'false');
    playButton.textContent = playing ? 'Pause' : 'Play';
    timeOutput.textContent = `${controller.motionTime.toFixed(2)} s`;
    statsLabel.textContent = `Rev ${controller.scene.revision} · ${controller.scene.parts.length} parts`;
  }

  // Viewport interaction: gizmo drag, pick, orbit, pan, zoom
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

  // Keyboard shortcuts while canvas has focus
  canvas.addEventListener('keydown', event => {
    if (event.key === 'f' || event.key === 'F') {
      controller.frameSelection();
    } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) controller.redo();
      else controller.undo();
    } else if (event.key === 'g') {
      controller.setTool('translate');
    } else if (event.key === 'r') {
      controller.setTool('rotate');
    } else if (event.key === 's') {
      controller.setTool('scale');
    }
  });

  const onVisibilityChange = () => {
    if (!documentReference.hidden && isVisible) requestFrame();
  };
  documentReference.addEventListener('visibilitychange', onVisibilityChange);

  const wrappedController = {
    get controller() { return controller; },
    get scene() { return controller.scene; },
    get renderer() { return renderer; },
    exportRecipe: () => controller.exportRecipe(),
    loadRecipe: (recipeInput, options) => controller.loadRecipe(recipeInput, options),
    selectNode: nodeId => controller.selectNode(nodeId),
    setTool: tool => controller.setTool(tool),
    setActiveTab: tab => selectInspectorTab(tab),
    pickAt: (pixelX, pixelY) => controller.pickAt(pixelX, pixelY),
    renderNow() {
      renderPass();
    },
    dispose() {
      clearTimeout(statusTimer);
      if (frameHandle) cancelAnimationFrame(frameHandle);
      documentReference.removeEventListener('visibilitychange', onVisibilityChange);
      resizeObserver?.disconnect();
      intersectionObserver?.disconnect();
      controller.dispose();
      renderer?.dispose();
      root.remove();
    },
  };

  handleChange = detail => {
    syncUi();
    if (detail.kind === 'tab' || insideDraw) return;
    requestFrame();
  };

  if (typeof ResizeObserver === 'function') {
    resizeObserver = new ResizeObserver(() => requestFrame());
    resizeObserver.observe(viewportElement);
  }
  if (typeof IntersectionObserver === 'function') {
    intersectionObserver = new IntersectionObserver(entries => {
      isVisible = entries.some(entry => entry.isIntersecting);
      if (isVisible) requestFrame();
    }, { threshold: 0.01 });
    intersectionObserver.observe(viewportElement);
  }

  // Initial draw
  syncUi();
  renderPass();
  return wrappedController;
}
