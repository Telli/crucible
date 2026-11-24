import { deflateSync } from 'node:zlib';

export const SOFTBOX_URL = new URL('../../assets/looks/studio-softbox.hdr', import.meta.url);
const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;
const BINARY_CHUNK = 0x004e4942;

// The GLB decoder hands the thread back through scheduler.yield when a slice runs long; the fake browser has none.
export function installImmediateScheduler(testContext) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'scheduler');
  Object.defineProperty(globalThis, 'scheduler', { value: { yield: () => Promise.resolve() }, configurable: true, writable: true });
  testContext.after(() => {
    if (previous) {
      Object.defineProperty(globalThis, 'scheduler', previous);
    } else {
      delete globalThis.scheduler;
    }
  });
}

// One triangle, as a complete GLB. `documentFields` adds to the glTF JSON (extensions, an external buffer uri); `baseColor` gives it a material of that colour.
export function triangleGlb(documentFields = {}, { embedBuffer = true, baseColor = null } = {}) {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const document = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, ...(baseColor ? { material: 0 } : {}) }] }],
    ...(baseColor ? { materials: [{ pbrMetallicRoughness: { baseColorFactor: baseColor } }] } : {}),
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }],
    bufferViews: [{ buffer: 0, byteLength: positions.byteLength }],
    buffers: [{ byteLength: positions.byteLength }],
    ...documentFields,
  };
  const jsonBytes = new TextEncoder().encode(JSON.stringify(document));
  const jsonLength = Math.ceil(jsonBytes.length / 4) * 4;
  const binaryLength = embedBuffer ? positions.byteLength : 0;
  const total = 12 + 8 + jsonLength + (embedBuffer ? 8 + binaryLength : 0);
  const bytes = new Uint8Array(total);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, GLB_MAGIC, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, JSON_CHUNK, true);
  bytes.fill(0x20, 20, 20 + jsonLength);
  bytes.set(jsonBytes, 20);
  if (embedBuffer) {
    const binaryStart = 20 + jsonLength;
    view.setUint32(binaryStart, binaryLength, true);
    view.setUint32(binaryStart + 4, BINARY_CHUNK, true);
    bytes.set(new Uint8Array(positions.buffer), binaryStart + 8);
  }
  return bytes;
}

function crc32Of(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, body) {
  const chunk = new Uint8Array(12 + body.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, body.length);
  chunk.set(new TextEncoder().encode(type), 4);
  chunk.set(body, 8);
  view.setUint32(8 + body.length, crc32Of(chunk.subarray(4, 8 + body.length)));
  return chunk;
}

// A 2 x 2 grey PNG written chunk by chunk.
export function tinyPng(width = 2, height = 2) {
  const header = new Uint8Array(13);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(0, width);
  headerView.setUint32(4, height);
  header.set([8, 0, 0, 0, 0], 8);
  const rows = new Uint8Array((width + 1) * height);
  const pieces = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', new Uint8Array(deflateSync(rows))),
    pngChunk('IEND', new Uint8Array(0)),
  ];
  const png = new Uint8Array(pieces.reduce((sum, piece) => sum + piece.length, 0));
  let offset = 0;
  for (const piece of pieces) {
    png.set(piece, offset);
    offset += piece.length;
  }
  return png;
}

// The decoder of catalog images needs a browser; this stands in for it with the size the PNG header gives.
export function installImageDecoder(testContext) {
  const originals = { createImageBitmap: globalThis.createImageBitmap, OffscreenCanvas: globalThis.OffscreenCanvas };
  globalThis.createImageBitmap = async () => ({ width: 2, height: 2, close() {} });
  globalThis.OffscreenCanvas = class {
    constructor(width, height) {
      this.width = width;
      this.height = height;
    }

    getContext() {
      return {
        drawImage() {},
        getImageData: (left, top, width, height) => ({ data: new Uint8ClampedArray(width * height * 4).fill(200) }),
      };
    }
  };
  testContext.after(() => {
    for (const [name, value] of Object.entries(originals)) {
      if (value) {
        globalThis[name] = value;
      } else {
        delete globalThis[name];
      }
    }
  });
}

export function baseRecipe() {
  return {
    format: 'crucible.scene',
    schemaVersion: 1,
    geometries: [{ id: 'ground', type: 'plane' }, { id: 'block', type: 'box' }],
    materials: [
      { id: 'grass', tag: 'surface', color: [0.2, 0.5, 0.2], roughness: 0.8, metallic: 0 },
      { id: 'bricks', tag: 'surface', color: [1, 1, 1], roughness: 0.9, metallic: 0, pattern: { type: 'bricks', size: 1 } },
    ],
    nodes: [
      { id: 'floor', geometry: 'ground', material: 'grass', scale: [20, 1, 20] },
      { id: 'wall', geometry: 'block', material: 'bricks', translation: [0, 1, 0] },
    ],
  };
}

// A host with a folder in memory: `store` keeps the bytes and names, and the read hooks give them back.
export function createHost({ rejectStoreWith = null, withStore = true } = {}) {
  const files = { asset: new Map(), environment: new Map(), image: new Map() };
  const fileNames = new Map();
  const storeCalls = [];
  const hooks = {
    asset: async id => files.asset.get(id),
    environment: async id => files.environment.get(id),
    image: async id => files.image.get(id),
    name: async id => fileNames.get(id) ?? null,
  };
  if (withStore) {
    hooks.store = async entry => {
      storeCalls.push({ kind: entry.kind, id: entry.id, name: entry.name, extension: entry.extension });
      if (rejectStoreWith) {
        throw new Error(rejectStoreWith);
      }
      files[entry.kind].set(entry.id, entry.bytes);
      fileNames.set(entry.id, entry.name);
    };
  }
  return { hooks, files, fileNames, storeCalls };
}
