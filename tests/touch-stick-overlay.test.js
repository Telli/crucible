import assert from 'node:assert/strict';
import test from 'node:test';
import { touchSource } from '../src/input-sources.js';
import { clampKnobOffset, createTouchStickModel, createTouchStickOverlay, stickOpacity } from '../src/touch-stick-overlay.js';

function fakeElement(documentOwner) {
  const element = {
    ownerDocument: documentOwner,
    style: {},
    children: [],
    attributes: {},
    removed: false,
    setAttribute(name, value) { element.attributes[name] = value; },
    appendChild(child) { element.children.push(child); return child; },
    remove() { element.removed = true; },
    getBoundingClientRect() { return { left: 0, top: 0 }; },
  };
  return element;
}

function fakePage() {
  const documentOwner = { createElement: () => fakeElement(documentOwner) };
  return fakeElement(documentOwner);
}

function fakeTouchTarget() {
  const listeners = new Map();
  return {
    innerWidth: 400,
    innerHeight: 800,
    addEventListener(type, handler) { listeners.set(type, handler); },
    removeEventListener(type) { listeners.delete(type); },
    dispatch(type, event) { listeners.get(type)(event); },
  };
}

test('the knob follows the drag and is cut back to the stick radius', () => {
  assert.deepEqual(clampKnobOffset(30, -40, 60), { x: 30, y: -40 });
  const far = clampKnobOffset(300, 400, 60);
  assert.ok(Math.abs(far.x - 36) < 1e-9 && Math.abs(far.y - 48) < 1e-9, `got ${JSON.stringify(far)}`);
  assert.equal(Math.hypot(far.x, far.y).toFixed(6), '60.000000');
  assert.throws(() => clampKnobOffset(Number.NaN, 0, 60), /finite dragX and dragY/);
  assert.throws(() => clampKnobOffset(1, 1, 0), /radius must be a number above 0/);
});

test('the stick is solid while held and fades to nothing after release', () => {
  assert.equal(stickOpacity(true, 0, 350), 1);
  assert.equal(stickOpacity(false, 0, 350), 1);
  assert.equal(stickOpacity(false, 175, 350), 0.5);
  assert.equal(stickOpacity(false, 350, 350), 0);
  assert.equal(stickOpacity(false, 9000, 350), 0);
});

test('the model keeps the last place while fading, then forgets it', () => {
  const model = createTouchStickModel({ fadeMilliseconds: 400 });
  const held = [{ name: 'touch/move', originX: 100, originY: 500, dragX: 0, dragY: -200, radius: 60 }];
  const [whileHeld] = model.update(held, 1000);
  assert.deepEqual([whileHeld.centerX, whileHeld.centerY, whileHeld.knobX, whileHeld.knobY, whileHeld.opacity], [100, 500, 100, 440, 1]);
  const [justReleased] = model.update([], 2000);
  assert.deepEqual([justReleased.knobY, justReleased.opacity], [440, 1]);
  const [halfway] = model.update([], 2200);
  assert.equal(halfway.opacity, 0.5);
  assert.deepEqual(model.update([], 2400), []);
  assert.deepEqual(model.update([], 5000), []);
  assert.throws(() => model.update(null, 0), /stickStates/);
  assert.throws(() => createTouchStickModel({ fadeMilliseconds: 0 }), /fadeMilliseconds/);
});

test('touchSource reports the held stick for the drawing', () => {
  const target = fakeTouchTarget();
  const source = touchSource({ target, blurTarget: fakeTouchTarget(), sticks: [{ name: 'move', area: { x: 0, y: 0, width: 0.5, height: 1 }, radius: 60 }] });
  source.attach(() => {});
  assert.deepEqual(source.stickStates(), []);
  target.dispatch('pointerdown', { pointerType: 'touch', pointerId: 1, clientX: 80, clientY: 600, timeStamp: 0 });
  target.dispatch('pointermove', { pointerType: 'touch', pointerId: 1, clientX: 80, clientY: 400, timeStamp: 10 });
  assert.deepEqual(source.stickStates(), [{ name: 'move', originX: 80, originY: 600, dragX: 0, dragY: -200, radius: 60 }]);
  target.dispatch('pointerup', { pointerType: 'touch', pointerId: 1, clientX: 80, clientY: 400, timeStamp: 20 });
  assert.deepEqual(source.stickStates(), []);
});

test('the overlay draws a ring and a knob that ignore touches, then removes itself', () => {
  const page = fakePage();
  let states = [{ name: 'move', originX: 100, originY: 500, dragX: 0, dragY: -200, radius: 60 }];
  let pendingFrame = null;
  let time = 0;
  const overlay = createTouchStickOverlay({
    parent: page,
    source: { stickStates: () => states },
    fadeMilliseconds: 400,
    requestFrame: callback => { pendingFrame = callback; return 7; },
    cancelFrame: handle => { assert.equal(handle, 7); pendingFrame = null; },
    now: () => time,
  });
  const [container] = page.children;
  assert.match(container.style.cssText, /pointer-events:none/);
  assert.match(container.style.cssText, /user-select:none/);
  assert.match(container.style.cssText, /touch-action:none/);
  assert.match(container.style.cssText, /env\(safe-area-inset-top/);
  pendingFrame();
  const [ring, knob] = container.children;
  assert.equal(ring.style.transform, 'translate(100px,500px)');
  assert.equal(knob.style.transform, 'translate(100px,440px)');
  assert.equal(ring.style.opacity, '1');
  assert.match(ring.style.cssText, /width:120px/);
  states = [];
  time = 200;
  pendingFrame();
  time = 600;
  pendingFrame();
  assert.equal(ring.style.opacity, '0');
  assert.equal(knob.style.opacity, '0');
  overlay.dispose();
  assert.equal(container.removed, true);
  assert.equal(pendingFrame, null);
});

test('the overlay names what to pass when its inputs are wrong', () => {
  assert.throws(() => createTouchStickOverlay({ source: { stickStates: () => [] } }), /needs parent/);
  assert.throws(() => createTouchStickOverlay({ parent: fakePage(), source: {} }), /stickStates\(\)/);
});
