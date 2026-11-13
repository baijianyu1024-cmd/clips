import {build} from 'esbuild';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {existsSync} from 'node:fs';
const root=process.cwd(),ui=existsSync('ui/app/notebook.tsx')?path.join(root,'ui'):root;
const result=await build({entryPoints:['extension/library-entry.jsx'],outfile:'extension/library-app.js',bundle:true,format:'esm',platform:'browser',target:'chrome116',jsx:'automatic',minify:true,metafile:true,legalComments:'eof',define:{'process.env.NODE_ENV':'"production"'},alias:{'@/app':path.join(ui,'app'),'@/lib':path.join(ui,'lib'),'@/extension':path.join(root,'extension')},plugins:[{name:'plain-css',setup(build){build.onLoad({filter:/globals\.css$/},async args=>({contents:(await readFile(args.path,'utf8')).replace('@import "tailwindcss";',''),loader:'css'}));}}]});
const names=new Set(Object.keys(result.metafile.inputs).filter(p=>p.includes('node_modules/')).map(p=>p.split('node_modules/').at(-1).split('/').slice(0,p.split('node_modules/').at(-1).startsWith('@')?2:1).join('/'))),notices=[];
for(const name of [...names].sort()){const pkg=JSON.parse(await readFile(`node_modules/${name}/package.json`));let license='';for(const f of ['LICENSE','LICENSE.md','LICENSE.txt'])try{license=await readFile(`node_modules/${name}/${f}`,'utf8');break;}catch{}if(!license)throw Error('Missing license '+name);notices.push(`${name} ${pkg.version}\n${license}`);}
await writeFile('extension/vendor/library-LICENSES.txt',notices.join('\n\n---\n\n'));
await writeFile('extension/library-app.css',(await readFile('extension/library-app.css','utf8'))+'\n.library-learning-workspace{padding:0;min-height:100dvh}.library-storage-changed{position:fixed;inset:0 0 auto;z-index:99999;padding:20px;background:#fff4e8;color:#642a18}.library-learning-workspace .learn-root{height:100dvh}\n');
console.log(`Built shared library (${Object.keys(result.metafile.inputs).length} source files).`);
