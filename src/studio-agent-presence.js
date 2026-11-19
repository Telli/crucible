// Shows an AI agent at work in the Studio viewport: a pointer with the agent's name that travels to each object the
// agent changed, the way a collaborator's cursor does in a shared document.

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const MAXIMUM_NAME_LENGTH = 40;
const MAXIMUM_STOPS = 8;
const STOP_MILLISECONDS = 1100;
const LINGER_MILLISECONDS = 1600;

export const DEFAULT_AGENT_NAME = 'Agent';

export function assertAgentName(name) {
  if (typeof name !== 'string' || name.trim() === '' || name.length > MAXIMUM_NAME_LENGTH) {
    throw new TypeError(`The agent name must be a string of 1 to ${MAXIMUM_NAME_LENGTH} characters, such as "Claude".`);
  }
  return name.trim();
}

function entriesById(entries) {
  return new Map((entries ?? []).map(entry => [entry.id, JSON.stringify(entry)]));
}

function changedIds(beforeEntries, afterEntries) {
  const before = entriesById(beforeEntries);
  const changed = new Set();
  for (const [id, text] of entriesById(afterEntries)) {
    if (before.get(id) !== text) {
      changed.add(id);
    }
  }
  return changed;
}

/**
 * Compares two scene recipes and lists what an edit touched.
 * `nodeIds` are the nodes of `after` that are new, changed, or use a material or geometry that changed.
 * `removedNodeIds` are the nodes of `before` that `after` no longer has. `otherChange` is true when anything else differs.
 */
export function diffRecipeNodes(before, after) {
  const changedNodes = changedIds(before.nodes, after.nodes);
  const changedMaterials = changedIds(before.materials, after.materials);
  const changedGeometries = changedIds(before.geometries, after.geometries);
  const nodeIds = (after.nodes ?? [])
    .filter(node => changedNodes.has(node.id) || changedMaterials.has(node.material) || changedGeometries.has(node.geometry))
    .map(node => node.id);
  const afterIds = new Set((after.nodes ?? []).map(node => node.id));
  const removedNodeIds = (before.nodes ?? []).map(node => node.id).filter(id => !afterIds.has(id));
  const withoutParts = recipe => JSON.stringify({ ...recipe, nodes: undefined, materials: undefined, geometries: undefined });
  const otherChange = withoutParts(before) !== withoutParts(after);
  return { nodeIds, removedNodeIds, otherChange };
}

/** One short line for the status region, such as "Claude edited hero, orb and 2 more". */
export function describeAgentEdit(name, { nodeIds, removedNodeIds, otherChange }) {
  if (nodeIds.length > 0) {
    const named = nodeIds.slice(0, 2).join(', ');
    const rest = nodeIds.length - 2;
    return rest > 0 ? `${name} edited ${named} and ${rest} more` : `${name} edited ${named}`;
  }
  if (removedNodeIds.length > 0) {
    return `${name} removed ${removedNodeIds.slice(0, 2).join(', ')}`;
  }
  return otherChange ? `${name} changed the scene look` : `${name} saved without changes`;
}

function centreOf(points) {
  const sum = points.reduce((total, point) => [total[0] + point[0], total[1] + point[1]], [0, 0]);
  return [sum[0] / points.length, sum[1] / points.length];
}

function createPointerIcon(documentReference) {
  const icon = documentReference.createElementNS(SVG_NAMESPACE, 'svg');
  icon.setAttribute('viewBox', '0 0 16 16');
  icon.setAttribute('aria-hidden', 'true');
  const arrow = documentReference.createElementNS(SVG_NAMESPACE, 'path');
  arrow.setAttribute('d', 'M2 1.5 13.5 7 8.4 8.6 6.6 13.8Z');
  icon.append(arrow);
  return icon;
}

/**
 * Creates the pointer and the outline it draws. `controller` supplies `nodeOutline`, `viewportWidth` and `viewportHeight`;
 * `requestDraw` asks the Studio for a frame so the outline appears. Returns the elements to mount and the calls that drive them.
 */
export function createAgentPresence(documentReference, { controller, requestDraw }) {
  const pointer = documentReference.createElement('div');
  pointer.className = 'crucible-studio-agent-cursor';
  pointer.hidden = true;
  pointer.setAttribute('aria-hidden', 'true');
  const nameTag = documentReference.createElement('span');
  nameTag.className = 'crucible-studio-agent-name';
  pointer.append(createPointerIcon(documentReference), nameTag);

  let stops = [];
  let stopIndex = 0;
  let timer = null;

  function activeNodeId() {
    return stops[stopIndex] ?? null;
  }

  function place() {
    const nodeId = activeNodeId();
    if (!nodeId) {
      return null;
    }
    const outline = controller.nodeOutline(nodeId);
    if (!outline) {
      return null;
    }
    const centre = centreOf(outline);
    pointer.style.left = `${((centre[0] / controller.viewportWidth) * 100).toFixed(2)}%`;
    pointer.style.top = `${((centre[1] / controller.viewportHeight) * 100).toFixed(2)}%`;
    return outline;
  }

  function finish() {
    clearTimeout(timer);
    timer = null;
    stops = [];
    stopIndex = 0;
    pointer.hidden = true;
    pointer.dataset.nodeId = '';
    requestDraw();
  }

  function goToStop(index) {
    stopIndex = index;
    pointer.dataset.nodeId = activeNodeId();
    pointer.hidden = place() === null;
    requestDraw();
    const isLast = index >= stops.length - 1;
    timer = setTimeout(() => (isLast ? finish() : goToStop(index + 1)), isLast ? LINGER_MILLISECONDS : STOP_MILLISECONDS);
  }

  return {
    element: pointer,
    get activeNodeId() {
      return activeNodeId();
    },
    /** Called on every Studio frame: keeps the pointer on its object while the camera moves and returns the outline to draw. */
    place,
    /** Walks the pointer over `nodeIds` in order, under `name`. A new call replaces a walk in progress. */
    show({ name, nodeIds }) {
      const label = assertAgentName(name);
      if (!Array.isArray(nodeIds) || nodeIds.some(nodeId => typeof nodeId !== 'string' || nodeId === '')) {
        throw new TypeError('nodeIds must be an array of node id strings.');
      }
      finish();
      nameTag.textContent = label;
      stops = nodeIds.filter(nodeId => controller.nodeOutline(nodeId) !== null).slice(0, MAXIMUM_STOPS);
      if (stops.length > 0) {
        goToStop(0);
      }
      return stops.length;
    },
    hide: finish,
    dispose() {
      clearTimeout(timer);
    },
  };
}
