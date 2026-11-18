import { mat4, quat, vec3 } from 'gl-matrix';
import { applyProjection, cameraFieldOfView } from './camera.js';
import { createAgentScene } from './agent-scene.js';
import { createSceneQuery } from './scene-query.js';
import { MAX_POINT_LIGHTS, MAX_SPOT_LIGHTS } from './light-limits.js';
import {
  STUDIO_MATERIAL_PRESETS,
  STUDIO_PRIMITIVES,
  STUDIO_TABS,
  STUDIO_TEMPLATES,
  STUDIO_TOOLS,
  STUDIO_VIEW_PRESETS,
  primitiveGeometrySpec,
} from './studio-templates.js';

const AXIS_NAMES = Object.freeze(['x', 'y', 'z']);
const PLANE_AXES = Object.freeze(['xy', 'xz', 'yz']);
const GIZMO_AXES = Object.freeze(['x', 'y', 'z', 'xy', 'xz', 'yz', 'screen', 'uniform', 'surface']);
const SHOT_NAME_PATTERN = /^[A-Za-z0-9_-]{1,24}$/;
const GIZMO_SCREEN_PIXELS = 74;
const ROTATION_RING_SEGMENTS = 32;
const ROTATION_DEGREES_PER_PIXEL = 0.75;
const ROTATION_SNAP_DEGREES = 15;
const TRANSLATION_SNAP_STEP = 0.25;
const SCALE_PIXELS_PER_UNIT = 90;
const MINIMUM_SCALE = 0.05;
const MAXIMUM_SCALE = 100;
const MINIMUM_DISTANCE = 0.25;
const MAXIMUM_DISTANCE = 400;
const MAXIMUM_ELEVATION = 1.53;
const ROUND_PRECISION = 10000;
const DEGREE_PRECISION = 100;

export function roundValue(value, precision = ROUND_PRECISION) {
  return Math.round(value * precision) / precision;
}

export function roundVector(values, precision = ROUND_PRECISION) {
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

export function quaternionToEulerDegrees(quaternion) {
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

export function linearRgbToHex(rgb) {
  const values = Array.isArray(rgb) ? rgb : [0.8, 0.8, 0.8];
  const hex = values.slice(0, 3).map(channel => {
    const byte = Math.max(0, Math.min(255, Math.round(linearChannelToSrgb(channel) * 255)));
    return byte.toString(16).padStart(2, '0');
  });
  return `#${hex.join('')}`;
}

export function hexToLinearRgb(hexText) {
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

export function directionToSunAngles(direction) {
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

export function sunAnglesToDirection(azimuthDegrees, elevationDegrees) {
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
  applyProjection(
    projection,
    {
      projection: camera.projection ?? 'perspective',
      fov: camera.fov,
      focalLength: camera.focalLength,
      sensorWidth: camera.sensorWidth,
      orthoScale: camera.orthoScale,
      shift: camera.shift,
      near: camera.near ?? 0.1,
      far: camera.far ?? (worldMode ? 600 : 100),
    },
    aspect,
    { world: worldMode },
  );
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
  if (camera.projection) {
    payload.projection = camera.projection;
  }
  if (camera.orthoScale !== undefined) {
    payload.orthoScale = roundValue(camera.orthoScale);
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

export function hasAnimatedData(recipe) {
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

function uniqueIdentifier(existingIds, prefix) {
  let counter = 1;
  while (existingIds.has(`${prefix}-${counter}`)) {
    counter += 1;
  }
  return `${prefix}-${counter}`;
}

function rayPlaneIntersection(rayOrigin, rayDirection, planePoint, planeNormal) {
  const denominator = vec3.dot(rayDirection, planeNormal);
  if (Math.abs(denominator) < 1e-5) {
    return null;
  }
  const offset = vec3.subtract(vec3.create(), planePoint, rayOrigin);
  const distance = vec3.dot(offset, planeNormal) / denominator;
  if (!Number.isFinite(distance) || distance < 0 || distance > 2000) {
    return null;
  }
  return [
    rayOrigin[0] + rayDirection[0] * distance,
    rayOrigin[1] + rayDirection[1] * distance,
    rayOrigin[2] + rayDirection[2] * distance,
  ];
}

function planeNormalForAxis(axis, camera) {
  if (axis === 'xy') return [0, 0, 1];
  if (axis === 'xz') return [0, 1, 0];
  if (axis === 'yz') return [1, 0, 0];
  const look = vec3.subtract(vec3.create(), camera.eye, camera.target);
  if (vec3.length(look) < 1e-6) {
    return [0, 0, 1];
  }
  vec3.normalize(look, look);
  return [look[0], look[1], look[2]];
}

function upsertNodeKeyframeTrack(tracks, nodeId, property, time, value) {
  const nextTracks = tracks.map(track => structuredClone(track));
  const existing = nextTracks.find(track => track.kind === 'node' && track.id === nodeId && track.property === property);
  if (!existing) {
    nextTracks.push({
      kind: 'node',
      id: nodeId,
      property,
      keyframes: [{ time: roundValue(time, 1000), value: roundVector(value) }],
    });
    return nextTracks;
  }
  const roundedTime = roundValue(time, 1000);
  const matchIndex = existing.keyframes.findIndex(keyframe => Math.abs(keyframe.time - roundedTime) < 0.005);
  const entry = { time: roundedTime, value: roundVector(value) };
  if (matchIndex >= 0) {
    existing.keyframes[matchIndex] = entry;
  } else {
    existing.keyframes.push(entry);
    existing.keyframes.sort((first, second) => first.time - second.time);
  }
  return nextTracks;
}

function snapVector(values, step = TRANSLATION_SNAP_STEP) {
  return values.map(component => roundValue(Math.round(component / step) * step));
}

/**
 * Headless controller bridging interactive viewport picking, 3D gizmos, scene editing and inspector state to an AgentScene recipe.
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

  function worldLengthPerPixel(pivot) {
    const camera = currentScene.camera;
    const distance = pivot ? Math.max(0.5, vec3.distance(camera.eye, pivot)) : 5;
    if (camera.projection === 'orthographic') {
      return (camera.orthoScale ?? 4) / height;
    }
    const fieldOfViewDegrees = cameraFieldOfView(camera, width / height);
    return (2 * distance * Math.tan((fieldOfViewDegrees * Math.PI) / 360)) / height;
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
    const handleLength = Math.max(0.25, worldLengthPerPixel(pivot) * GIZMO_SCREEN_PIXELS);
    const origin = projectWorldPoint(pivot);
    const planeExtent = handleLength * 0.4;
    const planeCorner = (deltaX, deltaY, deltaZ) => projectWorldPoint([pivot[0] + deltaX, pivot[1] + deltaY, pivot[2] + deltaZ]);
    const ringPoints = axis => {
      const points = [];
      for (let step = 0; step <= ROTATION_RING_SEGMENTS; step += 1) {
        const angle = (step / ROTATION_RING_SEGMENTS) * Math.PI * 2;
        const cosine = Math.cos(angle) * handleLength * 0.92;
        const sine = Math.sin(angle) * handleLength * 0.92;
        const worldOffset = axis === 'x'
          ? [0, cosine, sine]
          : axis === 'y'
            ? [cosine, 0, sine]
            : [cosine, sine, 0];
        points.push(projectWorldPoint([pivot[0] + worldOffset[0], pivot[1] + worldOffset[1], pivot[2] + worldOffset[2]]));
      }
      return points;
    };
    return {
      pivot,
      handleLength,
      origin,
      axes: {
        x: planeCorner(handleLength, 0, 0),
        y: planeCorner(0, handleLength, 0),
        z: planeCorner(0, 0, handleLength),
      },
      planes: {
        xy: [origin, planeCorner(planeExtent, 0, 0), planeCorner(planeExtent, planeExtent, 0), planeCorner(0, planeExtent, 0)],
        xz: [origin, planeCorner(planeExtent, 0, 0), planeCorner(planeExtent, 0, planeExtent), planeCorner(0, 0, planeExtent)],
        yz: [origin, planeCorner(0, planeExtent, 0), planeCorner(0, planeExtent, planeExtent), planeCorner(0, 0, planeExtent)],
      },
      rings: {
        x: ringPoints('x'),
        y: ringPoints('y'),
        z: ringPoints('z'),
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
    if (AXIS_NAMES.includes(axis) && handles) {
      const axisPoint = handles.axes[axis];
      const deltaX = axisPoint.x - handles.origin.x;
      const deltaY = axisPoint.y - handles.origin.y;
      const length = Math.hypot(deltaX, deltaY);
      if (length > 1) {
        axisScreen = [deltaX / length, deltaY / length];
      }
    }
    const basePivot = handles?.pivot ?? Array.from(node.translation ?? [0, 0, 0]);
    const isPlanar = PLANE_AXES.includes(axis) || axis === 'screen';
    const planeNormal = isPlanar ? planeNormalForAxis(axis, currentScene.camera) : null;
    let planeStartPoint = basePivot;
    if (planeNormal) {
      const ray = screenRay(pixelX, pixelY);
      planeStartPoint = rayPlaneIntersection(ray.origin, ray.direction, basePivot, planeNormal) ?? basePivot;
    }
    const worldPerPixel = worldLengthPerPixel(basePivot);
    const toolMode = axis === 'surface' ? 'snap' : activeTool === 'select' ? 'translate' : activeTool;
    dragState = {
      nodeId: selectedNodeId,
      tool: toolMode,
      axis,
      startX: pixelX,
      startY: pixelY,
      baseRecipe: recipe,
      basePivot,
      baseTranslation: Array.from(node.translation ?? [0, 0, 0]),
      baseRotation: normalizeQuaternion(node.rotation ?? [0, 0, 0, 1]),
      baseScale: Array.from(node.scale ?? [1, 1, 1]),
      parentInverse: parentWorld ? mat4.invert(mat4.create(), parentWorld) : null,
      axisScreen,
      planeNormal,
      planeStartPoint,
      worldPerPixel,
      changed: false,
      deltaLabel: '',
    };
    return { nodeId: dragState.nodeId, tool: dragState.tool, axis: dragState.axis };
  }

  function toNodeLocalDelta(worldDelta, parentInverse) {
    if (!parentInverse) {
      return worldDelta;
    }
    const rotated = vec3.fromValues(worldDelta[0], worldDelta[1], worldDelta[2]);
    const linearInverse = mat4.clone(parentInverse);
    linearInverse[12] = 0;
    linearInverse[13] = 0;
    linearInverse[14] = 0;
    vec3.transformMat4(rotated, rotated, linearInverse);
    return [rotated[0], rotated[1], rotated[2]];
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
      dragState.deltaLabel = 'Snapped to surface';
      notify({ kind: 'transform', nodeId: dragState.nodeId, live: true, deltaLabel: dragState.deltaLabel });
      return { translation };
    }
    if (dragState.tool === 'translate' && dragState.planeNormal) {
      const ray = screenRay(pixelX, pixelY);
      const hitPoint = rayPlaneIntersection(ray.origin, ray.direction, dragState.basePivot, dragState.planeNormal);
      if (!hitPoint) {
        return null;
      }
      const rawWorldDelta = [
        hitPoint[0] - dragState.planeStartPoint[0],
        hitPoint[1] - dragState.planeStartPoint[1],
        hitPoint[2] - dragState.planeStartPoint[2],
      ];
      const maxJump = Math.max(12, vec3.distance(currentScene.camera.eye, dragState.basePivot) * 4);
      const deltaLength = Math.hypot(...rawWorldDelta);
      if (deltaLength > maxJump) {
        const factor = maxJump / deltaLength;
        rawWorldDelta[0] *= factor;
        rawWorldDelta[1] *= factor;
        rawWorldDelta[2] *= factor;
      }
      const localDelta = toNodeLocalDelta(rawWorldDelta, dragState.parentInverse);
      const rawTranslation = [
        dragState.baseTranslation[0] + localDelta[0],
        dragState.baseTranslation[1] + localDelta[1],
        dragState.baseTranslation[2] + localDelta[2],
      ];
      const translation = roundVector(shiftKey ? snapVector(rawTranslation) : rawTranslation);
      applySceneOperations([{ type: 'set-node', id: dragState.nodeId, translation }], { recordUndo: false });
      dragState.changed = true;
      dragState.deltaLabel = `${dragState.axis.toUpperCase()} ${deltaLength.toFixed(2)} m`;
      notify({ kind: 'transform', nodeId: dragState.nodeId, live: true, deltaLabel: dragState.deltaLabel });
      return { translation };
    }
    if (dragState.tool === 'translate' && axisIndex >= 0) {
      const projectedPixels = deltaX * dragState.axisScreen[0] + deltaY * dragState.axisScreen[1];
      const worldDelta = [0, 0, 0];
      worldDelta[axisIndex] = projectedPixels * dragState.worldPerPixel;
      const localDelta = toNodeLocalDelta(worldDelta, dragState.parentInverse);
      const rawTranslation = [
        dragState.baseTranslation[0] + localDelta[0],
        dragState.baseTranslation[1] + localDelta[1],
        dragState.baseTranslation[2] + localDelta[2],
      ];
      const translation = roundVector(shiftKey ? snapVector(rawTranslation) : rawTranslation);
      applySceneOperations([{ type: 'set-node', id: dragState.nodeId, translation }], { recordUndo: false });
      dragState.changed = true;
      const signed = translation[axisIndex] - dragState.baseTranslation[axisIndex];
      dragState.deltaLabel = `${dragState.axis.toUpperCase()} ${signed >= 0 ? '+' : ''}${signed.toFixed(2)} m`;
      notify({ kind: 'transform', nodeId: dragState.nodeId, live: true, deltaLabel: dragState.deltaLabel });
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
      dragState.deltaLabel = `${(axisIndex >= 0 ? dragState.axis : 'z').toUpperCase()} ${degrees >= 0 ? '+' : ''}${degrees.toFixed(1)}°`;
      notify({ kind: 'transform', nodeId: dragState.nodeId, live: true, deltaLabel: dragState.deltaLabel });
      return { rotation };
    }
    if (dragState.tool === 'scale') {
      const signedPixels = PLANE_AXES.includes(dragState.axis) || dragState.axis === 'uniform' || dragState.axis === 'screen'
        ? deltaX - deltaY
        : deltaX * dragState.axisScreen[0] + deltaY * dragState.axisScreen[1];
      const factor = Math.max(MINIMUM_SCALE, Math.min(MAXIMUM_SCALE, 1 + signedPixels / SCALE_PIXELS_PER_UNIT));
      const affectsAxis = index => {
        if (dragState.axis === 'uniform' || dragState.axis === 'screen') return true;
        if (index === axisIndex) return true;
        return PLANE_AXES.includes(dragState.axis) && dragState.axis.includes(AXIS_NAMES[index]);
      };
      const scale = roundVector(dragState.baseScale.map((component, index) => (
        affectsAxis(index) ? Math.max(MINIMUM_SCALE, Math.min(MAXIMUM_SCALE, component * factor)) : component
      )));
      applySceneOperations([{ type: 'set-node', id: dragState.nodeId, scale }], { recordUndo: false });
      dragState.changed = true;
      dragState.deltaLabel = `×${factor.toFixed(2)}`;
      notify({ kind: 'transform', nodeId: dragState.nodeId, live: true, deltaLabel: dragState.deltaLabel });
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
      notify({ kind: 'transformCommit', deltaLabel: '' });
    } else {
      notify({ kind: 'transformCancel', deltaLabel: '' });
    }
    return changed;
  }

  function updateNodeTransform(nodeId, patch) {
    if (!patch || typeof patch !== 'object') {
      throw new TypeError('updateNodeTransform expects a patch object.');
    }
    const operation = { type: 'set-node', id: nodeId };
    if (patch.label !== undefined) {
      if (typeof patch.label !== 'string' || patch.label.length > 256) {
        throw new TypeError('Node label must be a string of at most 256 characters.');
      }
      operation.label = patch.label.trim() || nodeId;
    }
    if (patch.parent !== undefined) {
      if (patch.parent !== null) {
        const recipe = currentScene.exportRecipe();
        if (!recipe.nodes.some(node => node.id === patch.parent)) {
          throw new RangeError(`Unknown parent node "${String(patch.parent)}".`);
        }
        if (descendantIdsOf(recipe.nodes, nodeId).has(patch.parent)) {
          throw new RangeError('Cannot parent a node under itself or its descendant.');
        }
      }
      operation.parent = patch.parent;
    }
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
    for (const flagField of ['visible', 'castShadow', 'receiveShadow']) {
      if (patch[flagField] !== undefined) {
        if (typeof patch[flagField] !== 'boolean') {
          throw new TypeError(`Node ${flagField} must be true or false.`);
        }
        operation[flagField] = patch[flagField];
      }
    }
    applySceneOperations([operation]);
    notify({ kind: patch.parent !== undefined ? 'topology' : 'transform', nodeId });
    return operation;
  }

  function addPrimitive(primitiveType, options = {}) {
    const spec = primitiveGeometrySpec(primitiveType);
    const recipe = currentScene.exportRecipe();
    const geometryIds = new Set(recipe.geometries.map(item => item.id));
    const nodeIds = new Set(recipe.nodes.map(item => item.id));
    const materialIds = new Set(recipe.materials.map(item => item.id));
    const baseName = primitiveType.toLowerCase();
    const geometryId = uniqueIdentifier(geometryIds, `geo-${baseName}`);
    const nodeId = uniqueIdentifier(nodeIds, baseName);
    let materialId = options.materialId && materialIds.has(options.materialId) ? options.materialId : null;
    const operations = [
      { type: 'add-geometry', geometry: { id: geometryId, ...spec.geometry } },
    ];
    if (!materialId) {
      materialId = uniqueIdentifier(materialIds, 'mat');
      operations.push({
        type: 'add-material',
        material: {
          id: materialId,
          tag: 'surface',
          color: options.color ?? [0.68, 0.44, 0.34],
          roughness: 0.48,
          metallic: 0.04,
        },
      });
    }
    const labelNumber = nodeId.split('-').pop();
    const nodeRecord = {
      id: nodeId,
      label: options.label ?? `${spec.labelPrefix} ${labelNumber}`,
      geometry: geometryId,
      material: materialId,
      translation: options.translation ?? spec.translation,
      rotation: options.rotation ?? spec.rotation,
      scale: options.scale ?? spec.scale,
    };
    if (options.parent) {
      nodeRecord.parent = options.parent;
    }
    operations.push({ type: 'add-node', node: nodeRecord });
    applySceneOperations(operations);
    selectedNodeId = nodeId;
    notify({ kind: 'topology', nodeId });
    return nodeRecord;
  }

  function addSceneLight(lightType = 'point') {
    const environment = currentScene.exportRecipe().environment ?? {};
    if (lightType === 'point') {
      const existing = environment.pointLights ?? [];
      if (existing.length >= MAX_POINT_LIGHTS) {
        throw new RangeError(`Scene already reached the limit of ${MAX_POINT_LIGHTS} point lights.`);
      }
      const nextLights = [...existing, { position: [2.2, 3.0, 2.2], color: [1, 0.96, 0.9], intensity: 2.5, radius: 0.14, range: 14, castShadow: true }];
      updateLook({ environment: { pointLights: nextLights } });
      return nextLights.length;
    }
    if (lightType === 'spot') {
      const existing = environment.spotLights ?? [];
      if (existing.length >= MAX_SPOT_LIGHTS) {
        throw new RangeError(`Scene already reached the limit of ${MAX_SPOT_LIGHTS} spot lights.`);
      }
      const nextLights = [...existing, { position: [2.8, 3.8, 2.8], direction: [-2.8, -3.2, -2.8], angle: 0.65, penumbra: 0.25, color: [1, 0.96, 0.9], intensity: 4, radius: 0.12, range: 16, castShadow: true }];
      updateLook({ environment: { spotLights: nextLights } });
      return nextLights.length;
    }
    throw new RangeError(`Unsupported light type "${String(lightType)}". Use point or spot.`);
  }

  function duplicateSelected() {
    if (!selectedNodeId) {
      throw new RangeError('Select a node before duplicating it.');
    }
    const recipe = currentScene.exportRecipe();
    const source = recipe.nodes.find(node => node.id === selectedNodeId);
    if (!source) {
      throw new RangeError(`Unknown node "${selectedNodeId}".`);
    }
    const existingIds = new Set(recipe.nodes.map(node => node.id));
    const copyId = uniqueIdentifier(existingIds, `${source.id}-copy`);
    const offset = [0.45, 0, 0.45];
    const cloned = structuredClone(source);
    cloned.id = copyId;
    cloned.label = `${source.label ?? source.id} copy`;
    cloned.translation = roundVector([
      (source.translation?.[0] ?? 0) + offset[0],
      source.translation?.[1] ?? 0,
      (source.translation?.[2] ?? 0) + offset[2],
    ]);
    applySceneOperations([{ type: 'add-node', node: cloned }]);
    selectedNodeId = copyId;
    notify({ kind: 'topology', nodeId: copyId });
    return cloned;
  }

  function deleteSelected() {
    if (!selectedNodeId) {
      throw new RangeError('Select a node before deleting it.');
    }
    const recipe = currentScene.exportRecipe();
    if (!recipe.nodes.some(node => node.id === selectedNodeId)) {
      throw new RangeError(`Unknown node "${selectedNodeId}".`);
    }
    const removed = descendantIdsOf(recipe.nodes, selectedNodeId);
    const operations = [];
    if (recipe.motion?.tracks?.some(track => track.kind === 'node' && removed.has(track.id))) {
      const remainingTracks = recipe.motion.tracks.filter(track => !(track.kind === 'node' && removed.has(track.id)));
      const hasOtherDrivers = Boolean(
        recipe.motion.ik?.length ||
        recipe.motion.layers?.length ||
        recipe.motion.drivers?.length ||
        recipe.motion.constraints?.length ||
        recipe.motion.springs ||
        recipe.motion.drive,
      );
      if (remainingTracks.length === 0 && !hasOtherDrivers) {
        operations.push({ type: 'set-motion', motion: null });
      } else {
        operations.push({ type: 'set-motion', motion: { ...recipe.motion, tracks: remainingTracks } });
      }
    }
    if (recipe.environment?.lines?.nodes && Object.keys(recipe.environment.lines.nodes).some(id => removed.has(id))) {
      const nextLineNodes = Object.fromEntries(Object.entries(recipe.environment.lines.nodes).filter(([id]) => !removed.has(id)));
      operations.push({ type: 'set-environment', environment: { lines: { ...recipe.environment.lines, nodes: nextLineNodes } } });
    }
    operations.push({ type: 'remove-node', id: selectedNodeId, recursive: true });
    applySceneOperations(operations);
    const nextRecipe = currentScene.exportRecipe();
    selectedNodeId = nextRecipe.nodes.find(node => node.geometry !== undefined)?.id ?? nextRecipe.nodes[0]?.id ?? null;
    notify({ kind: 'topology', nodeId: selectedNodeId });
    return selectedNodeId;
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
    if (patch.emissiveHex !== undefined) {
      operation.emissiveColor = hexToLinearRgb(patch.emissiveHex);
    } else if (patch.emissiveColor !== undefined) {
      operation.emissiveColor = roundVector(assertFiniteVector(patch.emissiveColor, 3, 'emissiveColor'));
    }
    for (const scalarField of ['roughness', 'metallic', 'clearcoat', 'clearcoatRoughness', 'emission', 'opacity']) {
      if (patch[scalarField] !== undefined) {
        if (typeof patch[scalarField] !== 'number' || !Number.isFinite(patch[scalarField])) {
          throw new TypeError(`Material ${scalarField} must be a finite number.`);
        }
        operation[scalarField] = roundValue(patch[scalarField]);
      }
    }
    if (patch.doubleSided !== undefined) {
      if (typeof patch.doubleSided !== 'boolean') {
        throw new TypeError('Material doubleSided must be true or false.');
      }
      operation.doubleSided = patch.doubleSided;
    }
    applySceneOperations([operation]);
    notify({ kind: 'material', materialId });
    return operation;
  }

  function createMaterial({ color = [0.72, 0.72, 0.72], roughness = 0.42, metallic = 0.05, assignToNodeId = selectedNodeId } = {}) {
    const recipe = currentScene.exportRecipe();
    const existingIds = new Set(recipe.materials.map(item => item.id));
    const materialId = uniqueIdentifier(existingIds, 'mat');
    const materialRecord = { id: materialId, tag: 'surface', color, roughness, metallic };
    const operations = [{ type: 'add-material', material: materialRecord }];
    if (assignToNodeId && recipe.nodes.some(node => node.id === assignToNodeId && node.geometry !== undefined)) {
      operations.push({ type: 'set-node', id: assignToNodeId, material: materialId });
    }
    applySceneOperations(operations);
    notify({ kind: 'material', materialId });
    return materialRecord;
  }

  function assignNodeMaterial(nodeId, materialId) {
    const recipe = currentScene.exportRecipe();
    if (!recipe.nodes.some(node => node.id === nodeId && node.geometry !== undefined)) {
      throw new RangeError(`Node "${String(nodeId)}" has no geometry to paint.`);
    }
    if (!recipe.materials.some(material => material.id === materialId)) {
      throw new RangeError(`Unknown material "${String(materialId)}".`);
    }
    applySceneOperations([{ type: 'set-node', id: nodeId, material: materialId }]);
    notify({ kind: 'material', materialId, nodeId });
    return materialId;
  }

  function applyMaterialPreset(materialId, presetName) {
    const preset = STUDIO_MATERIAL_PRESETS[presetName];
    if (!preset) {
      throw new RangeError(`Unknown material preset "${String(presetName)}". Use ${Object.keys(STUDIO_MATERIAL_PRESETS).join(', ')}.`);
    }
    return updateMaterial(materialId, {
      color: [...preset.color],
      roughness: preset.roughness,
      metallic: preset.metallic,
      clearcoat: preset.clearcoat ?? 0,
      clearcoatRoughness: preset.clearcoatRoughness ?? 0.1,
      opacity: preset.opacity ?? 1,
      emission: preset.emission ?? 0,
      ...(preset.emissiveColor ? { emissiveColor: [...preset.emissiveColor] } : {}),
    });
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
    const azimuth = Math.atan2(offset[0], offset[2]) + deltaAzimuth;
    const elevation = Math.max(-MAXIMUM_ELEVATION, Math.min(MAXIMUM_ELEVATION, Math.atan2(offset[1], currentHorizontal) + deltaElevation));
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
    if (camera.projection === 'orthographic' && zoomScale !== 1) {
      operation.orthoScale = roundValue(Math.max(0.25, Math.min(100, (camera.orthoScale ?? 4) * zoomScale)));
    }
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

  function setCameraViewPreset(presetName) {
    if (!STUDIO_VIEW_PRESETS.includes(presetName)) {
      throw new RangeError(`Unknown camera view "${String(presetName)}". Use ${STUDIO_VIEW_PRESETS.join(', ')}.`);
    }
    const camera = currentScene.camera;
    const distance = Math.max(MINIMUM_DISTANCE, vec3.distance(camera.eye, camera.target));
    const unitDirections = {
      front: [0, 0, 1],
      back: [0, 0, -1],
      right: [1, 0, 0],
      left: [-1, 0, 0],
      top: [0.002, 1, 0.002],
      isometric: [1, 0.72, 1],
    };
    const unit = vec3.normalize(vec3.create(), unitDirections[presetName]);
    const eye = roundVector([
      camera.target[0] + unit[0] * distance,
      camera.target[1] + unit[1] * distance,
      camera.target[2] + unit[2] * distance,
    ]);
    return updateCamera({ eye, up: [0, 1, 0] });
  }

  function toggleCameraProjection() {
    const camera = currentScene.camera;
    const aspect = width / height;
    const distance = Math.max(0.5, vec3.distance(camera.eye, camera.target));
    const currentFov = roundValue(cameraFieldOfView(camera, aspect), DEGREE_PRECISION);
    if (camera.projection === 'orthographic') {
      return updateCamera({ projection: 'perspective', fov: currentFov });
    }
    const orthoScale = roundValue(Math.max(0.5, 2 * distance * Math.tan((currentFov * Math.PI) / 360)));
    return updateCamera({ projection: 'orthographic', orthoScale, fov: currentFov });
  }

  function setCameraLensMillimetres(focalLength) {
    assertPositiveFinite(focalLength, 'focalLength');
    return updateCamera({ projection: 'perspective', focalLength: roundValue(focalLength, DEGREE_PRECISION), sensorWidth: 36 });
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
      throw new RangeError('Add a keyframe or motion track before scrubbing timeline.');
    }
    motionTime = currentScene.sampleMotion(seconds);
    notify({ kind: 'motion' });
    return motionTime;
  }

  function insertNodeKeyframe(nodeId = selectedNodeId) {
    if (!nodeId) {
      throw new RangeError('Select a node before inserting a keyframe.');
    }
    const recipe = currentScene.exportRecipe();
    const node = recipe.nodes.find(candidate => candidate.id === nodeId);
    if (!node) {
      throw new RangeError(`Unknown node "${String(nodeId)}".`);
    }
    const duration = Math.max(4, recipe.motion?.duration ?? 4, motionTime);
    let tracks = recipe.motion?.tracks ?? [];
    tracks = upsertNodeKeyframeTrack(tracks, nodeId, 'translation', motionTime, node.translation ?? [0, 0, 0]);
    tracks = upsertNodeKeyframeTrack(tracks, nodeId, 'rotation', motionTime, node.rotation ?? [0, 0, 0, 1]);
    tracks = upsertNodeKeyframeTrack(tracks, nodeId, 'scale', motionTime, node.scale ?? [1, 1, 1]);
    const nextMotion = { ...(recipe.motion ?? {}), duration, loop: recipe.motion?.loop ?? true, tracks };
    applySceneOperations([{ type: 'set-motion', motion: nextMotion }]);
    if (motionTime > 0) {
      motionTime = currentScene.sampleMotion(motionTime);
    }
    notify({ kind: 'motion', nodeId });
    return nextMotion;
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
    addPrimitive,
    addSceneLight,
    duplicateSelected,
    deleteSelected,
    updateMaterial,
    createMaterial,
    assignNodeMaterial,
    applyMaterialPreset,
    updateLook,
    setSunAngles,
    orbitCamera,
    updateCamera,
    setCameraViewPreset,
    toggleCameraProjection,
    setCameraLensMillimetres,
    frameSelection,
    listBookmarks,
    saveBookmark,
    applyBookmark,
    removeBookmark,
    setMotionTime,
    insertNodeKeyframe,
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

export {
  STUDIO_MATERIAL_PRESETS,
  STUDIO_PRIMITIVES,
  STUDIO_TABS,
  STUDIO_TEMPLATES,
  STUDIO_TOOLS,
  STUDIO_VIEW_PRESETS,
};
