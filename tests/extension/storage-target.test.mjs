import test from 'node:test';
import assert from 'node:assert/strict';
import {getTarget,setTarget,assertTarget,scopedStorage} from '../../extension/storage-target.js';
const data={};const base={get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,data[k]])),set:async values=>Object.assign(data,structuredClone(values)),remove:async keys=>(Array.isArray(keys)?keys:[keys]).forEach(k=>delete data[k])};
globalThis.chrome={storage:{local:base}};
test('local-only installations never infer a cloud connection from old browser data',async()=>{
 assert.equal(await getTarget(),null);data.activeNoteId='legacy-note';data['draft:legacy-note']={thought:'keep'};assert.equal(await getTarget(),null);data.clipsStorageTarget={mode:'cloud'};assert.equal(await getTarget(),null);await assert.rejects(setTarget({mode:'cloud'}),/配置无效/);assert.equal(data['draft:legacy-note'].thought,'keep');
});
test('distinct folder drafts and unconfigured state are isolated; stale pages reject a changed destination',async()=>{
 const a={mode:'local',id:crypto.randomUUID(),name:'A',connection:'one'},b={mode:'local',id:crypto.randomUUID(),name:'B',connection:'two'};
 await scopedStorage(a).set({activeNoteId:'same-note','draft:same-note':{thought:'A'}});await scopedStorage(b).set({'draft:same-note':{thought:'B'}});
 assert.equal((await scopedStorage(a).get('draft:same-note'))['draft:same-note'].thought,'A');assert.equal((await scopedStorage(b).get('draft:same-note'))['draft:same-note'].thought,'B');assert.equal((await scopedStorage({mode:'cloud'}).get('draft:same-note'))['draft:same-note'],undefined);
 await setTarget(a);await assertTarget(a);await setTarget(b);await assert.rejects(assertTarget(a),/已切换/);
});
