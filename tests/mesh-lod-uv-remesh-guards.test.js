import './support/load-agent-scene-modules.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { box, sphere } from '../src/geometry.js';
import { meshFromGeometry, remeshMesh, unwrapUv, generateGeometryLods } from '../src/mesh.js';

const cube = () => meshFromGeometry(box(0, 1));

test('remesh names the resolution field when the resolution is not a positive number (#2441)', () => {
  for (const resolution of [0, -4, NaN, Infinity, '8']) {
    assert.throws(() => remeshMesh(cube(), { resolution }), /remesh: resolution was /, `resolution ${resolution}`);
  }
});

test('remesh names the voxelSize field when the voxel size is not a positive number (#2441)', () => {
  for (const voxelSize of [NaN, Infinity, -1, '0.1']) {
    assert.throws(() => remeshMesh(cube(), { voxelSize }), /remesh: voxelSize was /, `voxelSize ${voxelSize}`);
  }
});

test('remesh still reports a numeric voxel size for valid options (#2441)', () => {
  const { voxelSize } = remeshMesh(cube(), { voxelSize: 0.1 });
  assert.equal(voxelSize, 0.1);
});

test('unwrapUv refuses a maxDistortion that is not a number from 0 to 100 (#2442)', () => {
  for (const maxDistortion of [NaN, -1, Infinity, 101, 'x']) {
    assert.throws(() => unwrapUv(cube(), { maxDistortion }), /unwrapUv: maxDistortion was .*from 0 to 100/, `maxDistortion ${maxDistortion}`);
  }
  assert.equal(unwrapUv(cube(), { maxDistortion: 0 }).islands, 6);
});

test('generateGeometryLods checks smoothAngle in degrees before it decimates, for plain and attribute geometry (#2443)', () => {
  const textured = sphere(16, 8);
  assert.ok(textured.uvs, 'the sphere carries uvs, so it takes the attribute path');
  for (const geometry of [box(0.08, 2), textured]) {
    for (const smoothAngle of [NaN, -10, 181, 'x', Infinity]) {
      assert.throws(() => generateGeometryLods(geometry, { smoothAngle }), /generateGeometryLods: smoothAngle was .*from 0 to 180/, `smoothAngle ${smoothAngle}`);
    }
  }
  assert.equal(generateGeometryLods(box(0.08, 2), { ratios: [0.5], smoothAngle: 180 }).length, 2);
});
