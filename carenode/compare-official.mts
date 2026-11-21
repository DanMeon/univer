// Compare built tarballs with the official @univerjs/<x>@<base> tarballs from the npm registry, file by file
// (tar metadata is not compared; package.json is compared as parsed JSON).
//
//   --mode exact  layer 1: an unmodified upstream build (upstream names and version) must equal the official
//                 release in every file. Any difference fails.
//   --mode fork   layer 2: a fork build may differ from the official release only by
//                   - the fork version in place of the base version inside files (bundled plugin versions),
//                   - the content hash in the name of a shared chunk that changes because of that version string,
//                     and the same hash where other files import the chunk (pairHashedChunks),
//                   - package.json identity fields as applyForkIdentity sets them, the version, and
//                     dependencies on selected packages as npm:@danmeon/univer-<y>@<version> aliases
//                     (other workspace dependencies may only change version),
//                   - the fork notice block at the top of README.md (the rest must equal the official README),
//                   - a LICENSE equal to the workspace LICENSE where the official tarball has none (pnpm skips its
//                     LICENSE copy when a packed file is named like a license, e.g. @univerjs/protocol's license.d.ts),
//                   - lib/ files of a package whose source files differ from the upstream tag (listed in its README;
//                     reported, not failed).
//                 Anything else fails.
//
// usage: node carenode/compare-official.mts --mode exact|fork --selection <selection.json> --built <tarball dir>
//          --official <empty download dir> --report <report.json> [--version <fork version>]

import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { isDeepStrictEqual, parseArgs } from 'node:util';
import type { IIdentityManifest, IPackManifest, ISelection } from './fork.mts';
import {
    applyForkIdentity,
    DEPENDENCY_FIELDS,
    extractTarball,
    fail,
    FORK_NOTICE_END,
    FORK_NOTICE_START,
    IDENTITY_FIELDS,
    listFiles,
    log,
    parseForkVersion,
    readJson,
    run,
    writeJson,
} from './fork.mts';

type Manifest = Record<string, unknown> & IIdentityManifest & { version?: string };

interface IDifference {
    file: string;
    kind: string;
    detail?: string;
}

interface IPackageResult {
    name: string;
    official: { file: string; integrity: string };
    built: string;
    files: number;
    allowed: IDifference[];
    disallowed: IDifference[];
}

const { values } = parseArgs({
    options: {
        mode: { type: 'string' },
        selection: { type: 'string' },
        built: { type: 'string' },
        official: { type: 'string' },
        report: { type: 'string' },
        version: { type: 'string' },
    },
});
if ((values.mode !== 'exact' && values.mode !== 'fork') || !values.selection || !values.built || !values.official || !values.report) {
    fail('usage: --mode exact|fork --selection <selection.json> --built <dir> --official <dir> --report <report.json> [--version <fork version>]');
}
const mode = values.mode;
const selection = readJson<ISelection>(values.selection);
const fork = mode === 'fork' ? parseForkVersion(values.version ?? '') : undefined;
const base = fork ? fork.base : selection.version;
if (!/^\d+\.\d+\.\d+$/.test(base)) {
    fail(`layer 1 needs an unmodified upstream build; the selection is at ${base}`);
}
const built = readJson<IPackManifest>(path.join(values.built, 'packages.json'));
const selectedNames = new Set(selection.packages.map((pkg) => pkg.name));
// Run from the workspace root: the fork adds this LICENSE where the official tarball has none.
const workspaceLicense = fs.readFileSync('LICENSE');

// Official tarballs: npm pack verifies each download against the registry's dist.integrity.
const officialDir = path.resolve(values.official);
fs.mkdirSync(officialDir, { recursive: true });
if (fs.readdirSync(officialDir).length > 0) {
    fail(`${officialDir} is not empty`);
}
const specs = selection.packages.map((pkg) => `${pkg.name}@${base}`);
const downloaded = JSON.parse(run('npm', ['pack', ...specs, '--pack-destination', officialDir, '--json', '--ignore-scripts'])) as { id: string; filename: string; integrity: string }[];
const officialBySpec = new Map(downloaded.map((entry) => [entry.id, entry]));

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'carenode-compare-'));
const results: IPackageResult[] = [];

for (const pkg of selection.packages) {
    const official = officialBySpec.get(`${pkg.name}@${base}`);
    const builtEntry = built.packages.find((entry) => entry.upstreamName === pkg.name);
    if (!official || !builtEntry) {
        fail(`${pkg.name}: official tarball ${official ? 'found' : 'missing'}, built tarball ${builtEntry ? 'found' : 'missing'}`);
    }
    const officialRoot = extractTarball(path.join(officialDir, official.filename), tempRoot);
    const builtRoot = extractTarball(path.join(values.built, builtEntry.file), tempRoot);
    const result: IPackageResult = {
        name: pkg.name,
        official: { file: official.filename, integrity: official.integrity },
        built: builtEntry.file,
        files: 0,
        allowed: [],
        disallowed: [],
    };
    const sourceChanged = (pkg.changedFiles ?? []).length > 0;

    const officialFiles = listFiles(officialRoot);
    const builtFiles = listFiles(builtRoot);
    const builtSet = new Set(builtFiles);
    const officialSet = new Set(officialFiles);
    const onlyOfficial = officialFiles.filter((f) => !builtSet.has(f));
    const onlyBuilt = builtFiles.filter((f) => !officialSet.has(f));
    // A shared chunk's file name carries a hash of its content (`plugin-Cn6IfvA0.js`), so a chunk that bundles a
    // plugin version gets a new name in a fork build, and so do the chunks that import it.
    const chunks = mode === 'fork' ? pairHashedChunks(onlyOfficial, onlyBuilt) : { renames: new Map<string, string>(), hashes: [] };
    const pairedOfficial = new Set(chunks.renames.values());
    result.files = officialFiles.length + onlyBuilt.length - chunks.renames.size;
    for (const file of onlyOfficial.filter((f) => !pairedOfficial.has(f))) {
        note(result, mode === 'fork' && sourceChanged && file.startsWith('lib/'), { file, kind: 'only-in-official' });
    }
    for (const file of onlyBuilt.filter((f) => !chunks.renames.has(f))) {
        if (mode === 'fork' && file === 'LICENSE' && fs.readFileSync(path.join(builtRoot, file)).equals(workspaceLicense)) {
            result.allowed.push({ file, kind: 'license-added', detail: 'the official tarball has no LICENSE' });
            continue;
        }
        note(result, mode === 'fork' && sourceChanged && file.startsWith('lib/'), { file, kind: 'only-in-build' });
    }

    const pairs: [string, string][] = [
        ...officialFiles.filter((f) => builtSet.has(f)).map((f): [string, string] => [f, f]),
        ...[...chunks.renames].map(([builtFile, officialFile]): [string, string] => [officialFile, builtFile]),
    ];
    for (const [officialFile, builtFile] of pairs) {
        const file = officialFile === builtFile ? officialFile : `${officialFile} <- ${builtFile}`;
        const a = fs.readFileSync(path.join(officialRoot, officialFile));
        const b = fs.readFileSync(path.join(builtRoot, builtFile));
        if (officialFile === 'package.json') {
            compareManifest(result, JSON.parse(a.toString('utf8')), JSON.parse(b.toString('utf8')));
            continue;
        }
        if (a.equals(b) && officialFile === builtFile) continue;
        if (mode === 'exact') {
            result.disallowed.push({ file, kind: 'content', detail: `${a.length} vs ${b.length} bytes` });
            continue;
        }
        if (officialFile === 'README.md') {
            compareReadme(result, a.toString('utf8'), b.toString('utf8'));
            continue;
        }
        // Undo the two allowed changes and require the official bytes. latin1 maps every byte to one character,
        // so the replacement is safe in binary files too.
        let text = b.toString('latin1');
        const versionCount = text.split(fork!.version).length - 1;
        text = text.replaceAll(fork!.version, fork!.base);
        let hashCount = 0;
        for (const [builtHash, officialHash] of chunks.hashes) {
            hashCount += text.split(builtHash).length - 1;
            text = text.replaceAll(builtHash, officialHash);
        }
        if (Buffer.from(text, 'latin1').equals(a)) {
            if (versionCount > 0) result.allowed.push({ file, kind: 'version-string', detail: `${versionCount}x ${fork!.base} -> ${fork!.version}` });
            if (hashCount > 0 || officialFile !== builtFile) result.allowed.push({ file, kind: 'chunk-hash', detail: `${hashCount} chunk name(s)` });
        } else {
            note(result, sourceChanged && officialFile.startsWith('lib/'), { file, kind: 'content', detail: `${a.length} vs ${b.length} bytes` });
        }
    }
    results.push(result);
}

/**
 * Pair files that exist on one side only and differ only by the content hash in their name: same directory,
 * same stem, same extension, exactly one candidate on each side. Ambiguous names stay unpaired (and fail).
 */
function pairHashedChunks(onlyOfficial: string[], onlyBuilt: string[]): { renames: Map<string, string>; hashes: [string, string][] } {
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
    const officialGroups = group(onlyOfficial);
    const renames = new Map<string, string>();
    const hashes = new Map<string, string>();
    for (const [key, builtCandidates] of group(onlyBuilt)) {
        const officialCandidates = officialGroups.get(key) ?? [];
        if (builtCandidates.length !== 1 || officialCandidates.length !== 1) continue;
        renames.set(builtCandidates[0].file, officialCandidates[0].file);
        hashes.set(builtCandidates[0].hash, officialCandidates[0].hash);
    }
    return { renames, hashes: [...hashes] };
}

function note(result: IPackageResult, allowedAsChangedSource: boolean, difference: IDifference): void {
    if (allowedAsChangedSource) {
        result.allowed.push({ ...difference, kind: `changed-source:${difference.kind}` });
    } else {
        result.disallowed.push(difference);
    }
}

function compareReadme(result: IPackageResult, official: string, forkReadme: string): void {
    const end = `${FORK_NOTICE_END}\n\n`;
    const at = forkReadme.indexOf(end);
    if (forkReadme.startsWith(FORK_NOTICE_START) && at > 0 && forkReadme.slice(at + end.length) === official) {
        result.allowed.push({ file: 'README.md', kind: 'readme-notice' });
    } else {
        result.disallowed.push({ file: 'README.md', kind: 'content', detail: 'README is not the fork notice followed by the official README' });
    }
}

function compareManifest(result: IPackageResult, official: Manifest, builtManifest: Manifest): void {
    if (mode === 'exact') {
        if (!isDeepStrictEqual(official, builtManifest)) {
            const keys = [...new Set([...Object.keys(official), ...Object.keys(builtManifest)])]
                .filter((key) => !isDeepStrictEqual(official[key], builtManifest[key]));
            result.disallowed.push({ file: 'package.json', kind: 'manifest', detail: keys.join(', ') });
        }
        return;
    }
    const expected = structuredClone(official);
    applyForkIdentity(expected, base);
    expected.version = fork!.version;
    const changed: string[] = [];
    for (const key of [...IDENTITY_FIELDS, 'version'] as const) {
        if (!isDeepStrictEqual(expected[key], builtManifest[key])) {
            result.disallowed.push({ file: 'package.json', kind: 'manifest', detail: `${key}: ${JSON.stringify(builtManifest[key])}, expected ${JSON.stringify(expected[key])}` });
        } else if (!isDeepStrictEqual(official[key], builtManifest[key])) {
            changed.push(key);
        }
    }
    for (const field of DEPENDENCY_FIELDS) {
        const a = (official[field] ?? {}) as Record<string, string>;
        const b = (builtManifest[field] ?? {}) as Record<string, string>;
        if (!isDeepStrictEqual(Object.keys(a).sort(), Object.keys(b).sort())) {
            result.disallowed.push({ file: 'package.json', kind: 'manifest', detail: `${field} keys differ` });
            continue;
        }
        for (const [dep, spec] of Object.entries(a)) {
            if (spec === b[dep]) continue;
            if (spec === base && selectedNames.has(dep) && b[dep] === `npm:${forkNameOfSelected(dep)}@${fork!.version}`) {
                changed.push(`${field}.${dep} alias`);
            } else if (spec === base && b[dep] === fork!.version && !selectedNames.has(dep)) {
                changed.push(`${field}.${dep} version`);
            } else {
                result.disallowed.push({ file: 'package.json', kind: 'manifest', detail: `${field}.${dep}: ${b[dep]}, official ${spec}` });
            }
        }
    }
    const rest = (manifest: Manifest): Manifest => {
        const copy = { ...manifest };
        for (const key of [...IDENTITY_FIELDS, 'version', ...DEPENDENCY_FIELDS]) delete copy[key];
        return copy;
    };
    if (!isDeepStrictEqual(rest(official), rest(builtManifest))) {
        const a = rest(official);
        const b = rest(builtManifest);
        const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((key) => !isDeepStrictEqual(a[key], b[key]));
        result.disallowed.push({ file: 'package.json', kind: 'manifest', detail: `other fields: ${keys.join(', ')}` });
    }
    if (changed.length > 0) {
        result.allowed.push({ file: 'package.json', kind: 'manifest-fork-fields', detail: changed.join(', ') });
    }
}

function forkNameOfSelected(dep: string): string {
    return selection.packages.find((pkg) => pkg.name === dep)!.forkName;
}

fs.rmSync(tempRoot, { recursive: true, force: true });

const layer = mode === 'exact' ? `layer 1 (unmodified ${base} build vs official ${base})` : `layer 2 (${fork!.version} build vs official ${base})`;
const files = results.reduce((sum, r) => sum + r.files, 0);
const disallowed = results.flatMap((r) => r.disallowed.map((d) => ({ name: r.name, ...d })));
const allowedKinds = new Map<string, number>();
for (const r of results) {
    for (const a of r.allowed) {
        const kind = a.kind.startsWith('changed-source') ? 'changed-source' : a.kind;
        allowedKinds.set(kind, (allowedKinds.get(kind) ?? 0) + 1);
    }
}
writeJson(values.report, {
    mode,
    base,
    version: fork?.version ?? base,
    packages: results,
    totals: { packages: results.length, files, allowed: Object.fromEntries(allowedKinds), disallowed: disallowed.length },
});

for (const r of results) {
    for (const d of r.disallowed) log(`DIFF ${r.name} ${d.file}: ${d.kind}${d.detail ? ` (${d.detail})` : ''}`);
    for (const a of r.allowed.filter((x) => x.kind.startsWith('changed-source'))) log(`changed source ${r.name} ${a.file}: ${a.kind}`);
}
const allowedText = mode === 'fork' ? `, allowed differences ${JSON.stringify(Object.fromEntries(allowedKinds))}` : '';
log(`${layer}: ${results.length} packages, ${files} files compared${allowedText}, differences outside the allowed list: ${disallowed.length}`);
if (disallowed.length > 0) {
    process.exitCode = 1;
}
