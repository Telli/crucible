import assert from 'node:assert/strict';
import test from 'node:test';
import { decodePack, encodePack } from '../src/scene-pack-format.js';
import { encodePackOrRefuse } from '../src/studio-pack-refusal.js';

// A browser class reports its own tag, which is how the pack format names it.
function browserClass(tag) {
  return class {
    get [Symbol.toStringTag]() {
      return tag;
    }

    constructor() {
      this.width = 1;
      this.height = 1;
      this.data = new Uint8ClampedArray(4);
    }
  };
}

const ImageData = browserClass('ImageData');
const ImageBitmap = browserClass('ImageBitmap');

function partWith(name, material) {
  return { name, geometry: { positions: new Float32Array(9) }, material, matrix: new Float32Array(16) };
}

test('a part whose material holds decoded ImageData packs as plain pixels', () => {
  const parts = [partWith('scan-body', { color: [1, 1, 1], map: { image: new ImageData(), colorSpace: 'srgb' } })];
  const packed = decodePack(encodePackOrRefuse(encodePack, { parts }));
  assert.deepEqual(packed.parts[0].material.map, { image: { width: 1, height: 1, data: new Uint8ClampedArray(4) }, colorSpace: 'srgb' });
});

test('a part whose material holds an image the pack cannot store is refused by name, with what to do instead', () => {
  const parts = [partWith('floor', { color: [1, 1, 1] }), partWith('scan-body', { color: [1, 1, 1], map: { image: new ImageBitmap() } })];
  assert.throws(() => encodePackOrRefuse(encodePack, { parts }), error => {
    assert.match(error.message, /^Web pack refused: part "scan-body" carries a ImageBitmap on its map texture/);
    assert.match(error.message, /Remove the placed catalog assets.*export the scene as a GLB/);
    assert.doesNotMatch(error.message, /scene\.parts\[/);
    return true;
  });
});

test('a part with no name is refused by its number, and plain scenes and other errors pass through', () => {
  const unnamed = [partWith('', { map: { image: new ImageBitmap() } })];
  assert.throws(() => encodePackOrRefuse(encodePack, { parts: unnamed }), /part number 1 carries/);
  assert.ok(encodePackOrRefuse(encodePack, { parts: [partWith('plain', { color: [1, 1, 1] })] }).byteLength > 0);
  const unrelated = new Error('Disk is full.');
  assert.throws(() => encodePackOrRefuse(() => { throw unrelated; }, { parts: [] }), error => error === unrelated);
});
