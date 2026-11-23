// Compare a fork build <base>-carenode.<N> (N >= 1) with the previous fork release <base>-carenode.<N-1>, file by
// file, before the build is staged on npm. The two may differ only by
//   - the version string inside files (<N-1> -> <N>), and the content hash in the name of a chunk file plus the same
//     hash where other files import it (pairHashedChunks),
//   - package.json fields once the version strings are swapped back (the version and the alias versions),
//   - the fork notice block at the top of README.md (the rest must be equal),
//   - in a package whose shipped source changed between the two release tags (`git diff --name-only <previous tag> HEAD
//     -- <dir>/src`, tests excluded): the code those files build to. A bundle with module markers (`// src/<path>`,
//     lib/es, lib/cjs, lib/index.js, facades, locales) is cut into one section per module; a section may differ only
//     when its module is one of the changed files. Identifier suffixes the bundler adds to avoid name clashes
//     (`name$1`) are ignored, because a new name in a changed module can renumber them elsewhere. A declaration file
//     lib/types/<path>.d.ts may differ only when src/<path>.ts(x) changed. Derived files - the import block before the
//     first module, the export block after the last, and a bundle without module markers (UMD) - may differ only in
//     such a package, and are listed. So is the declaration of an unchanged source file that only names another of
//     its imports where one of the two comes from a changed file (changedImportBehind),
//   - a stylesheet, decided in this order (previousStylesheetVerdict in fork.mts): lib/index.css that in both builds is
//     the join of the stylesheets of its style dependencies (a preset, `univer-cli preset build`) may differ only when
//     each style dependency whose stylesheet differs has a stylesheet input changed since the previous tag, whatever
//     the package's own source did (listed as a style dependency difference); any other stylesheet, the Tailwind CSS
//     generated from the package's source, may differ only when a .ts or .tsx source file of the package changed
//     (listed as derived).
// Anything else fails, and so does a package without a changed source file whose built code differs. A changed file
// whose build shows no difference is listed (a comment-only change shows nothing, since the bundles drop comments).
//
// usage: node carenode/compare-previous.mts --selection <selection.json> --built <tarball dir> --version <fork version>
//          --previous <dir> [--download] --report <report.json>
//   --previous <dir> --download  an empty directory; the previous release's tarballs are downloaded into it from npm
//                                (npm pack checks each download against the registry's integrity)
//   --previous <dir>             a directory of the previous build's tarballs with its packages.json (a
//                                `univer-<version>` artifact of carenode-release.yml)
//   Run from the workspace root at this build's commit, with the previous release tag fetched.

import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { isDeepStrictEqual, parseArgs } from 'node:util';
import type { IPackManifest, ISelection } from './fork.mts';
import {
    extractTarball,
    fail,
    FORK_NOTICE_END,
    FORK_NOTICE_START,
    isTestSource,
    listFiles,
    log,
    pairHashedChunks,
    parseForkVersion,
    previousStylesheetVerdict,
    readJson,
    run,
    writeJson,
} from './fork.mts';

interface IDifference {
    file: string;
    kind: string;
    detail?: string;
}

interface IPackageResult {
    name: string;
    previous: string;
    built: string;
    changedSource: string[];
    files: number;
    attributed: IDifference[];
    derived: IDifference[];
    /** The stylesheet of a preset, made by style dependencies whose source changed (styleDependencyChanges). */
    styleDependency: IDifference[];
    disallowed: IDifference[];
    noVisibleEffect: string[];
}

const { values } = parseArgs({
    options: {
        selection: { type: 'string' },
        built: { type: 'string' },
        version: { type: 'string' },
        previous: { type: 'string' },
        download: { type: 'boolean' },
        report: { type: 'string' },
    },
});
if (!values.selection || !values.built || !values.version || !values.previous || !values.report) {
    fail('usage: --selection <selection.json> --built <dir> --version <fork version> --previous <dir> [--download] --report <report.json>');
}
const current = parseForkVersion(values.version);
if (current.build < 1) {
    fail(`${current.version} has no previous fork release to compare with`);
}
const previousVersion = `${current.base}-carenode.${current.build - 1}`;
const previousTag = `v${previousVersion}`;
const selection = readJson<ISelection>(values.selection);
const built = readJson<IPackManifest>(path.join(values.built, 'packages.json'));
if (built.version !== current.version) {
    fail(`${values.built} holds ${built.version}, expected ${current.version}`);
}

// Previous tarballs by fork name.
const previousDir = path.resolve(values.previous);
const previousFiles = new Map<string, string>();
if (values.download) {
    fs.mkdirSync(previousDir, { recursive: true });
    if (fs.readdirSync(previousDir).length > 0) {
        fail(`${previousDir} is not empty`);
    }
    const specs = selection.packages.map((pkg) => `${pkg.forkName}@${previousVersion}`);
    let packed: string;
    try {
        packed = run('npm', ['pack', ...specs, '--pack-destination', previousDir, '--json', '--ignore-scripts']);
    } catch {
        fail(`the previous release ${previousVersion} could not be downloaded from npm (npm's error is above); it must be public before ${current.version} is compared and staged`);
    }
    const downloaded = JSON.parse(packed) as { name: string; version: string; filename: string }[];
    for (const entry of downloaded) {
        if (entry.version !== previousVersion) fail(`npm returned ${entry.name}@${entry.version}, expected ${previousVersion}`);
        previousFiles.set(entry.name, entry.filename);
    }
} else {
    const manifest = readJson<IPackManifest>(path.join(previousDir, 'packages.json'));
    if (manifest.version !== previousVersion) {
        fail(`${previousDir} holds ${manifest.version}, expected ${previousVersion}`);
    }
    for (const entry of manifest.packages) previousFiles.set(entry.name, entry.file);
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'carenode-previous-'));
const results: IPackageResult[] = [];
// Source files changed since the previous tag, relative to the package directory, by upstream name.
const changedSourceOf = new Map(selection.packages.map((pkg) => [
    pkg.name,
    run('git', ['diff', '--name-only', previousTag, 'HEAD', '--', `${pkg.dir}/src`])
        .split('\n')
        .filter((file) => file && !isTestSource(file))
        .map((file) => path.posix.relative(pkg.dir, file)),
]));
// Previous and built package roots by upstream name. The selection lists a package after its dependencies, so a preset's
// style dependencies are extracted before it.
const extracted = new Map<string, readonly [string, string]>();

for (const pkg of selection.packages) {
    const previousFile = previousFiles.get(pkg.forkName);
    const builtEntry = built.packages.find((entry) => entry.upstreamName === pkg.name);
    if (!previousFile || !builtEntry) {
        fail(`${pkg.forkName}: previous tarball ${previousFile ? 'found' : 'missing'}, built tarball ${builtEntry ? 'found' : 'missing'}`);
    }
    const changedSource = changedSourceOf.get(pkg.name)!;
    const result: IPackageResult = {
        name: pkg.forkName,
        previous: previousFile,
        built: builtEntry.file,
        changedSource,
        files: 0,
        attributed: [],
        derived: [],
        styleDependency: [],
        disallowed: [],
        noVisibleEffect: [],
    };
    const changed = new Set(changedSource);
    const touched = new Set<string>();

    const previousRoot = extractTarball(path.join(previousDir, previousFile), tempRoot);
    const builtRoot = extractTarball(path.join(values.built, builtEntry.file), tempRoot);
    extracted.set(pkg.name, [previousRoot, builtRoot]);
    const previousList = listFiles(previousRoot);
    const builtList = listFiles(builtRoot);
    const previousSet = new Set(previousList);
    const builtSet = new Set(builtList);
    const chunks = pairHashedChunks(previousList.filter((f) => !builtSet.has(f)), builtList.filter((f) => !previousSet.has(f)));
    const pairedPrevious = new Set(chunks.renames.values());
    result.files = new Set([...previousList, ...builtList.filter((f) => !chunks.renames.has(f))]).size;

    const normalizeBuilt = (text: string): string => {
        let out = text.replaceAll(current.version, previousVersion);
        for (const [builtHash, previousHash] of chunks.hashes) out = out.replaceAll(builtHash, previousHash);
        return out;
    };

    // A derived file may differ only in a package whose source changed.
    const derive = (file: string, detail: string): void => {
        if (changed.size > 0) {
            result.derived.push({ file, kind: 'derived', detail });
        } else {
            result.disallowed.push({ file, kind: 'content', detail: `${detail}; no source file changed since ${previousTag}` });
        }
    };

    // Attribute a difference in one built file (`a` previous, `b` this build; either may be missing).
    const attribute = (file: string, a: string | undefined, b: string | undefined): void => {
        if (file.startsWith('lib/types/') && file.endsWith('.d.ts')) {
            const stem = `src/${file.slice('lib/types/'.length, -'.d.ts'.length)}`;
            const source = [`${stem}.ts`, `${stem}.tsx`].find((candidate) => changed.has(candidate));
            if (source) {
                touched.add(source);
                result.attributed.push({ file, kind: a === undefined ? 'added' : b === undefined ? 'removed' : 'declaration', detail: source });
            } else {
                const behind = a === undefined || b === undefined ? undefined : changedImportBehind(file, a, b, changed);
                if (behind) {
                    result.derived.push({ file, kind: 'derived', detail: `declaration names another import (${behind} changed)` });
                } else {
                    result.disallowed.push({ file, kind: 'declaration', detail: `${stem}.ts(x) did not change since ${previousTag}` });
                }
            }
            return;
        }
        if (file.endsWith('.js')) {
            const sectionsA = a === undefined ? emptyBundle() : splitBundle(a);
            const sectionsB = b === undefined ? emptyBundle() : splitBundle(b);
            if (!sectionsA || !sectionsB) {
                derive(file, 'bundle without module markers');
                return;
            }
            if (sectionsA.preamble !== sectionsB.preamble) derive(file, 'import block');
            if (sectionsA.tail !== sectionsB.tail) derive(file, 'export block');
            for (const key of new Set([...sectionsA.sections.keys(), ...sectionsB.sections.keys()])) {
                if (sectionsA.sections.get(key) === sectionsB.sections.get(key)) continue;
                const source = key.replace(/#\d+$/, '');
                if (changed.has(source)) {
                    touched.add(source);
                    result.attributed.push({ file, kind: 'module', detail: source });
                } else {
                    result.disallowed.push({ file, kind: 'module', detail: `${source} did not change since ${previousTag}` });
                }
            }
            return;
        }
        const kind = a === undefined ? 'only-in-build' : b === undefined ? 'only-in-previous' : 'content';
        if (file.endsWith('.css')) {
            const verdict = previousStylesheetVerdict(
                file,
                pkg,
                selection,
                (name) => extracted.get(name) ?? fail(`${name} is not extracted before ${pkg.name}, which depends on it`),
                (dependency) => changedSourceOf.get(dependency.name)!
            );
            if (verdict.kind === 'style-dependency') {
                result.styleDependency.push({ file, kind: 'style-dependency', detail: verdict.detail });
            } else if (verdict.kind === 'derived') {
                derive(file, verdict.detail);
            } else {
                result.disallowed.push({ file, kind, detail: verdict.detail });
            }
            return;
        }
        result.disallowed.push({ file, kind });
    };

    for (const file of previousList.filter((f) => !builtSet.has(f) && !pairedPrevious.has(f))) {
        attribute(file, withoutRenumbering(fs.readFileSync(path.join(previousRoot, file), 'utf8')), undefined);
    }
    for (const file of builtList.filter((f) => !previousSet.has(f) && !chunks.renames.has(f))) {
        attribute(file, undefined, withoutRenumbering(normalizeBuilt(fs.readFileSync(path.join(builtRoot, file), 'utf8'))));
    }
    const pairs: [string, string][] = [
        ...previousList.filter((f) => builtSet.has(f)).map((f): [string, string] => [f, f]),
        ...[...chunks.renames].map(([builtFile, previousFile]): [string, string] => [previousFile, builtFile]),
    ];
    for (const [previousName, builtName] of pairs) {
        const file = previousName === builtName ? previousName : `${previousName} <- ${builtName}`;
        // latin1 maps every byte to one character, so the (ASCII) version and hash swap is safe in any file.
        const a = fs.readFileSync(path.join(previousRoot, previousName)).toString('latin1');
        const b = normalizeBuilt(fs.readFileSync(path.join(builtRoot, builtName)).toString('latin1'));
        if (a === b) continue;
        if (previousName === 'package.json') {
            const previousManifest = JSON.parse(utf8(a)) as Record<string, unknown>;
            const builtManifest = JSON.parse(utf8(b)) as Record<string, unknown>;
            if (!isDeepStrictEqual(previousManifest, builtManifest)) {
                const keys = [...new Set([...Object.keys(previousManifest), ...Object.keys(builtManifest)])]
                    .filter((key) => !isDeepStrictEqual(previousManifest[key], builtManifest[key]));
                result.disallowed.push({ file, kind: 'manifest', detail: keys.join(', ') });
            }
            continue;
        }
        if (previousName === 'README.md') {
            const body = readmeBody(utf8(a));
            if (body === undefined || body !== readmeBody(utf8(b))) {
                result.disallowed.push({ file, kind: 'content', detail: 'README differs outside the fork notice' });
            }
            continue;
        }
        const textA = withoutRenumbering(utf8(a));
        const textB = withoutRenumbering(utf8(b));
        if (textA === textB) continue;
        attribute(file, textA, textB);
    }

    result.noVisibleEffect = changedSource.filter((source) => !touched.has(source));
    results.push(result);
}

fs.rmSync(tempRoot, { recursive: true, force: true });

interface IBundle {
    preamble: string;
    sections: Map<string, string>;
    tail: string;
}

function utf8(latin1: string): string {
    return Buffer.from(latin1, 'latin1').toString('utf8');
}

function emptyBundle(): IBundle {
    return { preamble: '', sections: new Map(), tail: '' };
}

/**
 * Cut a bundle into the part before the first `// src/<path>` module marker, one section per module (a repeated marker
 * gets `#2`, `#3`...), and the export block after the last module. `undefined` when the bundle has no marker.
 */
function splitBundle(text: string): IBundle | undefined {
    const lines = text.split('\n');
    const markers = lines.flatMap((line, index) => (line.startsWith('// src/') ? [index] : []));
    if (markers.length === 0) return undefined;
    let tailStart = lines.length;
    for (let i = markers[markers.length - 1] + 1; i < lines.length; i++) {
        if (/^(?:export \{|exports\.|Object\.defineProperty\(exports)/.test(lines[i])) {
            tailStart = i;
            break;
        }
    }
    const sections = new Map<string, string>();
    markers.forEach((start, index) => {
        const end = index + 1 < markers.length ? markers[index + 1] : tailStart;
        const name = lines[start].slice('// '.length).trim();
        let key = name;
        for (let n = 2; sections.has(key); n++) key = `${name}#${n}`;
        sections.set(key, lines.slice(start + 1, end).join('\n'));
    });
    return { preamble: lines.slice(0, markers[0]).join('\n'), sections, tail: lines.slice(tailStart).join('\n') };
}

/** Drop the `$<n>` suffix the bundler adds to an identifier that clashes with another module's. */
function withoutRenumbering(text: string): string {
    return text.replace(/([A-Z_a-z][\w$]*?)\$\d+\b/g, '$1');
}

/** A declaration file without its `import { ... } from '...'` lines, and the module each imported name comes from. */
function splitDeclarationImports(text: string): { body: string; modules: Map<string, string> } {
    const modules = new Map<string, string>();
    const body = text.replace(/^import (?:type )?\{([^}]*)\} from '([^']+)';\n/gm, (_line, list: string, specifier: string) => {
        for (const item of list.split(',')) {
            const name = item.trim().split(/\s+as\s+/).pop()!.replace(/^type\s+/, '');
            if (name) modules.set(name, specifier);
        }
        return '';
    });
    return { body, modules };
}

/**
 * The changed source files behind a difference in the declaration `file` of a source file that did not change, or
 * `undefined` when the difference is of another kind. The declared type of an export without an annotation is
 * inferred, and it names what the module imports: a list of classes is declared with the one class type the others
 * reduce to. When a class in the list changes its members, TypeScript may name another class of the list there. So
 * the two declarations must be equal but for their import lines and the imported names, and wherever they name
 * different imports, one of the two must come from a changed source file of the package.
 */
function changedImportBehind(file: string, a: string, b: string, changed: Set<string>): string | undefined {
    const previous = splitDeclarationImports(a);
    const built = splitDeclarationImports(b);
    const words = /[A-Z_a-z$][\w$]*|[^A-Z_a-z$]+/g;
    const wordsA = previous.body.match(words) ?? [];
    const wordsB = built.body.match(words) ?? [];
    if (wordsA.length !== wordsB.length) return undefined;
    const dir = path.posix.dirname(`src/${file.slice('lib/types/'.length)}`);
    const changedSourceOf = (specifier: string | undefined): string | undefined => {
        if (!specifier?.startsWith('.')) return undefined;
        const target = path.posix.join(dir, specifier);
        return [`${target}.ts`, `${target}.tsx`, `${target}/index.ts`, `${target}/index.tsx`].find((candidate) => changed.has(candidate));
    };
    const behind = new Set<string>();
    for (let i = 0; i < wordsA.length; i++) {
        if (wordsA[i] === wordsB[i]) continue;
        const source = changedSourceOf(previous.modules.get(wordsA[i])) ?? changedSourceOf(built.modules.get(wordsB[i]));
        if (!previous.modules.has(wordsA[i]) || !built.modules.has(wordsB[i]) || !source) return undefined;
        behind.add(source);
    }
    return behind.size > 0 ? [...behind].join(', ') : undefined;
}

/** README after the fork notice, or `undefined` when the notice is missing. */
function readmeBody(text: string): string | undefined {
    const end = `${FORK_NOTICE_END}\n`;
    const at = text.indexOf(end);
    return text.startsWith(FORK_NOTICE_START) && at > 0 ? text.slice(at + end.length) : undefined;
}

const disallowed = results.flatMap((r) => r.disallowed.map((d) => ({ name: r.name, ...d })));
const styleDependency = results.flatMap((r) => r.styleDependency.map((d) => ({ name: r.name, ...d })));
const changedPackages = results.filter((r) => r.changedSource.length > 0);
writeJson(values.report, {
    version: current.version,
    previous: previousVersion,
    previousSource: values.download ? 'npm' : previousDir,
    packages: results,
    totals: {
        packages: results.length,
        files: results.reduce((sum, r) => sum + r.files, 0),
        changedPackages: changedPackages.length,
        attributed: results.reduce((sum, r) => sum + r.attributed.length, 0),
        derived: results.reduce((sum, r) => sum + r.derived.length, 0),
        styleDependency: styleDependency.length,
        disallowed: disallowed.length,
    },
});

for (const r of changedPackages) {
    const modules = [...new Set(r.attributed.map((d) => d.detail))];
    log(`changed ${r.name}: ${r.changedSource.length} source file(s); built code differs in ${modules.length} (${modules.join(', ')})`);
    for (const d of r.derived) log(`  derived ${d.file}: ${d.detail}`);
    for (const source of r.noVisibleEffect) log(`  no visible effect: ${source}`);
}
for (const d of styleDependency) log(`style dependency ${d.name} ${d.file}: ${d.detail}`);
for (const d of disallowed) log(`DIFF ${d.name} ${d.file}: ${d.kind}${d.detail ? ` (${d.detail})` : ''}`);
log(`previous release (${current.version} vs ${previousVersion} from ${values.download ? 'npm' : previousDir}): ${results.length} packages, ${changedPackages.length} with changed source, ${styleDependency.length} stylesheet(s) made by changed style dependencies, differences outside the changed source: ${disallowed.length}`);
if (disallowed.length > 0) {
    process.exitCode = 1;
}
