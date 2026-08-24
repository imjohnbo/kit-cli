/**
 * Tests for src/version.js, src/update-check.js, and src/commands/upgrade.js
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { VERSION, PACKAGE_NAME, REPOSITORY } from '../src/package-info.js';
import {
  isNewer,
  cacheIsStale,
  updateCheckAllowed,
  noticeIfOutdated,
  refreshLatest,
  OK,
  NOT_FOUND,
  UNREACHABLE,
  DISABLED,
} from '../src/update-check.js';
import { detectInstaller, upgradeArgv, upgradeCommand } from '../src/commands/upgrade.js';
import config from '../src/config.js';
import { runCommand, findSubcommand } from './helpers.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

// The update check reads config and env. Save and restore both around each test,
// and clear CI, which is set in the very environment these tests run in.
let snapshot;

beforeEach(() => {
  snapshot = {
    updateCheck: config.get('updateCheck'),
    updateCheckedAt: config.get('updateCheckedAt'),
    updateLatestVersion: config.get('updateLatestVersion'),
    updateLatestPackage: config.get('updateLatestPackage'),
    CI: process.env.CI,
    KIT_NO_UPDATE_CHECK: process.env.KIT_NO_UPDATE_CHECK,
    KIT_REGISTRY: process.env.KIT_REGISTRY,
    fetch: globalThis.fetch,
  };
  delete process.env.CI;
  delete process.env.KIT_NO_UPDATE_CHECK;
  delete process.env.KIT_REGISTRY;
  config.set('updateCheck', true);
  config.set('updateCheckedAt', 0);
  config.set('updateLatestVersion', '');
  config.set('updateLatestPackage', PACKAGE_NAME);
});

afterEach(() => {
  config.set('updateCheck', snapshot.updateCheck);
  config.set('updateCheckedAt', snapshot.updateCheckedAt);
  config.set('updateLatestVersion', snapshot.updateLatestVersion);
  config.set('updateLatestPackage', snapshot.updateLatestPackage);
  for (const key of ['CI', 'KIT_NO_UPDATE_CHECK', 'KIT_REGISTRY']) {
    if (snapshot[key] === undefined) delete process.env[key];
    else process.env[key] = snapshot[key];
  }
  globalThis.fetch = snapshot.fetch;
});

// ── version ────────────────────────────────────────────────────────────────

describe('version', () => {
  test('comes from package.json', () => {
    assert.equal(VERSION, pkg.version);
  });

  test('is a semver string', () => {
    assert.match(VERSION, /^\d+\.\d+\.\d+/);
  });

  test('is not hardcoded anywhere in src', () => {
    // A literal version string in src/ is the drift this module exists to stop.
    const files = ['src/program.js', 'bin/kit.js'];
    for (const file of files) {
      const body = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
      assert.ok(!body.includes(`'${pkg.version}'`), `${file} hardcodes the version`);
    }
  });
});

// ── isNewer ────────────────────────────────────────────────────────────────

describe('isNewer', () => {
  const cases = [
    ['1.0.1', '1.0.0', true, 'patch bump'],
    ['1.1.0', '1.0.9', true, 'minor beats higher patch'],
    ['2.0.0', '1.99.99', true, 'major beats higher minor'],
    ['1.0.0', '1.0.0', false, 'equal'],
    ['1.0.0', '1.0.1', false, 'older patch'],
    ['1.0.0', '2.0.0', false, 'older major'],
    ['1.0.10', '1.0.9', true, 'numeric, not lexical'],
    ['2.0.0', '2.0.0-rc.1', true, 'release beats its prerelease'],
    ['2.0.0-rc.1', '2.0.0', false, 'prerelease loses to its release'],
    ['2.0.0-rc.2', '2.0.0-rc.1', true, 'later prerelease'],
    ['v1.0.1', '1.0.0', true, 'leading v tolerated'],
  ];

  for (const [candidate, current, want, label] of cases) {
    test(`${label}: ${candidate} vs ${current} -> ${want}`, () => {
      assert.equal(isNewer(candidate, current), want);
    });
  }

  test('treats unparseable input as not newer', () => {
    assert.equal(isNewer('latest', '1.0.0'), false);
    assert.equal(isNewer('', '1.0.0'), false);
    assert.equal(isNewer(undefined, '1.0.0'), false);
    assert.equal(isNewer('1.0.1', 'garbage'), false);
  });
});

// ── updateCheckAllowed ─────────────────────────────────────────────────────

describe('updateCheckAllowed', () => {
  test('allowed by default', () => {
    assert.equal(updateCheckAllowed({}), true);
  });

  test('KIT_NO_UPDATE_CHECK turns it off', () => {
    assert.equal(updateCheckAllowed({ KIT_NO_UPDATE_CHECK: '1' }), false);
  });

  test('KIT_NO_UPDATE_CHECK=0 leaves it on', () => {
    assert.equal(updateCheckAllowed({ KIT_NO_UPDATE_CHECK: '0' }), true);
  });

  test('CI turns it off, so pipelines make no outbound request', () => {
    assert.equal(updateCheckAllowed({ CI: 'true' }), false);
  });

  test('CI=false leaves it on', () => {
    assert.equal(updateCheckAllowed({ CI: 'false' }), true);
  });

  test('the config toggle turns it off', () => {
    config.set('updateCheck', false);
    assert.equal(updateCheckAllowed({}), false);
  });
});

// ── noticeIfOutdated ───────────────────────────────────────────────────────

describe('noticeIfOutdated', () => {
  test('prints when the cache holds a newer version', () => {
    config.set('updateLatestVersion', '9.9.9');
    const lines = [];
    const notice = noticeIfOutdated({ write: (s) => lines.push(s), current: '1.0.0' });
    assert.ok(notice);
    assert.match(lines[0], /1\.0\.0 -> 9\.9\.9/);
    assert.match(lines[0], /kit upgrade/);
  });

  test('says nothing when the cache matches the running version', () => {
    config.set('updateLatestVersion', '1.0.0');
    const lines = [];
    assert.equal(noticeIfOutdated({ write: (s) => lines.push(s), current: '1.0.0' }), null);
    assert.equal(lines.length, 0);
  });

  test('says nothing when the cache is empty', () => {
    const lines = [];
    assert.equal(noticeIfOutdated({ write: (s) => lines.push(s), current: '1.0.0' }), null);
    assert.equal(lines.length, 0);
  });

  test('says nothing when the check is disabled', () => {
    config.set('updateLatestVersion', '9.9.9');
    config.set('updateCheck', false);
    const lines = [];
    assert.equal(noticeIfOutdated({ write: (s) => lines.push(s), current: '1.0.0' }), null);
    assert.equal(lines.length, 0);
  });

  test('makes no network request', () => {
    config.set('updateLatestVersion', '9.9.9');
    let called = false;
    globalThis.fetch = async () => { called = true; return { ok: true, json: async () => ({}) }; };
    noticeIfOutdated({ write: () => {}, current: '1.0.0' });
    assert.equal(called, false);
  });

  test('defaults to writing on stderr, not stdout', () => {
    config.set('updateLatestVersion', '9.9.9');
    const logs = [];
    const errors = [];
    const origLog = console.log;
    const origErr = console.error;
    console.log = (...a) => logs.push(a.join(' '));
    console.error = (...a) => errors.push(a.join(' '));
    try {
      noticeIfOutdated({ current: '1.0.0' });
    } finally {
      console.log = origLog;
      console.error = origErr;
    }
    assert.equal(logs.length, 0);
    assert.equal(errors.length, 1);
  });
});

// ── cacheIsStale ───────────────────────────────────────────────────────────

describe('cacheIsStale', () => {
  test('a never-checked cache is stale', () => {
    assert.equal(cacheIsStale(Date.now()), true);
  });

  test('a cache written just now is fresh', () => {
    config.set('updateCheckedAt', 1_000_000_000_000);
    assert.equal(cacheIsStale(1_000_000_000_000 + 60_000), false);
  });

  test('a cache older than a day is stale', () => {
    config.set('updateCheckedAt', 1_000_000_000_000);
    assert.equal(cacheIsStale(1_000_000_000_000 + 25 * 60 * 60 * 1000), true);
  });
});

// ── refreshLatest ──────────────────────────────────────────────────────────

describe('refreshLatest', () => {
  test('reads the version and caches it', async () => {
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ version: '3.2.1' }) });
    assert.deepEqual(await refreshLatest({ force: true }), { status: OK, version: '3.2.1' });
    assert.equal(config.get('updateLatestVersion'), '3.2.1');
    assert.ok(config.get('updateCheckedAt') > 0);
  });

  test('asks the npm registry for the package', async () => {
    let url;
    globalThis.fetch = async (u) => { url = u; return { ok: true, status: 200, json: async () => ({ version: '1.0.0' }) }; };
    await refreshLatest({ force: true });
    // Built from package.json, so renaming the package cannot break the check.
    assert.equal(url, `https://registry.npmjs.org/${PACKAGE_NAME}/latest`);
  });

  test('leaves a scoped name unencoded, which is what the registry serves', async () => {
    let url;
    globalThis.fetch = async (u) => { url = u; return { ok: true, status: 200, json: async () => ({ version: '1.0.0' }) }; };
    await refreshLatest({ force: true });
    assert.ok(!String(url).includes('%2F'), 'the scope separator must stay a slash');
  });

  test('honors KIT_REGISTRY for mirrors', async () => {
    process.env.KIT_REGISTRY = 'https://npm.internal.example/';
    let url;
    globalThis.fetch = async (u) => { url = u; return { ok: true, status: 200, json: async () => ({ version: '1.0.0' }) }; };
    await refreshLatest({ force: true });
    assert.equal(url, `https://npm.internal.example/${PACKAGE_NAME}/latest`);
  });

  test('reports not-found for an unpublished package', async () => {
    globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
    const r = await refreshLatest({ force: true });
    assert.equal(r.status, NOT_FOUND);
    assert.equal(r.version, null);
  });

  test('reports unreachable for a server error', async () => {
    globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
    assert.equal((await refreshLatest({ force: true })).status, UNREACHABLE);
  });

  test('reports unreachable when the request throws, rather than propagating', async () => {
    globalThis.fetch = async () => { throw new Error('ENOTFOUND'); };
    assert.equal((await refreshLatest({ force: true })).status, UNREACHABLE);
  });

  test('reports unreachable on a response with no version', async () => {
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });
    assert.equal((await refreshLatest({ force: true })).status, UNREACHABLE);
  });

  test('makes no automatic request when the check is disabled', async () => {
    config.set('updateCheck', false);
    let called = false;
    globalThis.fetch = async () => { called = true; return { ok: true, status: 200, json: async () => ({}) }; };
    assert.equal((await refreshLatest({ force: true })).status, DISABLED);
    assert.equal(called, false);
  });

  test('an explicit request runs even when the notice is disabled', async () => {
    // `kit upgrade` must work for someone who turned the background notice off.
    config.set('updateCheck', false);
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ version: '5.0.0' }) });
    const r = await refreshLatest({ force: true, automatic: false });
    assert.equal(r.status, OK);
    assert.equal(r.version, '5.0.0');
  });

  test('serves a fresh cache without a request', async () => {
    config.set('updateLatestVersion', '2.0.0');
    config.set('updateLatestPackage', PACKAGE_NAME);
    config.set('updateCheckedAt', Date.now());
    let called = false;
    globalThis.fetch = async () => { called = true; return { ok: true, status: 200, json: async () => ({}) }; };
    assert.deepEqual(await refreshLatest(), { status: OK, version: '2.0.0' });
    assert.equal(called, false);
  });

  test('records which package the cached version came from', async () => {
    config.set('updateLatestPackage', '');
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ version: '3.0.0' }) });
    await refreshLatest({ force: true });
    assert.equal(config.get('updateLatestPackage'), PACKAGE_NAME);
  });
});

// ── detectInstaller ────────────────────────────────────────────────────────

describe('detectInstaller', () => {
  const cases = [
    ['/usr/local/lib/node_modules/kit-cli/src/commands/upgrade.js', 'npm'],
    ['/home/me/.nvm/versions/node/v22.0.0/lib/node_modules/kit-cli/src/commands/upgrade.js', 'npm'],
    ['/home/me/.local/share/pnpm/global/5/node_modules/kit-cli/src/commands/upgrade.js', 'pnpm'],
    ['/home/me/.pnpm/kit-cli/src/commands/upgrade.js', 'pnpm'],
    ['/home/me/.bun/install/global/node_modules/kit-cli/src/commands/upgrade.js', 'bun'],
    ['/opt/homebrew/Cellar/kit-cli/1.0.0/libexec/src/commands/upgrade.js', 'brew'],
    ['/usr/local/Cellar/kit-cli/1.0.0/libexec/src/commands/upgrade.js', 'brew'],
    ['/home/me/.config/yarn/global/node_modules/kit-cli/src/commands/upgrade.js', 'yarn'],
    ['/Users/me/code/kit-cli/src/commands/upgrade.js', 'source'],
  ];

  for (const [path, want] of cases) {
    test(`${want}: ${path.slice(0, 52)}`, () => {
      assert.equal(detectInstaller(path), want);
    });
  }

  test('handles Windows separators', () => {
    assert.equal(
      detectInstaller('C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\kit-cli\\src\\commands\\upgrade.js'),
      'npm'
    );
  });

  test('a git checkout reports source, not npm', () => {
    // `npm link` leaves the real path inside the working tree, so an upgrade
    // there must tell the user to use git rather than run a global install.
    assert.equal(detectInstaller('/Users/me/dev/kit-cli/src/commands/upgrade.js'), 'source');
  });
});

// ── upgradeArgv ────────────────────────────────────────────────────────────

describe('upgradeArgv', () => {
  test('npm installs the latest globally', () => {
    assert.deepEqual(upgradeArgv('npm'), ['npm', 'install', '-g', `${PACKAGE_NAME}@latest`]);
  });

  test('the target comes from package.json, not a literal', () => {
    // Renaming the package must not leave `kit upgrade` pointing at the old name.
    assert.ok(upgradeArgv('npm').some((part) => part.startsWith(`${PACKAGE_NAME}@`)));
  });

  test('every manager has a command', () => {
    for (const m of ['npm', 'pnpm', 'yarn', 'bun', 'brew']) {
      assert.ok(Array.isArray(upgradeArgv(m)), `no command for ${m}`);
    }
  });

  test('source has no command, so the caller must handle it', () => {
    assert.equal(upgradeArgv('source'), null);
  });

  test('no command goes through a shell string', () => {
    // argv arrays reach execve directly. A string would invite quoting bugs.
    for (const m of ['npm', 'pnpm', 'yarn', 'bun', 'brew']) {
      for (const part of upgradeArgv(m)) {
        assert.equal(typeof part, 'string');
        assert.ok(!/[;&|`$]/.test(part), `shell metacharacter in ${m}: ${part}`);
      }
    }
  });
});

// ── the upgrade command ────────────────────────────────────────────────────

describe('kit upgrade', () => {
  const run = (argv, responses) => runCommand(upgradeCommand, argv, { responses });

  test('reports when already up to date', async () => {
    const res = await run(['--check'], { version: VERSION });
    assert.match(res.out, new RegExp(`kit ${VERSION.replace(/\./g, '\\.')} is up to date`));
  });

  test('--check reports a newer version without installing', async () => {
    const res = await run(['--check'], { version: '99.0.0' });
    assert.match(res.out, /Update available/);
    assert.match(res.out, /99\.0\.0/);
    assert.equal(res.exitCode, undefined);
  });

  test('exits non-zero when the registry cannot be reached', async () => {
    const res = await runCommand(upgradeCommand, ['--check'], { responses: { __status: 500 } });
    assert.equal(res.exitCode, 1);
    assert.match(res.err, /Could not reach the registry/);
  });

  test('mentions KIT_REGISTRY when the registry is unreachable', async () => {
    const res = await runCommand(upgradeCommand, ['--check'], { responses: { __status: 500 } });
    assert.match(res.err, /KIT_REGISTRY/);
  });

  test('says the package is unpublished on a 404, not "unreachable"', async () => {
    const res = await runCommand(upgradeCommand, ['--check'], { responses: { __status: 404 } });
    assert.equal(res.exitCode, 1);
    assert.match(res.err, /is not published to npm yet/);
    assert.doesNotMatch(res.err, /Could not reach the registry/);
  });

  test('points at the GitHub install when unpublished', async () => {
    const res = await runCommand(upgradeCommand, ['--check'], { responses: { __status: 404 } });
    assert.match(res.err, new RegExp(`npm install -g github:${REPOSITORY}`));
  });

  test('is registered with --check and --dry-run', () => {
    const cmd = upgradeCommand();
    const flags = cmd.options.map((o) => o.long);
    assert.ok(flags.includes('--check'));
    assert.ok(flags.includes('--dry-run'));
  });

  test('has a description, so the command tree test passes', () => {
    assert.ok(upgradeCommand().description());
  });
});

// ── the entrypoint ─────────────────────────────────────────────────────────

describe('bin/kit.js wiring', () => {
  const entry = readFileSync(new URL('../bin/kit.js', import.meta.url), 'utf8');

  test('prints the notice before parsing, so a process.exit cannot skip it', () => {
    assert.ok(entry.indexOf('noticeIfOutdated') < entry.indexOf('parseAsync'));
  });

  test('suppresses the notice for the upgrade command itself', () => {
    assert.match(entry, /runningUpgrade/);
    assert.match(entry, /if \(!runningUpgrade\) noticeIfOutdated\(\)/);
  });

  test('does not await the background refresh', () => {
    assert.doesNotMatch(entry, /await refreshLatestInBackground/);
  });
});

// ── the cache is keyed by package name ─────────────────────────────────────

describe('cache keyed by package name', () => {
  test('ignores a version cached under a different package name', () => {
    // This package was briefly named kit-cli, which belongs to another author on
    // npm. A cache that forgets the name keeps pointing at a stranger's release.
    config.set('updateLatestVersion', '0.0.4');
    config.set('updateLatestPackage', 'kit-cli');
    config.set('updateCheckedAt', Date.now());

    const lines = [];
    const notice = noticeIfOutdated({ write: (s) => lines.push(s), current: '0.0.1' });
    assert.equal(notice, null);
    assert.equal(lines.length, 0);
  });

  test('uses a version cached under the current package name', () => {
    config.set('updateLatestVersion', '9.9.9');
    config.set('updateLatestPackage', PACKAGE_NAME);
    config.set('updateCheckedAt', Date.now());

    const lines = [];
    assert.ok(noticeIfOutdated({ write: (s) => lines.push(s), current: '0.0.1' }));
    assert.match(lines[0], /9\.9\.9/);
  });

  test('treats a cache from another package as stale', () => {
    config.set('updateLatestPackage', 'kit-cli');
    config.set('updateCheckedAt', Date.now());
    assert.equal(cacheIsStale(Date.now()), true);
  });

  test('refetches rather than serving another package version', async () => {
    config.set('updateLatestVersion', '0.0.4');
    config.set('updateLatestPackage', 'kit-cli');
    config.set('updateCheckedAt', Date.now());

    let called = false;
    globalThis.fetch = async () => {
      called = true;
      return { ok: true, status: 200, json: async () => ({ version: '1.2.3' }) };
    };
    const r = await refreshLatest();
    assert.equal(called, true, 'a foreign cache must not be served');
    assert.equal(r.version, '1.2.3');
  });
});

// ── REPOSITORY ─────────────────────────────────────────────────────────────

describe('REPOSITORY', () => {
  test('parses owner/repo from the repository URL', () => {
    assert.equal(REPOSITORY, 'imjohnbo/kit-cli');
  });

  test('is not a second hardcoded copy of the repo name', () => {
    const body = readFileSync(new URL('../src/commands/upgrade.js', import.meta.url), 'utf8');
    assert.ok(!body.includes('imjohnbo/kit-cli'), 'upgrade.js hardcodes the repo slug');
  });
});
