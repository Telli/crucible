import { createCameraPath } from './camera-path.js';

function lerpVector(first, second, amount) {
  return first.map((value, axis) => value + (second[axis] - value) * amount);
}

function validateFrameKeys(frames, framesPerSecond) {
  if (!Number.isFinite(framesPerSecond) || framesPerSecond <= 0) {
    throw new RangeError(`Camera fps must be a positive finite number, got ${JSON.stringify(framesPerSecond)}.`);
  }
  if (frames.length === 0) throw new RangeError('Camera frames must hold at least one [eye, target] pair.');
  const isFiniteTriple = vector => Array.isArray(vector) && vector.length === 3 && vector.every(Number.isFinite);
  for (let index = 0; index < frames.length; index++) {
    const frame = frames[index];
    if (!Array.isArray(frame) || !isFiniteTriple(frame[0]) || !isFiniteTriple(frame[1])) {
      throw new RangeError(`Camera frames[${index}] must be [eye, target], each three finite numbers.`);
    }
    if (Math.hypot(frame[1][0] - frame[0][0], frame[1][1] - frame[0][1], frame[1][2] - frame[0][2]) <= 1e-8) {
      throw new RangeError(`Camera frames[${index}] eye and target are the same point, so there is no view direction; move the target away from the eye.`);
    }
  }
  if (!Number.isFinite(frames.length / framesPerSecond)) {
    throw new RangeError(`Camera fps ${framesPerSecond} is too small for ${frames.length} frames to have a finite duration; pass a larger fps.`);
  }
}

function requireFiniteSeconds(seconds) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) {
    throw new RangeError(`Camera sample time must be a finite number of seconds, got ${seconds}.`);
  }
}

/**
 * Turns camera keys into a function from seconds to a camera pose. Keys are either { fps, frames: [[eye, target], ...] },
 * sampled with a linear blend between neighbouring frames, or the keys createCameraPath takes (duration, eye, target, fov...).
 */
export function createCameraSampler(keys) {
  if (Array.isArray(keys.frames)) {
    const { frames } = keys;
    const framesPerSecond = keys.fps ?? 24;
    validateFrameKeys(frames, framesPerSecond);
    return {
      duration: frames.length / framesPerSecond,
      sample(seconds) {
        requireFiniteSeconds(seconds);
        const position = Math.max(0, Math.min(frames.length - 1, seconds * framesPerSecond));
        const before = Math.floor(position);
        const after = Math.min(frames.length - 1, before + 1);
        const amount = position - before;
        return {
          eye: lerpVector(frames[before][0], frames[after][0], amount),
          target: lerpVector(frames[before][1], frames[after][1], amount),
        };
      },
    };
  }
  const path = createCameraPath({ loop: false, ...keys });
  return {
    duration: keys.duration,
    sample(seconds) {
      requireFiniteSeconds(seconds);
      const pose = path.sample(Math.min(seconds, keys.duration));
      return { eye: Array.from(pose.eye), target: Array.from(pose.target), up: Array.from(pose.up), fov: pose.fov };
    },
  };
}
