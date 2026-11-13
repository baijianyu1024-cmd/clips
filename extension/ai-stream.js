// Decode SSE incrementally; finish_reason is required so truncated replies are never saved.
export async function readCompletion(response,onText){
 if(!response.body?.getReader)throw new Error('无法读取流式回复，请重试。');
 const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',text='',finish=null,done=false;
 function line(value){
  if(!value.startsWith('data:'))return;
  const payload=value.slice(5).trim();if(!payload)return;if(payload==='[DONE]'){done=true;return;}
  let data;try{data=JSON.parse(payload);}catch{throw new Error('回复数据不完整，请重试。');}
  if(data.error)throw new Error('生成回复失败，请重试。');
  const choice=data.choices?.[0];if(choice?.finish_reason)finish=choice.finish_reason;
  if(typeof choice?.delta?.content==='string'){text+=choice.delta.content;if(text.length>100000)throw new Error('回复过长，请缩小问题后重试。');onText?.(text);}
 }
 try{while(!done){const part=await reader.read();buffer+=decoder.decode(part.value||new Uint8Array(),{stream:!part.done});let end;while((end=buffer.indexOf('\n'))>=0){line(buffer.slice(0,end).replace(/\r$/,''));buffer=buffer.slice(end+1);}if(part.done){if(buffer.trim())line(buffer);break;}}}
 finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 if(!finish)throw new Error('连接中断，回复未完成，请重试。');
 return {text,finish};
}
// Only complete objects in the top-level paragraphs array are shown mid-generation.
export function completedParagraphs(text){
 const match=/^\s*\{\s*"paragraphs"\s*:\s*\[/.exec(text);if(!match)return [];
 const result=[];let depth=0,start=-1,string=false,escape=false;
 for(let i=match[0].length;i<text.length;i++){
  const c=text[i];if(string){if(escape)escape=false;else if(c==='\\')escape=true;else if(c==='"')string=false;continue;}
  if(c==='"'){string=true;continue;}if(c==='{'||c==='['){if(depth===0)start=i;depth++;}
  else if(c==='}'||c===']'){if(depth===0)break;depth--;if(depth===0){try{result.push(JSON.parse(text.slice(start,i+1)));}catch{break;}}}
 }
 return result;
}
