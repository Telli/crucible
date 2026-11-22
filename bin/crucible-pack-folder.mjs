// The folder `crucible packs add` installs into and crucible-mcp reads when --packs is not given.
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

/** ~/.crucible/packs, or CRUCIBLE_PACKS_HOME when it is set to an absolute folder. */
export function defaultPacksFolder({ environment = process.env, home = homedir() } = {}) {
  const override = environment.CRUCIBLE_PACKS_HOME;
  if (override !== undefined && override !== '') {
    if (!isAbsolute(override)) throw new TypeError(`CRUCIBLE_PACKS_HOME must be an absolute folder, got "${override}". Set it to a full path or unset it to use ~/.crucible/packs.`);
    return resolve(override);
  }
  return join(home, '.crucible', 'packs');
}

/**
 * The packs folder crucible-mcp uses: --packs when given ("none" turns packs off), otherwise the default folder when it exists.
 * A missing default folder means no packs, so a machine that never installed one sees no change.
 */
export function resolvePacksOption(packsFlag, options = {}) {
  if (packsFlag === 'none') return undefined;
  if (packsFlag !== undefined) return packsFlag;
  const folder = defaultPacksFolder(options);
  return existsSync(folder) ? folder : undefined;
}
