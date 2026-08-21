# Releasing kit-cli

## Blocker: the npm name is taken

`kit-cli` on npm belongs to another author. It has existed since 2015 and sits at
version 0.0.4. Publishing under that name is not possible.

Pick a name before the first release. These were free at the time of writing:

| Name | Note |
|---|---|
| `@kit/cli` | Best branding. Needs the `kit` npm organization. |
| `@imjohnbo/kit-cli` | Personal scope. Available now, no organization needed. |
| `kit-api-cli` | Unscoped fallback. |

Change `name` in `package.json` and nothing else. `src/package-info.js` reads it,
so the update check and `kit upgrade` follow automatically. The installed command
stays `kit` either way, because `bin` sets that name separately.

A scoped package needs `publishConfig.access` set to `public`, which is already
set.

## What makes a release publish to npm

A pushed version tag starts the workflow. A manual approval finishes it. Nothing
else publishes.

```
npm version patch          # or minor, or major
git push --follow-tags
```

`npm version` bumps `package.json`, makes a commit, and creates the tag. The
`--follow-tags` push sends the tag, and the tag starts
`.github/workflows/release.yml`.

The project starts at `0.0.1`. It is pre-release, so treat the surface as
unstable and expect breaking changes in minor bumps until `1.0.0`.

A prerelease tag such as `v0.1.0-rc.1` also triggers the workflow. It publishes
under the `next` dist-tag rather than `latest`, so `kit upgrade` does not move
users onto it.

The workflow has three jobs. The first two run on their own. The third waits for
a person.

| Job | Runs | Stops the release when |
|---|---|---|
| `verify` | Node 18, 20, 22 | A test fails |
| `verify-package` | Once | The version breaks a semver rule, or the tarball does not match the source |
| `publish` | After approval | The repacked tarball differs from the verified one |

The `publish` job targets the `npm-publish` environment. Add a required reviewer
to that environment. A person then has to approve every release. A pushed tag on
its own cannot ship anything.

## One-time setup

1. Create a GitHub environment named `npm-publish`. Add yourself as a required
   reviewer.
2. Set up npm trusted publishing for the `kit-cli` package. Point it at this
   repository and at `release.yml`. The workflow then publishes with the OIDC
   token and needs no npm token.
3. If you skip step 2, create an npm automation token instead. Store it in the
   `npm-publish` environment as the `NPM_TOKEN` secret. The workflow reads either
   one.

`package.json` sets `publishConfig.provenance` to `true`. A local `npm publish`
therefore fails, because provenance needs a CI identity. This is deliberate. It
stops an unattested build from reaching the registry.

## How semantic versioning is enforced

`npm run check:semver` runs four checks. CI runs the same script on every tagged
release.

1. **The version is valid semver.** A syntax check.
2. **The tag matches `package.json`.** A `v0.1.0` tag cannot ship `0.0.9`.
3. **The version is newer than what npm serves.** This blocks a re-publish and
   blocks going backwards.
4. **A breaking change carries a big enough bump.** This is the only check that
   enforces the *meaning* of a version.

Check 4 needs a machine-readable definition of the public surface. For a library
that would be the exported symbols. For a CLI it is the command tree: the
commands, their arguments, and their flags. Removing or renaming any of those
breaks somebody's script. Adding one does not.

`spec/cli-surface.json` holds that surface. Regenerate it with:

```
npm run surface
```

A test asserts the committed snapshot matches the current tree, so a surface
change has to be committed on purpose and shows up in review. On release, the
gate reads the snapshot from the previous tag, compares it to the one being
released, and classifies the difference.

| Surface change | Smallest allowed bump below 1.0.0 | From 1.0.0 on |
|---|---|---|
| A command or flag was removed or renamed | minor | major |
| A required argument was added | minor | major |
| An argument became required | minor | major |
| A command or flag was added | minor | minor |
| Nothing changed | patch | patch |

While the major version is 0, a breaking change needs a minor bump rather than a
major one. Semver leaves 0.x unstable, but npm's caret range treats minor as the
breaking axis below 1.0.0, and the ecosystem reads it that way.

Prereleases skip check 4. They exist to ship an unstable surface.

### What this cannot catch

The gate sees the shape of the command tree. It does not see behavior. A flag
that keeps its name and changes its meaning, an output format that changes, or an
exit code that changes will all pass. Those still need a human to notice and to
bump accordingly.

## How a user verifies a release

Three independent checks. Each answers a different question.

**Did this package come from this repository?** npm provenance answers this. It
links the tarball to the workflow run and the commit.

```
npm audit signatures
```

**Is the release asset the same artifact?** The GitHub attestation answers this.

```
gh attestation verify <tarball> --repo imjohnbo/kit-cli
```

**Does the package contain the source, and nothing else?** The
`verify-package` job answers this, and it is the check that matters most.

npm provenance proves where a tarball was built. It does not prove that the
tarball matches the source. A workflow step between checkout and publish could
change a file and still produce valid provenance.

kit-cli has no build step and no devDependencies. The published tarball is the
source. So CI proves it directly: pack the tree, unpack the tarball, and diff the
two. The release stops if they differ.

Keep it that way. A build step, a generated file, or a code-generation step would
end this guarantee. If you ever need one, publish the generated file to the
repository as well, so the diff still holds.

## Release checklist

1. Merge the work. Make sure `main` is green.
2. Run `npm test` locally.
3. Run `npm run surface`. Commit the result if it changed.
4. Run `npm run check:semver` to see how the gate reads the change.
5. Run `npm version patch`, `npm version minor`, or `npm version major`.
6. Run `git push --follow-tags`.
7. Watch the `verify` and `verify-package` jobs.
8. Approve the `npm-publish` environment.
9. Check that `npm view <name> version` reports the new version.
10. Run `npm audit signatures` in a scratch install as a smoke test.

## Where the version comes from

`package.json` holds the version. `src/package-info.js` reads it at run time.
`src/program.js` passes it to commander. The same module reads the package name,
so renaming the package is a single edit.

Do not add a second copy. Two tests guard this:

- `scripts/upgrade.test.js` asserts that no file in `src/` hardcodes the version.
- `scripts/spec-coverage.test.js` asserts that `kit --version` matches
  `package.json`.

`verify-package` repeats the second check in CI, so a mismatched tag can never
publish.

## If a release goes wrong

Do not delete a published npm version. Unpublishing breaks anyone who already
installed it, and npm blocks republishing the same version number.

Publish a patch release instead. If the bad version must stop reaching new
users, deprecate it:

```
npm deprecate <name>@0.0.2 "Broken release. Use 0.0.3."
```

Then move the `latest` tag if it still points at the bad version:

```
npm dist-tag add <name>@0.0.3 latest
```

## Update notices in the CLI

`kit upgrade` hands the work to the package manager that installed the CLI. It
does not download or unpack a release itself. The manager already verifies
tarball integrity and provenance. A hand-rolled updater would replace that with
unaudited code.

The passive notice reads a cached version number from config. It never blocks a
command and never fails one. A background request refreshes the cache at most
once a day. The notice goes to stderr, so `--format json` output stays parseable.

Users turn it off in two ways:

```
kit config set-update-check false
export KIT_NO_UPDATE_CHECK=1
```

The check also stays off when `CI` is set, so pipelines make no outbound request.

## Action pinning

Every action is pinned to a commit SHA, with the version in a trailing comment:

```yaml
- uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
```

A tag is mutable. `@v7` is a promise from the action's owner, not a guarantee, so
a compromised or retagged release would flow straight into a job that holds
`id-token: write`. A SHA cannot move.

Check for updates with `gh api repos/actions/checkout/releases/latest`, or let
Dependabot raise the pull request. Dependabot reads the version comment and keeps
it in step with the SHA.
