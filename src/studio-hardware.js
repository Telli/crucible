// What this computer can draw comfortably, and how sharp Studio's viewport should be on it. The tier only changes the
// viewport's pixel ratio. It is never written to the scene recipe, so a scene renders the same everywhere.

export const STUDIO_PERFORMANCE_TIERS = Object.freeze(['light', 'balanced', 'sharp']);

// What each tier asks of the viewport's renderer. The pixel ratio is a share of the screen's own ratio held under a cap,
// and `samples` is the multisample anti-aliasing count. Sharp is what Studio always drew.
export const STUDIO_TIER_SETTINGS = Object.freeze({
  light: Object.freeze({ ratioShare: 0.75, ratioCap: 1, samples: 2 }),
  balanced: Object.freeze({ ratioShare: 1, ratioCap: 1.5, samples: 4 }),
  sharp: Object.freeze({ ratioShare: 1, ratioCap: 2, samples: 4 }),
});

// Software rasterisers draw on the processor: every pixel is expensive.
const SOFTWARE_RENDERER = /swiftshader|llvmpipe|softpipe|basic render|software/i;
// Dedicated graphics cards and Apple's M-series chips, which have a card's worth of memory bandwidth.
const DISCRETE_RENDERER = /nvidia|geforce|\brtx\b|\bgtx\b|quadro|radeon rx|radeon pro|\bapple m\d|\barc\b/i;
// Graphics that share the processor's memory, and phone chips.
const INTEGRATED_RENDERER = /intel|\buhd\b|\biris\b|hd graphics|radeon\(tm\) graphics|radeon graphics|vega|mali|adreno|powervr/i;

// An integrated chip on this many device pixels or more (a 1440p screen and up) has too many to fill.
const INTEGRATED_PIXEL_LIMIT = 3_600_000;
const FEW_CORES = 4;
const LITTLE_MEMORY_GIGABYTES = 4;

/** The graphics card's name without the browser's wrapping: `ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 ...)` becomes `NVIDIA GeForce RTX 3060`. */
export function readableRendererName(rendererName) {
  if (typeof rendererName !== 'string') {
    return '';
  }
  let name = rendererName.trim();
  const wrapped = /^ANGLE \((.*)\)$/.exec(name);
  if (wrapped) {
    const parts = wrapped[1].split(', ');
    name = parts.length > 1 ? parts[1] : parts[0];
  }
  return name
    .replace(/^ANGLE Metal Renderer: /, '')
    .replace(/\s+Direct3D\d+.*$/, '')
    .replace(/\s+\(0x[0-9a-f]+\).*$/i, '')
    .replace(/\((?:R|TM)\)/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// The graphics card and the cores. Memory is left out: the browser caps what it reports, so it would understate a big machine.
function summaryOf({ gpuName, cores }) {
  const found = [];
  if (gpuName) found.push(gpuName);
  if (Number.isFinite(cores) && cores > 0) found.push(`${cores} cores`);
  return found.length > 0 ? found.join(', ') : 'Hardware not reported';
}

// Few cores or little memory mean the processor also has the scene's other work to do. A browser reports memory in
// steps and never above 8, so a small value is real and 8 only means "at least 8": the rule reads small values only.
function isModest({ cores, memoryGigabytes }) {
  return (Number.isFinite(cores) && cores <= FEW_CORES) || (Number.isFinite(memoryGigabytes) && memoryGigabytes <= LITTLE_MEMORY_GIGABYTES);
}

function tierOf({ rendererName, cores, memoryGigabytes, screenPixels }) {
  if (SOFTWARE_RENDERER.test(rendererName)) {
    return 'light';
  }
  if (DISCRETE_RENDERER.test(rendererName)) {
    return 'sharp';
  }
  if (INTEGRATED_RENDERER.test(rendererName)) {
    const crowded = Number.isFinite(screenPixels) && screenPixels >= INTEGRATED_PIXEL_LIMIT;
    return isModest({ cores, memoryGigabytes }) || crowded ? 'light' : 'balanced';
  }
  // A card nobody recognises, or one the browser hides: the middle tier is the safe guess.
  return 'balanced';
}

/**
 * Picks a performance tier from what the browser reports. Pure: the inputs are numbers and a string, so a table of
 * real renderer strings tests every rule. `summary` says what was found, for the setup screen.
 */
export function detectStudioHardware({ rendererName = '', cores, memoryGigabytes, screenPixels } = {}) {
  const name = typeof rendererName === 'string' ? rendererName : '';
  const gpuName = readableRendererName(name);
  return {
    tier: tierOf({ rendererName: name, cores, memoryGigabytes, screenPixels }),
    summary: summaryOf({ gpuName, cores }),
  };
}

function unmaskedRendererOf(glContext) {
  try {
    const extension = glContext?.getExtension?.('WEBGL_debug_renderer_info');
    return extension ? String(glContext.getParameter(extension.UNMASKED_RENDERER_WEBGL) ?? '') : '';
  } catch {
    return '';
  }
}

/** Reads the inputs of `detectStudioHardware` from a WebGL context (may be null) and the browser. Anything not reported stays undefined. */
export function gatherStudioHardwareInputs({ glContext = null, navigatorReference = globalThis.navigator, windowReference = globalThis.window } = {}) {
  const devicePixelRatio = windowReference?.devicePixelRatio || 1;
  const screenReference = windowReference?.screen;
  const screenPixels = screenReference?.width && screenReference?.height
    ? Math.round(screenReference.width * screenReference.height * devicePixelRatio * devicePixelRatio)
    : undefined;
  return {
    rendererName: unmaskedRendererOf(glContext),
    cores: navigatorReference?.hardwareConcurrency,
    memoryGigabytes: navigatorReference?.deviceMemory,
    devicePixelRatio,
    screenPixels,
  };
}

/** The tier a performance preference stands for: the three named tiers are themselves, and `automatic` is the detected one. */
export function resolveStudioPerformanceTier(performancePreference, detectedTier) {
  return performancePreference === 'automatic' ? detectedTier : performancePreference;
}

/** The pixel ratio and the anti-aliasing samples the viewport draws with on a screen of this ratio. */
export function studioViewportSettingsFor(tier, devicePixelRatio) {
  const { ratioShare, ratioCap, samples } = STUDIO_TIER_SETTINGS[tier];
  const screenRatio = devicePixelRatio || 1;
  return { pixelRatio: Math.min(screenRatio * ratioShare, ratioCap), samples };
}

/**
 * What a live renderer needs to go from its settings to the wanted ones: nothing, a new pixel ratio (its `pixelRatio` is
 * set and it resizes) or a new renderer, because the sample count is fixed when it is built.
 */
export function rendererChangeFor(current, wanted) {
  if (current.samples !== wanted.samples) {
    return 'recreate';
  }
  return current.pixelRatio === wanted.pixelRatio ? 'none' : 'resize';
}
