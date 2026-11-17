import test from 'node:test';
import assert from 'node:assert/strict';
import { generateCoreSummary, summaryOutline, renderSummaryParagraphs, PLAN_GUIDANCE, WRITE_GUIDANCE } from '../../extension/summary-pipeline.js';
const outline={subject:'通勤体验',main:{claim:'可预期性重要',reason:'能规划行程',evidence:'等待时间不确定'},mechanism:{claim:'信息共享减少猜测',reason:'能安排换乘',evidence:'统一到站信息'},connection:{claim:'减少临时判断',reason:'等待和换乘耗费注意力',reader_basis:'换乘最耗精力',is_inference:true}};
const paragraphs=[{heading:'可预期性重要',body:'统一信息让人能规划行程。'},{heading:'减少临时判断',body:'这提示评价通勤也应考虑注意力。'}];
const planResponse=(value=outline,finish='stop')=>Response.json({choices:[{message:{content:typeof value==='string'?value:JSON.stringify(value)},finish_reason:finish}]});
const sse=(value,finish='stop')=>new Response('data: '+JSON.stringify({choices:[{delta:{content:typeof value==='string'?value:JSON.stringify(value)},finish_reason:finish}]})+'\n\ndata: [DONE]\n\n');
const messages=[{role:'system',content:'old prompt'}, {role:'user',content:[{type:'text',text:'原文和个人记录'},{type:'image_url',image_url:{url:'data:image/png;base64,AAAA'}}]}];
test('both passes receive the selected text and images; only complete Markdown is displayed',async()=>{
 const calls=[],progress=[];
 const result=await generateCoreSummary({messages,model:'test',key:'FAKE',onProgress:async x=>progress.push(x),fetcher:async(url,init)=>{
  assert.equal(url,'https://api.deepseek.com/chat/completions');assert.equal(init.redirect,'error');
  const body=JSON.parse(init.body);calls.push(body);
  assert.equal(body.model,'test');assert.deepEqual(body.messages[1],messages[1]);
  assert.equal(body.response_format.type,'json_object');assert.equal(body.messages.some(m=>JSON.stringify(m).includes('FAKE')),false);
  return calls.length===1?planResponse():sse({paragraphs});
 }});
 assert.equal(calls.length,2);assert.equal(calls[0].stream,false);assert.equal(calls[1].stream,true);
 assert.deepEqual(JSON.parse(calls[1].messages[2].content).selected_outline,outline);
 assert.deepEqual(result,{text:renderSummaryParagraphs(paragraphs),warning:''});
 assert.equal(progress[0].phase,'planning');assert.equal(progress.at(-1).text,result.text);
 assert.doesNotMatch(JSON.stringify(progress),/evidence|data:image|FAKE|reader_basis/);
});
test('no-personal-records and short material do not require an invented personal insight',()=>{
 assert.equal(summaryOutline({...outline,connection:null,mechanism:null}).connection,null);
 assert.equal(renderSummaryParagraphs([paragraphs[0]]),'**可预期性重要** 统一信息让人能规划行程。');
});
test('incomplete, empty or malformed planning stops after the first request',async()=>{
 for(const response of [()=>planResponse('broken'),()=>planResponse(outline,'length'),()=>planResponse({}),()=>planResponse({...outline,main:{...outline.main,evidence:[]}})]){
  let calls=0;
  await assert.rejects(generateCoreSummary({messages,model:'test',key:'FAKE',fetcher:async()=>{calls++;return response();}}));
  assert.equal(calls,1);
 }
});
test('truncated, invalid or empty writing is rejected without a third request',async()=>{
 for(const response of [()=>sse({paragraphs},'length'),()=>sse({paragraphs},null),()=>sse('broken'),()=>sse({paragraphs:[]}),()=>sse({paragraphs:[{heading:'test',body:''}]}),()=>sse({paragraphs:Array(4).fill(paragraphs[0])})]){
  let calls=0;
  await assert.rejects(generateCoreSummary({messages,model:'test',key:'FAKE',fetcher:async()=>++calls===1?planResponse():response()}));
  assert.equal(calls,2);
 }
});
test('API errors do not expose provider bodies; long valid results are preserved with a warning',async()=>{
 await assert.rejects(generateCoreSummary({messages,model:'test',key:'FAKE',fetcher:async()=>new Response('secret provider body',{status:401})}),e=>/API Key 无效/.test(e.message)&&!e.message.includes('secret'));
 let calls=0;const long=[{heading:'判断',body:'完整句子。'.repeat(140)}];
 const result=await generateCoreSummary({messages,model:'test',key:'FAKE',fetcher:async()=>++calls===1?planResponse():sse({paragraphs:long})});
 assert.equal(calls,2);assert.equal(result.text,renderSummaryParagraphs(long));assert.match(result.warning,/偏长/);
});
test('claims remain subordinate to original evidence and work emphasis is not redefined as loss',()=>{
 for(const prompt of [PLAN_GUIDANCE,WRITE_GUIDANCE])assert.match(prompt,/工作重心、职责或投入的变化，不等于成本、损耗或风险发生转移/);
 assert.match(WRITE_GUIDANCE,/以原始材料为准修正或舍去/);
 assert.throws(()=>summaryOutline({...outline,subject:'x'.repeat(400)}));
 assert.equal(summaryOutline({...outline,unexpected:'discard'}).unexpected,undefined);
});
