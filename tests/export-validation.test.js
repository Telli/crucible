import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSampleParts, withoutTextures } from './helpers/sample-model.js';
import { exportGlb } from '../src/export.js';

const samplePart = withoutTextures(await loadSampleParts())[0];

function firstPart() {
  return { ...samplePart };
}

function readJson(binary) {
  const view = new DataView(binary);
  const jsonLength = view.getUint32(12, true);
  return JSON.parse(new TextDecoder().decode(new Uint8Array(binary, 20, jsonLength)));
}

test('GLB export rejects lightUvs that do not match the vertex count', () => {
  const part = firstPart();
  const image = { width: 2, height: 2, data: new Uint8ClampedArray(16).fill(255) };
  const geometry = { ...part.geometry, lightUvs: new Float32Array(4) };
  const material = { ...part.material, lightMap: { image, uvChannel: 1 } };
  assert.throws(() => exportGlb([{ ...part, geometry, material }]), /lightUvs/i);
});

test('GLB light map emissive factor is a JSON array when the color is a Float32Array', () => {
  const part = firstPart();
  const image = { width: 2, height: 2, data: new Uint8ClampedArray(16).fill(255) };
  const geometry = { ...part.geometry, lightUvs: new Float32Array(part.geometry.positions.length / 3 * 2) };
  const material = { ...part.material, color: new Float32Array([0.5, 0.5, 0.5]), emission: 0, lightMap: { image, uvChannel: 1 } };
  const json = readJson(exportGlb([{ ...part, geometry, material }]));
  assert.ok(Array.isArray(json.materials[0].emissiveFactor));
});

function texturedPart(textureFields, materialFields = {}) {
  const part = firstPart();
  const image = { width: 2, height: 2, data: new Uint8ClampedArray(16).fill(255) };
  const geometry = { ...part.geometry, uvs: new Float32Array(part.geometry.positions.length / 3 * 2) };
  return { ...part, geometry, material: { ...part.material, map: { image, ...textureFields }, ...materialFields } };
}

test('GLB export rejects sampler values that are not glTF enums and names the field', () => {
  for (const field of ['wrapS', 'wrapT', 'magFilter', 'minFilter']) {
    assert.throws(() => exportGlb([texturedPart({ [field]: 1234 })]), new RegExp(field));
  }
  assert.throws(() => exportGlb([texturedPart({ magFilter: 9987 })]), /magFilter/);
  assert.doesNotThrow(() => exportGlb([texturedPart({ wrapS: 33071, wrapT: 33648, magFilter: 9728, minFilter: 9987 })]));
});

test('GLB export rejects a boxMapAxis outside 0, 1 and 2', () => {
  for (const boxMapAxis of [3, -1, 1.5, '1']) {
    assert.throws(() => exportGlb([texturedPart({}, { boxMapScale: 1, boxMapAxis })]), /boxMapAxis/);
  }
  assert.doesNotThrow(() => exportGlb([texturedPart({}, { boxMapScale: 1, boxMapAxis: 2 })]));
});

test('GLB export rejects empty, non-finite and unsorted animation keyframes', () => {
  const part = firstPart();
  const make = keyframes => ({ name: 'c', tracks: [{ target: part.name, property: 'translation', keyframes }] });
  assert.throws(() => exportGlb([part], { clips: [make([])] }), /keyframe/i);
  assert.throws(() => exportGlb([part], { clips: [make([{ time: NaN, value: [0, 0, 0] }])] }), /finite|time/i);
  assert.throws(() => exportGlb([part], { clips: [make([{ time: 1, value: [0, 0, 0] }, { time: 0.5, value: [0, 0, 0] }])] }), /increas|order|sorted/i);
  assert.throws(() => exportGlb([part], { clips: [make([{ time: 0, value: [NaN, 0, 0] }])] }), /finite/i);
});
