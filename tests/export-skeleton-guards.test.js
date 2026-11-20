import assert from 'node:assert/strict';
import test from 'node:test';
import { mat4 } from 'gl-matrix';
import { exportGlb } from '../src/export.js';
import { box } from '../src/geometry.js';

const plainMaterial = { color: [1, 1, 1], metallic: 0, roughness: 1 };

function readDocument(binary) {
  const view = new DataView(binary);
  const jsonLength = view.getUint32(12, true);
  return JSON.parse(new TextDecoder().decode(new Uint8Array(binary, 20, jsonLength)));
}

function clipOf(property, keyframes, interpolation) {
  return { name: 'clip', tracks: [{ target: 'Rod', property, interpolation, keyframes }] };
}

const rodPart = () => ({ name: 'Rod', geometry: box(), matrix: mat4.create(), material: plainMaterial });

test('a translation keyframe with the wrong number of components is refused, not written as a misaligned accessor', () => {
  const clip = clipOf('translation', [{ time: 0, value: [0, 0, 0] }, { time: 1, value: [1, 2] }]);
  assert.throws(() => exportGlb([rodPart()], { clips: [clip] }), /translation track on Rod.*3 values/i);
});

test('a rotation keyframe needs four components', () => {
  const clip = clipOf('rotation', [{ time: 0, value: [0, 0, 0, 1] }, { time: 1, value: [0, 0, 1] }]);
  assert.throws(() => exportGlb([rodPart()], { clips: [clip] }), /rotation track on Rod.*4 values/i);
});

test('a cubic keyframe without tangents names the track instead of failing inside Array.from', () => {
  const clip = clipOf('translation', [{ time: 0, value: [0, 0, 0] }, { time: 1, value: [1, 0, 0] }], 'CUBICSPLINE');
  assert.throws(() => exportGlb([rodPart()], { clips: [clip] }), /translation track on Rod.*tangent/i);
});

test('well formed cubic keyframes still export with three values per tangent', () => {
  const tangent = [0, 0, 0];
  const keyframes = [0, 1].map(time => ({ time, value: [time, 0, 0], inTangent: tangent, outTangent: tangent }));
  const binary = exportGlb([rodPart()], { clips: [clipOf('translation', keyframes, 'CUBICSPLINE')] });
  const document = readDocument(binary);
  assert.equal(document.accessors[document.animations[0].samplers[0].output].count, 6);
});

test('a node list whose parents form a loop is refused with the loop named', () => {
  const nodes = [
    { name: 'Rod', id: 'a', parent: 'b', meshIds: ['mesh-0'] },
    { name: 'Handle', id: 'b', parent: 'a', meshIds: [] },
  ];
  assert.throws(() => exportGlb([rodPart()], { nodes }), /GLB node (Rod|Handle).*parent.*loop/i);
});
