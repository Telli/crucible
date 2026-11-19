// Gives the sample microscope its surfaces: UVs, enamel, metal and rubber materials, a knurl on the focus knobs, a
// millimetre scale on the stage and engraved labels on the four objectives. Geometry, node names and transforms stay as
// they are; only UV seams add a few vertices.
//
//   node scripts/texture-sample-model.mjs <untextured.glb> <output.glb>
//
// The input is the flat-material GLB (git show 5cd5b0eb:public/sample-model.glb). Nothing is read from the network.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { padded, readGlb, writeGlb } from './agent-glb-io.mjs';
import { brushedTexture, grainTexture, knurlNormalTexture, KNURL_FLAT_V, KNURL_TEETH_PER_TILE, objectiveTexture, STAGE_BLANK_UV, stageTexture } from './sample-model-textures.mjs';

const FLOAT = 5126;
const UNSIGNED_SHORT = 5123;
const UNSIGNED_INT = 5125;
const BOX_TILES_PER_UNIT = 30;
// Beige-white enamel. The studio's fill light is teal (0.8, 2.0, 1.8 in the shared shader), so the base colour is warmer than
// the colour it should show: this tint renders as about sRGB 233, 223, 207 on a lit face and loses the teal on the shaded ones.
const ENAMEL_COLOR = [0.85, 0.60, 0.42, 1];
// A thin lacquer over the enamel, so it has a soft highlight and does not read as flat white.
const ENAMEL_CLEARCOAT = { clearcoatFactor: 0.2, clearcoatRoughnessFactor: 0.4 };
const OBJECTIVE_CENTER_Z = 0.044;
const OBJECTIVE_TIP_HEIGHT = 0.012;
const FINE_KNOB = { centerY: 0.0715, centerZ: -0.038 };
const COARSE_KNOB = { centerY: 0.129, centerZ: -0.071 };
const KNOB_SPLIT_HEIGHT = 0.094;
const KNOB_TILES_PER_TURN = 36 / KNURL_TEETH_PER_TILE;

function readMesh(document, binary, nodeName) {
  const node = document.nodes.find(candidate => candidate.name === nodeName);
  const primitive = document.meshes[node.mesh].primitives[0];
  const read = (accessorIndex, Type) => {
    const accessor = document.accessors[accessorIndex];
    const view = document.bufferViews[accessor.bufferView];
    const start = binary.byteOffset + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    const count = accessor.count * ({ VEC3: 3, SCALAR: 1 }[accessor.type]);
    return Array.from(new Type(binary.buffer.slice(start, start + count * Type.BYTES_PER_ELEMENT)));
  };
  const indexType = document.accessors[primitive.indices].componentType === UNSIGNED_SHORT ? Uint16Array : Uint32Array;
  return { positions: read(primitive.attributes.POSITION, Float32Array), normals: read(primitive.attributes.NORMAL, Float32Array), indices: read(primitive.indices, indexType), uvs: null };
}

function vertexAt(mesh, index) {
  return { position: mesh.positions.slice(index * 3, index * 3 + 3), normal: mesh.normals.slice(index * 3, index * 3 + 3) };
}

/** Gives each vertex the UV `project(position, normal)` returns. */
function assignUvs(mesh, project) {
  const count = mesh.positions.length / 3;
  mesh.uvs = [];
  for (let index = 0; index < count; index++) {
    const { position, normal } = vertexAt(mesh, index);
    mesh.uvs.push(...project(position, normal));
  }
}

/** Box mapping: the two axes across the dominant normal axis, scaled to a fixed tile size, so a grain keeps its size on every face. */
function boxProjection(position, normal) {
  const magnitudes = normal.map(Math.abs);
  const axis = magnitudes.indexOf(Math.max(...magnitudes));
  const [first, second] = [0, 1, 2].filter(other => other !== axis);
  return [position[first] * BOX_TILES_PER_UNIT, position[second] * BOX_TILES_PER_UNIT];
}

function boundsOf(positions, include = () => true) {
  const minimum = [Infinity, Infinity, Infinity];
  const maximum = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < positions.length; index += 3) {
    if (!include(index / 3)) continue;
    for (let axis = 0; axis < 3; axis++) {
      minimum[axis] = Math.min(minimum[axis], positions[index + axis]);
      maximum[axis] = Math.max(maximum[axis], positions[index + axis]);
    }
  }
  return { minimum, maximum };
}

/**
 * A turn around an axis maps to u. A triangle across the seam would stretch the whole texture over it, so the vertices that
 * leave it with the shortest u span are copied one period up. The period must be a whole number of texture tiles, so a copy
 * samples the same texels. A triangle that wraps the axis itself (an end cap) has no short arrangement and keeps its span.
 */
function splitAtSeam(mesh, period) {
  const copies = new Map();
  const copyUp = original => {
    if (!copies.has(original)) {
      const index = mesh.positions.length / 3;
      mesh.positions.push(...mesh.positions.slice(original * 3, original * 3 + 3));
      mesh.normals.push(...mesh.normals.slice(original * 3, original * 3 + 3));
      mesh.uvs.push(mesh.uvs[original * 2] + period, mesh.uvs[original * 2 + 1]);
      copies.set(original, index);
    }
    return copies.get(original);
  };
  for (let corner = 0; corner < mesh.indices.length; corner += 3) {
    const us = [0, 1, 2].map(offset => mesh.uvs[mesh.indices[corner + offset] * 2]);
    const lifted = shortestArrangement(us, period);
    for (let offset = 0; offset < 3; offset++) {
      if (lifted[offset]) mesh.indices[corner + offset] = copyUp(mesh.indices[corner + offset]);
    }
  }
}

/** For three u values on a circle of the given period: which of them to lift one period so the three sit in the shortest span. */
function shortestArrangement(us, period) {
  let best = { span: Infinity, lifted: [false, false, false] };
  for (const lowest of us) {
    const lifted = us.map(value => value < lowest);
    const arranged = us.map((value, index) => (lifted[index] ? value + period : value));
    const span = Math.max(...arranged) - Math.min(...arranged);
    if (span < best.span - 1e-9) best = { span, lifted };
  }
  return best.lifted;
}

/** The separate solids of a mesh, each with its own vertices, found through the triangles that share a vertex or a position. */
function splitBodies(mesh) {
  const vertexCount = mesh.positions.length / 3;
  const parent = Array.from({ length: vertexCount }, (_, index) => index);
  const root = index => (parent[index] === index ? index : (parent[index] = root(parent[index])));
  const firstAtPosition = new Map();
  for (let index = 0; index < vertexCount; index++) {
    const key = mesh.positions.slice(index * 3, index * 3 + 3).map(value => value.toFixed(5)).join(',');
    if (firstAtPosition.has(key)) parent[root(index)] = root(firstAtPosition.get(key));
    else firstAtPosition.set(key, index);
  }
  for (let corner = 0; corner < mesh.indices.length; corner += 3) {
    parent[root(mesh.indices[corner + 1])] = root(mesh.indices[corner]);
    parent[root(mesh.indices[corner + 2])] = root(mesh.indices[corner]);
  }
  const bodies = new Map();
  const newIndexOf = new Map();
  const bodyOf = index => {
    if (!bodies.has(root(index))) bodies.set(root(index), { positions: [], normals: [], indices: [], uvs: null });
    return bodies.get(root(index));
  };
  for (let index = 0; index < vertexCount; index++) {
    const body = bodyOf(index);
    newIndexOf.set(index, body.positions.length / 3);
    body.positions.push(...mesh.positions.slice(index * 3, index * 3 + 3));
    body.normals.push(...mesh.normals.slice(index * 3, index * 3 + 3));
  }
  for (let corner = 0; corner < mesh.indices.length; corner++) {
    bodyOf(mesh.indices[corner]).indices.push(newIndexOf.get(mesh.indices[corner]));
  }
  return [...bodies.values()];
}

function centroidOf(positions) {
  const count = positions.length / 3;
  return [0, 1, 2].map(axis => positions.reduce((sum, value, index) => sum + (index % 3 === axis ? value : 0), 0) / count);
}

function wrapToHalfTurn(turns) {
  return turns - Math.round(turns);
}

function applyFocusKnobUvs(mesh) {
  assignUvs(mesh, (position, normal) => {
    if (Math.abs(normal[0]) > 0.6) return [0.5, KNURL_FLAT_V];
    const { centerY, centerZ } = position[1] < KNOB_SPLIT_HEIGHT ? FINE_KNOB : COARSE_KNOB;
    const turns = Math.atan2(position[2] - centerZ, position[1] - centerY) / (Math.PI * 2);
    return [(turns + 0.5) * KNOB_TILES_PER_TURN, 0.3];
  });
  splitAtSeam(mesh, KNOB_TILES_PER_TURN);
}

const OBJECTIVE_SECTORS = [
  { row: 0, partName: 'objective_4x', outwardTurns: 0.5 },
  { row: 1, partName: 'objective_10x', outwardTurns: -0.25 },
  { row: 2, partName: 'objective_40x', outwardTurns: 0.16 },
  { row: 3, partName: 'objective_100x', outwardTurns: 0.076 },
];

/** Which of the four barrels a body is: behind the nosepiece centre, left of it, right of it or in front, by its centre. */
function objectiveSector(position) {
  const sidewaysOffset = position[0];
  const forwardOffset = position[2] - OBJECTIVE_CENTER_Z;
  if (Math.abs(forwardOffset) >= Math.abs(sidewaysOffset)) return forwardOffset > 0 ? OBJECTIVE_SECTORS[3] : OBJECTIVE_SECTORS[0];
  return sidewaysOffset > 0 ? OBJECTIVE_SECTORS[2] : OBJECTIVE_SECTORS[1];
}

function averageAcross(mesh, indices) {
  return [0, 1].map(axis => indices.reduce((sum, index) => sum + mesh.positions[index * 3 + axis * 2], 0) / indices.length);
}

/** Each objective's axis, as its centre at the tip and at the top: a barrel that leans would twist the label if turns were measured around one fixed point. */
function objectiveAxis(mesh, members) {
  const heights = members.map(index => mesh.positions[index * 3 + 1]);
  const lowest = Math.min(...heights);
  const highest = Math.max(...heights);
  const tip = members.filter(index => mesh.positions[index * 3 + 1] < lowest + OBJECTIVE_TIP_HEIGHT);
  const top = members.filter(index => mesh.positions[index * 3 + 1] > highest - OBJECTIVE_TIP_HEIGHT);
  return { tip: averageAcross(mesh, tip), top: averageAcross(mesh, top), lowest, highest };
}

function applyObjectiveUvs(mesh, sector) {
  const axis = objectiveAxis(mesh, Array.from({ length: mesh.positions.length / 3 }, (_, index) => index));
  assignUvs(mesh, position => {
    const along = Math.min(1, Math.max(0, (axis.highest - position[1]) / (axis.highest - axis.lowest)));
    const centerX = axis.top[0] + (axis.tip[0] - axis.top[0]) * along;
    const centerZ = axis.top[1] + (axis.tip[1] - axis.top[1]) * along;
    const turns = Math.atan2(position[0] - centerX, position[2] - centerZ) / (Math.PI * 2);
    return [0.5 + wrapToHalfTurn(turns - sector.outwardTurns), (sector.row + 0.02 + 0.96 * along) / OBJECTIVE_SECTORS.length];
  });
  splitAtSeam(mesh, 1);
}

function applyStageUvs(mesh) {
  const { minimum, maximum } = boundsOf(mesh.positions);
  assignUvs(mesh, (position, normal) => {
    if (normal[1] < 0.7) return [...STAGE_BLANK_UV];
    return [(position[0] - minimum[0]) / (maximum[0] - minimum[0]), (position[2] - minimum[2]) / (maximum[2] - minimum[2])];
  });
}

// The studio's fill light is teal and its surroundings are blue, and a dielectric reflects them untinted, so a black plastic part reads
// green-blue on its shaded side. A dark metal reflects them through its own colour: this one is warm, so the reflection lands as grey.
const DARK_METAL = [0.05, 0.04, 0.041, 1];
const BORE_METAL = [0.043, 0.027, 0.028, 1];
const GRAIN = { image: 'grain', roughness: 1, metallic: 0 };
const ENAMEL = { ...GRAIN, roughness: 0.64, color: ENAMEL_COLOR, clearcoat: ENAMEL_CLEARCOAT, uv: boxProjection };
const PART_SURFACES = {
  base_stand: ENAMEL,
  head: ENAMEL,
  prism_housing: ENAMEL,
  illuminator: { image: 'brushed', roughness: 1, metallic: 0.9, color: DARK_METAL, uv: boxProjection },
  rack_post: { image: 'brushed', roughness: 1, metallic: 1, color: [0.80, 0.55, 0.50, 1], uv: boxProjection },
  stage_clips: { image: 'brushed', roughness: 1, metallic: 1, color: [0.80, 0.55, 0.50, 1], uv: boxProjection },
  condenser: { image: 'brushed', roughness: 1, metallic: 0.9, color: DARK_METAL, uv: boxProjection },
  nosepiece: { image: 'brushed', roughness: 1, metallic: 0.9, color: DARK_METAL, uv: boxProjection },
  eyepiece_mounts: { ...GRAIN, metallic: 1, color: BORE_METAL, uv: boxProjection },
  eyepiece_tubes: { ...GRAIN, metallic: 1, color: BORE_METAL, uv: boxProjection },
  focus_knobs: { color: DARK_METAL, roughness: 0.85, metallic: 1, normalImage: 'knurl', uv: applyFocusKnobUvs },
  stage: { color: [1, 1, 1, 1], roughness: 0.85, metallic: 1, colorImage: 'stage', uv: applyStageUvs },
};

const OBJECTIVE_SURFACE = { color: [1, 1, 1, 1], roughness: 0.4, metallic: 0.5, colorImage: 'objectives' };

/** The mesh pieces to write, one per part: the four objective barrels leave their shared mesh so each can move on its own. */
function sourcePieces(source, binary) {
  const pieces = [];
  for (const node of source.nodes) {
    const originalMaterial = source.materials[source.meshes[node.mesh].primitives[0].material];
    const mesh = readMesh(source, binary, node.name);
    if (node.name !== 'objectives') {
      pieces.push({ name: node.name, meshName: source.meshes[node.mesh].name, mesh, originalMaterial, surface: PART_SURFACES[node.name] });
      continue;
    }
    for (const body of splitBodies(mesh)) {
      const sector = objectiveSector(centroidOf(body.positions));
      pieces.push({ name: sector.partName, meshName: sector.partName, mesh: body, originalMaterial, surface: { ...OBJECTIVE_SURFACE, uv: bodyMesh => applyObjectiveUvs(bodyMesh, sector) } });
    }
  }
  return pieces.sort((first, second) => first.name.localeCompare(second.name));
}

function addAccessor(state, array, type, componentType, target, extra = {}) {
  const bytes = Buffer.from(array.buffer, array.byteOffset, array.byteLength);
  const offset = state.chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  state.chunks.push(padded(bytes, 0));
  state.document.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, target });
  state.document.accessors.push({ bufferView: state.document.bufferViews.length - 1, componentType, count: array.length / ({ VEC2: 2, VEC3: 3, SCALAR: 1 }[type]), type, ...extra });
  return state.document.accessors.length - 1;
}

function addImage(state, name, png) {
  const offset = state.chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  state.chunks.push(padded(png, 0));
  state.document.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: png.length });
  state.document.images.push({ name, mimeType: 'image/png', bufferView: state.document.bufferViews.length - 1 });
  state.document.textures.push({ sampler: 0, source: state.document.images.length - 1 });
  return state.document.textures.length - 1;
}

function writeMeshAccessors(state, mesh, withUvs) {
  const positions = new Float32Array(mesh.positions);
  const bounds = boundsOf(mesh.positions);
  const attributes = { POSITION: addAccessor(state, positions, 'VEC3', FLOAT, 34962, { min: bounds.minimum, max: bounds.maximum }), NORMAL: addAccessor(state, new Float32Array(mesh.normals), 'VEC3', FLOAT, 34962) };
  if (withUvs) attributes.TEXCOORD_0 = addAccessor(state, new Float32Array(mesh.uvs), 'VEC2', FLOAT, 34962);
  const vertexCount = mesh.positions.length / 3;
  const indices = vertexCount < 65536 ? new Uint16Array(mesh.indices) : new Uint32Array(mesh.indices);
  return { attributes, indices: addAccessor(state, indices, 'SCALAR', vertexCount < 65536 ? UNSIGNED_SHORT : UNSIGNED_INT, 34963) };
}

function surfaceMaterial(original, surface, textureIndices) {
  const pbr = { baseColorFactor: surface.color, metallicFactor: surface.metallic, roughnessFactor: surface.roughness };
  if (surface.colorImage) pbr.baseColorTexture = { index: textureIndices[surface.colorImage] };
  if (surface.image) pbr.metallicRoughnessTexture = { index: textureIndices[surface.image] };
  const material = { name: original.name, doubleSided: true, pbrMetallicRoughness: pbr };
  if (surface.clearcoat) material.extensions = { KHR_materials_clearcoat: surface.clearcoat };
  if (surface.normalImage) material.normalTexture = { index: textureIndices[surface.normalImage], scale: 1 };
  return material;
}

export async function textureSampleModel(inputBytes) {
  const { document: source, binary } = readGlb(inputBytes, 'The untextured sample GLB');
  const state = { chunks: [], document: { asset: { version: '2.0', generator: 'Crucible texture-sample-model' }, extensionsUsed: ['KHR_materials_clearcoat'], scene: 0, scenes: [], nodes: [], meshes: [], materials: [], accessors: [], bufferViews: [], buffers: [{ byteLength: 0 }], samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }], images: [], textures: [] } };
  const pngs = { grain: await grainTexture(), brushed: await brushedTexture(), knurl: await knurlNormalTexture(), stage: await stageTexture(), objectives: await objectiveTexture() };
  const textureIndices = Object.fromEntries(Object.entries(pngs).map(([name, png]) => [name, addImage(state, name, png)]));
  const nodes = [];
  for (const { name, meshName, mesh, originalMaterial, surface } of sourcePieces(source, binary)) {
    if (surface) {
      if (surface.uv === boxProjection) assignUvs(mesh, boxProjection);
      else surface.uv(mesh);
    }
    const { attributes, indices } = writeMeshAccessors(state, mesh, Boolean(surface));
    state.document.materials.push(surface ? surfaceMaterial(originalMaterial, surface, textureIndices) : originalMaterial);
    state.document.meshes.push({ name: meshName, primitives: [{ attributes, indices, material: state.document.materials.length - 1 }] });
    nodes.push({ name, mesh: state.document.meshes.length - 1 });
  }
  state.document.nodes = nodes;
  state.document.scenes = [{ name: 'Scene', nodes: nodes.map((_, index) => index) }];
  const output = Buffer.concat(state.chunks);
  state.document.buffers[0].byteLength = output.length;
  return writeGlb(state.document, output);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [inputPath, outputPath] = process.argv.slice(2);
  if (!inputPath || !outputPath) throw new Error('Pass <untextured.glb> and <output.glb>: node scripts/texture-sample-model.mjs <untextured.glb> <output.glb>.');
  const output = await textureSampleModel(readFileSync(inputPath));
  writeFileSync(outputPath, output);
  console.log(`${outputPath}: ${output.length} bytes`);
}
