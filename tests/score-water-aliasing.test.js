import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve, join } from 'node:path';
import { parseArguments, framePaths } from '../scripts/score-water-aliasing.mjs';

test('without --reference each directory is scored against its own reference stills', () => {
  const parsed = parseArguments(['frames-a', 'frames-b']);
  assert.equal(parsed.referenceDirectory, undefined);
  assert.deepEqual(parsed.frameDirectories, [resolve('frames-a'), resolve('frames-b')]);
  const paths = framePaths(parsed.frameDirectories[0], parsed.referenceDirectory, 'low', 1);
  assert.equal(paths.frame, join(resolve('frames-a'), 'low-1-n.png'));
  assert.equal(paths.reference, join(resolve('frames-a'), 'low-1-ref.png'));
});

test('--reference takes the reference stills from one fixed directory for every frame directory', () => {
  const parsed = parseArguments(['frames-a', '--reference', 'fixed', 'frames-b']);
  assert.equal(parsed.referenceDirectory, resolve('fixed'));
  assert.deepEqual(parsed.frameDirectories, [resolve('frames-a'), resolve('frames-b')]);
  for (const directory of parsed.frameDirectories) {
    const paths = framePaths(directory, parsed.referenceDirectory, 'beauty', 2);
    assert.equal(paths.frame, join(directory, 'beauty-2-n.png'));
    assert.equal(paths.reference, join(resolve('fixed'), 'beauty-2-ref.png'));
  }
});

test('bad arguments throw errors that say what to pass', () => {
  assert.throws(() => parseArguments(['frames', '--reference']), /--reference needs a directory/);
  assert.throws(() => parseArguments(['--reference', '--other', 'frames']), /--reference needs a directory/);
  assert.throws(() => parseArguments(['--refrence', 'fixed', 'frames']), /Unknown option --refrence/);
  assert.throws(() => parseArguments(['--reference', 'fixed']), /at least one directory/);
});
