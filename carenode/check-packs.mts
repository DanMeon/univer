// Pack check of a fork build: every selected package has exactly one tarball, under its fork name and
// version, with the upstream LICENSE, the fork notice at the top of the README, the fork repository
// in repository/homepage/bugs, an "Unofficial" description, no `workspace:` spec left, every selected
// dependency as an `npm:@danmeon/univer-<y>@<version>` alias, and no @univerjs/presets.
//
// usage: node carenode/check-packs.mts --selection <selection.json> --dir <tarball dir> --version <fork version>

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';
import type { IPackManifest, ISelection } from './fork.mts';
import {
    DEPENDENCY_FIELDS,
    extractTarball,
    fail,
    FORK_KEYWORD,
    FORK_NAME_PREFIX,
    FORK_NOTICE_END,
    FORK_NOTICE_START,
    FORK_REPOSITORY_URL,
    forkNameOf,
    log,
    parseForkVersion,
    readJson,
    UPSTREAM_SCOPE,
} from './fork.mts';

type Manifest = Record<string, unknown> & {
    name?: string;
    version?: string;
    description?: string;
    license?: string;
    homepage?: string;
    keywords?: string[];
    repository?: { url?: string } | string;
    bugs?: { url?: string } | string;
};

const PRESETS = [`${UPSTREAM_SCOPE}presets`, `${FORK_NAME_PREFIX}presets`];
const ICONS = `${UPSTREAM_SCOPE}icons`;

const { values } = parseArgs({ options: { selection: { type: 'string' }, dir: { type: 'string' }, version: { type: 'string' } } });
if (!values.selection || !values.dir || !values.version) {
    fail('--selection <selection.json>, --dir <tarball dir> and --version <fork version> are required');
}
const target = parseForkVersion(values.version);
const selection = readJson<ISelection>(values.selection);
const buildManifest = readJson<IPackManifest>(path.join(values.dir, 'packages.json'));
const selected = new Map(selection.packages.map((pkg) => [pkg.name, pkg.forkName]));
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'carenode-pack-check-'));

const problems = new Map<string, string[]>();
function report(pkg: string, message: string): void {
    problems.set(pkg, [...(problems.get(pkg) ?? []), message]);
}

const tarballs = fs.readdirSync(values.dir).filter((file) => file.endsWith('.tgz'));
const listed = new Set(buildManifest.packages.map((entry) => entry.file));
for (const file of tarballs) {
    if (!listed.has(file)) report('(directory)', `${file} is not listed in packages.json`);
}
for (const pkg of selection.packages) {
    const entries = buildManifest.packages.filter((entry) => entry.upstreamName === pkg.name);
    if (entries.length !== 1) report(pkg.name, `${entries.length} tarballs listed`);
}

for (const entry of buildManifest.packages) {
    const label = entry.upstreamName;
    if (!selected.has(label)) {
        report(label, 'not a selected package');
        continue;
    }
    const root = extractTarball(path.join(values.dir, entry.file), tempRoot);
    const manifest = readJson<Manifest>(path.join(root, 'package.json'));
    const expectedName = forkNameOf(label);

    if (manifest.name !== expectedName) report(label, `name is ${manifest.name}, expected ${expectedName}`);
    if (manifest.version !== target.version) report(label, `version is ${manifest.version}, expected ${target.version}`);
    if (!manifest.description?.startsWith('Unofficial Carenode fork') || !manifest.description.includes('not an official Univer release')) {
        report(label, `description does not say it is an unofficial fork: ${manifest.description}`);
    }
    if (manifest.license !== 'Apache-2.0') report(label, `license is ${manifest.license}`);
    const repositoryUrl = typeof manifest.repository === 'object' ? manifest.repository.url : manifest.repository;
    const bugsUrl = typeof manifest.bugs === 'object' ? manifest.bugs.url : manifest.bugs;
    if (repositoryUrl !== FORK_REPOSITORY_URL) report(label, `repository.url is ${repositoryUrl}`);
    if (manifest.homepage !== FORK_REPOSITORY_URL) report(label, `homepage is ${manifest.homepage}`);
    if (bugsUrl !== FORK_REPOSITORY_URL) report(label, `bugs is ${bugsUrl}`);
    if (!manifest.keywords?.includes(FORK_KEYWORD)) report(label, `keywords lack ${FORK_KEYWORD}`);

    for (const field of DEPENDENCY_FIELDS) {
        for (const [dep, spec] of Object.entries((manifest[field] ?? {}) as Record<string, string>)) {
            if (spec.startsWith('workspace:')) report(label, `${field}.${dep} is still ${spec}`);
            const forkName = selected.get(dep);
            if (forkName && spec !== `npm:${forkName}@${target.version}`) {
                report(label, `${field}.${dep} is ${spec}, expected npm:${forkName}@${target.version}`);
            }
            if (field === 'devDependencies') continue;
            // What a consumer installs: selected packages as aliases, the official icons, and nothing else from Univer.
            if (PRESETS.includes(dep) || PRESETS.some((name) => spec.includes(name))) report(label, `${field}.${dep} pulls in presets`);
            if ((dep.startsWith(UPSTREAM_SCOPE) || spec.includes(UPSTREAM_SCOPE)) && !forkName && dep !== ICONS) {
                report(label, `${field}.${dep} (${spec}) is a Univer package outside the fork build`);
            }
            if (dep.startsWith(FORK_NAME_PREFIX)) report(label, `${field}.${dep} uses a fork name as the key; keep the upstream key with an alias`);
        }
    }

    const licenseFile = path.join(root, 'LICENSE');
    if (!fs.existsSync(licenseFile) || !fs.readFileSync(licenseFile, 'utf8').includes('Apache License')) {
        report(label, 'LICENSE (Apache-2.0) is missing');
    }
    const readmeFile = path.join(root, 'README.md');
    const readme = fs.existsSync(readmeFile) ? fs.readFileSync(readmeFile, 'utf8') : '';
    if (!readme.startsWith(FORK_NOTICE_START) || !readme.includes(FORK_NOTICE_END) || !readme.includes(`${expectedName}@${target.version}`)) {
        report(label, 'README does not start with the fork notice');
    }
}

fs.rmSync(tempRoot, { recursive: true, force: true });
for (const [pkg, messages] of problems) {
    for (const message of messages) log(`FAIL ${pkg}: ${message}`);
}
const ok = selection.packages.filter((pkg) => !problems.has(pkg.name)).length;
const directory = problems.has('(directory)') ? ', plus problems in the directory' : '';
log(`pack check: ${ok}/${selection.packages.length} OK (${tarballs.length} tarballs${directory})`);
if (problems.size > 0) {
    process.exitCode = 1;
}
