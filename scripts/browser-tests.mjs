// Finds the test files that start a browser or path trace a frame, so the fast list never holds one (#3139).
// A browser test is slow when it runs and fast only when it skipped (no build or no Chrome where the list was recorded),
// then Chrome starts beside hundreds of other files in the pre-push pass and times out.
// The check reads source, not behaviour: a file is a browser test when it, or a local file it imports or names by path
// (`new URL('../scripts/smoke.mjs', import.meta.url)` counts), mentions a browser launcher or a render job.
import { existsSync, readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { importSpecifiers } from './import-specifiers.mjs';
import { repositoryRoot } from './test-run.mjs';

// Source that starts a browser: playwright, a Chrome executable or flag, or the real MCP server process (it renders in Chrome).
// Pure tests that only mention path tracing or render jobs by name do not match, because they run no browser.
export const LAUNCHER_MARKERS = [
  { pattern: /\bplaywright(?:-core)?\b|\bpuppeteer\b|\bchromium\b/, reason: 'launches a browser through playwright' },
  { pattern: /StdioClientTransport|crucible-mcp\.mjs|build\/mcp\//, reason: 'starts the MCP server, which renders in Chrome' },
  { pattern: /--headless|--remote-debugging|CHROME_PATH|chrome\.exe/, reason: 'starts Chrome' },
];

const LOCAL_PATH_LITERAL = /(["'`])((?:\.{1,2}\/)[^"'`\s]*?\.(?:m?js|cjs))\1/g;
const SCRIPT_EXTENSION = /\.(?:m?js|cjs)$/;
const FOLLOWED_FOLDERS = /^(?:tests|scripts|src|bin|bench|packages)\//;
const EXTENSIONS = ['', '.js', '.mjs', '.cjs'];

function resolveLocalFile(importerPath, specifier, fileExists) {
  const resolved = posix.normalize(posix.join(posix.dirname(importerPath), specifier));
  return EXTENSIONS.map(extension => resolved + extension).find(candidate => FOLLOWED_FOLDERS.test(candidate) && fileExists(candidate));
}

function localFilesNamedBy(sourceText, importerPath, fileExists) {
  const specifiers = new Set(importSpecifiers(sourceText).filter(specifier => specifier.startsWith('.') && SCRIPT_EXTENSION.test(specifier)));
  for (const match of sourceText.matchAll(LOCAL_PATH_LITERAL)) specifiers.add(match[2]);
  return [...specifiers].map(specifier => resolveLocalFile(importerPath, specifier, fileExists)).filter(Boolean);
}

/**
 * Returns browserReason(testFile): why the file starts a browser or path traces, or null.
 * \`readSource(path)\` gives the text of a repository file, or null. Each file is read and scanned once per detector.
 */
export function createBrowserDetector(readSource) {
  const sources = new Map();
  const read = path => {
    if (!sources.has(path)) sources.set(path, readSource(path));
    return sources.get(path);
  };
  const fileExists = path => read(path) !== null;
  const nodes = new Map();
  function nodeFor(path) {
    if (!nodes.has(path)) {
      const sourceText = read(path);
      nodes.set(path, {
        reason: LAUNCHER_MARKERS.find(({ pattern }) => pattern.test(sourceText))?.reason ?? null,
        next: localFilesNamedBy(sourceText, path, fileExists),
      });
    }
    return nodes.get(path);
  }
  return function browserReason(testFile) {
    if (!fileExists(testFile)) return null;
    const visited = new Set([testFile]);
    const queue = [[testFile, [testFile]]];
    while (queue.length > 0) {
      const [path, trail] = queue.shift();
      const node = nodeFor(path);
      if (node.reason) return node.reason + ' (' + trail.join(' -> ') + ')';
      for (const next of node.next) {
        if (visited.has(next)) continue;
        visited.add(next);
        queue.push([next, [...trail, next]]);
      }
    }
    return null;
  };
}

export function readRepositorySource(folder = repositoryRoot) {
  const root = String(folder).replaceAll('\\', '/');
  return path => {
    const absolute = posix.join(root, path);
    return existsSync(absolute) ? readFileSync(absolute, 'utf8') : null;
  };
}

