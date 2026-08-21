/**
 * Tests for src/semver.js and scripts/cli-surface.js
 *
 * Together these are what make semantic versioning enforceable. The semver
 * module handles the syntax and the ordering. The surface snapshot handles the
 * part that actually needs judgment: whether a change is breaking.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseVersion,
  isValidVersion,
  isPrerelease,
  isNewer,
  bumpType,
  requiredBumpForBreaking,
  bumpSatisfies,
} from '../src/semver.js';
import {
  captureSurface,
  readSurface,
  diffSurface,
  classifySurfaceDiff,
  SURFACE_PATH,
} from './cli-surface.js';
import { buildProgram } from '../src/program.js';

// ── parseVersion and validation ────────────────────────────────────────────

describe('parseVersion', () => {
  test('parses a plain version', () => {
    assert.deepEqual(parseVersion('1.2.3'), {
      major: 1, minor: 2, patch: 3, prerelease: null, build: null,
    });
  });

  test('parses a prerelease', () => {
    assert.equal(parseVersion('1.0.0-rc.1').prerelease, 'rc.1');
  });

  test('parses build metadata', () => {
    assert.equal(parseVersion('1.0.0+build.5').build, 'build.5');
  });

  test('tolerates a leading v', () => {
    assert.equal(parseVersion('v0.0.1').patch, 1);
  });

  test('rejects a two-part version', () => {
    assert.equal(parseVersion('1.2'), null);
  });

  test('rejects a non-numeric part', () => {
    assert.equal(parseVersion('1.x.0'), null);
  });

  test('rejects an empty string', () => {
    assert.equal(parseVersion(''), null);
  });
});

describe('isValidVersion', () => {
  for (const good of ['0.0.1', '1.0.0', '10.20.30', '1.0.0-rc.1', '1.0.0+b1']) {
    test(`accepts ${good}`, () => assert.equal(isValidVersion(good), true));
  }
  for (const bad of ['1', '1.0', 'v', 'latest', '1.0.0.0', '01.0.0-']) {
    test(`rejects ${bad}`, () => assert.equal(isValidVersion(bad), false));
  }
});

describe('isPrerelease', () => {
  test('true for a prerelease', () => assert.equal(isPrerelease('0.1.0-rc.1'), true));
  test('false for a release', () => assert.equal(isPrerelease('0.1.0'), false));
  test('false for build metadata alone', () => assert.equal(isPrerelease('0.1.0+b1'), false));
});

// ── bumpType ───────────────────────────────────────────────────────────────

describe('bumpType', () => {
  const cases = [
    ['0.0.1', '1.0.0', 'major'],
    ['0.0.1', '0.1.0', 'minor'],
    ['0.0.1', '0.0.2', 'patch'],
    ['0.0.1', '0.0.1', 'none'],
    ['1.0.0-rc.1', '1.0.0', 'prerelease'],
    ['1.0.0', '1.0.0-rc.1', 'prerelease'],
    ['0.9.9', '1.0.0', 'major'],
  ];
  for (const [from, to, want] of cases) {
    test(`${from} -> ${to} is a ${want} bump`, () => {
      assert.equal(bumpType(from, to), want);
    });
  }

  test('returns null on unparseable input', () => {
    assert.equal(bumpType('latest', '1.0.0'), null);
  });
});

// ── the 0.x rule ───────────────────────────────────────────────────────────

describe('requiredBumpForBreaking', () => {
  test('while major is 0, a breaking change needs a minor bump', () => {
    // Semver leaves 0.x unstable, but npm's caret range treats minor as the
    // breaking axis below 1.0.0, and the ecosystem reads it that way.
    assert.equal(requiredBumpForBreaking('0.1.0'), 'minor');
    assert.equal(requiredBumpForBreaking('0.9.9'), 'minor');
  });

  test('from 1.0.0 on, a breaking change needs a major bump', () => {
    assert.equal(requiredBumpForBreaking('1.0.0'), 'major');
    assert.equal(requiredBumpForBreaking('2.5.1'), 'major');
  });
});

describe('bumpSatisfies', () => {
  test('a major bump satisfies a major requirement', () => {
    assert.equal(bumpSatisfies('major', 'major'), true);
  });

  test('a minor bump does not satisfy a major requirement', () => {
    assert.equal(bumpSatisfies('minor', 'major'), false);
  });

  test('a major bump satisfies a minor requirement', () => {
    assert.equal(bumpSatisfies('major', 'minor'), true);
  });

  test('a patch bump does not satisfy a minor requirement', () => {
    assert.equal(bumpSatisfies('patch', 'minor'), false);
  });

  test('no bump satisfies nothing', () => {
    assert.equal(bumpSatisfies('none', 'patch'), false);
  });
});

// ── the committed surface snapshot ─────────────────────────────────────────

describe('cli surface snapshot', () => {
  test('spec/cli-surface.json matches the current command tree', () => {
    const committed = readSurface();
    assert.ok(committed, 'spec/cli-surface.json is missing. Run `npm run surface`.');
    assert.deepEqual(
      captureSurface(),
      committed,
      'The command tree changed. Run `npm run surface` and commit the result, so ' +
        'the release gate can tell whether the change is breaking.'
    );
  });

  test('the snapshot covers every command in the tree', () => {
    const surface = captureSurface();
    const count = Object.keys(surface.commands).length;
    assert.ok(count > 80, `only captured ${count} commands`);
  });

  test('the snapshot leaves out help, which is not a contract', () => {
    const surface = captureSurface();
    assert.ok(!('help' in surface.commands));
    for (const entry of Object.values(surface.commands)) {
      assert.ok(!entry.options.includes('--help'));
    }
  });

  test('the snapshot records nested commands by full path', () => {
    const surface = captureSurface();
    assert.ok('sequences emails create' in surface.commands);
    assert.ok('bulk tags delete' in surface.commands);
  });

  test('the snapshot records argument arity', () => {
    const surface = captureSurface();
    assert.deepEqual(surface.commands['tags update'].arguments, [
      { name: 'id', required: true, variadic: false },
      { name: 'name', required: true, variadic: false },
    ]);
  });

  test('the snapshot records an optional argument as optional', () => {
    assert.equal(captureSurface().commands['broadcasts stats'].arguments[0].required, false);
  });

  test('the snapshot records a variadic argument', () => {
    assert.equal(captureSurface().commands['account set-colors'].arguments[0].variadic, true);
  });

  test('the committed file is valid JSON with a trailing newline', () => {
    const raw = readFileSync(SURFACE_PATH, 'utf8');
    assert.doesNotThrow(() => JSON.parse(raw));
    assert.ok(raw.endsWith('\n'));
  });
});

// ── diffSurface ────────────────────────────────────────────────────────────

describe('diffSurface', () => {
  const base = {
    commands: {
      'tags list': { arguments: [], options: ['--format'] },
      'tags update': { arguments: [{ name: 'id', required: true, variadic: false }], options: [] },
    },
  };

  test('a removed command is breaking', () => {
    const after = { commands: { 'tags list': base.commands['tags list'] } };
    const diff = diffSurface(base, after);
    assert.equal(classifySurfaceDiff(diff), 'breaking');
    assert.match(diff.breaking[0], /removed command: kit tags update/);
  });

  test('a removed flag is breaking', () => {
    const after = structuredClone(base);
    after.commands['tags list'].options = [];
    const diff = diffSurface(base, after);
    assert.equal(classifySurfaceDiff(diff), 'breaking');
    assert.match(diff.breaking[0], /removed flag: kit tags list --format/);
  });

  test('a new required argument is breaking', () => {
    const after = structuredClone(base);
    after.commands['tags update'].arguments.push({ name: 'extra', required: true, variadic: false });
    const diff = diffSurface(base, after);
    assert.equal(classifySurfaceDiff(diff), 'breaking');
    assert.match(diff.breaking[0], /new required argument/);
  });

  test('an argument becoming required is breaking', () => {
    const before = {
      commands: { 'broadcasts stats': { arguments: [{ name: 'id', required: false, variadic: false }], options: [] } },
    };
    const after = {
      commands: { 'broadcasts stats': { arguments: [{ name: 'id', required: true, variadic: false }], options: [] } },
    };
    assert.equal(classifySurfaceDiff(diffSurface(before, after)), 'breaking');
  });

  test('a removed argument is breaking', () => {
    const after = structuredClone(base);
    after.commands['tags update'].arguments = [];
    assert.equal(classifySurfaceDiff(diffSurface(base, after)), 'breaking');
  });

  test('a new command is additive', () => {
    const after = structuredClone(base);
    after.commands['tags rename'] = { arguments: [], options: [] };
    const diff = diffSurface(base, after);
    assert.equal(classifySurfaceDiff(diff), 'additive');
    assert.match(diff.additive[0], /new command: kit tags rename/);
  });

  test('a new flag is additive', () => {
    const after = structuredClone(base);
    after.commands['tags list'].options = ['--format', '--slim'];
    const diff = diffSurface(base, after);
    assert.equal(classifySurfaceDiff(diff), 'additive');
    assert.match(diff.additive[0], /new flag: kit tags list --slim/);
  });

  test('a new optional argument is additive', () => {
    const after = structuredClone(base);
    after.commands['tags update'].arguments.push({ name: 'note', required: false, variadic: false });
    assert.equal(classifySurfaceDiff(diffSurface(base, after)), 'additive');
  });

  test('an identical surface is no change', () => {
    assert.equal(classifySurfaceDiff(diffSurface(base, structuredClone(base))), 'none');
  });

  test('breaking wins when a change is both', () => {
    const after = structuredClone(base);
    after.commands['tags list'].options = [];             // breaking
    after.commands['tags rename'] = { arguments: [], options: [] }; // additive
    const diff = diffSurface(base, after);
    assert.equal(diff.breaking.length, 1);
    assert.equal(diff.additive.length, 1);
    assert.equal(classifySurfaceDiff(diff), 'breaking');
  });

  test('the real tree compared to itself shows no change', () => {
    const a = captureSurface(buildProgram());
    const b = captureSurface(buildProgram());
    assert.equal(classifySurfaceDiff(diffSurface(a, b)), 'none');
  });
});
