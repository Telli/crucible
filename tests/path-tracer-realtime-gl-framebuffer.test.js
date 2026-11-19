import test from 'node:test';
import assert from 'node:assert/strict';
import { createFramebuffer } from '../src/path-tracer-realtime-gl.js';

const GL = { FRAMEBUFFER: 1, COLOR_ATTACHMENT0: 2, TEXTURE_2D: 3, NONE: 4, FRAMEBUFFER_COMPLETE: 5 };

// A stand-in context that counts the framebuffers still alive.
function countingGl({ complete = true } = {}) {
  const liveFramebuffers = new Set();
  let created = 0;
  const drawBufferCalls = [];
  return {
    ...GL,
    liveFramebuffers,
    get created() {
      return created;
    },
    drawBufferCalls,
    createFramebuffer() {
      created += 1;
      const framebuffer = {};
      liveFramebuffers.add(framebuffer);
      return framebuffer;
    },
    bindFramebuffer() {},
    framebufferTexture2D() {},
    drawBuffers(buffers) {
      drawBufferCalls.push(buffers);
    },
    checkFramebufferStatus() {
      return complete ? GL.FRAMEBUFFER_COMPLETE : 0;
    },
    deleteFramebuffer(framebuffer) {
      liveFramebuffers.delete(framebuffer);
    },
  };
}

test('an incomplete framebuffer is released before the error is thrown', () => {
  const gl = countingGl({ complete: false });
  assert.throws(() => createFramebuffer(gl, [{ slot: 0, texture: {} }]), /cannot render to float targets/);
  assert.equal(gl.liveFramebuffers.size, 0);
});

test('an empty attachment list is refused before a framebuffer is created', () => {
  const gl = countingGl();
  assert.throws(() => createFramebuffer(gl, []), /at least one \{ slot, texture \} attachment/);
  assert.equal(gl.created, 0);
  assert.equal(gl.liveFramebuffers.size, 0);
});

test('a complete framebuffer stays alive and draws to the attachment slots', () => {
  const gl = countingGl();
  const framebuffer = createFramebuffer(gl, [{ slot: 0, texture: {} }, { slot: 2, texture: {} }]);
  assert.equal(gl.liveFramebuffers.has(framebuffer), true);
  assert.deepEqual(gl.drawBufferCalls, [[GL.COLOR_ATTACHMENT0, GL.NONE, GL.COLOR_ATTACHMENT0 + 2]]);
});
