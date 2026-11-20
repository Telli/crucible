import test from 'node:test';
import assert from 'node:assert/strict';
import { createCameraSpline } from '../src/hero-lab/camera-spline.js';
import { SCENES } from '../src/hero-lab/loop/scenes.js';

const KEY = { at: 0, eye: [0, 1, 2], target: [0, 0, 0], fov: 45 };

test('a spline refuses fewer than two keys', () => {
  assert.throws(() => createCameraSpline([KEY]), /at least two camera keys/);
});

test('a spline refuses key times that do not rise', () => {
  assert.throws(() => createCameraSpline([KEY, { ...KEY, at: 0 }, { ...KEY, at: 1 }]), /key times must rise/);
});

test('the five authored flights sample the same poses as before the key checks', () => {
  const expected = {
    port: {
      '0.25': { eye: [-131.6618, 78.8338, -184.8397], target: [-1.4577, 12.3032, 18.309], fov: 39.3703 },
      '0.5': { eye: [-88.8618, 44.305, -154.8084], target: [9.9925, 24.9136, 16.8069], fov: 40.8527 },
      '0.75': { eye: [71.8861, 30.5575, -152.9012], target: [17.9214, 25.7178, 7.6256], fov: 42.6456 },
    },
    datacenter: {
      '0.25': { eye: [12.7344, 22.5469, 33.125], target: [4, 0.6234, 0.3984], fov: 30.8125 },
      '0.5': { eye: [6.5, 17.5, 26], target: [4, 0.95, 0.25], fov: 32 },
      '0.75': { eye: [0.2656, 12.4531, 18.875], target: [4, 1.2766, 0.1016], fov: 33.1875 },
    },
    chipfab: {
      '0.25': { eye: [11.4491, 1.6181, -0.4778], target: [37.0324, 1.8354, 0.3148], fov: 58.1157 },
      '0.5': { eye: [25.0185, 2.3, -0.0741], target: [53.1111, 2.2519, -0.0333], fov: 56.7407 },
      '0.75': { eye: [36.576, 3.648, 0.2], target: [59.824, 3.8528, 1.4328], fov: 54.8 },
    },
    warehouse: {
      '0.25': { eye: [23.2191, 3.0428, 9.3161], target: [4.8664, 2.4, -2.5668], fov: 48.3637 },
      '0.5': { eye: [13.8105, 4.3958, 12.7717], target: [0.5243, 2.414, -4.8779], fov: 46.1603 },
      '0.75': { eye: [2.6322, 8.3431, 12.8311], target: [-9.9993, 2.0476, -5.94], fov: 44.1025 },
    },
    darkstore: {
      '0.25': { eye: [-1.5665, 3.0023, 7.2356], target: [1.6305, 2.0214, -11.8072], fov: 52.3099 },
      '0.5': { eye: [1.5902, 5.6288, 1.8178], target: [-3.2833, 1.5996, -10.2083], fov: 48.7687 },
      '0.75': { eye: [6.844, 8.4304, 1.932], target: [-3.24, 1.1, -11.792], fov: 44.672 },
    },
  };
  const round = values => values.map(value => Number(value.toFixed(4)));
  for (const scene of SCENES) {
    const sample = createCameraSpline(scene.keys);
    for (const progress of [0.25, 0.5, 0.75]) {
      const pose = sample(progress);
      assert.deepEqual(
        { eye: round(pose.eye), target: round(pose.target), fov: Number(pose.fov.toFixed(4)) },
        expected[scene.id][String(progress)],
        `${scene.id} at ${progress}`,
      );
    }
  }
});
