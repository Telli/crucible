import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const repository = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const tablePaths = [
  join(repository, 'skills', 'build-crucible-scene', 'references', 'errors-and-recovery.md'),
  join(repository, 'skills', 'render-crucible-media', 'references', 'errors-and-recovery.md'),
];
const SOURCE_FOLDERS = ['src', 'scripts'];
const MINIMUM_WORDS_IN_A_MESSAGE = 3;

async function readSourceText() {
  const pieces = [];
  for (const folder of SOURCE_FOLDERS) {
    const names = await readdir(join(repository, folder));
    for (const name of names.filter(candidate => /\.(js|mjs)$/.test(candidate))) {
      pieces.push(await readFile(join(repository, folder, name), 'utf8'));
    }
  }
  return pieces.join('\n');
}

// The first column of every table row; the header is the line above the `|---|` separator.
function firstColumnCells(markdown) {
  const separator = /^\|[-| ]+\|$/;
  const lines = markdown.split('\n');
  const cells = [];
  lines.forEach((line, index) => {
    const isRow = line.startsWith('|') && !separator.test(line);
    const isHeader = separator.test(lines[index + 1] ?? '');
    if (isRow && !isHeader) cells.push(line.split('|')[1].trim());
  });
  assert.ok(cells.length > 0, 'errors-and-recovery.md needs a table of messages');
  return cells;
}

// Backticked spans of three or more words are quoted messages; `...` inside one stands for text the tool fills in.
export function quotedMessageFragments(cell) {
  const spans = [...cell.matchAll(/`([^`]+)`/g)].map(match => match[1]);
  return spans
    .filter(span => span.trim().split(/\s+/).length >= MINIMUM_WORDS_IN_A_MESSAGE)
    .flatMap(span => span.split('...').map(fragment => fragment.trim()).filter(Boolean));
}

test('every quoted message in the errors-and-recovery tables occurs in src/ or scripts/', async () => {
  const sourceText = await readSourceText();
  let checked = 0;
  for (const tablePath of tablePaths) {
    const cells = firstColumnCells(await readFile(tablePath, 'utf8'));
    for (const cell of cells) {
      for (const fragment of quotedMessageFragments(cell)) {
        checked += 1;
        assert.ok(
          sourceText.includes(fragment),
          `${tablePath.slice(repository.length)} quotes "${fragment}" but no file in src/ or scripts/ contains it. Quote text the tool really returns, or describe the cause without backticks.`,
        );
      }
    }
  }
  assert.ok(checked >= 8, `expected to check at least 8 quoted messages, found ${checked}`);
});

test('quotedMessageFragments skips short code names and splits on ellipses', () => {
  assert.deepEqual(quotedMessageFragments('`nvenc` fails'), []);
  assert.deepEqual(quotedMessageFragments('`alpha beta gamma ... delta epsilon zeta`'), ['alpha beta gamma', 'delta epsilon zeta']);
});
