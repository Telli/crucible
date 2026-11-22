import './support/load-agent-scene-modules.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAgentScene } from '../src/agent-scene.js';
import { createStudioController } from '../src/studio.js';
import { createOutlineMask } from '../src/studio-outline-mask.js';
import { createFakeWebgl2 } from './support/fake-webgl2.mjs';

function createFakeDocument({ context }) {
  const canvases = [];
  const documentReference = {
    createElement() {
      const listeners = new Map();
      const canvas = {
        hidden: false,
        removed: false,
        attributes: {},
        setAttribute(name, value) {
          this.attributes[name] = value;
        },
        getContext: () => context,
        addEventListener: (type, listener) => listeners.set(type, listener),
        removeEventListener: type => listeners.delete(type),
        emit: (type, event = { preventDefault() {} }) => listeners.get(type)?.(event),
        remove() {
          this.removed = true;
        },
      };
      canvases.push(canvas);
      return canvas;
    },
  };
  return { documentReference, canvases };
}

function partFor(geometry) {
  return { geometry, modelViewProjection: new Float32Array(16) };
}

function triangleGeometry() {
  return { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2] };
}

function makeMask({ context, onRestored }) {
  const { documentReference, canvases } = createFakeDocument({ context });
  const mounted = [];
  const mask = createOutlineMask({ documentReference, className: 'mask', mount: canvas => mounted.push(canvas), onRestored });
  return { mask, canvases, mounted };
}

test('the mask uploads each geometry once, however many frames draw it', () => {
  const { context, state } = createFakeWebgl2();
  const { mask, canvases, mounted } = makeMask({ context });
  const geometry = triangleGeometry();
  assert.equal(canvases.length, 0, 'no canvas exists before a dense selection');
  assert.equal(mask.draw({ parts: [partFor(geometry)] }, 800, 600), true);
  assert.equal(mask.draw({ parts: [partFor(geometry)] }, 800, 600), true);
  assert.equal(mask.draw({ parts: [partFor(geometry)] }, 800, 600), true);
  assert.equal(state.buffersCreated, 2, 'one position buffer and one index buffer');
  assert.equal(state.draws.length, 3);
  assert.equal(state.draws[0], 3);
  assert.equal(mounted.length, 1);
  assert.equal(canvases[0].width, 800);
  assert.equal(canvases[0].height, 600);
});

test('deselecting frees every buffer and hides the canvas', () => {
  const { context, state } = createFakeWebgl2();
  const { mask, canvases } = makeMask({ context });
  mask.draw({ parts: [partFor(triangleGeometry()), partFor(triangleGeometry())] }, 400, 300);
  assert.equal(mask.uploadCount, 2);
  assert.equal(mask.draw(null, 400, 300), false);
  assert.equal(mask.uploadCount, 0);
  assert.equal(state.buffersDeleted, state.buffersCreated);
  assert.equal(state.vertexArraysDeleted, state.vertexArraysCreated);
  assert.equal(canvases[0].hidden, true);
  mask.draw({ parts: [partFor(triangleGeometry())] }, 400, 300);
  assert.equal(canvases[0].hidden, false, 'a new dense selection shows it again');
});

test('a part that leaves the selection loses its buffers while the others stay', () => {
  const { context, state } = createFakeWebgl2();
  const { mask } = makeMask({ context });
  const kept = triangleGeometry();
  const dropped = triangleGeometry();
  mask.draw({ parts: [partFor(kept), partFor(dropped)] }, 400, 300);
  mask.draw({ parts: [partFor(kept)] }, 400, 300);
  assert.equal(mask.uploadCount, 1);
  assert.equal(state.buffersDeleted, 2);
});

test('dispose frees the buffers and the program, gives the context back and removes the canvas', () => {
  const { context, state } = createFakeWebgl2();
  const { mask, canvases } = makeMask({ context });
  mask.draw({ parts: [partFor(triangleGeometry())] }, 400, 300);
  mask.dispose();
  assert.equal(state.buffersDeleted, state.buffersCreated);
  assert.equal(state.programsDeleted, 1);
  assert.equal(state.contextLosses, 1);
  assert.equal(canvases[0].removed, true);
  assert.equal(mask.draw({ parts: [partFor(triangleGeometry())] }, 400, 300), false, 'a disposed mask draws nothing');
});

test('a lost context stops drawing, and the restore asks for a redraw and uploads again', () => {
  const { context, state } = createFakeWebgl2();
  let restored = 0;
  const { mask, canvases } = makeMask({ context, onRestored: () => { restored += 1; } });
  const geometry = triangleGeometry();
  mask.draw({ parts: [partFor(geometry)] }, 400, 300);
  let prevented = false;
  canvases[0].emit('webglcontextlost', { preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true, 'the browser is told to allow a restore');
  assert.equal(mask.draw({ parts: [partFor(geometry)] }, 400, 300), false);
  canvases[0].emit('webglcontextrestored');
  assert.equal(restored, 1);
  assert.equal(mask.draw({ parts: [partFor(geometry)] }, 400, 300), true);
  assert.equal(state.buffersCreated, 4, 'the buffers of the lost context are made again');
});

test('without WebGL2 the mask says it cannot draw, so the caller outlines another way', () => {
  const { mask } = makeMask({ context: null });
  assert.equal(mask.draw({ parts: [partFor(triangleGeometry())] }, 400, 300), false);
});

test('drawing and freeing the mask schedules no frame and no timer', () => {
  const { context } = createFakeWebgl2();
  const { mask } = makeMask({ context });
  const scheduled = [];
  const originals = { requestAnimationFrame: globalThis.requestAnimationFrame, setTimeout: globalThis.setTimeout, setInterval: globalThis.setInterval };
  globalThis.requestAnimationFrame = () => scheduled.push('frame');
  globalThis.setTimeout = () => scheduled.push('timeout');
  globalThis.setInterval = () => scheduled.push('interval');
  try {
    mask.draw({ parts: [partFor(triangleGeometry())] }, 400, 300);
    mask.draw(null, 400, 300);
    mask.dispose();
  } finally {
    Object.assign(globalThis, originals);
  }
  assert.deepEqual(scheduled, []);
});

function denseRecipe() {
  return {
    format: 'crucible.scene',
    schemaVersion: 1,
    geometries: [
      { id: 'dense-ball', type: 'sphere', segments: 96, rings: 64 },
      { id: 'small-box', type: 'box', bevel: 0 },
    ],
    materials: [{ id: 'paint', tag: 'surface', color: [0.8, 0.25, 0.2], roughness: 0.4, metallic: 0.1 }],
    nodes: [
      { id: 'dense', geometry: 'dense-ball', material: 'paint', translation: [0, 1, 0] },
      { id: 'small', geometry: 'small-box', material: 'paint', translation: [3, 0.5, 0] },
    ],
    camera: { eye: [0, 2, 8], target: [0, 1, 0], up: [0, 1, 0], fov: 45, near: 0.1, far: 100 },
    environment: { setup: 'studio' },
  };
}

test('a selection past the triangle budget is not given the hull: it goes to the mask with its own mesh', () => {
  const controller = createStudioController({ scene: createAgentScene(denseRecipe()), viewportWidth: 800, viewportHeight: 600 });
  controller.selectNode('dense');
  const densePart = controller.scene.parts.find(part => part.name === 'dense');
  assert.ok(densePart.geometry.indices.length / 3 > 8000, 'the ball is past the triangle budget');
  assert.equal(controller.selectionSilhouette(), null, 'no hull fan stands in for the shape');
  const source = controller.selectionMaskSource();
  assert.equal(source.parts.length, 1);
  assert.equal(source.parts[0].geometry, densePart.geometry, 'the mask draws the real triangles');
  controller.dispose();
});

test('the mask matrix puts a vertex where the controller projects it', () => {
  const controller = createStudioController({ scene: createAgentScene(denseRecipe()), viewportWidth: 800, viewportHeight: 600 });
  controller.selectNode('dense');
  const { parts } = controller.selectionMaskSource();
  const matrix = parts[0].modelViewProjection;
  const positions = parts[0].geometry.positions;
  const [x, y, z] = [positions[0], positions[1], positions[2]];
  const clipX = matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12];
  const clipY = matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13];
  const clipW = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
  const part = controller.scene.parts.find(candidate => candidate.name === 'dense');
  const world = [
    part.matrix[0] * x + part.matrix[4] * y + part.matrix[8] * z + part.matrix[12],
    part.matrix[1] * x + part.matrix[5] * y + part.matrix[9] * z + part.matrix[13],
    part.matrix[2] * x + part.matrix[6] * y + part.matrix[10] * z + part.matrix[14],
  ];
  const projected = controller.projectWorldPoint(world);
  assert.ok(Math.abs((clipX / clipW * 0.5 + 0.5) * 800 - projected.x) < 0.01);
  assert.ok(Math.abs((0.5 - clipY / clipW * 0.5) * 600 - projected.y) < 0.01);
  controller.dispose();
});

test('a small selection keeps the exact path and has no mask source', () => {
  const controller = createStudioController({ scene: createAgentScene(denseRecipe()), viewportWidth: 800, viewportHeight: 600 });
  controller.selectNode('small');
  assert.ok(controller.selectionSilhouette().length >= 6);
  assert.equal(controller.selectionMaskSource(), null);
  controller.selectNode(null);
  assert.equal(controller.selectionMaskSource(), null);
  controller.dispose();
});

test('a dense selection with part of it behind the camera still has a mask source', () => {
  const controller = createStudioController({ scene: createAgentScene(denseRecipe()), viewportWidth: 800, viewportHeight: 600 });
  controller.selectNode('dense');
  controller.updateCamera({ eye: [0, 1, 0.5], target: [0, 1, -5] });
  assert.ok(controller.selectionMaskSource().parts.length > 0, 'the card clips what is behind the camera instead of dropping the outline');
  assert.equal(controller.selectionSilhouette(), null);
  controller.dispose();
});
