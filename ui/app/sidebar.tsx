'use client';
import {MediaImage, pageURL, isLocalLibrary, openStorage} from "./client-runtime";
import {Archive,ArrowDownToLine,BookOpen,FolderOpen,Inbox,Layers3,MessagesSquare,Plus} from 'lucide-react';
import type {Note} from './model';
type Props={notes:Note[];tags:string[];view:string;tag?:string;onNavigate?:(view:'all'|'inbox'|'archive')=>void;onTag?:(tag:string)=>void;onNew?:()=>void;onTags?:()=>void;onData?:()=>void};
export default function Sidebar({notes,tags,view,tag='',onNavigate,onTag,onNew,onTags,onData}:Props){
 const active=notes.filter(n=>!n.deletedAt&&!n.archived);
 const navigate=(value:'all'|'inbox'|'archive')=>onNavigate?onNavigate(value):location.assign(pageURL('/?view='+value));
 const nav=(value:'all'|'inbox'|'archive',label:string,Icon:typeof BookOpen,count=0)=><button aria-label={label} title={label} className={`nav-item ${view===value?'active':''}`} onClick={()=>navigate(value)}><Icon size={18}/><span>{label}</span>{!!count&&<span className="nav-count">{count}</span>}</button>;
 return <aside className="sidebar">
  <a className="brand" href={pageURL("/")} aria-label="Clips首页"><MediaImage src={pageURL("/favicon.svg")} alt=""/><span>Clips</span></a>
  <button className="primary new-note" title="添加笔记" onClick={()=>onNew?onNew():location.assign(pageURL('/?new=1'))}><Plus size={19}/>添加笔记<kbd>⌘ ⇧ N</kbd></button>
  <nav aria-label="笔记导航">{nav('all','笔记库',BookOpen,active.filter(n=>n.status!=='inbox').length)}{nav('inbox','待阅读',Inbox,active.filter(n=>n.status==='inbox').length)}<a className={`nav-item ${view==='learn'?'active':''}`} href={pageURL("/learn")} title="对话" aria-current={view==='learn'?'page':undefined}><MessagesSquare size={18}/><span>对话</span></a></nav>
  <div className="topics"><div className="sidebar-label">标签 <button className="manage-tags-link" aria-label="管理标签" onClick={()=>onTags?onTags():location.assign(pageURL('/?manage=tags'))}>管理</button></div>{tags.length?tags.map(t=><button key={t} className={`topic ${tag===t?'selected':''}`} onClick={()=>onTag?onTag(tag===t?'':t):location.assign(pageURL('/?tag='+encodeURIComponent(t)))}><span>#</span>{t}</button>):<p className="topic-hint">暂无标签</p>}</div>
  <div className="sidebar-bottom"><a className="nav-item" href={pageURL("/extension-bridge")} title={isLocalLibrary()?"阅读设置":"浏览器插件"}><Layers3 size={17}/><span>{isLocalLibrary()?"阅读设置":"浏览器插件"}</span></a>{nav('archive','已归档',Archive)}<button className="nav-item" title="导入与导出" aria-label="导入与导出" onClick={()=>onData?onData():location.assign(pageURL('/?manage=data'))}><ArrowDownToLine size={17}/><span>导入与导出</span></button>{isLocalLibrary()&&<button className="nav-item" title="资料库与备份" aria-label="资料库与备份" onClick={openStorage}><FolderOpen size={17}/><span>资料库与备份</span></button>}<div className="personal"><span className="avatar">{isLocalLibrary()?"C":"K"}</span><div>我的笔记<small>{isLocalLibrary()?"本地文件夹":"仅自己可见"}</small></div><span className="status-dot" title="私人笔记空间"/></div></div>
 </aside>;
}
