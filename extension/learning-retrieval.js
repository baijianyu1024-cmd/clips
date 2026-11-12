import {fingerprint} from './learning-model.js';
export const kindNames={original:'原文',thought:'我的想法',summary:'核心摘要',transcript:'字幕',image:'图片',generated:'对话整理'};
export function pieces(value,max=1400){
 const result=[];for(const paragraph of String(value||'').split(/\n\s*\n/).filter(s=>s.trim())){
   for(let start=0;start<paragraph.length;){let end=Math.min(start+max,paragraph.length);if(end<paragraph.length){const part=paragraph.slice(start,end),boundary=Math.max(part.lastIndexOf('。'),part.lastIndexOf('. '),part.lastIndexOf('\n'));if(boundary>max/2)end=start+boundary+1;}result.push(paragraph.slice(start,end).trim());start=end;}
 }return result;
}
export function terms(value){
 const s=String(value||'').toLowerCase();const list=s.match(/[a-z0-9_+.-]{2,}/g)||[];
 for(const run of s.match(/[\u3400-\u9fff]{2,}/g)||[])for(let size=2;size<=Math.min(4,run.length);size++)for(let i=0;i<=run.length-size;i++)list.push(run.slice(i,i+size));
 return [...new Set(list)].filter(t=>!['什么','怎么','一下','这个','那个','我的','可以','是否','如何','哪些','结合','内容','帮我','请问'].includes(t)).slice(0,240);
}
export async function buildMaterials(notes,request){
 const materials=[],warnings=[];
 async function add(note,kind,text,key,extra={}){
   const chunks=kind==='image'?[String(text||'图片')]:pieces(text);
   for(let i=0;i<chunks.length;i++){
     if(materials.length>=8000)throw new Error('材料超过第一版检索容量，请缩小笔记范围。');
     const row={noteId:note.id,title:note.title||'无标题笔记',published:note.published||'',kind,text:chunks[i],url:note.sources?.[0]?.url||'',coverage:kind==='original'?'摘录，非全文':'',location:key+(chunks.length>1?' · '+(i+1):''),...extra};
     row.id=await fingerprint(JSON.stringify([note.id,kind,key,i,row.text,row.imageKey||'',row.url]));materials.push(row);
   }
 }
 for(const n of notes){
   const images=async(items,context,key)=>{for(const i of items||[])await add(n,'image',[i.name,context].filter(Boolean).join('\n').slice(0,1800),key+'/'+i.key,{imageKey:i.key,coverage:'图片；按名称与关联记录检索，未建立图片全文索引'});};
   await add(n,n.learningOrigin?'generated':'summary',n.summary,'摘录与要点');await add(n,'thought',n.thought,'我的想法');
   if(n.coreSummary){await add(n,'summary',n.coreSummary.text,'核心摘要');await images(n.coreSummary.images,n.coreSummary.text,'摘要图片');}
   await images([...(n.images||[]),...(n.legacyRecordImages||[])],n.summary||n.thought,'记录图片');
   for(const c of n.clips||[]){await add(n,'original',c.text,'摘录/'+c.id,{url:c.sourceUrl||n.sources?.[0]?.url||'',videoTime:c.videoTime});await add(n,'thought',c.thought,'想法/'+c.id);if(c.translation?.text)await add(n,'summary',c.translation.text,'译文/'+c.id,{coverage:'AI 译文，需核对原文'});await images(c.images,[c.text,c.thought].join('\n'),'图片/'+c.id);}
   for(const r of n.reviews||[])await add(n,'thought',r.text,'补充理解/'+r.id);
   try{
     const {snapshots=[]}=await request({path:'/api/materials?note='+n.id});
     const seen=new Set();
     for(const s of snapshots){
       for(const b of s.blocks||[]){
         const key=JSON.stringify([s.sourceUrl,b.text,b.imageKey]);if(seen.has(key))continue;seen.add(key);
         if(b.type==='image'){if(b.imageKey)await add(n,'image',b.text,'原文配图/'+s.id+'/'+b.id,{url:s.sourceUrl,imageKey:b.imageKey,coverage:s.warnings?.join(' ')||'原文配图'});}
         else await add(n,'original',b.text,'原文/'+s.id+'/'+b.id,{url:s.sourceUrl,snapshotId:s.id,blockId:b.id,capturedAt:s.createdAt,coverage:s.warnings?.join(' ')||'已保存正文副本；未保证全文完整'});
       }
     }
   }catch(e){warnings.push(n.title+'：原文副本未能读取。');}
   for(const meta of (n.transcripts||[]).slice(0,3))try{
     const {snapshot}=await request({path:'/api/transcripts?note='+n.id+'&id='+meta.id});
     let text='',start=0,from=0;
     for(let i=0;i<(snapshot?.segments||[]).length;i++){
       const segment=snapshot.segments[i];if(!text){start=segment.start;from=i;}text+=(text?'\n':'')+segment.text;
       if(text.length>=1100||i===snapshot.segments.length-1){await add(n,'transcript',text,'字幕/'+meta.id+'/'+from+'-'+i,{url:'https://www.youtube.com/watch?v='+meta.videoId+'&t='+Math.floor(start)+'s',videoTime:start,snapshotId:meta.id,coverage:'已保存字幕 · '+(meta.language||'未知语言')});text='';}
     }
   }catch{warnings.push(n.title+'：已存字幕未能读取。');}
 }
 return {materials,warnings:[...new Set(warnings)]};
}
export function retrieve(materials,question,queries,chat,scope){
 const tokens=terms([question,...queries].join(' ')), df=new Map(tokens.map(t=>[t,materials.filter(m=>(m.title+' '+m.text).toLowerCase().includes(t)).length]));
 const follow=/继续|刚才|上面|它们|这些|这个|那它|再解释|举例|提纲|总结一下/.test(question);
 const prior=new Set(chat.turns.at(-1)?.used||[]);
 const scores=materials.map((m,index)=>{
   const text=m.text.toLowerCase(),title=m.title.toLowerCase();let score=0;
   for(const t of tokens){const idf=Math.log(1+materials.length/(1+df.get(t)));if(text.includes(t))score+=idf*(t.length>3?1.5:1);if(title.includes(t))score+=idf*1.4;}
   if(follow&&prior.has(m.id))score+=4;
   if(/我的|观点变化|想法/.test(question)&&m.kind==='thought')score*=1.5;
   if(m.kind==='summary'||m.kind==='generated')score*=.7;
   if(/图片|截图|图中|画板/.test(question)&&m.kind==='image')score+=2;
   return {m,index,score};
 }).filter(r=>r.score>0).sort((a,b)=>b.score-a.score);
 // Round-robin across notes prevents one long source from consuming the context.
 const groups=new Map();for(const r of scores){if(!groups.has(r.m.noteId))groups.set(r.m.noteId,[]);groups.get(r.m.noteId).push(r);}
 const ranked=[];for(let level=0;ranked.length<36;level++){let found=false;for(const group of groups.values())if(group[level]){ranked.push(group[level]);found=true;if(ranked.length===36)break;}if(!found)break;}
 const selected=[],selectedIds=new Set();let size=0,images=0;
 const push=m=>{if(selectedIds.has(m.id)||selected.length>=18||size+m.text.length>22000||(m.kind==='image'&&images>=4))return;selected.push(m);selectedIds.add(m.id);size+=m.text.length;if(m.kind==='image')images++;};
 for(const r of ranked.slice(0,12))push(r.m);
 for(const r of ranked.slice(0,8))for(const offset of [-1,1]){
   const neighbor=materials[r.index+offset];if(neighbor&&neighbor.noteId===r.m.noteId&&neighbor.kind===r.m.kind&&['original','transcript'].includes(neighbor.kind)&&neighbor.snapshotId===r.m.snapshotId)push(neighbor);
 }
 const found=[...new Map([...ranked.map(r=>r.m),...selected].map(m=>[m.id,m])).values()];
 return {found,selected};
}
export function validateAnswer(raw,used){
 const allowed=new Set(used), paragraphs=raw?.paragraphs;
 if(!Array.isArray(paragraphs)||!paragraphs.length||paragraphs.length>30)throw new Error('AI 未返回完整回答，请重试。');
 return paragraphs.map(p=>{
   const refs=Array.isArray(p.references)?[...new Set(p.references)]:[];
   if(typeof p.text!=='string'||!p.text.trim()||p.text.length>10000||!['evidence','inference','gap'].includes(p.type)||refs.some(id=>!allowed.has(id))||(p.type!=='gap'&&!refs.length))throw new Error('AI 的引用与本轮材料不一致，回答未保存，请重试。');
   return {text:p.text.trim(),type:p.type,references:refs};
 });
}
