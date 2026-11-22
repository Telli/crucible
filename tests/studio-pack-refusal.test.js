import assert from 'node:assert/strict';
import test from 'node:test';
import { encodePack } from '../src/scene-pack-format.js';
import { encodePackOrRefuse } from '../src/studio-pack-refusal.js';

// The browser class reports its own tag, which is how the pack format names it.
class ImageData {
  get [Symbol.toStringTag]() {
    return 'ImageData';
  }

  constructor() {
    this.width = 1;
    this.height = 1;
    this.data = new Uint8ClampedArray(4);
  }
}

function partWith(name, material) {
  return { name, geometry: { positions: new Float32Array(9) }, material, matrix: new Float32Array(16) };
}

test('a part whose material holds a decoded image is refused by name, with what to do instead', () => {
  const parts = [partWith('floor', { color: [1, 1, 1] }), partWith('scan-body', { color: [1, 1, 1], map: { image: new ImageData() } })];
  assert.throws(() => encodePackOrRefuse(encodePack, { parts }), error => {
    assert.match(error.message, /^Web pack refused: part "scan-body" carries an imported image on its map texture/);
    assert.match(error.message, /Remove the placed catalog assets.*export the scene as a GLB/);
    assert.doesNotMatch(error.message, /scene\.parts\[|ImageData/);
    return true;
  });
});

test('a part with no name is refused by its number, and plain scenes and other errors pass through', () => {
  const unnamed = [partWith('', { map: { image: new ImageData() } })];
  assert.throws(() => encodePackOrRefuse(encodePack, { parts: unnamed }), /part number 1 carries/);
  assert.ok(encodePackOrRefuse(encodePack, { parts: [partWith('plain', { color: [1, 1, 1] })] }).byteLength > 0);
  const unrelated = new Error('Disk is full.');
  assert.throws(() => encodePackOrRefuse(() => { throw unrelated; }, { parts: [] }), error => error === unrelated);
});
