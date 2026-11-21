#!/usr/bin/env bash
# Publish the tarballs of one fork build: a directory written by pack-packages.mts (*.tgz, packages.json in
# publish order, SHA256SUMS) — the `univer-<version>` artifact of a carenode-release.yml run.
#
#   carenode/publish.sh stage <dir>      CI only (carenode-release.yml, npm trusted publishing over OIDC):
#                                        stage every tarball that is not on the registry yet. Nothing becomes
#                                        public until a maintainer approves with 2FA (npm stage approve, or the
#                                        npm website's bulk approval).
#   carenode/publish.sh bootstrap <dir>  maintainer's machine, logged in to npm with 2FA: npm publish the tarballs
#                                        of packages that do not exist on the registry yet (trusted publishing
#                                        can only be configured for an existing package). Re-running skips
#                                        packages that exist.
#   carenode/publish.sh trust <dir>      maintainer's machine, after bootstrap: allow carenode-release.yml to
#                                        stage-publish (and only stage-publish) every package, 2 seconds apart.
#   carenode/publish.sh verify <dir>     anyone: every package of the build is public at the build's version.
set -euo pipefail

DIST_TAG=latest
WORKFLOW_FILE=carenode-release.yml
REPOSITORY=DanMeon/univer
SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"

usage() {
    sed -n '2,16p' "$SELF" >&2
    exit 2
}

[[ $# -eq 2 && -d "$2" ]] || usage
command=$1
cd "$2"

if command -v sha256sum >/dev/null; then
    sha256sum --quiet -c SHA256SUMS
else
    shasum -a 256 --quiet -c SHA256SUMS
fi

# "<name> <version> <file>" per package, in publish order (dependencies first).
packages=$(node -e '
const m = JSON.parse(require("fs").readFileSync("packages.json", "utf8"));
for (const p of m.packages) console.log(`${p.name} ${p.version} ${p.file}`);
')

has_version() {
    [[ "$(npm view "$1@$2" version 2>/dev/null)" == "$2" ]]
}

has_package() {
    npm view "$1" name >/dev/null 2>&1
}

case "$command" in
    stage)
        [[ "${GITHUB_ACTIONS:-}" == "true" ]] || { echo "stage runs in carenode-release.yml only" >&2; exit 1; }
        staged=0
        while read -r -u 3 name version file; do
            if has_version "$name" "$version"; then
                echo "skip $name@$version: already public"
                continue
            fi
            echo "stage $name@$version"
            npm stage publish "./$file" --access public --provenance --tag "$DIST_TAG"
            staged=$((staged + 1))
        done 3<<<"$packages"
        echo "staged $staged package(s); approve them on npm with 2FA to publish"
        ;;
    bootstrap)
        [[ -z "${CI:-}" ]] || { echo "bootstrap runs on a maintainer's machine, not in CI" >&2; exit 1; }
        echo "npm user: $(npm whoami)"
        published=0
        while read -r -u 3 name version file; do
            if has_package "$name"; then
                echo "skip $name: exists on the registry (later versions go through CI staging)"
                continue
            fi
            echo "publish $name@$version"
            npm publish "./$file" --access public --tag "$DIST_TAG"
            published=$((published + 1))
        done 3<<<"$packages"
        echo "published $published package(s)"
        ;;
    trust)
        [[ -z "${CI:-}" ]] || { echo "trust runs on a maintainer's machine, not in CI" >&2; exit 1; }
        failed=()
        while read -r -u 3 name _version _file; do
            echo "trust $name -> $REPOSITORY $WORKFLOW_FILE (stage publish only)"
            if ! npm trust github "$name" --file "$WORKFLOW_FILE" --repository "$REPOSITORY" --allow-stage-publish --yes; then
                failed+=("$name")
            fi
            sleep 2
        done 3<<<"$packages"
        if [[ ${#failed[@]} -gt 0 ]]; then
            echo "trust failed for: ${failed[*]}" >&2
            exit 1
        fi
        ;;
    verify)
        missing=()
        count=0
        while read -r -u 3 name version _file; do
            count=$((count + 1))
            if has_version "$name" "$version"; then
                echo "ok $name@$version"
            else
                echo "missing $name@$version"
                missing+=("$name@$version")
            fi
        done 3<<<"$packages"
        echo "verify: $((count - ${#missing[@]}))/$count public"
        [[ ${#missing[@]} -eq 0 ]]
        ;;
    *)
        usage
        ;;
esac
