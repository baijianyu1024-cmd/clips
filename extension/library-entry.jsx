import {createRoot} from 'react-dom/client';
import {Component,useEffect,useRef,useState} from 'react';
import Notebook from '@/app/notebook';
import Sidebar from '@/app/sidebar';
import {configureClient} from '@/app/client-runtime';
import '@/app/globals.css';
import './learning.css';
import {adapter} from './adapter.js';
import {getTarget,targetKey} from './storage-target.js';
import {createLibraryPlatform} from './library-platform.js';
import {mountLearning} from './learning-ui.js';
import {streamRequest} from './stream-request.js';
const root=createRoot(document.getElementById('root'));
let target;
let changed=false;
function LibraryFailure(){return <main className="library-load-error" role="alert"><h1>笔记库暂时无法打开</h1><p>请重新加载页面，或检查资料库连接。此错误不会清空笔记文件。</p><button onClick={()=>location.reload()}>重新加载</button><a href={chrome.runtime.getURL('storage.html')}>资料库设置</a></main>;}
class LibraryBoundary extends Component{
 state={failed:false};
 static getDerivedStateFromError(){return {failed:true};}
 componentDidCatch(error){console.error('Clips library render failed',error);}
 render(){return this.state.failed?<LibraryFailure/>:this.props.children;}
}
function lockLibrary(){if(changed)return;changed=true;document.getElementById('root').inert=true;const banner=document.createElement('div');banner.setAttribute('role','alert');banner.className='library-storage-changed';banner.textContent='资料库已切换，请关闭此页并重新打开。未保存内容仍保留在原资料库。';document.body.append(banner);}
async function start(){
target=await adapter.target();
if(!target||target.mode!=='local'||new URL(location.href).searchParams.has('settings'))location.replace(chrome.runtime.getURL('storage.html'));
else{
 configureClient(createLibraryPlatform({adapter:{...adapter,target:getTarget},target,tabs:()=>chrome.tabs.query({}),baseURL:chrome.runtime.getURL('library.html'),onChanged:lockLibrary}));
 chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes.clipsStorageTarget&&targetKey(changes.clipsStorageTarget.newValue)!==targetKey(target))lockLibrary();});
 root.render(<LibraryBoundary>{location.pathname.endsWith('/learning.html')?<Learning/>:<Notebook/>}</LibraryBoundary>);
}
}
await start().catch(error=>{console.error('Clips library startup failed',error);root.render(<LibraryFailure/>);});
function Learning(){
 const ref=useRef(null),[notes,setNotes]=useState([]),[tags,setTags]=useState([]);
 useEffect(()=>{let current=true;adapter.cloud({}).then(r=>{if(current){setNotes(r.notes);setTags(r.tagState.tags.map(t=>t.name));}}).catch(()=>{});
  const run=(action,input,onProgress)=>streamRequest({type:'LEARNING',action,input,context:targetKey(target)},onProgress);
  const cleanup=mountLearning(ref.current,{draftStorage:adapter,request:r=>adapter.cloud(r),run,libraryURL:'library.html',noteURL:id=>'library.html?note='+id,chatId:new URL(location.href).searchParams.get('chat'),setChat:id=>history.replaceState(null,'','learning.html'+(id?'?chat='+id:'')),image:async key=>(await adapter.cloud({path:'/api/media?key='+encodeURIComponent(key)})).dataUrl,settings:()=>adapter.open(chrome.runtime.getURL('panel.html?settings=1'))});return()=>{current=false;cleanup();};
 },[]);
 return <div className="app-shell"><Sidebar notes={notes} tags={tags} view="learn"/><div className="workspace library-learning-workspace"><div ref={ref} className="learn-root"/></div></div>;
}
