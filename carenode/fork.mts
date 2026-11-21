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
