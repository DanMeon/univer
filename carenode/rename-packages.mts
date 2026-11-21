// Give the selected packages their fork identity, after the build and only in the working tree:
// name, description, repository/homepage/bugs, a keyword, internal dependencies as workspace aliases
// (pnpm packs them as `npm:@danmeon/univer-<y>@<version>`), and a fork notice at the top of the README
// that lists the source files changed from the upstream tag (tests excluded: they are not packed).
//
// Renaming must come after the build: the build keeps a facade's own package name external and
// writes `name` into the bundles (see the Carenode fork notes in the consumer repository).
//
// usage: node carenode/rename-packages.mts --selection <selection.json> --version <fork version>
//        (run from the workspace root; the upstream tag of the base must be fetched)

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import type { IIdentityManifest, ISelection } from './fork.mts';
import {
    applyForkIdentity,
    DEPENDENCY_FIELDS,
    fail,
    FORK_NAME_PREFIX,
    FORK_NOTICE_END,
    FORK_NOTICE_START,
    FORK_REPOSITORY,
    FORK_REPOSITORY_URL,
    isTestSource,
    log,
    parseForkVersion,
    readJson,
    run,
    UPSTREAM_REPOSITORY_URL,
    writeJson,
} from './fork.mts';

type Manifest = Record<string, unknown> & IIdentityManifest & { version: string };

const { values } = parseArgs({ options: { selection: { type: 'string' }, version: { type: 'string' } } });
if (!values.selection || !values.version) {
    fail('--selection <selection.json> and --version <fork version> are required');
}
const target = parseForkVersion(values.version);
const selection = readJson<ISelection>(values.selection);
const forkNames = new Map(selection.packages.map((pkg) => [pkg.name, pkg.forkName]));
const commit = run('git', ['rev-parse', 'HEAD']).trim();
const branch = `carenode/v${target.base}`;

for (const pkg of selection.packages) {
    const manifestFile = path.join(pkg.dir, 'package.json');
    const manifest = readJson<Manifest>(manifestFile);
    if (manifest.name !== pkg.name || manifest.version !== target.version) {
        fail(`${manifestFile} is ${manifest.name}@${manifest.version}, expected ${pkg.name}@${target.version} (run set-version before the build)`);
    }

    applyForkIdentity(manifest, target.base);

    for (const field of DEPENDENCY_FIELDS) {
        const deps = manifest[field] as Record<string, string> | undefined;
        for (const [dep, spec] of Object.entries(deps ?? {})) {
            const forkName = forkNames.get(dep);
            if (!forkName) continue;
            const match = /^workspace:([*^~])$/.exec(spec);
            if (!match) {
                fail(`${pkg.name} ${field}.${dep} is "${spec}"; a selected package must be referenced as workspace:*, ^ or ~`);
            }
            deps![dep] = `workspace:${forkName}@${match[1]}`;
        }
    }
    writeJson(manifestFile, manifest, 4);

    // Apache-2.0 4(a): every tarball carries the license. pnpm copies the workspace LICENSE only into a package
    // that packs no file named like a license, so @univerjs/protocol (lib/types/.../license.d.ts) ships without
    // one upstream. Putting LICENSE in the package directory makes pnpm pack it for every package.
    if (!fs.readdirSync(pkg.dir).some((file) => /^licen[cs]e(?:\..+)?$/i.test(file))) {
        fs.copyFileSync('LICENSE', path.join(pkg.dir, 'LICENSE'));
    }

    // Tests are not packed, so only the shipped source counts (see isTestSource).
    const changedFiles = run('git', ['diff', '--name-only', target.baseTag, 'HEAD', '--', `${pkg.dir}/src`])
        .split('\n')
        .filter((file) => file && !isTestSource(file));
    pkg.changedFiles = changedFiles;
    const changes = changedFiles.length === 0
        ? `Source files changed from upstream \`${target.baseTag}\` in this package: none. Only the package name, version and this notice differ; the code was rebuilt from the upstream source.`
        : `Source files changed from upstream \`${target.baseTag}\` in this package (each changed file carries a "Modified by Carenode" header):\n\n${changedFiles.map((file) => `- \`${file}\``).join('\n')}`;
    const notice = [
        FORK_NOTICE_START,
        `> **Unofficial build.** \`${pkg.forkName}@${target.version}\` is a Carenode fork of [\`${pkg.name}\`](https://www.npmjs.com/package/${pkg.name}) ${target.base} from [Univer](${UPSTREAM_REPOSITORY_URL}) by DreamNum. It is not an official Univer release and DreamNum does not support it. It is distributed under the same Apache-2.0 license (see LICENSE).`,
        '>',
        `> Built from [\`${FORK_REPOSITORY}\`](${FORK_REPOSITORY_URL}) branch \`${branch}\`, commit \`${commit}\`.`,
        '',
        changes,
        FORK_NOTICE_END,
        '',
        '',
    ].join('\n');
    const readmeFile = path.join(pkg.dir, 'README.md');
    if (!fs.existsSync(readmeFile)) {
        fail(`${readmeFile} is missing`);
    }
    fs.writeFileSync(readmeFile, notice + fs.readFileSync(readmeFile, 'utf8'));
}

writeJson(values.selection, selection);
const changedCount = selection.packages.filter((pkg) => pkg.changedFiles!.length > 0).length;
log(`rename-packages: ${selection.packages.length} packages renamed to ${FORK_NAME_PREFIX}* at ${target.version}; ${changedCount} with changed source files`);
