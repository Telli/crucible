// A debug wrapper for a WebGL2 context, for tests and investigations only: it is never imported by src/.
// It calls getError after every method call and records the first call that raised an error, with the arguments and the bound state.
// The function is serialised into a browser page by page.evaluate, so it must not capture anything from this module.
export function installGlErrorTrace(context) {
  const methodNames = [];
  for (let prototype = Object.getPrototypeOf(context); prototype && prototype !== Object.prototype; prototype = Object.getPrototypeOf(prototype)) {
    for (const name of Object.getOwnPropertyNames(prototype)) {
      if (name === 'constructor' || name === 'getError') continue;
      if (typeof context[name] === 'function' && !methodNames.includes(name)) methodNames.push(name);
    }
  }
  const nativeGetError = context.getError.bind(context);
  const nativeGetParameter = context.getParameter.bind(context);
  const trace = { first: null, errors: [], callCount: 0 };
  const describeArgument = (argument) => {
    if (argument === null || argument === undefined || typeof argument !== 'object') return String(argument);
    if (ArrayBuffer.isView(argument)) return `${argument.constructor.name}(${argument.length})`;
    return argument.constructor?.name ?? 'object';
  };
  const boundState = () => {
    const program = nativeGetParameter(context.CURRENT_PROGRAM);
    const state = {
      program: program ? { linked: context.getProgramParameter(program, context.LINK_STATUS), log: context.getProgramInfoLog(program) } : null,
      drawFramebufferComplete: context.checkFramebufferStatus(context.DRAW_FRAMEBUFFER) === context.FRAMEBUFFER_COMPLETE,
      drawFramebufferBound: nativeGetParameter(context.DRAW_FRAMEBUFFER_BINDING) !== null,
      vertexArrayBound: nativeGetParameter(context.VERTEX_ARRAY_BINDING) !== null,
      activeTextureUnit: nativeGetParameter(context.ACTIVE_TEXTURE) - context.TEXTURE0,
      drawBuffer0: nativeGetParameter(context.DRAW_BUFFER0),
    };
    nativeGetError();
    return state;
  };
  for (const name of methodNames) {
    const original = context[name];
    context[name] = function traced(...args) {
      const result = original.apply(context, args);
      trace.callCount++;
      const error = nativeGetError();
      if (error !== 0) {
        const entry = { call: name, arguments: args.map(describeArgument), error, callIndex: trace.callCount, state: boundState() };
        trace.errors.push(entry);
        trace.first ??= entry;
      }
      return result;
    };
  }
  return trace;
}
