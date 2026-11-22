import assert from 'node:assert/strict';
import test from 'node:test';
import { mat4 } from 'gl-matrix';
import { attachGaussianSplats, createGaussianSplats, parseGaussianSplatPly } from '../src/gaussian-splats.js';

const PROPERTIES = ['x', 'y', 'z', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3'];

function buildPly(splats) {
  const header = ['ply', 'format binary_little_endian 1.0', `element vertex ${splats.length}`, ...PROPERTIES.map(name => `property float ${name}`), 'end_header', ''].join('\n');
  const headerBytes = new TextEncoder().encode(header);
  const body = new Float32Array(splats.length * PROPERTIES.length);
  splats.forEach((values, index) => body.set(values, index * PROPERTIES.length));
  const file = new Uint8Array(headerBytes.length + body.byteLength);
  file.set(headerBytes, 0);
  file.set(new Uint8Array(body.buffer), headerBytes.length);
  return file.buffer;
}

const splatAt = (x, y, z) => [x, y, z, 0.2, 0.4, 0.6, 2, Math.log(0.1), Math.log(0.2), Math.log(0.3), 1, 0, 0, 0];

// A WebGL2 stand-in that keeps each texture's uploaded words and serves readPixels from the texture attached to the
// bound read framebuffer, so a detach really has to read the data back for a second attach to see it.
function createTextureMemoryRenderer({ contextLost = false } = {}) {
  const textureWords = new Map();
  const framebufferTextures = new Map();
  const state = { boundTexture: null, readFramebuffer: null, packBuffer: 'renderer pack buffer', readCalls: 0, orderUploads: 0 };
  let nextObject = 0;
  const handlers = {
    isContextLost: () => contextLost,
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    createTexture: () => ({ texture: nextObject++ }),
    createFramebuffer: () => ({ framebuffer: nextObject++ }),
    bindTexture: (target, texture) => { state.boundTexture = texture; },
    texImage2D: (...parameters) => { textureWords.set(state.boundTexture, Uint32Array.from(parameters[8])); },
    bindFramebuffer: (target, framebuffer) => { if (target === 'READ_FRAMEBUFFER') state.readFramebuffer = framebuffer; },
    framebufferTexture2D: (target, attachment, textureTarget, texture) => { framebufferTextures.set(state.readFramebuffer, texture); },
    bufferSubData: () => { state.orderUploads++; },
    bindBuffer: (target, buffer) => { if (target === 'PIXEL_PACK_BUFFER') state.packBuffer = buffer; },
    getParameter: name => (name === 'PIXEL_PACK_BUFFER_BINDING' ? state.packBuffer : state.readFramebuffer),
    readPixels: (x, y, width, height, format, type, target) => {
      assert.equal(state.packBuffer, null, 'readPixels into an array needs no pixel pack buffer bound');
      state.readCalls++;
      target.set(textureWords.get(framebufferTextures.get(state.readFramebuffer)));
    },
  };
  const context = new Proxy({}, {
    get(target, name) {
      if (typeof name !== 'string') return undefined;
      if (handlers[name]) return handlers[name];
      if (/^[A-Z_0-9]+$/.test(name)) return name;
      return () => ({ created: name });
    },
  });
  const renderer = {
    context,
    canvas: { width: 64, height: 64 },
    multisampleFramebuffer: {},
    projection: mat4.perspective(mat4.create(), 1, 1, 0.1, 50),
    view: mat4.create(),
    hdr: false,
    drawBlendBatches() {},
    dispose() {},
  };
  return { renderer, textureWords, state };
}

function createSampleSplats() {
  return createGaussianSplats(parseGaussianSplatPly(buildPly([splatAt(0, 0, -3), splatAt(1, 2, -4)])));
}

test('detached splats attach to another renderer with the same packed words (#2735)', () => {
  const splats = createSampleSplats();
  const packedWords = Uint32Array.from(splats.packed.words);
  const first = createTextureMemoryRenderer();
  const detach = attachGaussianSplats(first.renderer, splats);
  assert.equal(splats.packed, null);
  assert.ok(splats.statistics.gpuBytes > 0);
  detach();
  assert.equal(first.state.readCalls, 1);
  assert.equal(splats.statistics.gpuBytes, 0);
  assert.equal(first.state.packBuffer, 'renderer pack buffer', 'detach restores the pixel pack buffer binding');
  const second = createTextureMemoryRenderer();
  attachGaussianSplats(second.renderer, splats);
  const [uploaded] = second.textureWords.values();
  assert.deepEqual(uploaded, packedWords);
  assert.ok(splats.statistics.gpuBytes > 0);
});

test('splats attached again draw their whole sorted order from the same view (#2735)', () => {
  const splats = createSampleSplats();
  const frame = { eye: [0, 0, 0], exposure: 1 };
  const first = createTextureMemoryRenderer();
  const detach = attachGaussianSplats(first.renderer, splats);
  first.renderer.drawBlendBatches(frame);
  assert.equal(first.state.orderUploads, 1);
  detach();
  const second = createTextureMemoryRenderer();
  attachGaussianSplats(second.renderer, splats);
  second.renderer.drawBlendBatches(frame);
  assert.equal(second.state.orderUploads, 1, 'the new order buffer gets the sorter order even though the view did not move');
  second.renderer.drawBlendBatches(frame);
  assert.equal(second.state.orderUploads, 1, 'an unchanged view still skips the upload');
});

test('detached splats can attach to the same renderer again (#2735)', () => {
  const splats = createSampleSplats();
  const { renderer } = createTextureMemoryRenderer();
  attachGaussianSplats(renderer, splats)();
  assert.doesNotThrow(() => attachGaussianSplats(renderer, splats));
});

test('attached splats still refuse a second attach and say how to detach (#2735)', () => {
  const splats = createSampleSplats();
  attachGaussianSplats(createTextureMemoryRenderer().renderer, splats);
  assert.throws(() => attachGaussianSplats(createTextureMemoryRenderer().renderer, splats), /already attached.*detach them, then attach again/);
});

test('a detach after the context is lost leaves the splats to be created again (#2735)', () => {
  const splats = createSampleSplats();
  const lost = createTextureMemoryRenderer({ contextLost: true });
  attachGaussianSplats(lost.renderer, splats)();
  assert.equal(lost.state.readCalls, 0);
  assert.throws(() => attachGaussianSplats(createTextureMemoryRenderer().renderer, splats), /create them again/);
});
