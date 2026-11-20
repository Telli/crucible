import test from 'node:test';
import assert from 'node:assert/strict';

const listeners = new Set();
const frames = new Map();
const observers = [];
let nextFrame = 0;
let scheduled = 0;

globalThis.window = { matchMedia: () => ({ matches: false }) };
globalThis.document = {
  hidden: false,
  addEventListener: (type, listener) => { if (type === 'visibilitychange') listeners.add(listener); },
  removeEventListener: (type, listener) => listeners.delete(listener),
};
globalThis.requestAnimationFrame = callback => {
  scheduled++;
  const id = ++nextFrame;
  frames.set(id, callback);
  return id;
};
globalThis.cancelAnimationFrame = id => frames.delete(id);
globalThis.IntersectionObserver = class {
  constructor(callback) {
    this.callback = callback;
    this.disconnected = false;
    observers.push(this);
  }
  observe() {}
  disconnect() { this.disconnected = true; }
};

const { startLoop } = await import('../src/hero-lab/stage.js');

function flushFrame(timestamp = 16) {
  // One animation frame runs every callback scheduled before it; a callback that schedules another frame waits for the next.
  const pending = [...frames.values()];
  frames.clear();
  for (const callback of pending) callback(timestamp);
}

test('a stage that scrolled out and back in keeps drawing (#2634)', () => {
  let draws = 0;
  const loop = startLoop({ dataset: {} }, () => { draws++; return true; });
  flushFrame();
  assert.equal(draws, 1);
  observers.at(-1).callback([{ isIntersecting: false }, { isIntersecting: true }]);
  flushFrame(32);
  assert.equal(draws, 2, 'the newest entry says the stage is visible');
  loop.stop();
});

test('stop releases the observer, the listener and the frame, and wake schedules nothing after (#2634)', () => {
  const loop = startLoop({ dataset: {} }, () => true);
  assert.equal(frames.size, 1);
  assert.equal(listeners.size, 1);
  const observer = observers.at(-1);
  const scheduledBefore = scheduled;
  loop.stop();
  assert.equal(observer.disconnected, true);
  assert.equal(listeners.size, 0);
  assert.equal(frames.size, 0);
  loop.wake();
  assert.equal(scheduled, scheduledBefore, 'wake schedules no frame after stop');
});
