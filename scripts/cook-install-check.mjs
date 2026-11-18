#!/usr/bin/env node
// Tells whether the installed Cook (@codepawlhq/cook) is the one package-lock.json pins (#2274).
// A Cook that is not the pinned one fails deep inside its own code ("KernelParamsV2 must be 320 bytes, got 336"), which looks
// like a bug in the change under test; this check names the mismatch and the command that fixes it.
// Usage: node scripts/cook-install-check.mjs (exits 1 on a mismatch, 0 when Cook matches the pin or is absent).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const COOK_PACKAGE = '@codepawlhq/cook';
const COOK_LOCK_ENTRY = `node_modules/${COOK_PACKAGE}`;
const CRUCIBLE_REPOSITORY = 'codepawl/crucible';
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const FIX_COMMANDS = 'npm ci, then npm run cook:fetch (the pinned prebuilt addon) or npm run cook:build (needs Rust)';

/** The version and commit SHA package-lock.json pins for Cook, or null when the lock has no Cook entry. */
export function pinnedCookFromLock(lockText) {
  if (typeof lockText !== 'string') {
    throw new TypeError('pinnedCookFromLock: pass the text of package-lock.json.');
  }
  const entry = JSON.parse(lockText).packages?.[COOK_LOCK_ENTRY];
  if (entry === undefined) return null;
  const commit = /#([0-9a-f]{40})$/.exec(String(entry.resolved ?? ''))?.[1] ?? null;
  return { version: entry.version ?? null, commit };
}

/**
 * A mismatch is intentional when Cook's own CI copies a Cook checkout into Crucible to test it (GITHUB_REPOSITORY is then
 * not Crucible), or when COOK_ALLOW_UNPINNED=1 is set.
 */
export function unpinnedCookAllowed(environment) {
  if (environment.COOK_ALLOW_UNPINNED === '1') return true;
  const repository = environment.GITHUB_REPOSITORY;
  return typeof repository === 'string' && repository !== '' && repository !== CRUCIBLE_REPOSITORY;
}

function shortCommit(commit) {
  return commit === null ? 'unknown commit' : commit.slice(0, 8);
}

/**
 * Compares the installed Cook with the pin. `installed` is { version, commit, directory } (commit null when the installed copy
 * is not a git checkout, so only the version can be compared). Returns { status: 'absent' | 'match' | 'mismatch' | 'allowed',
 * message }.
 */
export function compareCookInstall({ pinned, installed, environment = {} }) {
  if (installed === null) return { status: 'absent', message: `${COOK_PACKAGE} is not installed.` };
  if (pinned === null) return { status: 'match', message: `package-lock.json pins no ${COOK_PACKAGE}; nothing to compare.` };
  const versionDiffers = pinned.version !== null && installed.version !== pinned.version;
  const commitDiffers = installed.commit !== null && pinned.commit !== null && installed.commit !== pinned.commit;
  if (!versionDiffers && !commitDiffers) {
    return { status: 'match', message: `${COOK_PACKAGE} ${installed.version} matches the pin.` };
  }
  const description = `The installed ${COOK_PACKAGE} is ${installed.version} (${shortCommit(installed.commit)}) at ${installed.directory}, `
    + `but package-lock.json pins ${pinned.version} (${shortCommit(pinned.commit)}).`;
  if (unpinnedCookAllowed(environment)) {
    return { status: 'allowed', message: `${description} Allowed: COOK_ALLOW_UNPINNED=1 or a Cook CI run.` };
  }
  const linkHint = installed.commit === null
    ? ''
    : ` The installed copy is a git checkout: if node_modules/${COOK_PACKAGE} links to it on purpose, check out ${shortCommit(pinned.commit)} there and rebuild, or set COOK_ALLOW_UNPINNED=1.`;
  return { status: 'mismatch', message: `${description} Run ${FIX_COMMANDS}.${linkHint}` };
}

function gitHead(directory) {
  if (!existsSync(join(directory, '.git'))) return null;
  try {
    return execFileSync('git', ['-C', directory, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

/** Reads the installed Cook as seen from `root`: { version, commit, directory } or null when it does not resolve. */
export function readInstalledCook(root = repositoryRoot) {
  let packageJsonPath;
  try {
    packageJsonPath = createRequire(join(root, 'package.json')).resolve(`${COOK_PACKAGE}/package.json`);
  } catch {
    return null;
  }
  const directory = realpathSync(dirname(packageJsonPath));
  const { version } = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  return { version: version ?? null, commit: gitHead(directory), directory };
}

/** The whole check for the checkout at `root`. */
export function checkCookInstall({ root = repositoryRoot, environment = process.env } = {}) {
  const lockPath = join(root, 'package-lock.json');
  const pinned = existsSync(lockPath) ? pinnedCookFromLock(readFileSync(lockPath, 'utf8')) : null;
  return compareCookInstall({ pinned, installed: readInstalledCook(root), environment });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const result = checkCookInstall();
  console.log(result.message);
  process.exitCode = result.status === 'mismatch' ? 1 : 0;
}
