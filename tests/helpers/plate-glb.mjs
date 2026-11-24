// A one-triangle-plate GLB for tests: three vertices and a caller-chosen index list, in one self-contained binary file.
function paddedTo4(bytes, fill) {
  return Buffer.concat([bytes, Buffer.alloc((4 - bytes.length % 4) % 4, fill)]);
}

function chunkHeader(length, type) {
  const bytes = Buffer.alloc(8);
  bytes.writeUInt32LE(length, 0);
  bytes.write(type, 4, 'latin1');
  return bytes;
}

/** A GLB with one mesh named "Plate" (vertices at 0,0,0 1,0,0 0,1,0) drawn with the given 16-bit index list. */
export function plateGlb(indexList) {
  const positions = Buffer.from(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer);
  const indexBytes = Buffer.from(new Uint16Array(indexList).buffer);
  const binary = Buffer.concat([positions, paddedTo4(indexBytes, 0)]);
  const json = paddedTo4(Buffer.from(JSON.stringify({
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ name: 'Plate', primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] },
      { bufferView: 1, componentType: 5123, count: indexList.length, type: 'SCALAR' },
    ],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: positions.length }, { buffer: 0, byteOffset: positions.length, byteLength: indexBytes.length }],
    buffers: [{ byteLength: binary.length }],
  })), 0x20);
  const header = Buffer.alloc(12);
  header.write('glTF', 0, 'latin1');
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + json.length + 8 + binary.length, 8);
  return Buffer.concat([header, chunkHeader(json.length, 'JSON'), json, chunkHeader(binary.length, 'BIN\0'), binary]);
}
