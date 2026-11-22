import assert from 'node:assert/strict';
import test from 'node:test';
import { stripGlslComments } from '../scripts/strip-glsl-comments.mjs';

test('a line comment inside a single-line block comment is kept', () => {
  const source = 'const s = `#version 300 es\nvec3 b = a; /* old // note */\nvec3 c = d;\n`;';
  const stripped = stripGlslComments(source);
  assert.match(stripped, /vec3 b = a; \/\* old \/\/ note \*\//);
  assert.match(stripped, /vec3 c = d;/);
});

test('a block comment spanning lines keeps its closing marker', () => {
  const source = 'const s = `#version 300 es\nvec3 c = d; /* multi // note\n   still here */\nvec4 e = f; // real\n`;';
  const stripped = stripGlslComments(source);
  assert.match(stripped, /\/\* multi \/\/ note\n   still here \*\//);
  assert.doesNotMatch(stripped, /real/);
});

test('a real trailing line comment is still removed', () => {
  const source = 'const s = `#version 300 es\nvec4 e = f; // real comment\nvec4 g = h;\n`;';
  const stripped = stripGlslComments(source);
  assert.match(stripped, /vec4 e = f;\nvec4 g = h;/);
});
