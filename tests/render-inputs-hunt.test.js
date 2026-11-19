// Bug hunt over the render pass inputs: a ledger that accepts an infinite size, a failed program kept after it was deleted,
// and a mesh volume buffer that leaks its texture when the canvas is too wide or the framebuffer is incomplete.
import test from 'node:test';
import assert from 'node:assert/strict';
import { RenderTargetLedger } from '../src/render-target-ledger.js';
import { compileProgram, setPreparing } from '../src/gl-program.js';
import { drawMeshVolumes } from '../src/mesh-volume-pass.js';

test('the render target ledger refuses an infinite size and keeps its totals finite', () => {
  const ledger = new RenderTargetLedger();
  ledger.record('frame', { width: 4, height: 4, format: 'R8' });
  assert.throws(() => ledger.record('huge', { width: Infinity, height: 4, format: 'R8' }), RangeError);
  assert.throws(() => ledger.record('layers', { width: 4, height: 4, layers: Infinity, format: 'R8' }), RangeError);
  assert.equal(ledger.report().totalBytes, 16);
});

// A context whose second shader fails to compile, and whose deleted shaders and programs report nothing, as a real driver does.
function failingContext() {
  const deleted = new Set();
  let created = 0;
  return {
    created: () => created,
    LINK_STATUS: 1,
    COMPILE_STATUS: 2,
    VERTEX_SHADER: 3,
    FRAGMENT_SHADER: 4,
    getExtension: () => ({ COMPLETION_STATUS_KHR: 5 }),
    createProgram: () => ({ id: created++ }),
    createShader: () => ({}),
    shaderSource() {},
    compileShader() {},
    attachShader() {},
    linkProgram() {},
    getProgramParameter: (program, parameter) => parameter === 5 || (!deleted.has(program) && parameter !== 1),
    getShaderParameter: (shader) => deleted.has(shader) === true,
    getShaderInfoLog: (shader) => (deleted.has(shader) ? null : 'ERROR: 0:3: syntax error'),
    getProgramInfoLog: () => null,
    deleteShader: shader => deleted.add(shader),
    deleteProgram: program => deleted.add(program),
    isContextLost: () => false,
  };
}

test('while preparing, a program that failed to compile is built again so the next draw reports the shader log', () => {
  const context = failingContext();
  setPreparing(context, true);
  assert.throws(() => compileProgram(context, 'vertex', 'broken'), /syntax error/);
  assert.throws(() => compileProgram(context, 'vertex', 'broken'), /syntax error/, 'the retry still names the cause');
  assert.equal(context.created(), 2, 'a failed program is not kept for the retry');
  setPreparing(context, false);
});

function meshContext({ incomplete = false, maximumSize = 16384 } = {}) {
  const live = new Set();
  const handlers = {
    getExtension: () => ({}),
    checkFramebufferStatus: () => (incomplete ? 'INCOMPLETE' : 'FRAMEBUFFER_COMPLETE'),
    getParameter: () => maximumSize,
    isEnabled: () => false,
    getUniformLocation: name => name,
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    getShaderInfoLog: () => '',
    getProgramInfoLog: () => '',
    createTexture: () => track({ kind: 'texture' }),
    createFramebuffer: () => track({ kind: 'framebuffer' }),
    deleteTexture: handle => live.delete(handle),
    deleteFramebuffer: handle => live.delete(handle),
  };
  const track = handle => {
    live.add(handle);
    return handle;
  };
  const context = new Proxy({}, {
    get(_target, name) {
      if (name in handlers) return handlers[name];
      if (/^[A-Z0-9_]+$/.test(name)) return name;
      return () => ({});
    },
  });
  return { context, live };
}

function meshRenderer(context, width) {
  const tetrahedron = {
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]),
    normals: new Float32Array(12),
    indices: new Uint32Array([0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3]),
  };
  return {
    context,
    dispose() {},
    canvas: { width, height: 8 },
    depthTexture: {},
    viewProjection: new Float32Array(16),
    inverseViewProjection: new Float32Array(16),
    renderTargets: { record() {}, release() {} },
    localVolumeBuffers: { meshParts: [{ label: 'environment.localVolumes[0]', part: { name: 'room', geometry: tetrahedron } }] },
  };
}

const FRAME = { eye: [0, 0, 5], projection: 'perspective' };

test('a canvas wider than the texture limit is refused before anything is allocated', () => {
  const { context, live } = meshContext({ maximumSize: 4096 });
  assert.throws(() => drawMeshVolumes(meshRenderer(context, 5000), FRAME), /5000x8 .*limit of 4096/);
  assert.equal(live.size, 0);
});

test('an incomplete mesh volume framebuffer gives its texture and framebuffer back', () => {
  const { context, live } = meshContext({ incomplete: true });
  assert.throws(() => drawMeshVolumes(meshRenderer(context, 8), FRAME), /could not be allocated/);
  assert.equal(live.size, 0, 'nothing from the failed allocation stays alive');
});
