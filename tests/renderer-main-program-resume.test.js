// A main program that is still linking while its context is prepared is finished by the draw that comes back, not compiled again (#2944).
import test from 'node:test';
import assert from 'node:assert/strict';
import { CrucibleRenderer } from '../src/renderer.js';
import { ProgramNotReady } from '../src/gl-program.js';

const COMPLETION_STATUS = 0x91b1;
const LINK_STATUS = 0x8b82;
const ACTIVE_UNIFORMS = 0x8b86;

function fakeContext() {
  const context = {
    linked: false,
    reads: [],
    deleted: [],
    LINK_STATUS,
    ACTIVE_UNIFORMS,
    getProgramParameter(program, parameter) {
      context.reads.push(parameter);
      if (parameter === ACTIVE_UNIFORMS) {
        return 0;
      }
      return context.linked;
    },
    getUniformLocation: () => null,
    useProgram() {},
    deleteShader() {},
    deleteProgram(program) {
      context.deleted.push(program);
    },
  };
  return context;
}

// The same two reads gl-program.js makes while a context is preparing: completion, which does not wait, then the link status.
function finishOrThrow(context, { program }) {
  if (!context.getProgramParameter(program, COMPLETION_STATUS)) {
    throw new ProgramNotReady(program);
  }
  context.getProgramParameter(program, LINK_STATUS);
  return program;
}

function fakeRenderer(context) {
  const renderer = Object.create(CrucibleRenderer.prototype);
  renderer.context = context;
  renderer.backend = { finishProgram: pending => finishOrThrow(context, pending) };
  renderer.shaderFeatures = new Set(['studioLighting']);
  renderer.viewTransform = 'aces';
  renderer.lookSource = null;
  renderer.started = [];
  renderer.startMainProgram = () => {
    const started = { program: { features: [...renderer.shaderFeatures] }, shaders: [] };
    renderer.started.push(started);
    return started;
  };
  return renderer;
}

test('a rebuild interrupted while linking is finished by the next attempt with the same program', () => {
  const context = fakeContext();
  const renderer = fakeRenderer(context);
  renderer.shaderFeatures.add('instanced');
  assert.throws(() => renderer.buildMainProgram(), ProgramNotReady);
  assert.equal(context.reads.includes(LINK_STATUS), false, 'the link status, which waits for the driver, is not read while the program builds');
  assert.equal(Object.hasOwn(renderer, 'program'), false, 'the renderer keeps what it drew with');

  context.linked = true;
  renderer.buildMainProgram();
  assert.equal(renderer.started.length, 1, 'the source is compiled once');
  assert.equal(renderer.program, renderer.started[0].program);
  assert.equal(renderer.pendingMainProgram, null);
});

test('a rebuild for other shader features drops the program that was still linking', () => {
  const context = fakeContext();
  const renderer = fakeRenderer(context);
  renderer.shaderFeatures.add('instanced');
  assert.throws(() => renderer.buildMainProgram(), ProgramNotReady);
  const abandoned = renderer.started[0].program;

  renderer.shaderFeatures.delete('instanced');
  renderer.shaderFeatures.add('toon');
  context.linked = true;
  context.reads.length = 0;
  renderer.buildMainProgram();
  assert.equal(renderer.started.length, 2);
  assert.deepEqual(context.deleted, [abandoned]);
  assert.equal(context.reads[0], LINK_STATUS, 'the abandoned link is waited for before its program is deleted');
  assert.deepEqual(renderer.program.features, ['studioLighting', 'toon']);
});

test('a renderer released while its main program links deletes that program', () => {
  const context = fakeContext();
  const renderer = fakeRenderer(context);
  assert.throws(() => renderer.buildMainProgram(), ProgramNotReady);
  renderer.releasePendingConstruction();
  assert.deepEqual(context.deleted, [renderer.started[0].program]);
  assert.equal(renderer.pendingMainProgram, null);
});
