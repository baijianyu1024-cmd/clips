// A one-request port carries progress and a final result. Background validates sender and scope.
export function streamRequest(message,onProgress){
 if(!onProgress||!chrome.runtime.connect)return chrome.runtime.sendMessage(message).then(r=>{if(!r?.ok)throw Object.assign(new Error(r?.error||'插件连接中断，请重试。'),{status:r?.status});return r.data;});
 return new Promise((resolve,reject)=>{
  const port=chrome.runtime.connect({name:'clips-ai-stream'});let settled=false;
  const finish=(error,data)=>{if(settled)return;settled=true;clearTimeout(timer);port.disconnect();error?reject(error):resolve(data);};
  const timer=setTimeout(()=>finish(new Error('处理时间较长，请重新打开对话核对结果后重试。')),240000);
  port.onMessage.addListener(m=>{if(m.type==='progress'){onProgress(m.data);return;}if(m.type==='result')finish(m.ok?null:Object.assign(new Error(m.error||'请求失败，请重试。'),{status:m.status}),m.data);});
  port.onDisconnect.addListener(()=>finish(new Error('插件连接中断，请重试。')));
  port.postMessage(message);
 });
}
