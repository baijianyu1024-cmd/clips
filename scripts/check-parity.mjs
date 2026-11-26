import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=path.resolve(import.meta.dirname,'..');
const manifest=JSON.parse(await readFile(path.join(root,'ui/parity.json'),'utf8'));
const digest=async file=>createHash('sha256').update(await readFile(file)).digest('hex');
const reference=process.argv.includes('--reference')?process.argv[process.argv.indexOf('--reference')+1]:null;
for(const [file,sha] of Object.entries(manifest.public))assert.equal(await digest(path.join(root,file)),sha,'Recheck parity after changing '+file);
for(const file of manifest.ui)assert.ok(manifest.public['ui/'+file], 'Missing public UI digest: '+file);
for(const file of [...manifest.shared,...Object.keys(manifest.variants)])assert.ok(manifest.public['extension/'+file], 'Missing public module digest: '+file);
if(reference){
 for(const file of manifest.ui){
  const expected=manifest.uiVariants?.[file]?.reference ?? manifest.public['ui/'+file];
  assert.equal(await digest(path.join(reference,file)),expected,'Review shared UI difference: '+file);
 }
 for(const file of manifest.shared)assert.equal(await digest(path.join(root,'extension',file)),await digest(path.join(reference,'extension',file)),'Shared behavior differs: '+file);
 for(const [file,entry] of Object.entries(manifest.variants))assert.equal(await digest(path.join(reference,'extension',file)),entry.reference,'Review storage-specific difference: '+file);
}
console.log(`Parity checked: ${manifest.ui.length} UI sources, ${manifest.shared.length} identical extension modules${reference?', with reference checkout':''}.`);
