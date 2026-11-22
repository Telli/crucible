// A WebGL2 context that only counts what the outline mask asks of it: buffers made and deleted, draws, and the program.

export function createFakeWebgl2() {
  const state = {
    buffersCreated: 0,
    buffersDeleted: 0,
    vertexArraysCreated: 0,
    vertexArraysDeleted: 0,
    programsDeleted: 0,
    draws: [],
    matrices: [],
    contextLosses: 0,
  };
  const constants = {
    VERTEX_SHADER: 1,
    FRAGMENT_SHADER: 2,
    COMPILE_STATUS: 3,
    LINK_STATUS: 4,
    ARRAY_BUFFER: 5,
    ELEMENT_ARRAY_BUFFER: 6,
    STATIC_DRAW: 7,
    FLOAT: 8,
    TRIANGLES: 9,
    UNSIGNED_INT: 10,
    DEPTH_TEST: 11,
    CULL_FACE: 12,
    COLOR_BUFFER_BIT: 13,
  };
  const noop = () => {};
  const context = {
    ...constants,
    createShader: () => ({}),
    shaderSource: noop,
    compileShader: noop,
    getShaderParameter: () => true,
    getShaderInfoLog: () => '',
    deleteShader: noop,
    createProgram: () => ({}),
    attachShader: noop,
    linkProgram: noop,
    getProgramParameter: () => true,
    getProgramInfoLog: () => '',
    deleteProgram: () => {
      state.programsDeleted += 1;
    },
    getUniformLocation: () => ({}),
    createVertexArray: () => {
      state.vertexArraysCreated += 1;
      return {};
    },
    deleteVertexArray: () => {
      state.vertexArraysDeleted += 1;
    },
    bindVertexArray: noop,
    createBuffer: () => {
      state.buffersCreated += 1;
      return {};
    },
    deleteBuffer: () => {
      state.buffersDeleted += 1;
    },
    bindBuffer: noop,
    bufferData: noop,
    enableVertexAttribArray: noop,
    vertexAttribPointer: noop,
    viewport: noop,
    disable: noop,
    clearColor: noop,
    clear: noop,
    useProgram: noop,
    uniformMatrix4fv: (location, transpose, matrix) => {
      state.matrices.push([...matrix]);
    },
    drawElements: (mode, count) => {
      state.draws.push(count);
    },
    getExtension: name => (name === 'WEBGL_lose_context' ? { loseContext: () => { state.contextLosses += 1; } } : null),
  };
  return { context, state };
}
