import {canonical} from './core.js';
import {fingerprint} from './learning-model.js';
// Only persists content already acquired by an explicit reading action, to its matching note.
export async function retainMaterial(result,{storage,request}){
 if(!result?.url||(!result.text&&!result.images?.length))return result;
 const {activeNoteId}=await storage.get('activeNoteId');if(!activeNoteId)return result;
 const {notes}=await request({path:'/api/notes'}),note=notes.find(n=>n.id===activeNoteId&&!n.deletedAt&&n.sources.some(s=>canonical(s.url)===canonical(result.url)));
 if(!note)return result;
 const hash=await fingerprint(JSON.stringify([result.url,result.text,result.images])),key='retainedMaterial:'+note.id;
 if((await storage.get(key))[key]===hash)return result;
 const images=[];
 for(const item of result.images||[]){const match=/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(item.dataUrl||'');if(!match)continue;
   const {image}=await request({path:'/api/media',method:'POST',body:{base64:match[2],type:match[1],name:String(item.label||'原文图片').slice(0,180)+'.jpg'}});images.push(image);
 }
 await request({path:'/api/materials',method:'POST',body:{id:crypto.randomUUID(),noteId:note.id,url:result.url,title:result.title,text:result.text||'',images,reason:result.reason}});
 await storage.set({[key]:hash});return {...result,retained:true};
}
