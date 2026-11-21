// Pick the packages the fork publishes: the production-dependency closure of direct-packages.txt.
// Runs before rename-packages (pnpm selects by the upstream names). Fails when the closure differs
// from closure-packages.txt, contains a private package, or contains @univerjs/presets.
//
// usage: node carenode/select-packages.mts --out <selection.json>   (run from the workspace root)

import path from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';
import type { ISelectedPackage, ISelection } from './fork.mts';
import { DEPENDENCY_FIELDS, fail, forkNameOf, log, readJson, readList, run, TOOLS_DIR, UPSTREAM_SCOPE, writeJson } from './fork.mts';

interface IProject {
    name: string;
    version: string;
    path: string;
    private?: boolean;
}

const { values } = parseArgs({ options: { out: { type: 'string' } } });
if (!values.out) {
    fail('--out <selection.json> is required');
}

const root = process.cwd();
const direct = readList(path.join(TOOLS_DIR, 'direct-packages.txt'));
const expected = readList(path.join(TOOLS_DIR, 'closure-packages.txt'));

const filters = direct.flatMap((name) => ['--filter-prod', `${name}...`]);
const projects = JSON.parse(run('pnpm', ['-r', ...filters, 'ls', '--depth', '-1', '--json'])) as IProject[];
const byName = new Map(projects.map((project) => [project.name, project]));

const problems: string[] = [];
for (const name of direct) {
    if (!byName.has(name)) problems.push(`direct package ${name} is not in the workspace`);
}
for (const project of projects) {
    if (project.private) problems.push(`${project.name} is private`);
    if (!project.name.startsWith(UPSTREAM_SCOPE)) problems.push(`${project.name} is outside ${UPSTREAM_SCOPE}`);
    if (project.name === `${UPSTREAM_SCOPE}presets`) problems.push(`${project.name} must never be published by the fork`);
}
const added = projects.map((project) => project.name).filter((name) => !expected.includes(name));
const missing = expected.filter((name) => !byName.has(name));
if (added.length > 0 || missing.length > 0) {
    problems.push(`closure differs from closure-packages.txt: added [${added.join(', ')}], missing [${missing.join(', ')}]`);
}
const versions = new Set(projects.map((project) => project.version));
if (versions.size !== 1) problems.push(`selected packages have several versions: ${[...versions].join(', ')}`);
if (problems.length > 0) {
    fail(`package selection:\n  ${problems.join('\n  ')}`);
}

// Publish order: each package after the selected packages it depends on (production dependencies).
const dependsOn = new Map<string, string[]>();
for (const project of projects) {
    const manifest = readJson<Record<string, Record<string, string> | undefined>>(path.join(project.path, 'package.json'));
    const deps = DEPENDENCY_FIELDS.filter((field) => field !== 'devDependencies')
        .flatMap((field) => Object.keys(manifest[field] ?? {}))
        .filter((name) => byName.has(name) && name !== project.name);
    dependsOn.set(project.name, [...new Set(deps)]);
}
const ordered: string[] = [];
const remaining = new Set([...byName.keys()].sort());
while (remaining.size > 0) {
    const ready = [...remaining].filter((name) => dependsOn.get(name)!.every((dep) => !remaining.has(dep)));
    if (ready.length === 0) {
        fail(`dependency cycle among ${[...remaining].join(', ')}`);
    }
    for (const name of ready) {
        ordered.push(name);
        remaining.delete(name);
    }
}

const packages: ISelectedPackage[] = ordered.map((name) => ({
    name,
    forkName: forkNameOf(name),
    dir: path.relative(root, byName.get(name)!.path),
}));
const selection: ISelection = { version: projects[0].version, packages };
writeJson(values.out, selection);
log(`select-packages: ${packages.length} packages (production closure of ${direct.length} direct packages) at ${selection.version}`);
for (const pkg of packages) log(`  ${pkg.name}  ${pkg.dir}`);
