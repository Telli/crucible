import assert from 'node:assert/strict';
import test from 'node:test';

test('render target ledger refuses negative sizes whose product is positive (#1642)', async () => {
  const { RenderTargetLedger } = await import('../src/render-target-ledger.js');
  const ledger = new RenderTargetLedger();
  assert.throws(() => ledger.record('flipped', { width: -4, height: -4, format: 'RGBA8' }), RangeError);
  assert.throws(() => ledger.record('layers', { width: 4, height: 4, layers: -1, format: 'RGBA8' }), RangeError);
  assert.throws(() => ledger.record('nan', { width: NaN, height: 4, format: 'RGBA8' }), RangeError);
  assert.equal(ledger.report().targets.length, 0);
  ledger.record('empty', { width: 0, height: 4, format: 'RGBA8' });
  assert.equal(ledger.report().totalBytes, 0);
});

test('assembly layouts ignore names that match inherited object keys (#1643)', async () => {
  const { addDetailOffsets } = await import('../src/assembly.js');
  const part = (name, section) => ({ name, matrix: new Float32Array(16), assembly: { section } });
  assert.throws(() => addDetailOffsets([part('Screw', 'constructor')]), /No detail layout/);
  const [lane] = addDetailOffsets([part('toString', 'Left track assembly')]);
  assert.ok(lane.assembly.detailOffset.every(Number.isFinite), `offset ${lane.assembly.detailOffset}`);
});

test('a clutter mask that returns NaN places nothing (#1644)', async () => {
  const { createClutter } = await import('../src/clutter.js');
  const area = { minX: 0, maxX: 8, minZ: 0, maxZ: 8 };
  const stats = mask => createClutter({ area, eye: [4, 1, 4], mask }).stats();
  assert.equal(stats(() => NaN).vertices, 0);
  assert.ok(stats(() => 1).vertices > 0);
});
