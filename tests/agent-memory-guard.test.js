import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BROWSER_HEAP_LIMIT_BYTES, NODE_RSS_LIMIT_BYTES, SOFTWARE_ADAPTER_ALLOWANCE_BYTES, createNativeMemoryAllowance, isSoftwareAdapter, exceedsMemoryGuard, memoryGuardLimits, memoryGuardMessage, nativeNodeAllowanceBytes, sampleBrowserHeap } from '../scripts/agent-memory-guard.mjs';
import { MAXIMUM_MEMORY_MIB, MEMORY_CEILING_MIB, maximumMemoryMiB, memoryRangeError } from '../src/agent-scene-capabilities.js';

const MEBIBYTE = 1024 ** 2;

/** A browser heap whose uncollected garbage disappears on `HeapProfiler.collectGarbage`, as a page after a physics bake does. */
function fakeSession({ garbageBytes, liveBytes }) {
  const calls = [];
  let collected = false;
  return {
    calls,
    async send(method) {
      calls.push(method);
      if (method === 'HeapProfiler.collectGarbage') {
        collected = true;
        return {};
      }
      return { usedSize: collected ? liveBytes : liveBytes + garbageBytes };
    },
  };
}

test('uncollected garbage from the first fractured-wall frame does not trip the heap guard', async () => {
  // Measured on a 28-cell fractured wall render: 311 MiB sampled on frame 0, 11 MiB once collected.
  const session = fakeSession({ garbageBytes: 300 * MEBIBYTE, liveBytes: 11 * MEBIBYTE });
  const heapBytes = await sampleBrowserHeap(session);
  assert.equal(heapBytes, 11 * MEBIBYTE);
  assert.deepEqual(session.calls, ['Runtime.getHeapUsage', 'HeapProfiler.collectGarbage', 'Runtime.getHeapUsage']);
  assert.equal(exceedsMemoryGuard({ nodeBytes: 200 * MEBIBYTE, browserHeapBytes: heapBytes }), false);
});

test('a heap under the limit is read once and never collected', async () => {
  const session = fakeSession({ garbageBytes: 0, liveBytes: 90 * MEBIBYTE });
  assert.equal(await sampleBrowserHeap(session), 90 * MEBIBYTE);
  assert.deepEqual(session.calls, ['Runtime.getHeapUsage']);
});

test('memory that survives a collection still trips the guard', async () => {
  const session = fakeSession({ garbageBytes: 50 * MEBIBYTE, liveBytes: BROWSER_HEAP_LIMIT_BYTES + MEBIBYTE });
  const heapBytes = await sampleBrowserHeap(session);
  assert.equal(heapBytes, BROWSER_HEAP_LIMIT_BYTES + MEBIBYTE);
  assert.equal(exceedsMemoryGuard({ nodeBytes: 0, browserHeapBytes: heapBytes }), true);
});

test('the Node limit is unchanged and still enforced', () => {
  assert.equal(NODE_RSS_LIMIT_BYTES, 512 * MEBIBYTE);
  assert.equal(exceedsMemoryGuard({ nodeBytes: NODE_RSS_LIMIT_BYTES + 1, browserHeapBytes: 0 }), true);
  assert.equal(exceedsMemoryGuard({ nodeBytes: NODE_RSS_LIMIT_BYTES, browserHeapBytes: BROWSER_HEAP_LIMIT_BYTES }), false);
});

test('a native job gets 640 MiB plus 1 KiB a pixel on top of the Node limit, capped at 2 GiB', () => {
  assert.equal(nativeNodeAllowanceBytes({ width: 960, height: 540 }), 640 * MEBIBYTE + 960 * 540 * 1024);
  assert.equal(nativeNodeAllowanceBytes({ width: 1, height: 1 }), 640 * MEBIBYTE + 1024);
  assert.equal(nativeNodeAllowanceBytes({ width: 7680, height: 4320 }), 2048 * MEBIBYTE);
  assert.throws(() => nativeNodeAllowanceBytes({ width: 0, height: 540 }), /positive integer width and height/);
});

// Peak Node RSS of native + OIDN video jobs of the demo room, 24 frames at 16 samples, RTX 3060, Windows (#1186).
const MEASURED_NATIVE_PEAKS = [
  { width: 960, height: 540, peakMebibytes: 1224 },
  { width: 1280, height: 720, peakMebibytes: 1360 },
  { width: 1920, height: 1080, peakMebibytes: 2149 },
];

test('every measured native + OIDN video job fits its limit with at least 15 percent to spare', () => {
  for (const { width, height, peakMebibytes } of MEASURED_NATIVE_PEAKS) {
    const limitMebibytes = (NODE_RSS_LIMIT_BYTES + nativeNodeAllowanceBytes({ width, height })) / MEBIBYTE;
    assert.ok(limitMebibytes >= peakMebibytes * 1.15, `${width} x ${height}: limit ${limitMebibytes} MiB, measured peak ${peakMebibytes} MiB`);
  }
});

test('a native 960 x 540 job at 800 MiB of Node RSS passes while the same RSS stops a non-native job', () => {
  const nativeAllowanceBytes = nativeNodeAllowanceBytes({ width: 960, height: 540 });
  assert.equal(exceedsMemoryGuard({ nodeBytes: 800 * MEBIBYTE, browserHeapBytes: 0, nativeAllowanceBytes }), false);
  assert.equal(exceedsMemoryGuard({ nodeBytes: 800 * MEBIBYTE, browserHeapBytes: 0 }), true);
});

test('a runaway native job still stops, and the allowance does not loosen the browser heap limit', () => {
  const nativeAllowanceBytes = nativeNodeAllowanceBytes({ width: 960, height: 540 });
  const limit = NODE_RSS_LIMIT_BYTES + nativeAllowanceBytes;
  assert.equal(exceedsMemoryGuard({ nodeBytes: limit, browserHeapBytes: 0, nativeAllowanceBytes }), false);
  assert.equal(exceedsMemoryGuard({ nodeBytes: limit + 1, browserHeapBytes: 0, nativeAllowanceBytes }), true);
  assert.equal(exceedsMemoryGuard({ nodeBytes: 0, browserHeapBytes: BROWSER_HEAP_LIMIT_BYTES + 1, nativeAllowanceBytes }), true);
});

test('a runtime that never traced natively grants nothing, and a native frame raises the limit', () => {
  const allowance = createNativeMemoryAllowance();
  assert.equal(allowance.bytes, 0);
  allowance.grantForFrame({ width: 960, height: 540 });
  assert.equal(allowance.bytes, nativeNodeAllowanceBytes({ width: 960, height: 540 }));
});

test('a native failure and fallback keeps the allowance, so the fallback frame is not killed by the peak of the native attempt', () => {
  const allowance = createNativeMemoryAllowance();
  allowance.grantForFrame({ width: 960, height: 540 });
  const peakDuringNativeAttempt = 900 * MEBIBYTE;
  // The job's running peak stays at the native peak after the fallback; there is no reset path that drops the allowance.
  assert.equal(exceedsMemoryGuard({ nodeBytes: peakDuringNativeAttempt, browserHeapBytes: 0, nativeAllowanceBytes: allowance.bytes }), false);
});

test('a raster job and a review after a native job still see the memory the process retains', () => {
  const allowance = createNativeMemoryAllowance();
  allowance.grantForFrame({ width: 960, height: 540 });
  const retainedRss = 700 * MEBIBYTE;
  assert.equal(exceedsMemoryGuard({ nodeBytes: retainedRss, browserHeapBytes: 0, nativeAllowanceBytes: allowance.bytes }), false);
  assert.equal(exceedsMemoryGuard({ nodeBytes: retainedRss, browserHeapBytes: 0, nativeAllowanceBytes: createNativeMemoryAllowance().bytes }), true);
});

test('the allowance only grows: a smaller later frame does not shrink what the process may retain', () => {
  const allowance = createNativeMemoryAllowance();
  allowance.grantForFrame({ width: 1920, height: 1080 });
  const grantedBytes = allowance.bytes;
  allowance.grantForFrame({ width: 64, height: 64 });
  assert.equal(allowance.bytes, grantedBytes);
});

test('the guard error names the limit that tripped, the observed and allowed MiB and what to change', () => {
  const nodeMessage = memoryGuardMessage({ subject: 'Render job', nodeBytes: 900 * MEBIBYTE, browserHeapBytes: 0, nativeAllowanceBytes: 256 * MEBIBYTE });
  assert.match(nodeMessage, /Node RSS guard: 900 MiB used, 768 MiB allowed \(512 MiB base plus 256 MiB for the native tracer\)/);
  assert.match(nodeMessage, /smaller frame size or a non-native backend/);
  const heapMessage = memoryGuardMessage({ subject: 'Review', nodeBytes: 0, browserHeapBytes: 300 * MEBIBYTE });
  assert.match(heapMessage, /browser heap guard: 300 MiB used, 256 MiB allowed/);
});

test('the runtime wires one shared allowance into both guards and has no per-job reset', () => {
  const source = readFileSync(new URL('../scripts/agent-runtime.mjs', import.meta.url), 'utf8');
  assert.equal((source.match(/createNativeMemoryAllowance\(\)/g) || []).length, 1);
  assert.equal((source.match(/nativeMemoryAllowance\.grantForFrame\(/g) || []).length, 1);
  assert.equal((source.match(/nativeAllowanceBytes: nativeMemoryAllowance\.bytes/g) || []).length, 2);
});

test('a trace on a software adapter adds its device memory to the allowance, a GPU adds nothing', () => {
  const onGpu = createNativeMemoryAllowance();
  onGpu.grantForFrame({ width: 960, height: 540 });
  onGpu.grantForAdapter('NVIDIA GeForce RTX 3060');
  assert.equal(onGpu.bytes, nativeNodeAllowanceBytes({ width: 960, height: 540 }));
  const onLavapipe = createNativeMemoryAllowance();
  onLavapipe.grantForFrame({ width: 960, height: 540 });
  onLavapipe.grantForAdapter('llvmpipe (LLVM 21.1.8, 256 bits)');
  assert.equal(onLavapipe.bytes, nativeNodeAllowanceBytes({ width: 960, height: 540 }) + SOFTWARE_ADAPTER_ALLOWANCE_BYTES);
  onLavapipe.grantForAdapter(undefined);
  assert.equal(onLavapipe.bytes, nativeNodeAllowanceBytes({ width: 960, height: 540 }) + SOFTWARE_ADAPTER_ALLOWANCE_BYTES, 'the allowance never shrinks');
  assert.equal(isSoftwareAdapter('SwiftShader Device (Subzero)'), true);
  assert.equal(isSoftwareAdapter('AMD Radeon RX 7800 XT'), false);
});

test('the first 960 x 540 job on a fresh lavapipe runner (3226 MiB, #1186) passes with 15 percent to spare', () => {
  const allowance = createNativeMemoryAllowance();
  allowance.grantForFrame({ width: 960, height: 540 });
  allowance.grantForAdapter('llvmpipe (LLVM 21.1.8, 256 bits)');
  const limitMebibytes = (NODE_RSS_LIMIT_BYTES + allowance.bytes) / MEBIBYTE;
  assert.ok(limitMebibytes >= 3226 * 1.15, `limit ${limitMebibytes} MiB`);
  assert.equal(exceedsMemoryGuard({ nodeBytes: 3226 * MEBIBYTE, browserHeapBytes: 0, nativeAllowanceBytes: allowance.bytes }), false);
});

test('a real leak on a software adapter still trips the guard', () => {
  const allowance = createNativeMemoryAllowance();
  allowance.grantForFrame({ width: 960, height: 540 });
  allowance.grantForAdapter('llvmpipe (LLVM 21.1.8, 256 bits)');
  const leakedBytes = NODE_RSS_LIMIT_BYTES + allowance.bytes + MEBIBYTE;
  assert.equal(exceedsMemoryGuard({ nodeBytes: leakedBytes, browserHeapBytes: 0, nativeAllowanceBytes: allowance.bytes }), true);
  assert.match(memoryGuardMessage({ subject: 'Render job', nodeBytes: leakedBytes, browserHeapBytes: 0, nativeAllowanceBytes: allowance.bytes }), /exceeded its Node RSS guard/);
  // Even at the largest frame the whole limit stays bounded, so a runaway job cannot grow without end.
  allowance.grantForFrame({ width: 4096, height: 4096 });
  assert.ok(NODE_RSS_LIMIT_BYTES + allowance.bytes <= (512 + 2048 + 2304) * MEBIBYTE);
});

test('the runtime grants the adapter allowance from the native trace report before it samples memory', () => {
  const source = readFileSync(new URL('../scripts/agent-runtime.mjs', import.meta.url), 'utf8');
  assert.equal((source.match(/nativeMemoryAllowance\.grantForAdapter\(traced\.report\.gpu\)/g) || []).length, 1);
});

const GIBIBYTE = 1024 ** 3;

test('the guard follows --memory: the floors at 384 MiB and below, larger limits above (#1776, #1696)', () => {
  for (const memoryMiB of [32, 192, 384]) {
    assert.deepEqual(memoryGuardLimits(memoryMiB), { nodeBytes: NODE_RSS_LIMIT_BYTES, browserHeapBytes: BROWSER_HEAP_LIMIT_BYTES });
  }
  const raised = memoryGuardLimits(1024);
  assert.equal(raised.nodeBytes, (1024 + 128) * MEBIBYTE);
  assert.equal(raised.browserHeapBytes, Math.ceil(1024 * 2 / 3) * MEBIBYTE);
  const nodeBytes = 700 * MEBIBYTE;
  assert.equal(exceedsMemoryGuard({ nodeBytes, browserHeapBytes: 0, memoryMiB: 384 }), true);
  assert.equal(exceedsMemoryGuard({ nodeBytes, browserHeapBytes: 0, memoryMiB: 1024 }), false);
  assert.equal(exceedsMemoryGuard({ nodeBytes: 0, browserHeapBytes: 300 * MEBIBYTE, memoryMiB: 384 }), true);
  assert.equal(exceedsMemoryGuard({ nodeBytes: 0, browserHeapBytes: 300 * MEBIBYTE, memoryMiB: 1024 }), false);
  assert.throws(() => memoryGuardLimits(-1), /zero or more MiB/);
});

test('the largest --memory is half of the RAM, between 384 and 4096 MiB', () => {
  assert.equal(maximumMemoryMiB(512 * MEBIBYTE), MAXIMUM_MEMORY_MIB);
  assert.equal(maximumMemoryMiB(2 * GIBIBYTE), 1024);
  assert.equal(maximumMemoryMiB(8 * GIBIBYTE), 4096);
  assert.equal(maximumMemoryMiB(64 * GIBIBYTE), MEMORY_CEILING_MIB);
  assert.throws(() => maximumMemoryMiB(0), /total memory in bytes/);
  assert.throws(() => maximumMemoryMiB(NaN), /total memory in bytes/);
});

test('a --memory above the machine maximum is refused with the maximum named', () => {
  const error = memoryRangeError(8192, maximumMemoryMiB(4 * GIBIBYTE));
  assert.match(error.message, /from 32 to 2048 MiB on this machine/);
  assert.match(error.message, /got 8192/);
});

test('a native job gets a scene allowance that follows --memory and stays bounded', () => {
  const frame = { width: 640, height: 360 };
  const atDefault = nativeNodeAllowanceBytes({ ...frame, memoryMiB: 192 });
  const raised = nativeNodeAllowanceBytes({ ...frame, memoryMiB: 1024 });
  assert.equal(raised - atDefault, (1024 - 192) * 2 * MEBIBYTE);
  assert.equal(nativeNodeAllowanceBytes(frame) < atDefault, true);
  const largest = nativeNodeAllowanceBytes({ width: 7680, height: 4320, memoryMiB: MEMORY_CEILING_MIB });
  assert.equal(largest, (2048 + MEMORY_CEILING_MIB * 2) * MEBIBYTE);
  const allowance = createNativeMemoryAllowance();
  allowance.grantForFrame({ ...frame, memoryMiB: 1024 });
  assert.equal(allowance.bytes, raised);
  const nativeScene = { nodeBytes: 2200 * MEBIBYTE, browserHeapBytes: 0 };
  assert.equal(exceedsMemoryGuard({ ...nativeScene, memoryMiB: 384, nativeAllowanceBytes: nativeNodeAllowanceBytes({ ...frame, memoryMiB: 384 }) }), true);
  assert.equal(exceedsMemoryGuard({ ...nativeScene, memoryMiB: 1024, nativeAllowanceBytes: raised }), false);
});

test('the guard error names the limit and says how far --memory can be raised on this machine', () => {
  const raisable = memoryGuardMessage({ subject: 'Render job', nodeBytes: 900 * MEBIBYTE, browserHeapBytes: 0, memoryMiB: 384, maximumMemoryMiB: 2048 });
  assert.match(raisable, /Raise --memory \(now 384, at most 2048 on this machine\)/);
  const atMaximum = memoryGuardMessage({ subject: 'Render job', nodeBytes: 900 * MEBIBYTE, browserHeapBytes: 0, memoryMiB: 384, maximumMemoryMiB: 384 });
  assert.doesNotMatch(atMaximum, /Raise --memory/);
  const heap = memoryGuardMessage({ subject: 'Review', nodeBytes: 0, browserHeapBytes: 700 * MEBIBYTE, memoryMiB: 1024, maximumMemoryMiB: 4096 });
  assert.match(heap, /700 MiB used, 683 MiB allowed\. Raise --memory \(now 1024, at most 4096/);
});

test('the runtime hands its --memory to the sampler, the guard and the native allowance', () => {
  const source = readFileSync(new URL('../scripts/agent-runtime.mjs', import.meta.url), 'utf8');
  assert.equal((source.match(/memoryMiB: memory \}/g) || []).length >= 3, true);
  assert.equal((source.match(/memoryGuardLimits\(memory\)\.browserHeapBytes/g) || []).length, 2);
  assert.match(source, /memory > maximumMemory/);
});

test('a native allowance refuses a memory budget that is not a finite number of zero or more MiB', () => {
  for (const memoryMiB of [Number.NaN, Number.POSITIVE_INFINITY, -1, -9999]) {
    assert.throws(() => nativeNodeAllowanceBytes({ width: 64, height: 64, memoryMiB }), /zero or more MiB/, `memoryMiB ${memoryMiB}`);
  }
  assert.equal(nativeNodeAllowanceBytes({ width: 64, height: 64, memoryMiB: 0 }), 640 * MEBIBYTE + 64 * 64 * 1024);
});
