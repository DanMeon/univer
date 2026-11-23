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
  fix, the comparison baseline: it is kept as the tag and the `univer-<version>` artifact of the tag's workflow run,
  and is not published (only `1.5.2-carenode.0` was, by hand, to create the package names on npm). Each release with
  fixes raises `N`. The version is a prerelease, so it never satisfies a `^<upstream>` range: consumers pin the exact
  version.
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
   `compare-official.mts` (and a preset's stylesheet, see below);
3. for `N >= 1`, previous release — `compare-previous.mts` compares the build file by file with the previous release
   `<base>-carenode.<N-1>`: besides the version, chunk names and the README notice, built code may differ only in the
   modules (and declaration files) of source files changed since tag `v<base>-carenode.<N-1>`; derived files (import
   and export blocks, the UMD bundle) may differ only in such a package, and the declaration of an unchanged file only
   where its inferred type names another import and one of the two comes from a changed file; the Tailwind CSS only
   where a `.ts` or `.tsx` source file of the package changed, and a preset's stylesheet as below. Anything else fails
   the run. For `N >= 2` the previous release is downloaded from npm (`--download`) and must be public. For `N = 1` it
   is the unpublished baseline `<base>-carenode.0`: the job takes the `univer-<base>-carenode.0` artifact of the latest
   successful run of this workflow on tag `v<base>-carenode.0` at the tag's commit (the tag push, or a manual run on
   the tag ref), checks its `SHA256SUMS` and compares with it (`--previous <dir>` without `--download`). With no such
   run or artifact (artifacts expire after 90 days) the job fails;
   `gh workflow run carenode-release.yml --ref v<base>-carenode.0 -f version=<base>-carenode.0` builds it again;
4. for `N >= 1`, once steps 1 to 3 pass, stage the tarballs on npm through trusted publishing (`publish.sh stage`).
   Nothing is public until a maintainer approves the staged versions with 2FA. `N = 0` only leaves the tarballs as
   the run's `univer-<version>` artifact, the baseline that step 3 of `N = 1` compares with.

A preset (`univer-cli preset build`, e.g. `@univerjs/preset-sheets-core`) has no stylesheet source of its own: its
`lib/index.css` is the built `lib/index.css` of its style dependencies, joined — its `@univerjs*` dependencies that
have a `src/global.css` (`common/shared/preset-build/style.ts`). So a fix in one of them changes the preset's
stylesheet too. Such a `lib/index.css` may differ when, in both builds, it is that join, and every style dependency
whose stylesheet differs has a changed stylesheet input (a `.js`, `.ts`, `.jsx`, `.tsx` or `.css` file under its
`src`; `styleDependencyChanges` in `fork.mts`). Layer 2 applies this where the package's own source does not differ
from the upstream tag (otherwise its `lib/` may differ anyway) and reports it as `style-dependency:content`. Step 3
applies it, with changes since the previous tag, to every stylesheet that is such a join, whatever the package's own
source did — a joined stylesheet reads none of it — and lists it as `style dependency` with the dependency and its
files; only a stylesheet that is not a join falls back to the `.ts`/`.tsx` rule (`previousStylesheetVerdict` in
`fork.mts`). A style dependency is a production dependency, so it is always selected; one installed from the registry
(`@univerjs/icons`) is not built here and has no `src/global.css`.

A manual run (`workflow_dispatch` with a version) does steps 1 to 3 (step 3 for `N >= 1`) and never stages. On a
maintainer's machine, `compare-previous.mts --previous <dir>` without `--download` compares with any downloaded
`univer-<version>` artifact, e.g. before the previous release is public.

## Publishing by hand

`publish.sh bootstrap <dir>` publishes, from a maintainer's machine, the packages that do not exist on npm yet (trusted
publishing can only be set up for an existing package); `publish.sh trust <dir>` then lets this workflow stage-publish
them; `publish.sh verify <dir>` checks that a build is public. `<dir>` is a downloaded `univer-<version>` artifact.

## Upstream workflows

The upstream workflows are kept as files and disabled in this repository; they also only run in `dream-num/univer`.
