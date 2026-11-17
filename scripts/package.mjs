import { readdir, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { zipSync, unzipSync } from 'fflate';
import assert from 'node:assert/strict';
import './check-parity.mjs';
import './check-release.mjs';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'dist');
const folder = 'clips-chrome-extension';
const files = {};
async function collect(dir, relative = '') {
  for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    assert.ok(!entry.isSymbolicLink(), 'Symlinks cannot be packaged');
    if (entry.name.startsWith('preview.') || entry.name.endsWith('.jsx') || ['library.js','learning-local.js'].includes(entry.name)) continue;
    const key = relative + entry.name;
    if (entry.isDirectory()) await collect(path.join(dir, entry.name), key + '/');
    else files[key] = new Uint8Array(await readFile(path.join(dir, entry.name)));
  }
}
await collect(path.join(root, 'extension'));
for (const name of ['LICENSE', 'README.md', 'PRIVACY.md']) files[name] = new Uint8Array(await readFile(path.join(root, name)));
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
const archive = {};
for (const [name, data] of Object.entries(files)) {
  const destination = path.join(dist, folder, name);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, data);
  archive[`${folder}/${name}`] = [data, { mtime: new Date(1980, 0, 1), level: 9 }];
}
const zipped = zipSync(archive);
const extracted = unzipSync(zipped);
assert.equal(Object.keys(extracted).length, Object.keys(files).length);
for (const [name, data] of Object.entries(files)) assert.deepEqual(extracted[`${folder}/${name}`], data);
const zipName = `${folder}.zip`;
await writeFile(path.join(dist, zipName), zipped);
const digest = createHash('sha256').update(zipped).digest('hex');
await writeFile(path.join(dist, 'SHA256SUMS.txt'), `${digest}  ${zipName}\n`);
// The optional Node connector is separate from the browser extension. Never bundle
// node_modules, credentials or machine configuration; install locked dependencies.
const agentFiles = {};
for (const name of ['package.json', 'package-lock.json', 'config.mjs', 'client.mjs', 'broker.mjs', 'server.mjs', 'cli.mjs']) {
  agentFiles[`clips-agent/agent/${name}`] = new Uint8Array(await readFile(path.join(root, 'agent', name)));
}
agentFiles['clips-agent/extension/agent-protocol.js'] = new Uint8Array(await readFile(path.join(root, 'extension/agent-protocol.js')));
agentFiles['clips-agent/package.json'] = new TextEncoder().encode(JSON.stringify({ private: true, type: 'module' }));
agentFiles['clips-agent/README.md'] = new Uint8Array(await readFile(path.join(root, 'docs/AGENT.md')));
agentFiles['clips-agent/LICENSE'] = new Uint8Array(await readFile(path.join(root, 'LICENSE')));
const agentZip = zipSync(Object.fromEntries(Object.entries(agentFiles).map(([name, data]) => [name, [data, { mtime: new Date(1980, 0, 1), level: 9 }]])));
const agentExtracted = unzipSync(agentZip);
for (const [name, data] of Object.entries(agentFiles)) assert.deepEqual(agentExtracted[name], data);
await writeFile(path.join(dist, 'clips-agent.zip'), agentZip);
const agentDigest = createHash('sha256').update(agentZip).digest('hex');
await writeFile(path.join(dist, 'SHA256SUMS.txt'), `${digest}  ${zipName}\n${agentDigest}  clips-agent.zip\n`);
console.log(`Packaged ${Object.keys(files).length} files; ${(zipped.length / 1024).toFixed(0)} KiB. ZIP round-trip verified.`);
console.log(`SHA256: ${digest}`);
console.log(`Agent connector: ${Object.keys(agentFiles).length} files; SHA256: ${agentDigest}`);
