// Lets a test use Cook (@codepawlhq/cook) when it is installed and skip when it is not, so `npm test` passes either way.
// COOK_DISABLE=1 behaves like an absent package, which is how the absent mode is tested. A Cook that is not the one
// package-lock.json pins skips too, with a reason that says what to run (#2274); tests/cook-install.test.js fails on it.
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import test, { describe } from 'node:test';

import { checkCookInstall } from '../../scripts/cook-install-check.mjs';

const COOK_PACKAGE = '@codepawlhq/cook';

function findCookDirectory() {
  if (process.env.COOK_DISABLE === '1') return null;
  try {
    const require = createRequire(import.meta.url);
    return dirname(require.resolve(`${COOK_PACKAGE}/package.json`));
  } catch {
    return null;
  }
}

const resolvedCookDirectory = findCookDirectory();
const installCheck = resolvedCookDirectory === null ? null : checkCookInstall();
const cookMismatched = installCheck?.status === 'mismatch';
const cookDirectory = cookMismatched ? null : resolvedCookDirectory;

export const cookInstalled = cookDirectory !== null;
export const cookSkipReason = cookInstalled ? false : (cookMismatched ? installCheck.message : 'Cook (@codepawlhq/cook) is not installed');

function exportSubpath(subpath) {
  if (subpath === '' || subpath === '.') return COOK_PACKAGE;
  return `${COOK_PACKAGE}/${subpath}`;
}

/** The module namespace of `@codepawlhq/cook` or one of its subpaths ("pack-input", "engine", ...), or null when Cook is absent. */
export async function cookModule(subpath = '.') {
  if (!cookInstalled) return null;
  return import(exportSubpath(subpath));
}

/** The absolute path of a file inside the installed package (for example "src/kernel.wgsl"), or null when Cook is absent. */
export function cookFile(subpath) {
  if (!cookInstalled) return null;
  return join(cookDirectory, subpath);
}

// Accepts (name, fn) and (name, options, fn); when Cook is absent the skip reason replaces any skip the caller passed.
function withCookSkip(runner, name, optionsOrFunction, maybeFunction) {
  const hasOptions = typeof optionsOrFunction !== 'function';
  const options = hasOptions ? optionsOrFunction : {};
  const body = hasOptions ? maybeFunction : optionsOrFunction;
  if (cookInstalled) return hasOptions ? runner(name, options, body) : runner(name, body);
  return runner(name, { ...options, skip: cookSkipReason }, body);
}

export function cookTest(name, optionsOrFunction, maybeFunction) {
  return withCookSkip(test, name, optionsOrFunction, maybeFunction);
}

export function cookDescribe(name, optionsOrFunction, maybeFunction) {
  return withCookSkip(describe, name, optionsOrFunction, maybeFunction);
}
