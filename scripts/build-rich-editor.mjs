import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
await build({ entryPoints: ['editor/rich-editor.js'], outfile: 'extension/vendor/rich-editor.mjs', bundle: true, format: 'esm', platform: 'browser', target: 'chrome116', minify: true, legalComments: 'eof', metafile: true }).then(async result => {
  const names = new Set(Object.keys(result.metafile.inputs).filter(n => n.startsWith('node_modules/')).map(n => n.split('/').slice(1, n.split('/')[1].startsWith('@') ? 3 : 2).join('/')));
  const notices = [];
  for (const name of [...names].sort()) {
    const pkg = JSON.parse(await readFile(`node_modules/${name}/package.json`, 'utf8'));
    let license = '';
    for (const file of ['LICENSE', 'LICENSE.md', 'LICENSE.txt']) { try { license = await readFile(`node_modules/${name}/${file}`, 'utf8'); break; } catch {} }
    if (!license) throw Error('Missing license: ' + name);
    notices.push(`${name} ${pkg.version}\n${pkg.license}\n${license}`);
  }
  await writeFile('extension/vendor/rich-editor-LICENSES.txt', notices.join('\n\n---\n\n'));
});
