/**
 * Version comparison, used by the update check and by the release gate.
 *
 * Kept free of any config or filesystem dependency so a release script can
 * import it without starting the CLI's config store.
 */

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/;

/** Parses a version, or returns null. */
export function parseVersion(value) {
  const m = SEMVER.exec(String(value ?? '').trim());
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] ?? null,
    build: m[5] ?? null,
  };
}

/** True when `value` is a valid semver string. */
export function isValidVersion(value) {
  return parseVersion(value) !== null;
}

/** True when `value` carries a prerelease tag, such as 1.0.0-rc.1. */
export function isPrerelease(value) {
  return parseVersion(value)?.prerelease != null;
}

/**
 * Compares two versions. Returns true when `candidate` is newer than `current`.
 *
 * A release beats its own prerelease, so 2.0.0 is newer than 2.0.0-rc.1.
 * Anything unparseable returns false, which fails quiet.
 */
export function isNewer(candidate, current) {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  if (!a || !b) return false;

  for (const part of ['major', 'minor', 'patch']) {
    if (a[part] !== b[part]) return a[part] > b[part];
  }
  if (a.prerelease === b.prerelease) return false;
  if (a.prerelease === null) return true;
  if (b.prerelease === null) return false;
  return a.prerelease > b.prerelease;
}

/**
 * Names the kind of bump between two versions.
 *
 * Returns 'major', 'minor', 'patch', 'prerelease', or 'none'. Returns null when
 * either version does not parse.
 */
export function bumpType(from, to) {
  const a = parseVersion(from);
  const b = parseVersion(to);
  if (!a || !b) return null;

  if (b.major !== a.major) return 'major';
  if (b.minor !== a.minor) return 'minor';
  if (b.patch !== a.patch) return 'patch';
  if (b.prerelease !== a.prerelease) return 'prerelease';
  return 'none';
}

/**
 * The smallest bump that a breaking change is allowed to ship in.
 *
 * Semver leaves 0.x unstable, but the ecosystem reads 0.x as "minor is the
 * breaking axis", and npm's caret range treats it that way too. So while major
 * is 0, a breaking change needs a minor bump. From 1.0.0 on, it needs a major.
 */
export function requiredBumpForBreaking(toVersion) {
  const v = parseVersion(toVersion);
  if (!v) return null;
  return v.major === 0 ? 'minor' : 'major';
}

const RANK = { none: 0, prerelease: 1, patch: 2, minor: 3, major: 4 };

/** True when `actual` is at least as large a bump as `required`. */
export function bumpSatisfies(actual, required) {
  if (!(actual in RANK) || !(required in RANK)) return false;
  return RANK[actual] >= RANK[required];
}
