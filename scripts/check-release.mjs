import { readdir, readFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '..');
const manifest = JSON.parse(await readFile(path.join(root, 'extension/manifest.json'), 'utf8'));
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
assert.equal(manifest.version, pkg.version, 'Package and extension versions must match');
assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.host_permissions?.length || 0, 0, 'No required remote host permissions');
assert.equal(manifest.content_scripts?.length || 0, 0, 'No private-site content scripts');
assert.equal(manifest.externally_connectable, undefined);
const permittedOrigins = new Set(['https://api.deepseek.com/*', 'https://api.supadata.ai/*', 'https://www.youtube.com/*', 'https://youtube.com/*', 'https://m.youtube.com/*']);
assert.ok(manifest.optional_host_permissions.every(origin => permittedOrigins.has(origin)));

// This catches accidental private-deployment exports, not all secrets. Run Gitleaks too.
const privatePatterns = [
  /https?:\/\/[a-z0-9.-]+\.chatgpt\.site\b/i,
  /appg(?:prj|dep|ver)_[a-f0-9]{16,}/i,
  /\/(?:Users|home)\/[A-Za-z0-9_.-]+\//,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|sk-[A-Za-z0-9]{24,})\b/,
];
const skipped = new Set(['.git', 'node_modules', 'dist', 'coverage']);
const forbidden = /^(?:\.env(?:\..*)?|\.openai|\.wrangler|clips\.json|backups|transcripts|images)$|\.(?:pem|key|p12|sqlite|db|zip)$/i;
const allowed = /\.(?:js|mjs|json|md|txt|css|html|png|yml|yaml)$|^(?:LICENSE|\.gitignore)$/;
let checked = 0;
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (skipped.has(entry.name)) continue;
    const file = path.join(dir, entry.name), relative = path.relative(root, file);
    assert.ok(!entry.isSymbolicLink(), `Symlink is not publishable: ${relative}`);
    assert.ok(!forbidden.test(entry.name), `Private/data file is not publishable: ${relative}`);
    if (entry.isDirectory()) { await walk(file); continue; }
    assert.ok(allowed.test(entry.name), `Review unexpected file: ${relative}`);
    if (!entry.name.endsWith('.png')) {
      const content = await readFile(file, 'utf8');
      for (const pattern of privatePatterns) assert.ok(!pattern.test(content), `Private content detected in ${relative}`);
    }
    checked++;
  }
}
await walk(root);
for (const file of ['background.js', 'panel.html', 'library.html', 'vendor/rich-editor.mjs', 'vendor/rich-editor-LICENSES.txt', 'vendor/markdown-it.mjs', 'THIRD_PARTY_NOTICES.txt', ...Object.values(manifest.icons)]) {
  assert.ok((await lstat(path.join(root, 'extension', file))).isFile(), `Missing extension file: ${file}`);
}
console.log(`Public-source checks passed (${checked} files, version ${manifest.version}).`);
