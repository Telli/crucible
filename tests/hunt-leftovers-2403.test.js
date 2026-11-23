import test from 'node:test';
import assert from 'node:assert/strict';
import { mountButton } from '../src/site-controls.js';

function fakeWebglContext({ compileFailsOn = null, linkFails = false } = {}) {
  const liveShaders = new Set();
  const livePrograms = new Set();
  const createdShaders = [];
  const createdPrograms = [];
  const deletedShaders = [];
  const deletedPrograms = [];
  let shaderSequence = 0;
  let programSequence = 0;
  return {
    deletedShaders,
    deletedPrograms,
    createdShaders,
    createdPrograms,
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    COMPILE_STATUS: 0x8b81,
    LINK_STATUS: 0x8b82,
    UNMASKED_RENDERER_WEBGL: 0x9246,
    getExtension: () => ({}),
    getParameter: () => 'fake-gl',
    createShader(type) {
      const shader = { id: ++shaderSequence, type };
      liveShaders.add(shader);
      createdShaders.push(shader);
      return shader;
    },
    shaderSource() {},
    compileShader() {},
    getShaderParameter(shader, parameter) {
      if (parameter === 0x8b81) return compileFailsOn !== shader.type;
      return true;
    },
    getShaderInfoLog: shader => (liveShaders.has(shader) ? 'compile failed' : null),
    deleteShader(shader) {
      liveShaders.delete(shader);
      deletedShaders.push(shader);
    },
    createProgram() {
      const program = { id: ++programSequence };
      livePrograms.add(program);
      createdPrograms.push(program);
      return program;
    },
    attachShader() {},
    linkProgram() {},
    getProgramParameter: () => !linkFails,
    getProgramInfoLog: program => (livePrograms.has(program) ? 'link failed' : null),
    deleteProgram(program) {
      livePrograms.delete(program);
      deletedPrograms.push(program);
    },
  };
}

test('getKernel deletes shaders and the program when shader compilation or linking fails', async () => {
  const context = fakeWebglContext({ linkFails: true });
  const originalDocument = globalThis.document;
  const originalOffscreen = globalThis.OffscreenCanvas;
  globalThis.OffscreenCanvas = undefined;
  globalThis.document = { createElement: () => ({ getContext: () => context }) };
  try {
    const { getKernel } = await import(`../src/path-tracer-gpu.js?link=${Date.now()}`);
    assert.throws(() => getKernel(false, false, {}), /program did not link: link failed/);
    assert.equal(context.deletedPrograms.length, 1);
    assert.equal(context.deletedShaders.length, 2);
  } finally {
    globalThis.document = originalDocument;
    globalThis.OffscreenCanvas = originalOffscreen;
  }
});

test('mountButton does not attach duplicate click listeners when called repeatedly on the same button', () => {
  const listeners = new Map();
  const classNames = new Set();
  const attributes = new Map();
  const buttonElement = {
    textContent: 'Copy',
    type: '',
    classList: { add: name => classNames.add(name) },
    setAttribute: (name, value) => attributes.set(name, value),
    replaceChildren() {},
    addEventListener(type, listener) {
      const list = listeners.get(type) ?? [];
      list.push(listener);
      listeners.set(type, list);
    },
  };
  const originalDocument = globalThis.document;
  globalThis.document = { createElement: () => ({ textContent: '' }) };
  try {
    let clicks = 0;
    mountButton(buttonElement, { onClick: () => { clicks += 1; } });
    mountButton(buttonElement, { label: 'Copy code', onClick: () => { clicks += 1; } });
    assert.equal((listeners.get('click') ?? []).length, 1);
    for (const listener of listeners.get('click')) listener();
    assert.equal(clicks, 1);
  } finally {
    globalThis.document = originalDocument;
  }
});
