// The silhouette mask of a selected mesh that is too dense to outline as an SVG path: its triangles are drawn flat white
// on a small WebGL2 canvas that lies under the gizmo, and a CSS filter keeps only the ring around that shape. The graphics
// card draws the triangles, so a camera move costs one draw call a part instead of a string of numbers a triangle.
// The canvas and its context exist only after the first dense selection, and the buffers live only while it is selected.
// Nothing here schedules a frame: the viewport asks for a draw when it redraws on its own.

const VERTEX_SHADER = `#version 300 es
in vec3 position;
uniform mat4 modelViewProjection;
void main() {
  gl_Position = modelViewProjection * vec4(position, 1.0);
}`;

const FRAGMENT_SHADER = `#version 300 es
precision lowp float;
out vec4 fragmentColor;
void main() {
  fragmentColor = vec4(1.0);
}`;

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`The outline mask shader did not compile: ${log}`);
  }
  return shader;
}

function createProgram(gl) {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  const program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`The outline mask program did not link: ${log}`);
  }
  return program;
}

function uploadGeometry(gl, geometry) {
  const vertexArray = gl.createVertexArray();
  gl.bindVertexArray(vertexArray);
  const positionBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, Float32Array.from(geometry.positions), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  const indexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, Uint32Array.from(geometry.indices), gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  return { vertexArray, positionBuffer, indexBuffer, indexCount: geometry.indices.length };
}

function deleteUpload(gl, upload) {
  gl.deleteVertexArray(upload.vertexArray);
  gl.deleteBuffer(upload.positionBuffer);
  gl.deleteBuffer(upload.indexBuffer);
}

/**
 * @param {{ documentReference: Document, className: string, mount: (canvas: HTMLCanvasElement) => void, onRestored?: () => void }} options
 * @returns {{ element: HTMLCanvasElement | null, draw(source: object | null, width: number, height: number): boolean, uploadCount: number, dispose(): void }}
 */
export function createOutlineMask({ documentReference, className, mount, onRestored = () => {} }) {
  let canvas = null;
  let gl = null;
  let program = null;
  let matrixLocation = null;
  let unavailable = false;
  let lost = false;
  let disposed = false;
  // Geometry object -> its buffers, for the parts of the current selection only.
  let uploads = new Map();

  function freeUploads() {
    if (gl && !lost) {
      for (const upload of uploads.values()) {
        deleteUpload(gl, upload);
      }
    }
    uploads = new Map();
  }

  function onContextLost(event) {
    event.preventDefault();
    lost = true;
    uploads = new Map();
    program = null;
  }

  function onContextRestored() {
    lost = false;
    onRestored();
  }

  function ensureContext() {
    if (disposed || unavailable) {
      return false;
    }
    if (!canvas) {
      canvas = documentReference.createElement('canvas');
      canvas.className = className;
      canvas.setAttribute('aria-hidden', 'true');
      mount(canvas);
      if (typeof canvas.getContext !== 'function') {
        unavailable = true;
        return false;
      }
      gl = canvas.getContext('webgl2', { alpha: true, antialias: false, depth: false, stencil: false, premultipliedAlpha: true });
      if (!gl) {
        unavailable = true;
        return false;
      }
      canvas.addEventListener('webglcontextlost', onContextLost);
      canvas.addEventListener('webglcontextrestored', onContextRestored);
    }
    if (lost) {
      return false;
    }
    if (!program) {
      try {
        program = createProgram(gl);
      } catch {
        unavailable = true;
        return false;
      }
      matrixLocation = gl.getUniformLocation(program, 'modelViewProjection');
    }
    return true;
  }

  function syncUploads(parts) {
    const next = new Map();
    for (const part of parts) {
      next.set(part.geometry, uploads.get(part.geometry) ?? uploadGeometry(gl, part.geometry));
    }
    for (const [geometry, upload] of uploads) {
      if (!next.has(geometry)) {
        deleteUpload(gl, upload);
      }
    }
    uploads = next;
  }

  function hide() {
    if (canvas) {
      canvas.hidden = true;
    }
  }

  return {
    get element() {
      return canvas;
    },
    get uploadCount() {
      return uploads.size;
    },
    // Draws the parts, each a { geometry, modelViewProjection }, and returns true. Null frees the buffers and hides the
    // mask. False means the mask cannot draw (no WebGL2, or the context is gone), so the caller outlines another way.
    draw(source, width, height) {
      if (!source) {
        freeUploads();
        hide();
        return false;
      }
      if (!ensureContext()) {
        return false;
      }
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      canvas.hidden = false;
      syncUploads(source.parts);
      gl.viewport(0, 0, width, height);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program);
      for (const part of source.parts) {
        const upload = uploads.get(part.geometry);
        gl.uniformMatrix4fv(matrixLocation, false, part.modelViewProjection);
        gl.bindVertexArray(upload.vertexArray);
        gl.drawElements(gl.TRIANGLES, upload.indexCount, gl.UNSIGNED_INT, 0);
      }
      gl.bindVertexArray(null);
      return true;
    },
    dispose() {
      if (disposed) {
        return;
      }
      freeUploads();
      if (gl && !lost) {
        if (program) {
          gl.deleteProgram(program);
        }
        gl.getExtension('WEBGL_lose_context')?.loseContext();
      }
      canvas?.removeEventListener('webglcontextlost', onContextLost);
      canvas?.removeEventListener('webglcontextrestored', onContextRestored);
      canvas?.remove();
      disposed = true;
      program = null;
      gl = null;
    },
  };
}
