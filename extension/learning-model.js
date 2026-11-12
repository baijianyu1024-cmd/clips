import { canonical } from './core.js';
export const isUUID = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9-]{27}$/i.test(value);
export const fingerprint = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(n=>n.toString(16).padStart(2,'0')).join('');
export function validateChat(chat) {
  if(!chat||!isUUID(chat.id)||typeof chat.title!=='string'||chat.title.length>160||!Number.isInteger(chat.revision)||chat.revision<0||!Array.isArray(chat.turns)||chat.turns.length>20||!Array.isArray(chat.materials)||chat.materials.length>240) throw new Error('对话格式无效或已超过 20 轮，请新建对话。');
  const ids=new Set();
  for(const m of chat.materials) {
    if(!/^[a-f0-9]{64}$/.test(m.id)||ids.has(m.id)||!isUUID(m.noteId)||typeof m.text!=='string'||m.text.length>6000||typeof m.title!=='string'||m.title.length>300||!['original','thought','summary','transcript','image','generated'].includes(m.kind)) throw new Error('参考材料格式无效。');
    if(m.imageKey&&!/^[a-f0-9]{64}\/(?:reader\/[a-f0-9-]{36}\/)?[a-f0-9-]{36}\.(png|jpg|webp|gif)$/.test(m.imageKey)) throw new Error('图片引用格式无效。');
    ids.add(m.id);
  }
  for(const t of chat.turns) {
    if(!isUUID(t.id)||typeof t.question!=='string'||t.question.length>4000||!Array.isArray(t.used)||t.used.length>24||!Array.isArray(t.retrieved)||t.retrieved.length>240||!Array.isArray(t.answer)||t.answer.length>30||t.used.some(id=>!ids.has(id)||!t.retrieved.includes(id))||t.retrieved.some(id=>!ids.has(id))) throw new Error('本轮材料格式无效。');
    for(const p of t.answer) if(typeof p.text!=='string'||p.text.length>10000||!['evidence','inference','gap'].includes(p.type)||!Array.isArray(p.references)||p.references.some(id=>!t.used.includes(id))||(p.type!=='gap'&&!p.references.length)) throw new Error('回答引用与实际材料不一致。');
  }
  if(JSON.stringify(chat).length>750000) throw new Error('对话材料过多，请先保存笔记，再新建对话。');
  return chat;
}
export function validateCapture(input,note,prefix) {
  if(!note||note.deletedAt||!isUUID(input.id)||!canonical(input.url)||!note.sources.some(s=>canonical(s.url)===canonical(input.url))) throw new Error('页面与笔记来源不一致，未保存原文材料。');
  const text=String(input.text||'').trim();
  if(text.length>180000||(!text&&!input.images?.length)) throw new Error('没有可保存的原文材料。');
  const images=Array.isArray(input.images)?input.images:[];
  if(images.length>8||images.some(i=>!new RegExp('^'+prefix+'/[a-f0-9-]{36}\\.(png|jpg|webp|gif)$').test(i.key))) throw new Error('图片不属于当前资料库。');
  const blocks=[];
  for(const paragraph of text.split(/\n\s*\n/).filter(Boolean)) for(let i=0;i<paragraph.length;i+=1800) blocks.push({id:'b-'+blocks.length,type:'paragraph',text:paragraph.slice(i,i+1800)});
  for(const image of images)blocks.push({id:'b-'+blocks.length,type:'image',text:String(image.name||'原文图片').slice(0,300),imageKey:image.key});
  return {id:input.id,noteId:note.id,title:String(input.title||note.title).slice(0,300),sourceUrl:input.url,resolvedUrl:input.url,byline:'',published:note.published||'',method:'import',coverage:'partial',warnings:[String(input.reason||'仅保存获取时已加载的页面内容，未确认全文。').slice(0,500)],blocks,createdAt:new Date().toISOString()};
}
