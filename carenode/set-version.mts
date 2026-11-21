// Stamp the fork version into every workspace package.json before install and build.
// The build bakes `version` into the bundles (each plugin's `static version`), so this runs first.
//
// usage: node carenode/set-version.mts <fork version>   (run from the workspace root)

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fail, log, parseForkVersion, readJson, run } from './fork.mts';

interface IProject {
    name: string;
    version?: string;
    path: string;
    private?: boolean;
}

const target = parseForkVersion(process.argv[2] ?? '');
const root = process.cwd();
const rootManifest = readJson<{ version: string }>(path.join(root, 'package.json'));
if (rootManifest.version !== target.base) {
    fail(`version ${target.version} is based on ${target.base}, but this tree is ${rootManifest.version}`);
}

const projects = JSON.parse(run('pnpm', ['-r', 'ls', '--depth', '-1', '--json'])) as IProject[];
const dirs = [root, ...projects.map((project) => project.path).filter((dir) => path.resolve(dir) !== root)];

let stamped = 0;
const skipped: string[] = [];
for (const dir of dirs) {
    const file = path.join(dir, 'package.json');
    const text = fs.readFileSync(file, 'utf8');
    const manifest = JSON.parse(text) as { name?: string; version?: string; private?: boolean };
    const label = manifest.name ?? path.relative(root, dir);
    if (manifest.version !== target.base) {
        // Only private workspace members (examples, tests) may carry a version of their own.
        if (!manifest.private) {
            fail(`${label} is public but has version ${manifest.version}, not ${target.base}`);
        }
        skipped.push(`${label}@${manifest.version ?? '(none)'}`);
        continue;
    }
    const needle = `"version": "${target.base}"`;
    if (text.split(needle).length !== 2) {
        fail(`${file}: expected exactly one ${needle}`);
    }
    const next = text.replace(needle, `"version": "${target.version}"`);
    if (JSON.parse(next).version !== target.version) {
        fail(`${file}: the replaced ${needle} was not the top-level version`);
    }
    fs.writeFileSync(file, next);
    stamped += 1;
}

log(`set-version: ${stamped} package.json files now at ${target.version}`);
if (skipped.length > 0) {
    log(`set-version: left private packages with their own version: ${skipped.join(', ')}`);
}
