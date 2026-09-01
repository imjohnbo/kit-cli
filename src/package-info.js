import { readFileSync } from 'node:fs';
import { platform, arch } from 'node:os';

/**
 * Facts read from package.json, so there is one source of truth for each.
 *
 * npm ships package.json in every tarball, whatever the `files` array says. The
 * URL resolves against this module rather than the working directory, so it
 * survives the symlink that a global install creates.
 *
 * This lives apart from program.js to keep the import graph acyclic. Commands
 * need these values, and program.js imports the commands.
 */
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

export const VERSION = pkg.version;

/**
 * The published package name. The update check asks the registry about it, and
 * `kit upgrade` passes it to the package manager. Renaming the package is then a
 * single edit in package.json.
 */
export const PACKAGE_NAME = pkg.name;

/**
 * The GitHub slug, as `owner/repo`, parsed from the repository URL.
 *
 * The CLI points users at a GitHub install while the package is unpublished, so
 * the slug must not be a second hardcoded copy of the repo name.
 */
export const REPOSITORY = (() => {
  const url = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url ?? '';
  const m = /github\.com[/:]([^/]+)\/([^/.]+)/.exec(url);
  return m ? `${m[1]}/${m[2]}` : null;
})();

/**
 * Identifies this CLI to Kit's API and to npm's registry. Every outbound
 * request in the codebase sends this — see client.js, auth.js, and
 * update-check.js.
 *
 * Derived from PACKAGE_NAME rather than a second hardcoded literal, with the
 * npm scope stripped: an HTTP product token can't contain `@` or `/`, and
 * the unscoped `kit-cli` belongs to a different author on npm (see
 * update-check.js), so this UA must not silently drift from whatever
 * PACKAGE_NAME actually is if the package is ever renamed.
 */
const UA_PRODUCT = PACKAGE_NAME.replace(/^@[^/]+\//, '');
export const USER_AGENT = `${UA_PRODUCT}/${VERSION} (${platform()} ${arch()}; node/${process.version})`;

/**
 * The minimum supported Node major version, parsed from package.json's
 * `engines.node` (e.g. ">=20" -> 20). `kit doctor` checks the running
 * version against this — reading it from here instead of a second
 * hardcoded literal is what keeps that check from silently going stale the
 * next time the supported range changes, the way its first version did.
 */
export const MIN_NODE_MAJOR = (() => {
  const m = (pkg.engines?.node || '').match(/^>=\s*(\d+)/);
  return m ? Number(m[1]) : 20;
})();
