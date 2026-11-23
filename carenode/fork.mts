// Carenode fork tooling: the identity of a fork build and the helpers every script in carenode/ shares.
// See carenode/README.md for the build flow.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

export const FORK_REPOSITORY = 'DanMeon/univer';
export const FORK_REPOSITORY_URL = `https://github.com/${FORK_REPOSITORY}`;
export const UPSTREAM_REPOSITORY_URL = 'https://github.com/dream-num/univer';
export const UPSTREAM_SCOPE = '@univerjs/';
export const FORK_NAME_PREFIX = '@danmeon/univer-';
export const FORK_KEYWORD = 'carenode-fork';
export const FORK_NOTICE_START = '<!-- carenode-fork-notice -->';
export const FORK_NOTICE_END = '<!-- /carenode-fork-notice -->';
export const DEPENDENCY_FIELDS = ['dependencies', 'peerDependencies', 'optionalDependencies', 'devDependencies'] as const;
export const TOOLS_DIR = import.meta.dirname;

export interface IForkVersion {
    /** Full fork version, e.g. `1.5.2-carenode.0`. */
    version: string;
    /** Upstream release the build is based on, e.g. `1.5.2`. */
    base: string;
    /** Carenode build number N; 0 is the upstream source without changes. */
    build: number;
    /** Upstream git tag of the base, e.g. `v1.5.2`. */
    baseTag: string;
}

export function parseForkVersion(version: string): IForkVersion {
    const match = /^(\d+\.\d+\.\d+)-carenode\.(0|[1-9]\d*)$/.exec(version);
    if (!match) {
        throw new Error(`"${version}" is not a fork version; expected <upstream version>-carenode.<N>, e.g. 1.5.2-carenode.0`);
    }
    return { version, base: match[1], build: Number(match[2]), baseTag: `v${match[1]}` };
}

/** The manifest fields that carry the package identity; the fork changes exactly these (plus `version`). */
export const IDENTITY_FIELDS = ['name', 'description', 'repository', 'homepage', 'bugs', 'keywords'] as const;

export interface IIdentityManifest {
    name?: string;
    description?: string;
    repository?: string | { type?: string; url?: string; directory?: string };
    homepage?: string;
    bugs?: string | { url?: string; email?: string };
    keywords?: string[];
}

/**
 * Give an upstream manifest the fork identity, in place: fork name, an "Unofficial" description that keeps
 * the upstream one, the fork repository for repository/homepage/bugs (npm trusted publishing requires
 * repository.url to be the publishing repository; the fork has no issue tracker, so bugs points at the
 * repository), and the fork keyword. `name` must still be the upstream name.
 */
export function applyForkIdentity(manifest: IIdentityManifest, base: string): void {
    const upstreamName = manifest.name ?? '';
    manifest.name = forkNameOf(upstreamName);
    const notice = `Unofficial Carenode fork of ${upstreamName} ${base} (Univer by DreamNum), not an official Univer release.`;
    manifest.description = manifest.description ? `${notice} ${manifest.description}` : notice;
    const repository = typeof manifest.repository === 'object' ? manifest.repository : { type: 'git' };
    manifest.repository = { ...repository, url: FORK_REPOSITORY_URL };
    manifest.homepage = FORK_REPOSITORY_URL;
    manifest.bugs = { url: FORK_REPOSITORY_URL };
    manifest.keywords = [...(manifest.keywords ?? []).filter((keyword) => keyword !== FORK_KEYWORD), FORK_KEYWORD];
}

export function forkNameOf(upstreamName: string): string {
    if (!upstreamName.startsWith(UPSTREAM_SCOPE)) {
        throw new Error(`${upstreamName} is not an ${UPSTREAM_SCOPE} package`);
    }
    return FORK_NAME_PREFIX + upstreamName.slice(UPSTREAM_SCOPE.length);
}

export interface ISelectedPackage {
    /** Upstream name, e.g. `@univerjs/core`. */
    name: string;
    /** Published fork name, e.g. `@danmeon/univer-core`. */
    forkName: string;
    /** Package directory relative to the workspace root. */
    dir: string;
    /** Upstream source files changed under `<dir>/src` (filled in by rename-packages). */
    changedFiles?: string[];
}

export interface ISelection {
    /** Workspace version when the selection was made. */
    version: string;
    /** Packages in publish order: every package comes after the selected packages it depends on. */
    packages: ISelectedPackage[];
}

export interface IPackedPackage {
    /** Upstream name the tarball was built from. */
    upstreamName: string;
    /** Name inside the tarball. */
    name: string;
    version: string;
    file: string;
    integrity: string;
    sha256: string;
}

export interface IPackManifest {
    version: string;
    commit: string;
    /** In publish order. */
    packages: IPackedPackage[];
}

export function readJson<T>(file: string): T {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
}

export function writeJson(file: string, data: unknown, indent = 2): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(data, null, indent)}\n`);
}

/** Lines of a list file, without blank lines and `#` comments. */
export function readList(file: string): string[] {
    return fs.readFileSync(file, 'utf8')
        .split('\n')
        .map((line) => line.replace(/#.*/, '').trim())
        .filter(Boolean);
}

/** Run a command and return its stdout; stderr goes to the job log. Throws on a non-zero exit. */
export function run(command: string, args: string[], cwd = process.cwd()): string {
    return execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 256 * 1024 * 1024 });
}

/** Extract a package tarball into a fresh temporary directory and return its `package/` root. */
export function extractTarball(file: string, tempRoot: string): string {
    const dir = fs.mkdtempSync(path.join(tempRoot, 'tgz-'));
    run('tar', ['-xzf', path.resolve(file), '-C', dir]);
    const root = path.join(dir, 'package');
    if (!fs.existsSync(root)) {
        throw new Error(`${file} has no package/ directory`);
    }
    return root;
}

/** Regular files under `dir`, as sorted paths relative to it. */
export function listFiles(dir: string): string[] {
    return (fs.readdirSync(dir, { recursive: true, withFileTypes: true }) as fs.Dirent[])
        .filter((entry) => entry.isFile())
        .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)))
        .sort();
}

/**
 * Whether a changed file under a package's `src` is a test (a `__tests__` directory, `*.spec.*`, `*.test.*`). Tests are
 * not built into the tarball, so they are not listed as the package's changed source and do not count as a source
 * change when tarballs are compared.
 */
export function isTestSource(file: string): boolean {
    return /(?:^|\/)__tests__\//.test(file) || /\.(?:spec|test)\.[cm]?[jt]sx?$/.test(file);
}

/** The stylesheet a package ships: tsdown writes the CSS a package imports there, a preset build its joined stylesheet. */
export const STYLESHEET = 'lib/index.css';

/**
 * Whether a source file, relative to its package, is an input of the package's stylesheet: a .js, .ts, .jsx or .tsx
 * file under src, which the Tailwind content scans (SOURCE_CONTENT in common/shared/tailwind/tailwind.config.ts), or a
 * stylesheet under src (src/global.css, the entry each package imports).
 */
export function isStylesheetInput(file: string): boolean {
    return /^src\/.+\.(?:jsx?|tsx?|css)$/.test(file);
}

/**
 * The style dependencies of the selected package `pkg`, in manifest order: its `dependencies` named `@univerjs*` whose
 * package has a src/global.css. A preset (`univer-cli preset build`) has no stylesheet source of its own: it ships as
 * lib/index.css the built stylesheets of these packages, joined (joinStylesheets). Upstream owns the rule:
 * getBuiltStyleDependencyCssFiles in common/shared/preset-build/style.ts, which writes the file (createTailwindContent in
 * common/shared/tailwind/tailwind.config.ts picks the same packages for a preset's Tailwind content, which does not make
 * the shipped file). Upstream looks each dependency up in the package's node_modules; this takes its workspace directory
 * from the selection, so it needs no install (the previous-release job of carenode-release.yml has none). A workspace
 * dependency of a selected package is always selected (select-packages.mts selects the production closure), so one
 * outside the selection throws. A dependency installed from the registry (@univerjs/icons) is not built here and is left
 * out: none ships a src/global.css, and if one did, the stylesheet would not be the join and the comparison would fail.
 * Run from the workspace root.
 */
export function styleDependenciesOf(pkg: ISelectedPackage, selection: ISelection): ISelectedPackage[] {
    const manifest = readJson<{ dependencies?: Record<string, string> }>(path.join(pkg.dir, 'package.json'));
    const selected = new Map(selection.packages.map((entry) => [entry.name, entry]));
    return Object.entries(manifest.dependencies ?? {}).flatMap(([name, spec]) => {
        if (!name.startsWith('@univerjs')) return [];
        const dependency = selected.get(name);
        if (!dependency) {
            if (spec.startsWith('workspace:')) {
                throw new Error(`${pkg.name} depends on the workspace package ${name}, which is not in the selection`);
            }
            return [];
        }
        return fs.existsSync(path.join(dependency.dir, 'src/global.css')) ? [dependency] : [];
    });
}

/** A preset's lib/index.css from its style dependencies' stylesheets, as writePresetCss in common/shared/preset-build/style.ts writes it. */
function joinStylesheets(parts: string[]): string {
    return `${parts.map((part) => part.trimEnd()).filter(Boolean).join('\n')}\n`;
}

/**
 * Whether the stylesheet of the selected package `pkg` is joined from the stylesheets of its style dependencies
 * (styleDependenciesOf), and if so whether its difference between two builds is theirs. `joined`: in each build it is
 * the join of theirs in that build, as a preset build writes it. `allowed`: it is joined, and each style dependency whose
 * stylesheet differs has a changed stylesheet input (isStylesheetInput); that dependency's own stylesheet is compared in
 * its own package.
 *   roots(name)             the extracted `package/` roots of a selected package in the two builds
 *   changedSource(package)  the changed source files of a selected package, relative to its directory
 * `detail` names the style dependencies whose stylesheet differs and their changed inputs, or says why the difference
 * is not theirs.
 */
export function styleDependencyChanges(
    pkg: ISelectedPackage,
    selection: ISelection,
    roots: (name: string) => readonly [string, string],
    changedSource: (dependency: ISelectedPackage) => string[]
): { joined: boolean; allowed: boolean; detail: string } {
    const dependencies = styleDependenciesOf(pkg, selection);
    if (dependencies.length === 0) {
        return { joined: false, allowed: false, detail: `${STYLESHEET} is not joined from style dependencies (the package has none)` };
    }
    const stylesheets = (name: string): (string | undefined)[] => roots(name).map((root) => {
        const file = path.join(root, STYLESHEET);
        return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : undefined;
    });
    const own = stylesheets(pkg.name);
    const parts = dependencies.map((dependency) => stylesheets(dependency.name));
    for (const side of [0, 1]) {
        const present = parts.map((pair) => pair[side]).filter((part): part is string => part !== undefined);
        if (own[side] === undefined || present.length < parts.length || own[side] !== joinStylesheets(present)) {
            const names = dependencies.map((dependency) => dependency.name).join(', ');
            return { joined: false, allowed: false, detail: `${STYLESHEET} is not the join of the stylesheets of its style dependencies (${names}) in one of the two builds` };
        }
    }
    const changed: string[] = [];
    for (const [index, dependency] of dependencies.entries()) {
        if (parts[index][0] === parts[index][1]) continue;
        const files = changedSource(dependency).filter(isStylesheetInput);
        if (files.length === 0) {
            return { joined: true, allowed: false, detail: `${STYLESHEET} is joined from the stylesheets of its style dependencies; the stylesheet of ${dependency.name} differs, but no stylesheet input of ${dependency.name} changed` };
        }
        changed.push(`${dependency.name} (${files.join(', ')})`);
    }
    if (changed.length === 0) {
        return { joined: true, allowed: false, detail: `${STYLESHEET} is joined from the stylesheets of its style dependencies, and none of them differs` };
    }
    return { joined: true, allowed: true, detail: `joined from the stylesheets of its style dependencies; changed in ${changed.join('; ')}` };
}

/**
 * The verdict of compare-previous.mts on a difference in a stylesheet (a .css file) of the selected package `pkg` between
 * the previous release and this build, in this order:
 *   1. lib/index.css joined from the stylesheets of its style dependencies (styleDependencyChanges): only their rule
 *      decides, whatever the package's own source did, since a joined stylesheet reads none of it
 *      (`style-dependency`, or `failed`);
 *   2. any other stylesheet is generated from the package's source: it may differ when a .ts or .tsx source file of the
 *      package changed (`derived`);
 *   3. anything else fails, naming both reasons.
 *   roots(name)             the extracted `package/` roots of a selected package in the previous and this build
 *   changedSource(package)  the source files of a selected package changed since the previous release, relative to its
 *                           directory, tests excluded
 */
export function previousStylesheetVerdict(
    file: string,
    pkg: ISelectedPackage,
    selection: ISelection,
    roots: (name: string) => readonly [string, string],
    changedSource: (dependency: ISelectedPackage) => string[]
): { kind: 'style-dependency' | 'derived' | 'failed'; detail: string } {
    const dependencies = file === STYLESHEET ? styleDependencyChanges(pkg, selection, roots, changedSource) : undefined;
    if (dependencies?.joined) {
        return { kind: dependencies.allowed ? 'style-dependency' : 'failed', detail: dependencies.detail };
    }
    if (changedSource(pkg).some((source) => /\.tsx?$/.test(source))) {
        return { kind: 'derived', detail: 'stylesheet generated from the source' };
    }
    const noSource = 'no .ts or .tsx source file of the package changed since the previous release';
    return { kind: 'failed', detail: dependencies ? `${noSource}, and ${dependencies.detail}` : noSource };
}

/**
 * Pair files that exist on one side only and differ only by the content hash in their name: same directory,
 * same stem, same extension, exactly one candidate on each side. Ambiguous names stay unpaired (and fail).
 * `renames` maps the `b` file to its `a` file, `hashes` the `b` hash to the `a` hash.
 */
export function pairHashedChunks(onlyA: string[], onlyB: string[]): { renames: Map<string, string>; hashes: [string, string][] } {
    const pattern = /^(.*)-([\w-]{8})(\.[a-z.]+)$/;
    const group = (files: string[]): Map<string, { file: string; hash: string }[]> => {
        const groups = new Map<string, { file: string; hash: string }[]>();
        for (const file of files) {
            const match = pattern.exec(file);
            if (!match) continue;
            const key = `${match[1]}${match[3]}`;
            groups.set(key, [...(groups.get(key) ?? []), { file, hash: match[2] }]);
        }
        return groups;
    };
    const groupsA = group(onlyA);
    const renames = new Map<string, string>();
    const hashes = new Map<string, string>();
    for (const [key, candidatesB] of group(onlyB)) {
        const candidatesA = groupsA.get(key) ?? [];
        if (candidatesB.length !== 1 || candidatesA.length !== 1) continue;
        renames.set(candidatesB[0].file, candidatesA[0].file);
        hashes.set(candidatesB[0].hash, candidatesA[0].hash);
    }
    return { renames, hashes: [...hashes] };
}

/** Print one line of tool output to stdout (the job log). */
export function log(line: string): void {
    process.stdout.write(`${line}\n`);
}

export function fail(message: string): never {
    console.error(`error: ${message}`);
    process.exit(1);
}
