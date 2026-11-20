import './support/load-agent-scene-modules.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentScene } from '../src/agent-scene.js';
import { describeApplication } from '../src/agent-apply-report.js';
import { motionWithoutTracks } from '../src/motion-track-removal.js';

const keys = (start, end) => [{ time: 0, value: start }, { time: 1, value: end }];

function applyTo(scene, operations) {
  return scene.apply(operations, { expectedRevision: scene.revision });
}

function sceneWithTwoTracks() {
  return createAgentScene({
    format: 'crucible.scene', schemaVersion: 1,
    geometries: [{ id: 'box', type: 'box' }],
    materials: [{ id: 'paint', color: [0.5, 0.5, 0.5] }],
    nodes: [{ id: 'cube', geometry: 'box', material: 'paint' }],
    camera: { eye: [4, 3, 5], target: [0, 0, 0] },
    motion: {
      duration: 1,
      tracks: [
        { kind: 'camera', property: 'fov', keyframes: keys(40, 60) },
        { kind: 'node', id: 'cube', property: 'translation', keyframes: keys([0, 0, 0], [1, 0, 0]) },
      ],
    },
  });
}

test('removeTracks drops the matching camera track and keeps the node track', () => {
  const scene = sceneWithTwoTracks();
  const before = scene.exportRecipe();
  const operations = [{ type: 'set-motion', removeTracks: [{ kind: 'camera' }] }];
  applyTo(scene, operations);
  const tracks = scene.exportRecipe().motion.tracks;
  assert.deepEqual(tracks.map(track => `${track.kind}.${track.property}`), ['node.translation']);
  assert.match(JSON.stringify(describeApplication(before, scene.exportRecipe(), operations)), /removed 1 motion tracks/);
});

test('removing every track leaves no motion', () => {
  const scene = sceneWithTwoTracks();
  applyTo(scene, [{ type: 'set-motion', removeTracks: [{ kind: 'camera' }, { kind: 'node', id: 'cube', property: 'translation' }] }]);
  assert.equal(scene.exportRecipe().motion ?? null, null);
});

test('a selector that matches nothing names itself and lists the tracks there are', () => {
  const scene = sceneWithTwoTracks();
  assert.throws(
    () => applyTo(scene, [{ type: 'set-motion', removeTracks: [{ kind: 'node', id: 'ghost' }] }]),
    error => error.message.includes('ghost') && error.message.includes('camera.fov, node.cube.translation'),
  );
  assert.equal(scene.exportRecipe().motion.tracks.length, 2);
});

test('motion and removeTracks together are refused, and so is an empty or unknown selector', () => {
  const scene = sceneWithTwoTracks();
  assert.throws(() => applyTo(scene, [{ type: 'set-motion', motion: null, removeTracks: [{ kind: 'camera' }] }]), /not both/);
  assert.throws(() => applyTo(scene, [{ type: 'set-motion', removeTracks: [] }]), /1 to 64 track selectors/);
  assert.throws(() => applyTo(scene, [{ type: 'set-motion', removeTracks: [{ colour: 'red' }] }]), /kind, id and property/);
});

test('other motion fields survive when some tracks remain or only tracks were set', () => {
  const motion = { duration: 2, loop: true, tracks: [{ kind: 'camera', property: 'fov' }], ik: [{ id: 'leg' }] };
  assert.deepEqual(motionWithoutTracks(motion, [{ kind: 'camera' }]), { duration: 2, loop: true, tracks: [], ik: [{ id: 'leg' }] });
});
