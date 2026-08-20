# Releasing kit-cli

## What makes a release publish to npm

A pushed version tag starts the workflow. A manual approval finishes it. Nothing
else publishes.

```
npm version patch          # or minor, or major
git push --follow-tags
```

`npm version` bumps `package.json`, makes a commit, and creates the `v1.0.1`
tag. The `--follow-tags` push sends the tag, and the tag starts
`.github/workflows/release.yml`.

The workflow has three jobs. The first two run on their own. The third waits for
a person.

| Job | Runs | Stops the release when |
|---|---|---|
| `verify` | Node 18, 20, 22 | A test fails |
| `verify-package` | Once | The tag, the version, or the tarball is wrong |
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

## How a user verifies a release

Three independent checks. Each answers a different question.

**Did this package come from this repository?** npm provenance answers this. It
links the tarball to the workflow run and the commit.

```
npm audit signatures
```

**Is the release asset the same artifact?** The GitHub attestation answers this.

```
gh attestation verify kit-cli-1.0.1.tgz --repo imjohnbo/kit-cli
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
3. Run `npm version patch`, `npm version minor`, or `npm version major`.
4. Run `git push --follow-tags`.
5. Watch the `verify` and `verify-package` jobs.
6. Approve the `npm-publish` environment.
7. Check that `npm view kit-cli version` reports the new version.
8. Run `npm audit signatures` in a scratch install as a smoke test.

## Where the version comes from

`package.json` holds the version. `src/version.js` reads it at run time.
`src/program.js` passes it to commander.

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
npm deprecate kit-cli@1.0.1 "Broken release. Use 1.0.2."
```

Then move the `latest` tag if it still points at the bad version:

```
npm dist-tag add kit-cli@1.0.2 latest
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
