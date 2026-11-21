# Carenode fork of Univer

This repository is an unofficial fork of [dream-num/univer](https://github.com/dream-num/univer), kept by Carenode to
ship a small set of fixes on top of an upstream release. It is not an official Univer release and DreamNum does not
support it. Everything here is Apache-2.0, like upstream.

The Carenode side of this fork (why it exists, which fixes it carries, how Carenode installs it) is documented in the
Carenode repository at `apps/xlsxkit/docs/univer-fork.md`.

## Branches, tags and versions

- `carenode/v<upstream>` (e.g. `carenode/v1.5.2`) is the upstream tag `v<upstream>` plus commits: first the tooling
  commits (this folder and `.github/workflows/carenode-release.yml`), then one commit per Carenode fix. Upstream files
  are otherwise untouched, so the branch rebases onto the next upstream tag with few conflicts. A changed source file
  carries a `Modified by Carenode, <year> — <what>` header line.
- Tag `v<upstream>-carenode.<N>` releases version `<upstream>-carenode.<N>`. `N = 0` is the upstream source with no
  fix (the comparison baseline and the first publication of the package names); each release with fixes raises `N`.
  The version is a prerelease, so it never satisfies a `^<upstream>` range: consumers pin the exact version.
- Packages are published as `@danmeon/univer-<x>` for upstream `@univerjs/<x>`. Inside them, a dependency on another
  forked package keeps its upstream key as an alias: `"@univerjs/core": "npm:@danmeon/univer-core@1.5.2-carenode.1"`.

## What gets published

`direct-packages.txt` lists the Univer packages Carenode declares; `select-packages.mts` publishes their production
dependency closure, which must equal `closure-packages.txt` (33 packages for 1.5.2). `@univerjs/icons` comes from
another repository and is not forked. `@univerjs/presets` is never published.

## The release workflow (`carenode-release.yml`)

Pushing a `v*-carenode.*` tag runs, on the runner and toolchain of upstream's `release-npm.yml`:

1. layer 1 — build the upstream tag unmodified, pack the selected packages, and compare every file with the official
   `@univerjs/<x>@<upstream>` tarballs (`compare-official.mts --mode exact`); any difference fails;
2. fork build — `set-version.mts` (version into every workspace package, before the build bakes it into the
   bundles), install, build, `select-packages.mts`, `rename-packages.mts` (after the build; the README notice lists
   the changed source files, tests excluded since they are not packed), `pack-packages.mts`, `check-packs.mts`, and
   layer 2 — compare with the official tarballs, allowing only the differences listed at the top of
   `compare-official.mts`;
3. for `N >= 1`, previous release — `compare-previous.mts` downloads `<base>-carenode.<N-1>` from npm and compares
   the build with it file by file: besides the version, chunk names and the README notice, built code may differ
   only in the modules (and declaration files) of source files changed since tag `v<base>-carenode.<N-1>`; derived
   files (import and export blocks, the UMD bundle, the Tailwind CSS) may differ only in such a package. Anything
   else fails the run. The previous release must be public;
4. for `N >= 1`, once steps 1 to 3 pass, stage the tarballs on npm through trusted publishing (`publish.sh stage`).
   Nothing is public until a maintainer approves the staged versions with 2FA. `N = 0` only leaves the tarballs as
   the run's `univer-<version>` artifact.

A manual run (`workflow_dispatch` with a version) does steps 1 to 3 (step 3 for `N >= 1`) and never stages.
`compare-previous.mts --previous <dir>` without `--download` compares with a downloaded `univer-<version>` artifact
instead, for a check on a maintainer's machine before the previous release is public.

## Publishing by hand

`publish.sh bootstrap <dir>` publishes, from a maintainer's machine, the packages that do not exist on npm yet (trusted
publishing can only be set up for an existing package); `publish.sh trust <dir>` then lets this workflow stage-publish
them; `publish.sh verify <dir>` checks that a build is public. `<dir>` is a downloaded `univer-<version>` artifact.

## Upstream workflows

The upstream workflows are kept as files and disabled in this repository; they also only run in `dream-num/univer`.
