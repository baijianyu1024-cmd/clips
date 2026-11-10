import { canonical } from "./core.js";
import { youtubeId } from "./youtube.js";
import { contextForQuery } from "./understanding.js";
import { renderMarkdown } from "./markdown.js";
import { transferImages, validateImageBatch, blobDataUrl } from './image-drafts.js';
import { imageForAI, MAX_IMAGES, validImages } from './visual-material.js';

const esc = text => String(text || "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pageKey = page => `${page.id}:${canonical(page.url) || page.url}`;
const requestTurn = ({question,answer,source,quoteContext,images}) => ({question,answer,source,quoteContext,images});
export function createReadingTools({ adapter, getPage, getNotes, settings, getActive = () => null, saveThought, root = document.querySelector("#reading-tools"), prepareImage = imageForAI }) {
  let key='',snapshot=null,loading=false,generation=0,explanation=0;
  let draftQuote=null,draftImages=[],addingImages=false,selecting=false;
  let conversation=null,pending=null,requestPending=false,chatError='',savedThrough=0;
  let answerState=null,thoughtDraft=null,savingThought=false;
  root.innerHTML=`<details class="understand im-chat"><summary>理解 / 翻译</summary><div class="understand-body">
    <div class="im-chat-head"><button type="button" data-reading-action="new-chat" title="开始新对话">新对话</button></div>
    <div class="understand-result" role="log" aria-label="理解对话" aria-live="polite" aria-relevant="additions"></div>
    <p class="understand-status" role="status"></p>
    <div class="im-composer">
      <div class="im-attachments" aria-label="待发送的附件" hidden></div>
      <textarea id="understand-message" data-plain-text rows="2" maxlength="4000" aria-label="消息" placeholder="询问当前页面，或粘贴图片…"></textarea>
      <div class="im-composer-tools"><div><button type="button" data-reading-action="selection" title="引用网页中选中的文字">❝ 引用</button><button type="button" data-reading-action="images" title="添加图片">＋ 图片</button></div><button type="button" class="im-send" data-reading-action="send" aria-label="发送消息" title="发送">↑</button></div>
      <input id="understand-files" type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden>
    </div>
    <div class="im-chat-meta"><small>Enter 发送 · Shift + Enter 换行</small><button type="button" class="im-save" data-reading-action="prepare-thought" hidden>保存到想法</button></div>
    <details class="reading-source" hidden></details>
    <div class="understand-thought" hidden><label for="understand-thought-text">想法草稿</label><textarea id="understand-thought-text" data-plain-text rows="4" maxlength="20000"></textarea><p class="hint understand-destination"></p><div class="understand-thought-actions"><button type="button" data-reading-action="discard-thought">返回对话</button><button type="button" class="primary" data-reading-action="save-thought">确认保存</button></div></div>
    <p class="understand-save-status" role="status"></p>
  </div></details>`;
  const $=selector=>root.querySelector(selector),input=$('#understand-message');
  function renderSource() {
    const info=$('.reading-source'),material=conversation?.turns.length?conversation:null;
    const text=material?.context??snapshot?.text??'',images=material?.turns[0]?.images||snapshot?.images||[];
    info.hidden=!snapshot&&!loading;
    const status=loading?'正在读取页面':snapshot?.status==='readable'?'已获取页面内容':snapshot?.status==='partial'?'已获取部分页面内容':'未获取到页面内容';
    info.innerHTML=`<summary>${esc(material?material.scope:status)}</summary><p>${esc(material?material.reason:snapshot?.reason||'发送时读取当前已加载内容。')}</p>${text?`<pre>${esc(text)}</pre>`:''}${images.length?`<div class="source-images">${images.map(image=>`<img src="${esc(image.dataUrl)}" alt="${esc(image.label)}">`).join('')}</div>`:''}<small>内容与问答发送给 DeepSeek。对话暂存于侧栏，切换页面或关闭侧栏后清空。未联网搜索。</small>`;
  }
  function resizeInput(){input.style.height='auto';input.style.height=Math.min(160,Math.max(60,input.scrollHeight||60))+'px';}
  function renderDraft() {
    const attachments=$('.im-attachments');attachments.hidden=!draftQuote&&!draftImages.length;
    attachments.innerHTML=(draftQuote?`<div class="im-quote-attachment"><span>❝</span><div title="${esc(draftQuote.text)}">${esc(draftQuote.text)}</div><button type="button" data-reading-action="remove-quote" aria-label="移除引用">×</button></div>`:'')+draftImages.map(image=>`<figure><img src="${esc(image.dataUrl)}" alt="${esc(image.label)}"><button type="button" data-remove-understand="${image.id}" aria-label="移除图片">×</button></figure>`).join('');
    renderActions();resizeInput();
  }
  function renderActions() {
    const locked=requestPending||savingThought;
    input.disabled=locked;
    $('[data-reading-action=send]').disabled=locked||addingImages||selecting||(!input.value.trim()&&!draftQuote&&!draftImages.length);
    for(const button of root.querySelectorAll('[data-reading-action=selection],[data-reading-action=images],[data-reading-action=remove-quote],[data-remove-understand]'))button.disabled=locked||addingImages||selecting;
    $('[data-reading-action=new-chat]').disabled=savingThought||addingImages||selecting;
    const save=$('[data-reading-action=prepare-thought]'),turns=conversation?.turns.length||0;
    save.hidden=!turns;save.disabled=locked||!!thoughtDraft||savedThrough===turns;
    save.textContent=savedThrough&&savedThrough===turns?'已保存到想法':'保存到想法';
  }
  function messageHTML(turn) {
    return `<article class="understand-message user">${turn.source?`<blockquote>${esc(turn.source)}</blockquote>`:''}${turn.manualImages?.length?`<div class="im-message-images">${turn.manualImages.map(image=>`<img src="${esc(image.dataUrl)}" alt="${esc(image.label)}">`).join('')}</div>`:''}<div class="im-message-text">${esc(turn.question)}</div></article>`;
  }
  function renderChat() {
    renderActions();
    const log=$('.understand-result'),nearBottom=log.scrollHeight-log.scrollTop-log.clientHeight<60;
    const content=(conversation?.turns||[]).map(turn=>messageHTML(turn)+`<article class="understand-message assistant"><div class="markdown-body">${renderMarkdown(turn.answer)}</div>${turn.warning?`<p class="hint">${esc(turn.warning)}</p>`:''}</article>`).join('')+(pending?messageHTML(pending):'');
    if(log.innerHTML!==content){log.innerHTML=content;if(nearBottom||pending)log.scrollTop=log.scrollHeight;}
    $('.understand-status').textContent=chatError||(addingImages?'正在添加图片…':selecting?'正在引用…':requestPending?'正在回答…':'');
    $('.understand-status').classList.toggle('error',!!chatError);
  }
  function clearThought(){thoughtDraft=null;$('.understand-thought').hidden=true;$('.understand-save-status').textContent='';}
  function resetConversation(){explanation++;conversation=null;answerState=null;pending=null;requestPending=false;chatError='';savedThrough=0;draftQuote=null;draftImages=[];input.value='';clearThought();renderDraft();renderChat();}
  function pageChanged(){const next=pageKey(getPage());if(next===key)return;key=next;generation++;snapshot=null;loading=false;resetConversation();renderSource();}
  async function stillCurrent(capturedKey){return key===capturedKey&&pageKey(await adapter.page())===capturedKey;}
  async function read({ refresh = false } = {}) {
    pageChanged();
    if (!refresh && snapshot?.text) return snapshot;
    if (loading) throw new Error("原文正在获取，请稍候。");
    const target = { ...getPage() }, capturedKey = key, seq = ++generation;
    loading = true; renderSource();
    try {
      let result;
      const videoId = youtubeId(target.url);
      const note = videoId && getNotes().find(n => !n.deletedAt && !n.archived && n.transcripts?.some(t => t.videoId === videoId));
      const meta = note?.transcripts?.find(t => t.videoId === videoId);
      if (meta) {
        const { snapshot: transcript } = await adapter.cloud({ path: `/api/transcripts?note=${encodeURIComponent(note.id)}&id=${encodeURIComponent(meta.id)}` });
        const text = (transcript?.segments || []).map(s => s.text).join("\n");
        result = { url: target.url, title: target.title, text: text.slice(0, 40000), status: text.length > 40000 ? "partial" : "readable", truncated: text.length > 40000, reason: text.length > 40000 ? "使用已保存字幕的前 40,000 字，不包含视频画面。" : "使用已保存的 YouTube 字幕，不包含视频画面。" };
      } else result = await adapter.capture(target.id, "material");
      if (seq !== generation || !await stillCurrent(capturedKey) || canonical(result.url) !== canonical(target.url)) throw new Error("页面已切换，请在当前页面重新获取。");
      snapshot = { ...result, status: result.text?.trim() || result.images?.length ? result.status || "partial" : "unavailable", text: result.text?.trim() || "", reason: result.reason || "已获取当前可读文字，请检查内容是否完整。" };
      return snapshot;
    } catch (e) {
      if (seq === generation && await stillCurrent(capturedKey)) snapshot = { text: "", status: "unavailable", reason: e.message, url: target.url };
      throw e;
    } finally { if (seq === generation) { loading = false; renderSource(); } }
  }
  async function selectText() {
    if(requestPending||savingThought||selecting||addingImages)return;
    const capturedKey=key,seq=explanation,target={...getPage()};selecting=true;chatError='';renderChat();
    try{
      const selection=await adapter.capture(target.id,'selection');
      if(seq!==explanation||!await stillCurrent(capturedKey)||canonical(selection.url)!==canonical(target.url))return;
      if(!selection.text?.trim())throw new Error('先在网页选中文字，再点击「引用」。');
      draftQuote={text:selection.text.slice(0,20000),context:String(selection.context||'').slice(0,4000)};renderDraft();
    }catch(error){if(seq===explanation&&await stillCurrent(capturedKey))chatError=error.message;}
    finally{selecting=false;renderChat();}
  }
  async function send() {
    if(requestPending||savingThought||addingImages||selecting)return;
    const asked=input.value.trim(),quote=draftQuote&&structuredClone(draftQuote),manualImages=draftImages.map(({dataUrl,label})=>({dataUrl,label}));
    if(!asked&&!quote&&!manualImages.length)return;
    if(asked.length>4000)throw new Error('消息最多 4,000 字。');
    const capturedKey=key,seq=++explanation;
    const turn={question:asked||(quote?'帮我解释这段引用':'帮我解释这张图片'),source:quote?.text||'',quoteContext:quote?.context||'',manualImages};
    pending=turn;requestPending=true;chatError='';renderChat();
    try{
      if(!(await adapter.config()).configured){await settings();throw new Error('配置 DeepSeek 后即可开始对话。');}
      if(seq!==explanation||!await stillCurrent(capturedKey))return;
      if(!conversation?.turns.length){
        $('.understand-status').textContent='正在读取页面…';
        try{await read({refresh:true});}catch{/* The typed message or attachments remain usable without page extraction. */}
        if(seq!==explanation||!await stillCurrent(capturedKey))return;
        const automatic=(snapshot?.images||[]).slice(0,MAX_IMAGES-manualImages.length);
        turn.images=validImages([...manualImages,...automatic]);
        const scope=snapshot?.status==='readable'?'已获取页面内容':snapshot?.status==='partial'?'已获取部分页面内容':'未获取到页面内容';
        conversation={page:{...getPage()},title:getPage().title,context:contextForQuery(turn.source||asked,snapshot?.text||'',quote?.context||''),scope,reason:(snapshot?.reason||'仅依据消息回答。')+((snapshot?.images?.length||0)>automatic.length?' 部分页面图片未包含，优先使用你添加的图片。':''),turns:[]};
      }else turn.images=manualImages;
      const current=conversation,allImages=[...current.turns.flatMap(item=>item.images||[]),...turn.images];
      if(allImages.length>MAX_IMAGES)throw new Error(`本次对话最多 ${MAX_IMAGES} 张图片，请先保存想法，再开始新对话。`);
      validImages(allImages);
      $('.understand-status').textContent='正在回答…';
      const result=await adapter.understand({chat:true,question:turn.question,source:turn.source,quoteContext:turn.quoteContext,images:turn.images,title:current.title,context:current.context,scope:current.scope,turns:current.turns.map(requestTurn)});
      if(seq!==explanation||!await stillCurrent(capturedKey))return;
      current.turns.push({...turn,answer:result.text,warning:result.warning});
      const sources=current.turns.filter(item=>item.source).map(item=>item.source).join('\n\n');
      answerState={source:sources.length>20000?sources.slice(0,19980)+'\n（引用节选）':sources,question:current.turns[0].question,answer:result.text,turns:current.turns.map(({images,...item})=>{const {manualImages,warning,...text}=item;return text;}),page:current.page,images:current.turns.flatMap(item=>item.manualImages||[])};
      input.value='';draftQuote=null;draftImages=[];pending=null;
      if(!thoughtDraft)$('.understand-save-status').textContent='';
      renderDraft();renderSource();
    }catch(error){if(seq===explanation&&await stillCurrent(capturedKey)){chatError=error.message;pending=null;}}
    finally{if(seq===explanation){requestPending=false;renderChat();}}
  }
  async function prepareThought() {
    const note=getActive();if(!note)throw new Error('请先开始或选择目标笔记，再保存到想法。');
    if(!answerState||savingThought||requestPending||thoughtDraft||savedThrough===answerState.turns.length)return;
    const material=structuredClone(answerState),seq=explanation,capturedKey=key;
    savingThought=true;renderChat();$('.understand-save-status').textContent='正在整理这段对话…';
    try{
      const result=await adapter.understand({purpose:'thought',source:material.source,question:material.question,answer:material.answer,turns:material.turns});
      if(seq!==explanation||!await stillCurrent(capturedKey))return;
      thoughtDraft={id:crypto.randomUUID(),noteId:note.id,material,images:[]};
      $('#understand-thought-text').value=result.text;
      $('.understand-destination').textContent=`保存到「${note.title}」 · 基于前 ${material.turns.length} 轮对话整理`;
      $('.understand-thought').hidden=false;$('.understand-save-status').textContent='';
    }finally{savingThought=false;renderChat();}
  }
  async function commitThought() {
    if(savingThought||!thoughtDraft)return;
    const draft=thoughtDraft,seq=explanation,text=$('#understand-thought-text').value.trim();
    if(!text)throw new Error('请填写想法。');if(!saveThought)throw new Error('请安装插件后使用保存功能。');
    savingThought=true;renderChat();$('#understand-thought-text').readOnly=true;
    try{if(await saveThought({...draft,thought:text})===false)return;
      if(seq===explanation){savedThrough=draft.material.turns.length;$('.understand-thought').hidden=true;$('.understand-save-status').textContent='已保存为一条新的想法。';thoughtDraft=null;}
    }finally{savingThought=false;$('#understand-thought-text').readOnly=false;renderChat();}
  }
  async function addImages(files,text='',selection=null) {
    if(requestPending||savingThought)return;
    if(addingImages||selecting)throw new Error('附件正在准备，请稍候。');
    validateImageBatch(files);
    const used=conversation?.turns.flatMap(turn=>turn.images||[]).length||0;
    if(used+draftImages.length+files.length>MAX_IMAGES)throw new Error(`本次对话最多 ${MAX_IMAGES} 张图片，请先保存想法，再开始新对话。`);
    const capturedKey = key;
    const seq = explanation;
    addingImages = true; chatError = ''; renderChat();
    try{
      const added=[];for(const file of files)added.push({...await prepareImage(await blobDataUrl(file),file.name||'图片'),id:crypto.randomUUID()});
      if(seq!==explanation||!await stillCurrent(capturedKey))return;
      validImages([...(conversation?.turns.flatMap(turn=>turn.images||[])||[]),...draftImages,...added]);
      draftImages.push(...added);
      if(text){const start=selection?.start??input.value.length,end=selection?.end??start;if(input.value.length-(end-start)+text.length<=4000)input.value=input.value.slice(0,start)+text+input.value.slice(end);else chatError='图片已添加；粘贴文字超过 4,000 字，请缩短后再粘贴。';}
      renderDraft();
    }finally{addingImages=false;renderChat();}
  }
  function report(error){chatError=error.message;renderChat();}
  $('#understand-files').onchange=event=>{const files=[...event.target.files];event.target.value='';if(files.length)void addImages(files).catch(report);};
  $('.im-composer').addEventListener('paste',event=>{const files=transferImages(event.clipboardData);if(!files.length)return;event.preventDefault();void addImages(files,event.clipboardData.getData?.('text/plain')||'',{start:input.selectionStart,end:input.selectionEnd}).catch(report);});
  $('.im-composer').addEventListener('dragover',event=>{if([...event.dataTransfer.types].includes('Files'))event.preventDefault();});
  $('.im-composer').addEventListener('drop',event=>{const files=transferImages(event.dataTransfer);if(files.length){event.preventDefault();void addImages(files).catch(report);}});
  input.addEventListener('input',()=>{chatError='';resizeInput();renderActions();$('.understand-status').textContent='';});
  input.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing&&event.keyCode!==229){event.preventDefault();void send().catch(report);}});
  root.addEventListener('click',event=>{
    const remove=event.target.closest('[data-remove-understand]');if(remove){if(requestPending||savingThought)return;draftImages=draftImages.filter(image=>image.id!==remove.dataset.removeUnderstand);renderDraft();return;}
    const action=event.target.closest('[data-reading-action]')?.dataset.readingAction;if(!action)return;
    if(action==='new-chat'){if(savingThought||addingImages||selecting)return;if(thoughtDraft&&!window.confirm('想法草稿尚未保存，开始新对话会丢弃这份草稿。继续吗？'))return;resetConversation();renderSource();return;}
    if(action==='remove-quote'){if(requestPending||savingThought)return;draftQuote=null;renderDraft();return;}
    if(action==='images'){$('#understand-files').click();return;}
    if(action==='discard-thought'){if(!savingThought){clearThought();renderChat();}return;}
    if(action==='prepare-thought'||action==='save-thought'){void(action==='prepare-thought'?prepareThought():commitThought()).catch(error=>{$('.understand-save-status').textContent=error.message;});return;}
    if(action==='send')void send().catch(report);
    if(action==='selection')void selectText().catch(report);
  });
  pageChanged();return{pageChanged,read,snapshot:()=>snapshot};
}
