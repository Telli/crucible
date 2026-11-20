// Removes the line comments inside GLSL template literals, so the published bundles do not carry explanations
// that only a person reading src/ needs. JavaScript comments are left to the minifier.
// Used as a plugin by config/vite.lib.config.js and scripts/measure-size.mjs, so the size budgets measure the same text.
import { readFile } from 'node:fs/promises';

const GLSL_MARKER = /#version 300 es|^uniform /m;
const SOURCE_FILE = /[\\/]src[\\/][^\\/]+\.js$/;

function countBackticks(line) {
  return (line.match(/(?<!\\)`/g) ?? []).length;
}

// Strips a trailing line comment, leaving block comments intact and reporting whether a block spans the next line.
function stripLineComments(line, startedInBlock) {
  if (/^\s*\/\/.*$/.test(line) && !startedInBlock) return { text: null, inBlock: startedInBlock };
  if (line.includes('${') || line.includes('`')) return { text: line, inBlock: startedInBlock };
  let inBlock = startedInBlock;
  let text = '';
  for (let index = 0; index < line.length; index += 1) {
    const current = line[index];
    const next = line[index + 1];
    if (inBlock) {
      text += current;
      if (current === '*' && next === '/') {
        text += next;
        index += 1;
        inBlock = false;
      }
    } else if (current === '/' && next === '*') {
      text += current + next;
      index += 1;
      inBlock = true;
    } else if (current === '/' && next === '/') {
      return { text: text.replace(/\s+$/, ''), inBlock };
    } else {
      text += current;
    }
  }
  return { text, inBlock };
}

export function stripGlslComments(source) {
  if (!GLSL_MARKER.test(source)) return source;
  let insideTemplate = false;
  let inBlock = false;
  const kept = [];
  for (const line of source.split(/\r?\n/)) {
    const startedInside = insideTemplate;
    if (countBackticks(line) % 2 === 1) {
      insideTemplate = !insideTemplate;
      if (insideTemplate) inBlock = false;
    }
    if (startedInside) {
      const result = stripLineComments(line, inBlock);
      inBlock = result.inBlock;
      if (result.text !== null) kept.push(result.text);
    } else {
      kept.push(line);
    }
  }
  return kept.join('\n');
}

export function glslCommentStripperForVite() {
  return {
    name: 'strip-glsl-comments',
    enforce: 'pre',
    transform(code, id) {
      return SOURCE_FILE.test(id) ? { code: stripGlslComments(code), map: null } : null;
    },
  };
}

export function glslCommentStripperForEsbuild() {
  return {
    name: 'strip-glsl-comments',
    setup(build) {
      build.onLoad({ filter: SOURCE_FILE }, async ({ path }) => ({ contents: stripGlslComments(await readFile(path, 'utf8')), loader: 'js' }));
    },
  };
}
