import {useEffect,useState,type ImgHTMLAttributes} from 'react';
type Runtime={request?:typeof fetch;storage?:Pick<Storage,'getItem'|'setItem'|'removeItem'>;media?:(url:string)=>Promise<string>;page?:(path:string)=>string;queueTitles?:(urls:string[])=>Promise<{url:string;title:string}[]>;local?:boolean;settings?:()=>void};
let runtime:Runtime={};
export function configureClient(next:Runtime){runtime=next;}
export const isLocalLibrary=()=>!!runtime.local;
export const pageURL=(path:string)=>runtime.page?runtime.page(path):path;
export const openStorage=()=>runtime.settings?.();
export const request:typeof fetch=(input,init)=>runtime.request?runtime.request(input,init):fetch(input,init);
export const draftStorage={getItem:(key:string)=>(runtime.storage||localStorage).getItem(key),setItem:(key:string,value:string)=>(runtime.storage||localStorage).setItem(key,value),removeItem:(key:string)=>(runtime.storage||localStorage).removeItem(key)};
export const localQueueTitles=(urls:string[])=>runtime.queueTitles?.(urls);
export function MediaImage(props:ImgHTMLAttributes<HTMLImageElement>){
 const input=typeof props.src==='string'?props.src:'';
 const local=!!runtime.media&&input.startsWith('/api/media?');
 const [resolved,setResolved]=useState({input:'',src:'',error:false});
 useEffect(()=>{if(!local)return;let current=true;runtime.media!(input).then(src=>{if(current)setResolved({input,src,error:false});}).catch(()=>{if(current)setResolved({input,src:'',error:true});});return()=>{current=false;};},[input,local]);
 return <img {...props} src={local?(resolved.input===input?resolved.src||undefined:undefined):props.src} alt={local&&resolved.input===input&&resolved.error?(props.alt||'图片')+'（暂不可用）':props.alt}/>;
}
