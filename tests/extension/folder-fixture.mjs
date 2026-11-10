import { mkdtemp, mkdir, readFile, writeFile, readdir, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
export async function diskFolder(t) {
  const base=await mkdtemp(path.join(tmpdir(),'clips-folder-test-'));
  t?.after(()=>rm(base,{recursive:true,force:true}));
  const state={failPath:'',permission:'granted'};
  const convert=e=>{if(e.code==='ENOENT')return Object.assign(new Error('missing'),{name:'NotFoundError'});return e;};
  function directory(dir) { return {kind:'directory',name:path.basename(dir),path:dir,
    queryPermission:async()=>state.permission, requestPermission:async()=>state.permission,
    async getDirectoryHandle(name,{create=false}={}) {const p=path.join(dir,name);if(create)await mkdir(p,{recursive:true});else await readdir(p).catch(e=>{throw convert(e);});return directory(p);},
    async getFileHandle(name,{create=false}={}) {const p=path.join(dir,name);if(create){try{await writeFile(p,'',{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;}}else await readFile(p).catch(e=>{throw convert(e);});return {kind:'file',name,
      async getFile(){const data=await readFile(p);return new Blob([data]);},
      async createWritable(){let value;return {async write(v){value=v instanceof Blob?new Uint8Array(await v.arrayBuffer()):v;},async close(){if(state.failPath&&p.endsWith(state.failPath))throw new Error('Disk full');await writeFile(p+'.tmp',value);await rename(p+'.tmp',p);},async abort(){}};}
    };},
    async *entries(){for(const entry of await readdir(dir,{withFileTypes:true}))yield [entry.name,entry.isDirectory()?directory(path.join(dir,entry.name)):await this.getFileHandle(entry.name)];},
    async isSameEntry(other){return dir===other.path;},async resolve(other){const rel=path.relative(dir,other.path);return rel.startsWith('..')?null:rel.split(path.sep).filter(Boolean);}
  };}
  return {root:directory(base),state,read:file=>readFile(path.join(base,file),'utf8'),write:(file,text)=>writeFile(path.join(base,file),text)};
}
