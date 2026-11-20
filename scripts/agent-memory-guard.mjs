// The memory guard of render and review jobs: a job fails when the Node process or the live browser heap stays above its limit.

// The floors of the two limits: what a job with the smallest --memory gets. A larger --memory raises both (memoryGuardLimits).
export const NODE_RSS_LIMIT_BYTES = 512 * 1024 ** 2;
export const BROWSER_HEAP_LIMIT_BYTES = 256 * 1024 ** 2;
// Node RSS holds the budget plus the process itself (modules, the page-to-Node pipes, encoder buffers). The 384 MiB budget peaked
// under 180 MiB of RSS on a plain 1080p frame (#1696), so 128 MiB on top of the budget leaves the old 512 MiB at --memory 384.
const NODE_RSS_MARGIN_MIB = 128;
// The browser heap is the scene's JavaScript objects, a share of the budget; two thirds of 384 MiB is the old 256 MiB.
const BROWSER_HEAP_SHARE = 2 / 3;

function requireMemoryBudget(memoryMiB) {
  if (!Number.isFinite(memoryMiB) || memoryMiB < 0) {
    throw new RangeError(`The memory guard needs a memory budget of zero or more MiB, got ${memoryMiB}.`);
  }
}

/**
 * The two limits of a job that runs with `--memory memoryMiB`. They follow the budget instead of fixed constants (#1776, #1696),
 * so raising --memory (up to what the machine holds, see maximumMemoryMiB) raises the guard with it, and never below the floors above.
 */
export function memoryGuardLimits(memoryMiB = 0) {
  requireMemoryBudget(memoryMiB);
  return {
    nodeBytes: Math.max(NODE_RSS_LIMIT_BYTES, (memoryMiB + NODE_RSS_MARGIN_MIB) * 1024 ** 2),
    browserHeapBytes: Math.max(BROWSER_HEAP_LIMIT_BYTES, Math.ceil(memoryMiB * BROWSER_HEAP_SHARE) * 1024 ** 2),
  };
}

/**
 * The browser heap in use, counting only memory the page still holds.
 * `Runtime.getHeapUsage` also counts garbage that was not collected yet, and a scene with a physics bake
 * leaves tens of MiB of it behind on its first frame. Above the limit the heap is collected and read again,
 * so only memory that survives a collection (a real leak or a scene that really needs more) trips the guard.
 */
export async function sampleBrowserHeap(session, limitBytes = BROWSER_HEAP_LIMIT_BYTES) {
  let usage = await session.send('Runtime.getHeapUsage');
  if (usage.usedSize > limitBytes) {
    await session.send('HeapProfiler.collectGarbage');
    usage = await session.send('Runtime.getHeapUsage');
  }
  return usage.usedSize;
}

// The native path tracer and the OIDN denoiser run inside the Node process, so a native job holds memory the JS limit never
// meant to cover: the traced scene tables (fixed) and the denoiser's buffers, frame planes and temporal history (per pixel).
// Sized from native + OIDN video jobs of the demo room (#1186, RTX 3060, Windows): peak RSS 1224 MiB at 960 x 540, 1360 MiB at
// 1280 x 720 and 2149 MiB at 1920 x 1080. Taking the 960 x 540 to 1280 x 720 slope back to no pixels leaves a fixed part of
// about 540 MiB above the 512 MiB base; with 25 percent on top the fixed allowance is 640 MiB. A software adapter gets more, below.
export const NATIVE_FIXED_ALLOWANCE_BYTES = 640 * 1024 ** 2;
export const NATIVE_BYTES_PER_PIXEL = 1024;
export const NATIVE_ALLOWANCE_CAP_BYTES = 2048 * 1024 ** 2;

// A software Vulkan adapter (lavapipe on a Linux runner without a GPU) keeps its device buffers and the JIT-compiled kernel
// in the Node process, so RSS holds what a real GPU keeps in its own memory. Measured on GitHub's ubuntu runner (#1186,
// llvmpipe, LLVM 21): one bare trace of Cook's room fixture peaks at 836 MiB with a warm shader cache and 1262 MiB cold at
// 320 x 240, about 430 MiB for the compile at every frame size; the first native + wavelet video job of the demo room at
// 960 x 540 on a fresh runner peaked at 3226 MiB, against a 1705 MiB limit. 2304 MiB on top leaves that job 24 percent to spare.
export const SOFTWARE_ADAPTER_ALLOWANCE_BYTES = 2304 * 1024 ** 2;

/** True for an adapter that renders on the CPU, so its device memory is counted in the process RSS. */
export function isSoftwareAdapter(adapterName) {
  return typeof adapterName === 'string' && /llvmpipe|lavapipe|swiftshader/i.test(adapterName);
}

// The addon holds the scene's triangle, BVH and texture tables in the Node process, and the --memory budget is what bounds the
// scene's geometry and textures. So the allowance grows by this many MiB for each MiB of budget, and so does its cap. Not
// measured: a headroom choice that makes a bigger --memory buy a native job room for a bigger scene (#1776).
const NATIVE_SCENE_MIB_PER_BUDGET_MIB = 2;

/**
 * Extra Node RSS a native tracer job may hold on top of the base limit, from its frame size and its --memory budget,
 * never above the cap. Both parts are bounded: the cap is the fixed cap plus the budget's share, and the budget has a ceiling.
 */
export function nativeNodeAllowanceBytes({ width, height, memoryMiB = 0 }) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error(`nativeNodeAllowanceBytes needs a positive integer width and height, got ${width} x ${height}.`);
  }
  requireMemoryBudget(memoryMiB);
  const sceneBytes = memoryMiB * NATIVE_SCENE_MIB_PER_BUDGET_MIB * 1024 ** 2;
  const allowance = NATIVE_FIXED_ALLOWANCE_BYTES + width * height * NATIVE_BYTES_PER_PIXEL + sceneBytes;
  return Math.min(allowance, NATIVE_ALLOWANCE_CAP_BYTES + sceneBytes);
}

/**
 * The extra Node RSS one runtime grants, shared by every job and review it runs.
 * The in-process OIDN device and the tracer tables live "for the life of the process", so the memory a native job
 * leaves behind is still in RSS when the next raster job or review starts. The allowance therefore only grows: it is
 * raised by each native frame and never dropped, not when a job falls back to another backend and not when it ends.
 * One figure for the whole process: the frame part from the largest native frame, plus the software adapter part once a trace ran on one.
 */
export function createNativeMemoryAllowance() {
  let grantedBytes = 0;
  let adapterBytes = 0;
  return {
    /** Called when a frame really traces natively. */
    grantForFrame({ width, height, memoryMiB = 0 }) {
      grantedBytes = Math.max(grantedBytes, nativeNodeAllowanceBytes({ width, height, memoryMiB }));
    },
    /** Called with the adapter a native trace ran on; a software adapter adds its device memory, a GPU adds nothing. */
    grantForAdapter(adapterName) {
      if (isSoftwareAdapter(adapterName)) adapterBytes = SOFTWARE_ADAPTER_ALLOWANCE_BYTES;
    },
    get bytes() {
      return grantedBytes + adapterBytes;
    },
  };
}

/**
 * A job that never used the native tracer passes no allowance. Without `memoryMiB` the limits are the floors (512 MiB, 256 MiB);
 * the runtime passes its --memory so they follow the budget.
 */
export function exceedsMemoryGuard({ nodeBytes, browserHeapBytes, nativeAllowanceBytes = 0, memoryMiB = 0 }) {
  const limits = memoryGuardLimits(memoryMiB);
  return nodeBytes > limits.nodeBytes + nativeAllowanceBytes || browserHeapBytes > limits.browserHeapBytes;
}

/**
 * The error an agent reads when the guard trips: which limit, what was observed, and what to change.
 * `maximumMemoryMiB` is the largest --memory this machine accepts; the advice to raise --memory appears only while there is room above `memoryMiB`.
 */
export function memoryGuardMessage({ subject, nodeBytes, browserHeapBytes, nativeAllowanceBytes = 0, memoryMiB = 0, maximumMemoryMiB = 0 }) {
  const mebibytes = (bytes) => Math.round(bytes / 1024 ** 2);
  const limits = memoryGuardLimits(memoryMiB);
  const nodeLimitBytes = limits.nodeBytes + nativeAllowanceBytes;
  const raiseAdvice = maximumMemoryMiB > memoryMiB ? `Raise --memory (now ${memoryMiB}, at most ${maximumMemoryMiB} on this machine), or use` : 'Use';
  if (nodeBytes > nodeLimitBytes) {
    const allowanceNote = nativeAllowanceBytes > 0 ? ` (${mebibytes(limits.nodeBytes)} MiB base plus ${mebibytes(nativeAllowanceBytes)} MiB for the native tracer)` : '';
    return `${subject} exceeded its Node RSS guard: ${mebibytes(nodeBytes)} MiB used, ${mebibytes(nodeLimitBytes)} MiB allowed${allowanceNote}. ${raiseAdvice} a smaller frame size or a non-native backend.`;
  }
  return `${subject} exceeded its sampled browser heap guard: ${mebibytes(browserHeapBytes)} MiB used, ${mebibytes(limits.browserHeapBytes)} MiB allowed. ${raiseAdvice} a smaller frame size or fewer objects in the scene.`;
}
