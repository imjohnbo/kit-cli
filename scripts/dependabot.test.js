/**
 * .github/workflows/release.yml pins every action to a commit SHA and relies
 * on Dependabot to move those pins. Without a Dependabot config the pins rot
 * silently, so this holds the config to the two ecosystems the repo uses.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

describe('.github/dependabot.yml', () => {
  const read = () => readFileSync(new URL('../.github/dependabot.yml', import.meta.url), 'utf8');

  test('updates the SHA-pinned GitHub Actions', () => {
    assert.match(read(), /package-ecosystem:\s*["']?github-actions["']?/);
  });

  test('updates the npm dependencies', () => {
    assert.match(read(), /package-ecosystem:\s*["']?npm["']?/);
  });
});
