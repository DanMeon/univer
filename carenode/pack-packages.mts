// Pack the selected packages with pnpm and write the build manifest next to the tarballs:
// packages.json (publish order, integrity) and SHA256SUMS. pnpm turns `workspace:` specs into
// exact versions, and renamed workspace dependencies into `npm:<fork name>@<version>` aliases.
//
// usage: node carenode/pack-packages.mts --selection <selection.json> --out <dir>
//        (run from the workspace root after the build, and after rename-packages for a fork build)

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import type { IPackedPackage, IPackManifest, ISelection } from './fork.mts';
import { fail, log, readJson, run, writeJson } from './fork.mts';

const { values } = parseArgs({ options: { selection: { type: 'string' }, out: { type: 'string' } } });
if (!values.selection || !values.out) {
    fail('--selection <selection.json> and --out <dir> are required');
}
const selection = readJson<ISelection>(values.selection);
const out = path.resolve(values.out);
fs.mkdirSync(out, { recursive: true });
if (fs.readdirSync(out).length > 0) {
    fail(`${out} is not empty`);
}

const packed: IPackedPackage[] = [];
for (const pkg of selection.packages) {
    const manifest = readJson<{ name: string; version: string }>(path.join(pkg.dir, 'package.json'));
    const before = new Set(fs.readdirSync(out));
    run('pnpm', ['pack', '--pack-destination', out], path.resolve(pkg.dir));
    const created = fs.readdirSync(out).filter((file) => !before.has(file) && file.endsWith('.tgz'));
    if (created.length !== 1) {
        fail(`pnpm pack in ${pkg.dir} created ${created.length} tarballs: ${created.join(', ')}`);
    }
    const bytes = fs.readFileSync(path.join(out, created[0]));
    packed.push({
        upstreamName: pkg.name,
        name: manifest.name,
        version: manifest.version,
        file: created[0],
        integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
        sha256: createHash('sha256').update(bytes).digest('hex'),
    });
}

const buildManifest: IPackManifest = {
    version: packed[0].version,
    commit: run('git', ['rev-parse', 'HEAD']).trim(),
    packages: packed,
};
writeJson(path.join(out, 'packages.json'), buildManifest);
fs.writeFileSync(path.join(out, 'SHA256SUMS'), packed.map((pkg) => `${pkg.sha256}  ${pkg.file}\n`).join(''));
log(`pack-packages: ${packed.length} tarballs in ${out}`);
