import test from 'node:test';
import assert from 'node:assert/strict';
import { createPass } from '../src/path-tracer-realtime-gl.js';

const GL = { VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4 };

// A stand-in context that counts the shaders and programs still alive.
function countingGl({ failCompileCall = 0, failLink = false } = {}) {
  let compileCalls = 0;
  const liveShaders = new Set();
  const livePrograms = new Set();
  return {
    ...GL,
    liveShaders,
    livePrograms,
    createShader(type) {
      const shader = { type };
      liveShaders.add(shader);
      return shader;
    },
    shaderSource() {},
    compileShader(shader) {
      compileCalls += 1;
      shader.compiled = compileCalls !== failCompileCall;
    },
    getShaderParameter(shader, pname) {
      assert.equal(pname, GL.COMPILE_STATUS);
      return shader.compiled;
    },
    getShaderInfoLog() {
      return 'compile log';
    },
    deleteShader(shader) {
      liveShaders.delete(shader);
    },
    createProgram() {
      const program = {};
      livePrograms.add(program);
      return program;
    },
    attachShader() {},
    linkProgram(program) {
      program.linked = !failLink;
    },
    getProgramParameter(program, pname) {
      assert.equal(pname, GL.LINK_STATUS);
      return program.linked;
    },
    getProgramInfoLog() {
      return 'link log';
    },
    deleteProgram(program) {
      livePrograms.delete(program);
    },
    getUniformLocation(program, name) {
      return { program, name };
    },
  };
}

test('a linked pass releases its shaders and remembers its uniform locations', () => {
  const gl = countingGl();
  const pass = createPass(gl, 'fragment source');
  assert.equal(gl.liveShaders.size, 0);
  assert.equal(gl.livePrograms.size, 1);
  assert.equal(gl.livePrograms.has(pass.program), true);
  assert.equal(pass.locate('depth'), pass.locate('depth'));
});

test('a shader that fails to compile releases every shader and the program', () => {
  for (const failCompileCall of [1, 2]) {
    const gl = countingGl({ failCompileCall });
    assert.throws(() => createPass(gl, 'fragment source'), /did not compile: compile log/);
    assert.equal(gl.liveShaders.size, 0, `shaders left after compile call ${failCompileCall}`);
    assert.equal(gl.livePrograms.size, 0, `program left after compile call ${failCompileCall}`);
  }
});

test('a program that fails to link releases its shaders and the program', () => {
  const gl = countingGl({ failLink: true });
  assert.throws(() => createPass(gl, 'fragment source'), /did not link: link log/);
  assert.equal(gl.liveShaders.size, 0);
  assert.equal(gl.livePrograms.size, 0);
});
