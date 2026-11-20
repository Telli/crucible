// A drawn virtual stick for a touch game: a ring where the finger landed and a knob that follows the drag, fading out once the finger lifts.
// The drawing only reads `touchSource(...).stickStates()`; it never listens to touches, so it cannot change what the input source sees.
// docs/game.md shows how a game turns it on.

export const TOUCH_STICK_DEFAULT_FADE_MILLISECONDS = 350;
const MAXIMUM_FADE_MILLISECONDS = 5000;
const KNOB_DIAMETER_OVER_RING_DIAMETER = 0.42;

function describe(value) {
  return value === null ? 'null' : typeof value;
}

/** The knob's distance from the ring centre: the drag, cut back to `radius` when it is longer. Returns { x, y } in pixels. */
export function clampKnobOffset(dragX, dragY, radius) {
  if (![dragX, dragY].every(Number.isFinite)) {
    throw new TypeError(`clampKnobOffset needs finite dragX and dragY in pixels, got ${String(dragX)} and ${String(dragY)}.`);
  }
  if (!Number.isFinite(radius) || radius <= 0) {
    throw new RangeError(`clampKnobOffset radius must be a number above 0, got ${String(radius)}.`);
  }
  const length = Math.hypot(dragX, dragY);
  if (length <= radius) return { x: dragX, y: dragY };
  const scale = radius / length;
  return { x: dragX * scale, y: dragY * scale };
}

/** 1 while the finger is down, then a straight fall to 0 over `fadeMilliseconds` after it lifts. */
export function stickOpacity(held, millisecondsSinceRelease, fadeMilliseconds) {
  if (held) return 1;
  return Math.max(0, Math.min(1, 1 - millisecondsSinceRelease / fadeMilliseconds));
}

function requireFadeMilliseconds(value) {
  if (!Number.isFinite(value) || value <= 0 || value > MAXIMUM_FADE_MILLISECONDS) {
    throw new RangeError(`touch stick fadeMilliseconds must be a number from above 0 to ${MAXIMUM_FADE_MILLISECONDS}, got ${String(value)}.`);
  }
  return value;
}

/**
 * The state behind the drawing: feed it the stick states and the time, read what to draw. A stick that was let go keeps its last
 * place while it fades, so the ring does not jump when the finger lifts.
 */
export function createTouchStickModel({ fadeMilliseconds = TOUCH_STICK_DEFAULT_FADE_MILLISECONDS } = {}) {
  const fade = requireFadeMilliseconds(fadeMilliseconds);
  const lastPlaces = new Map(); // stick name -> { centerX, centerY, knobX, knobY, radius, releasedAt }
  return {
    update(stickStates, nowMilliseconds) {
      if (!Array.isArray(stickStates)) {
        throw new TypeError(`touch stick model update needs the array from touchSource(...).stickStates(), got ${describe(stickStates)}.`);
      }
      const heldNames = new Set();
      for (const { name, originX, originY, dragX, dragY, radius } of stickStates) {
        const offset = clampKnobOffset(dragX, dragY, radius);
        heldNames.add(name);
        lastPlaces.set(name, { centerX: originX, centerY: originY, knobX: originX + offset.x, knobY: originY + offset.y, radius, releasedAt: null });
      }
      const visuals = [];
      for (const [name, place] of lastPlaces) {
        if (!heldNames.has(name) && place.releasedAt === null) place.releasedAt = nowMilliseconds;
        const held = heldNames.has(name);
        const opacity = stickOpacity(held, held ? 0 : nowMilliseconds - place.releasedAt, fade);
        if (opacity === 0) {
          lastPlaces.delete(name);
          continue;
        }
        visuals.push({ name, held, opacity, centerX: place.centerX, centerY: place.centerY, knobX: place.knobX, knobY: place.knobY, radius: place.radius });
      }
      return visuals;
    },
  };
}

const CONTAINER_STYLE = [
  'position:fixed',
  'top:env(safe-area-inset-top,0px)',
  'right:env(safe-area-inset-right,0px)',
  'bottom:env(safe-area-inset-bottom,0px)',
  'left:env(safe-area-inset-left,0px)',
  'pointer-events:none',
  'user-select:none',
  '-webkit-user-select:none',
  'touch-action:none',
  'overflow:hidden',
].join(';');

function circleStyle(diameter, extra) {
  return `position:absolute;left:0;top:0;width:${diameter}px;height:${diameter}px;margin:${-diameter / 2}px 0 0 ${-diameter / 2}px;border-radius:50%;box-sizing:border-box;pointer-events:none;will-change:transform,opacity;${extra}`;
}

/**
 * Draw the sticks of a touch source over a page. `parent` is the element the overlay is added to (the canvas's parent), `source` the
 * object from touchSource, and the sizes follow each stick's radius in CSS pixels. The overlay ignores touches (pointer-events none),
 * cannot be selected, and keeps inside the safe area of a phone with a notch. Returns { dispose() }.
 */
export function createTouchStickOverlay({ parent, source, fadeMilliseconds = TOUCH_STICK_DEFAULT_FADE_MILLISECONDS, requestFrame, cancelFrame, now } = {}) {
  if (!parent || typeof parent.appendChild !== 'function' || !parent.ownerDocument?.createElement) {
    throw new TypeError(`createTouchStickOverlay needs parent, a page element to draw into such as canvas.parentNode, got ${describe(parent)}.`);
  }
  if (!source || typeof source.stickStates !== 'function') {
    throw new TypeError('createTouchStickOverlay needs source, the object from touchSource(...), which has stickStates().');
  }
  const model = createTouchStickModel({ fadeMilliseconds });
  const schedule = requestFrame ?? globalThis.requestAnimationFrame?.bind(globalThis);
  const cancel = cancelFrame ?? globalThis.cancelAnimationFrame?.bind(globalThis);
  const clock = now ?? (() => globalThis.performance.now());
  if (typeof schedule !== 'function' || typeof cancel !== 'function') {
    throw new TypeError('createTouchStickOverlay needs requestFrame and cancelFrame (such as requestAnimationFrame) in a page without them.');
  }
  const documentOwner = parent.ownerDocument;
  const container = documentOwner.createElement('div');
  container.setAttribute('aria-hidden', 'true');
  container.setAttribute('data-crucible-touch-stick', '');
  container.style.cssText = CONTAINER_STYLE;
  parent.appendChild(container);
  const drawn = new Map(); // stick name -> { ring, knob }

  function elementsFor(name, radius) {
    if (drawn.has(name)) return drawn.get(name);
    const ring = documentOwner.createElement('div');
    ring.style.cssText = circleStyle(radius * 2, 'border:4px solid #fff;background:rgba(15,18,28,.3);box-shadow:0 0 0 2px rgba(0,0,0,.65),inset 0 0 0 2px rgba(0,0,0,.5),0 0 16px rgba(0,0,0,.4)');
    const knob = documentOwner.createElement('div');
    knob.style.cssText = circleStyle(radius * 2 * KNOB_DIAMETER_OVER_RING_DIAMETER, 'background:#fff;box-shadow:0 0 0 2px rgba(0,0,0,.65),0 3px 8px rgba(0,0,0,.5)');
    container.appendChild(ring);
    container.appendChild(knob);
    const elements = { ring, knob };
    drawn.set(name, elements);
    return elements;
  }

  function draw(visuals) {
    const bounds = container.getBoundingClientRect?.() ?? { left: 0, top: 0 };
    const visibleNames = new Set();
    for (const visual of visuals) {
      visibleNames.add(visual.name);
      const { ring, knob } = elementsFor(visual.name, visual.radius);
      ring.style.opacity = String(visual.opacity);
      knob.style.opacity = String(visual.opacity);
      ring.style.transform = `translate(${visual.centerX - bounds.left}px,${visual.centerY - bounds.top}px)`;
      knob.style.transform = `translate(${visual.knobX - bounds.left}px,${visual.knobY - bounds.top}px)`;
    }
    for (const [name, { ring, knob }] of drawn) {
      if (visibleNames.has(name)) continue;
      ring.style.opacity = '0';
      knob.style.opacity = '0';
    }
  }

  let frameHandle = null;
  let disposed = false;
  function tick() {
    if (disposed) return;
    draw(model.update(source.stickStates(), clock()));
    frameHandle = schedule(tick);
  }
  frameHandle = schedule(tick);

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      if (frameHandle !== null) cancel(frameHandle);
      container.remove();
    },
  };
}
