// A renderer disposed while its programs are still linking leaves no GPU objects behind, and resize on a lost context stays quiet (#1266).
// It runs in headless Chrome from the Vite dev server; it skips locally when Chrome cannot start and fails on CI.
import test from 'node:test';
import assert from 'node:assert/strict';
import { withDevServerPage } from './helpers/dev-server-browser.js';

// Runs the scenario on a fresh deferred renderer whose context counts live objects per kind.
async function liveObjectsAfter(page, scenarioSource, { withEnvironment = false, rendererOptions = {} } = {}) {
  return page.evaluate(async ({ source, withEnvironment, rendererOptions }) => {
    const { box } = await import('/src/geometry.js');
    const { CrucibleRenderer } = await import('/src/renderer.js');
    const { createEnvironmentMap } = await import('/src/environment.js');
    const identity = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    const material = { tag: 'surface', color: [0.5, 0.5, 0.5], metallic: 0, roughness: 0.5, emission: 0 };
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    document.body.append(canvas);
    const context = canvas.getContext('webgl2');
    const live = new Map();
    for (const kind of ['Program', 'Shader', 'Texture', 'Framebuffer', 'Renderbuffer']) {
      const create = context[`create${kind}`].bind(context);
      const remove = context[`delete${kind}`].bind(context);
      context[`create${kind}`] = (...args) => {
        const object = create(...args);
        live.set(object, kind);
        return object;
      };
      context[`delete${kind}`] = (object) => {
        live.delete(object);
        return remove(object);
      };
    }
    const renderer = new CrucibleRenderer(canvas, [{ name: 'box', geometry: box(0, 1), matrix: identity, material }], { samples: 1, pixelRatio: 1, deferProgramLink: true, ...rendererOptions, ...(withEnvironment ? { environment: { map: createEnvironmentMap({ width: 8, height: 4, data: new Float32Array(8 * 4 * 3).fill(0.5) }) } } : {}) });
    const scenario = new Function('renderer', 'context', `return (async () => { ${source} })();`);
    let error = null;
    try {
      await scenario(renderer, context);
    } catch (thrown) {
      error = thrown.message;
    }
    const counts = {};
    for (const kind of live.values()) counts[kind] = (counts[kind] ?? 0) + 1;
    return { counts, error };
  }, { source: scenarioSource, withEnvironment, rendererOptions });
}

// SwiftShader has no KHR_parallel_shader_compile, so programsReady would finish at once. This stub makes the extension exist and every link report
// "still compiling", which is what a real GPU driver does for a while, so the wait loop actually runs.
const SIMULATE_SLOW_DRIVER = `
  const realGetExtension = context.getExtension.bind(context);
  context.getExtension = (name) => (name === 'KHR_parallel_shader_compile' ? { COMPLETION_STATUS_KHR: 0x91B1 } : realGetExtension(name));
  const realGetProgramParameter = context.getProgramParameter.bind(context);
  context.getProgramParameter = (program, parameter) => (parameter === 0x91B1 ? false : realGetProgramParameter(program, parameter));
`;
// The links finish at once until the scenario sets context.linksAreSlow = true, which lets a program the first draw starts report "still compiling".
const SIMULATE_SLOW_LINKS_ON_DEMAND = `
  context.linksAreSlow = false;
  const realGetExtension = context.getExtension.bind(context);
  context.getExtension = (name) => (name === 'KHR_parallel_shader_compile' ? { COMPLETION_STATUS_KHR: 0x91B1 } : realGetExtension(name));
  const realGetProgramParameter = context.getProgramParameter.bind(context);
  context.getProgramParameter = (program, parameter) => (parameter === 0x91B1 ? !context.linksAreSlow : realGetProgramParameter(program, parameter));
`;
// Counts every read of the completion status, which is how both waits in the renderer poll a link. The renderer polls on its own 8 ms timer, so the
// tests wait on these reads (an event of the renderer) and never on a wall clock, which a loaded machine stretches without bound.
const COUNT_COMPLETION_POLLS = `
  context.completionPolls = 0;
  const pollWaiters = [];
  const parameterBeforeCounting = context.getProgramParameter.bind(context);
  context.getProgramParameter = (program, parameter) => {
    if (parameter === 0x91B1) {
      context.completionPolls += 1;
      for (const waiter of pollWaiters.filter(entry => entry.count <= context.completionPolls)) waiter.resolve();
    }
    return parameterBeforeCounting(program, parameter);
  };
  context.untilCompletionPolls = (count) => (context.completionPolls >= count ? Promise.resolve() : new Promise(resolve => pollWaiters.push({ count, resolve })));
`;
// Resolves 'settled' when the promise finishes, or 'hung' when the renderer has polled this many more times without finishing. A renderer that ignores dispose
// keeps polling, so the poll count catches it the same way on a fast and on a loaded machine.
const SETTLES_OR_HANGS = `
  const settlement = (promise) => Promise.race([promise.then(() => 'settled'), context.untilCompletionPolls(context.completionPolls + 20).then(() => 'hung')]);
`;

test('dispose before programsReady deletes the pending programs and shaders', async (testContext) => {
  await withDevServerPage(testContext, async (page) => {
    const result = await liveObjectsAfter(page, 'renderer.dispose();');
    assert.equal(result.error, null);
    assert.deepEqual(result.counts, {});
  });
});

test('programsReady after dispose builds nothing on the disposed renderer', async (testContext) => {
  await withDevServerPage(testContext, async (page) => {
    const result = await liveObjectsAfter(page, 'renderer.dispose(); await renderer.programsReady(); await renderer.prepareFrame({});');
    assert.equal(result.error, null);
    assert.deepEqual(result.counts, {});
  });
});

test('dispose while programsReady is waiting settles it without building', async (testContext) => {
  await withDevServerPage(testContext, async (page) => {
    const result = await liveObjectsAfter(page, `${SIMULATE_SLOW_DRIVER}${COUNT_COMPLETION_POLLS}${SETTLES_OR_HANGS}
      const ready = renderer.programsReady();
      await Promise.race([context.untilCompletionPolls(context.completionPolls + 2), ready]);
      renderer.dispose();
      if (await settlement(ready) !== 'settled') throw new Error('programsReady kept waiting after dispose');
    `);
    assert.equal(result.error, null);
    assert.deepEqual(result.counts, {});
  });
});

test('dispose while prepareFrame is waiting resolves false without building', async (testContext) => {
  await withDevServerPage(testContext, async (page) => {
    const result = await liveObjectsAfter(page, `${SIMULATE_SLOW_DRIVER}${COUNT_COMPLETION_POLLS}${SETTLES_OR_HANGS}
      const prepared = renderer.prepareFrame({});
      await Promise.race([context.untilCompletionPolls(context.completionPolls + 2), prepared]);
      renderer.dispose();
      if (await settlement(prepared) !== 'settled') throw new Error('prepareFrame kept waiting after dispose');
      if (await prepared !== false) throw new Error('prepareFrame must resolve false on a disposed renderer');
    `);
    assert.equal(result.error, null);
    assert.deepEqual(result.counts, {});
  });
});

// A frame with ambient occlusion compiles its program inside the first draw, so prepareFrame waits a second time after programsReady (#1266).
const AMBIENT_OCCLUSION_FRAME = '{ eye: [3, 2, 3], effects: { ambientOcclusion: 0.5 } }';

test('dispose while prepareFrame waits for a program started by its own draw resolves false without drawing', async (testContext) => {
  await withDevServerPage(testContext, async (page) => {
    const result = await liveObjectsAfter(page, `${SIMULATE_SLOW_LINKS_ON_DEMAND}${COUNT_COMPLETION_POLLS}${SETTLES_OR_HANGS}
      await renderer.programsReady();
      context.linksAreSlow = true;
      const linkStatusReads = new Set();
      const programsStartedByTheDraw = new Set();
      const parameterBeforeSpy = context.getProgramParameter.bind(context);
      context.getProgramParameter = (program, parameter) => {
        if (parameter === context.LINK_STATUS) linkStatusReads.add(program);
        return parameterBeforeSpy(program, parameter);
      };
      const createBeforeSpy = context.createProgram.bind(context);
      context.createProgram = () => {
        const program = createBeforeSpy();
        programsStartedByTheDraw.add(program);
        return program;
      };
      const deleteBeforeSpy = context.deleteProgram.bind(context);
      context.deleteProgram = (program) => {
        if (programsStartedByTheDraw.has(program) && !linkStatusReads.has(program)) throw new Error('a started program was deleted before its link status was read');
        return deleteBeforeSpy(program);
      };
      const errorsBefore = context.getError();
      const pollsBeforeFrame = context.completionPolls;
      const prepared = renderer.prepareFrame(${AMBIENT_OCCLUSION_FRAME});
      await Promise.race([context.untilCompletionPolls(pollsBeforeFrame + 3), prepared]);
      if (await Promise.race([prepared, 'waiting']) !== 'waiting') throw new Error('the frame never waited for a program, got ' + await prepared);
      // The links stay slow after dispose, so only the disposed guard in the second wait can end it.
      renderer.dispose();
      if (await settlement(prepared) !== 'settled') throw new Error('prepareFrame kept waiting after dispose');
      const outcome = await prepared;
      if (outcome !== false) throw new Error('prepareFrame must resolve false on a disposed renderer, got ' + outcome);
      const glError = context.getError();
      if (glError !== 0) throw new Error('GL error ' + glError + ' after dispose during the second wait');
    `, { rendererOptions: { depth: true } });
    assert.equal(result.error, null);
    assert.deepEqual(result.counts, {});
  });
});

test('dispose right after prepareFrame starts resolves false without drawing', async (testContext) => {
  await withDevServerPage(testContext, async (page) => {
    const result = await liveObjectsAfter(page, `
      const prepared = renderer.prepareFrame({});
      renderer.dispose();
      if (await prepared !== false) throw new Error('prepareFrame must resolve false on a disposed renderer');
    `);
    assert.equal(result.error, null);
    assert.deepEqual(result.counts, {});
  });
});

test('dispose reads the link status of every pending program before deleting it', async (testContext) => {
  await withDevServerPage(testContext, async (page) => {
    const result = await liveObjectsAfter(page, `
      const linkStatusReads = new Set();
      const realGetProgramParameter = context.getProgramParameter.bind(context);
      context.getProgramParameter = (program, parameter) => {
        if (parameter === context.LINK_STATUS) linkStatusReads.add(program);
        return realGetProgramParameter(program, parameter);
      };
      const realDeleteProgram = context.deleteProgram.bind(context);
      context.deleteProgram = (program) => {
        if (program && !linkStatusReads.has(program)) throw new Error('a program was deleted before its link status was read');
        return realDeleteProgram(program);
      };
      renderer.dispose();
      if (linkStatusReads.size === 0) throw new Error('dispose read no link status');
    `);
    assert.equal(result.error, null);
    assert.deepEqual(result.counts, {});
  });
});

test('dispose before programsReady frees the environment map programs too', async (testContext) => {
  await withDevServerPage(testContext, async (page) => {
    const result = await liveObjectsAfter(page, 'renderer.dispose();', { withEnvironment: true });
    assert.equal(result.error, null);
    assert.deepEqual(result.counts, {});
  });
});

test('resize on a lost context returns without the dimensions error', async (testContext) => {
  await withDevServerPage(testContext, async (page) => {
    const result = await liveObjectsAfter(page, `
      await renderer.programsReady();
      const contextLost = new Promise(resolve => context.canvas.addEventListener('webglcontextlost', resolve, { once: true }));
      context.getExtension('WEBGL_lose_context').loseContext();
      await contextLost;
      renderer.resize();
      renderer.render({ eye: [3, 2, 3] });
      renderer.dispose();
    `);
    assert.equal(result.error, null);
    assert.deepEqual(result.counts, {});
  });
});
