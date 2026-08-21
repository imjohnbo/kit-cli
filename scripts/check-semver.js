#!/usr/bin/env node
/**
 * The release gate. Answers one question: may this version ship?
 *
 * Four checks, in order:
 *
 * 1. The version is valid semver.
 * 2. The git tag matches package.json.
 * 3. The version is newer than what npm already serves.
 * 4. A breaking change to the CLI surface carries a big enough bump.
 *
 * Check 4 is the only one that enforces the *semantic* part of semantic
 * versioning. The first three enforce the syntax and the ordering.
 *
 * Usage:
 *   node scripts/check-semver.js                 # local, checks the working tree
 *   node scripts/check-semver.js --tag v0.1.0    # CI, also checks the tag
 *   node scripts/check-semver.js --against 0.0.1 # compare surface to a version
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isValidVersion,
  isNewer,
  isPrerelease,
  bumpType,
  requiredBumpForBreaking,
  bumpSatisfies,
} from '../src/semver.js';
import { captureSurface, diffSurface, classifySurfaceDiff } from './cli-surface.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const failures = [];
const notes = [];

function fail(msg) {
  failures.push(msg);
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : process.argv[i + 1] ?? null;
}

function git(...args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

// ── 1. valid semver ────────────────────────────────────────────────────────

const version = pkg.version;

if (!isValidVersion(version)) {
  fail(`package.json version "${version}" is not valid semver.`);
}

// ── 2. the tag matches package.json ────────────────────────────────────────

const tag = arg('--tag') || process.env.GITHUB_REF_NAME || null;

if (tag) {
  if (!/^v/.test(tag)) {
    fail(`Tag "${tag}" must start with "v".`);
  }
  const tagVersion = tag.replace(/^v/, '');
  if (!isValidVersion(tagVersion)) {
    fail(`Tag "${tag}" is not a valid semver tag.`);
  } else if (tagVersion !== version) {
    fail(`Tag "${tag}" does not match package.json version "${version}".`);
  } else {
    notes.push(`Tag ${tag} matches package.json.`);
  }
} else {
  notes.push('No tag given, so the tag check was skipped.');
}

// ── 3. newer than what npm serves ──────────────────────────────────────────

const published = (() => {
  const given = arg('--published');
  if (given) return given === 'none' ? null : given;
  try {
    const out = execFileSync('npm', ['view', pkg.name, 'version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return out || null;
  } catch {
    // A package with no published version yet. The first release is fine.
    return null;
  }
})();

if (published) {
  if (!isNewer(version, published)) {
    fail(`Version ${version} is not newer than the published ${published}.`);
  } else {
    notes.push(`${version} is newer than the published ${published}.`);
  }
} else {
  notes.push('Nothing published yet, so the ordering check was skipped.');
}

// ── 4. a breaking surface change needs a big enough bump ───────────────────

const baseline = arg('--against') || published;

if (!baseline) {
  notes.push('No baseline version, so the surface check was skipped.');
} else if (isPrerelease(version)) {
  notes.push(`${version} is a prerelease, so the surface check was skipped.`);
} else {
  const ref = `v${baseline}`;
  const previous = git('show', `${ref}:spec/cli-surface.json`);

  if (!previous) {
    notes.push(`No surface snapshot at ${ref}, so the surface check was skipped.`);
  } else {
    const diff = diffSurface(JSON.parse(previous), captureSurface());
    const kind = classifySurfaceDiff(diff);
    const bump = bumpType(baseline, version);

    notes.push(`Surface change since ${baseline}: ${kind}. Bump: ${bump}.`);

    for (const line of diff.breaking) notes.push(`  breaking: ${line}`);
    for (const line of diff.additive) notes.push(`  additive: ${line}`);

    if (kind === 'breaking') {
      const required = requiredBumpForBreaking(version);
      if (!bumpSatisfies(bump, required)) {
        fail(
          `The CLI surface has a breaking change, so ${baseline} -> ${version} needs a ` +
            `${required} bump but is only a ${bump} bump.\n` +
            diff.breaking.map((l) => `    ${l}`).join('\n')
        );
      }
    } else if (kind === 'additive' && !bumpSatisfies(bump, 'minor')) {
      fail(
        `The CLI surface gained commands or flags, so ${baseline} -> ${version} needs at ` +
          `least a minor bump but is only a ${bump} bump.\n` +
          diff.additive.map((l) => `    ${l}`).join('\n')
      );
    }
  }
}

// ── report ─────────────────────────────────────────────────────────────────

for (const note of notes) console.log(note);

if (failures.length > 0) {
  console.error('');
  for (const f of failures) {
    console.error(`error: ${f}`);
    if (process.env.GITHUB_ACTIONS) {
      console.error(`::error::${f.split('\n')[0]}`);
    }
  }
  process.exit(1);
}

console.log('');
console.log(`Version ${version} may ship.`);
