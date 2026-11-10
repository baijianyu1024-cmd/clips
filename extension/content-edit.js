const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function contentRecord(n,kind,id){
  if(kind==='clip')return n.clips.find(c=>c.id===id);
  if(kind==='legacy')return {id:'legacy',text:n.summary||'',thought:n.thought||'',images:n.legacyRecordImages||[]};
  if(kind==='core')return n.coreSummary||{id:null,text:'',images:[]};
  if(kind==='ai')return n.aiSummaries.find(c=>c.id===id);
  if(kind==='review')return n.reviews?.find(c=>c.id===id);
  if(kind==='new-review')return {id:null,text:'',images:[]};
  if(kind==='image'){const image=n.images.find(c=>c.key===id);return image?{id,text:'',thought:'',images:[image]}:null;}
}
const editable=r=>r?JSON.stringify({text:r.text||'',thought:r.thought||'',images:(r.images||[]).map(i=>i.key)}):null;
export async function saveContentEdit(cloud,noteId,kind,target,baseline,record){
  if(['new-review','ai'].includes(kind)&&!record.text.trim())throw new Error('请填写内容。');
  for(let attempt=0;attempt<3;attempt++){
    const n=(await cloud({})).notes.find(n=>n.id===noteId&&!n.archived&&!n.deletedAt);if(!n)throw new Error('笔记已移除或归档，请先恢复。');
    const current=contentRecord(n,kind,target);
    const already=kind==='image'?n.clips.find(c=>c.id===record.id):kind==='new-review'?n.reviews?.find(c=>c.id===record.id):current;
    if(already&&editable(already)===editable(record))return n;
    if(!current)throw new Error('记录已被移除，请刷新后核对。');
    if(editable(current)!==editable(baseline)||(kind==='core'&&!equal(current.id,baseline.id)))throw Object.assign(new Error('这条内容已在其他页面修改，草稿已保留。请核对最新内容。'),{code:'RECORD_CONFLICT'});
    let body={id:noteId,revision:n.revision};
    if(kind==='core'){if(!record.text.trim()&&!record.images.length)throw new Error('请填写摘要或添加图片。');body={...body,action:'set_core_summary',expectedCoreSummaryId:current.id,coreSummary:{...n.coreSummary,id:record.id,text:record.text,images:record.images,origin:n.coreSummary?.origin||'manual',edited:true,scope:n.coreSummary?.scope||'手动填写',createdAt:new Date().toISOString()}};}
    else if(kind==='legacy')body={...body,action:'edit_record',record:{...record,id:'legacy'}};
    else if(kind==='image')body={...body,action:'edit_image_record',imageKey:target,record};
    else if(kind==='ai'){if(!record.text.trim())throw new Error('摘要不能为空。');body={...body,action:'edit_ai_summary',aiSummaryId:target,text:record.text};}
    else if(kind==='review')body={...body,action:'edit_review',reviewId:target,text:record.text};
    else if(kind==='new-review'){if(n.status!=='read')throw new Error('先标记读完，再补充理解。');body={...body,action:'review',reviewId:record.id,text:record.text,days:0};}
    else throw new Error('未知编辑类型。');
    try{return (await cloud({method:'PATCH',body})).note;}catch(e){if(e.status!==409||attempt===2)throw e;}
  }
}
