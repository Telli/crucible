// Names the field of every dangling index before anything reads through it, instead of a "Cannot read properties" TypeError.

function requireIndex(value, listName, list, fieldPath) {
  if (Number.isInteger(value) && Array.isArray(list) && value >= 0 && value < list.length) return;
  const range = list?.length ? `valid: 0 to ${list.length - 1}` : `the document has no ${listName}`;
  throw new Error(`Invalid glTF ${fieldPath} ${JSON.stringify(value)}: ${range}.`);
}

function requireObject(value, fieldPath) {
  if (!value || typeof value !== 'object') throw new Error(`Invalid glTF ${fieldPath}: expected an object. Fix: remove the entry or fix the exporter.`);
}

function validateMeshReferences(document) {
  (document.meshes ?? []).forEach((mesh, meshIndex) => {
    if (!Array.isArray(mesh.primitives)) throw new Error(`Invalid glTF meshes[${meshIndex}].primitives: expected an array.`);
    mesh.primitives.forEach((primitive, primitiveIndex) => {
      const path = `meshes[${meshIndex}].primitives[${primitiveIndex}]`;
      requireObject(primitive, path);
      if (primitive.material !== undefined) requireIndex(primitive.material, 'materials', document.materials, `${path}.material (primitive.material)`);
    });
  });
}

function validateAccessorReferences(document) {
  (document.accessors ?? []).forEach((accessor, accessorIndex) => {
    if (accessor.bufferView !== undefined) requireIndex(accessor.bufferView, 'bufferViews', document.bufferViews, `accessors[${accessorIndex}].bufferView`);
  });
}

function validateSceneReferences(document) {
  const sceneIndex = document.scene ?? 0;
  const sceneNodes = document.scenes?.[sceneIndex]?.nodes;
  if (sceneNodes !== undefined && !Array.isArray(sceneNodes)) throw new Error(`Invalid glTF scenes[${sceneIndex}].nodes: expected an array.`);
  (sceneNodes ?? []).forEach((nodeIndex, position) => {
    requireIndex(nodeIndex, 'nodes', document.nodes, `scenes[${sceneIndex}].nodes[${position}]`);
  });
}

const ENTRY_ARRAYS = ['nodes', 'meshes', 'accessors', 'bufferViews', 'buffers', 'materials', 'textures', 'images', 'skins', 'animations'];

function validateEntryObjects(document) {
  for (const arrayName of ENTRY_ARRAYS) {
    const entries = document[arrayName];
    if (entries === undefined || entries === null) continue;
    if (!Array.isArray(entries)) throw new Error(`Invalid glTF ${arrayName}: expected an array of objects. Fix: remove the field or fix the exporter.`);
    entries.forEach((entry, entryIndex) => requireObject(entry, `${arrayName}[${entryIndex}]`));
  }
}

// A null or absent list loads as empty; any other non-array would reach a for...of and fail with a raw TypeError.
function requireList(value, fieldPath) {
  if (value === undefined || value === null || Array.isArray(value)) return;
  throw new Error(`Invalid glTF ${fieldPath}: expected an array. Fix: pass an array or remove the field.`);
}

const ENTRY_LIST_FIELDS = [['nodes', 'children'], ['animations', 'channels'], ['animations', 'samplers']];

function validateListAndNameFields(document) {
  requireList(document.extensionsUsed, 'extensionsUsed');
  requireList(document.extensionsRequired, 'extensionsRequired');
  for (const [arrayName, fieldName] of ENTRY_LIST_FIELDS) {
    (document[arrayName] ?? []).forEach((entry, entryIndex) => requireList(entry[fieldName], `${arrayName}[${entryIndex}].${fieldName}`));
  }
  for (const arrayName of ['nodes', 'meshes']) {
    (document[arrayName] ?? []).forEach((entry, entryIndex) => {
      if (entry.name !== undefined && entry.name !== null && typeof entry.name !== 'string') {
        throw new Error(`Invalid glTF ${arrayName}[${entryIndex}].name ${JSON.stringify(entry.name)}: expected a string. Fix: pass a string or remove the field.`);
      }
    });
  }
  (document.animations ?? []).forEach((animation, animationIndex) => {
    (animation.channels ?? []).forEach((channel, channelIndex) => requireObject(channel, `animations[${animationIndex}].channels[${channelIndex}]`));
  });
}

const NODE_TRANSFORM_LENGTHS = { matrix: 16, translation: 3, rotation: 4, scale: 3 };

function validateNodeTransforms(document) {
  (document.nodes ?? []).forEach((node, nodeIndex) => {
    for (const [field, length] of Object.entries(NODE_TRANSFORM_LENGTHS)) {
      const value = node[field];
      if (value === undefined) continue;
      // A NaN or infinite entry (null once serialized) stays loadable: the node is skipped or collapsed with a warning.
      const numbers = Array.isArray(value) && value.length === length && value.every(entry => typeof entry === 'number' || entry === null);
      if (!numbers) throw new Error(`Invalid glTF nodes[${nodeIndex}].${field}: expected an array of ${length} numbers. Fix: pass ${length} numbers or remove the field.`);
    }
    if (node.rotation && node.rotation.every(component => component === 0)) {
      throw new Error(`Invalid glTF nodes[${nodeIndex}].rotation: a zero quaternion has no direction. Fix: pass a unit quaternion such as [0, 0, 0, 1].`);
    }
  });
}

/** Throws an error naming the field for each dangling reference the loader would otherwise trip over. */
export function validateDocumentReferences(document) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) throw new Error('glTF JSON must be an object. Fix: pass a glTF 2.0 document.');
  validateEntryObjects(document);
  validateListAndNameFields(document);
  validateMeshReferences(document);
  validateAccessorReferences(document);
  validateSceneReferences(document);
  validateNodeTransforms(document);
}
