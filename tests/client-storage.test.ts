import test from 'node:test';
import assert from 'node:assert/strict';
import {createContentStore} from '../src/lib/content-store.ts';
const sample=()=>({id:'original',ownerId:'owner-a',siteId:'hub2',title:'실제 원고',status:'draft',visibility:'private',revision:1,createdAt:'2026-10-01T00:00:00Z',content:{title:'실제 원고',intro:'본문',sections:[],faq:[],tags:[]}});
function driver(records=new Map<string,any>()) {
 const snapshot=(id:string)=>({id,exists:()=>records.has(id),data:()=>structuredClone(records.get(id))});
 const d:any={auth:{currentUser:{uid:'owner-a'}},db:{},doc:(_:any,c:string,id:string)=>id,collection:(_:any,c:string)=>c,where:()=>null,query:()=>null,getDoc:async(id:string)=>snapshot(id),getDocs:async()=>({docs:[...records.keys()].map(snapshot)}),setDoc:async(id:string,p:any)=>records.set(id,structuredClone(p)),deleteDoc:async(id:string)=>records.delete(id),runTransaction:async(_:any,fn:any)=>fn({get:async(id:string)=>snapshot(id),set:(id:string,p:any)=>records.set(id,structuredClone(p))})};
 return {d,records};
}
test('client writes and publishes one durable original document without an admin account',async()=>{
 const {d,records}=driver();const store=createContentStore(d);
 const created=await store.saveProject(sample(),undefined,true);
 assert.equal(created.visibility,'private');assert.equal(records.size,1);
 const published=await store.publishProject(created);
 assert.equal(published.visibility,'public');assert.equal(published.publishedArticleId,'original');
 assert.equal(records.size,1);
 const fresh=createContentStore(d);const restored=await fresh.loadProject('original');
 assert.equal(restored.content.intro,'본문');assert.equal(restored.status,'published');assert.equal(restored.ownerId,'owner-a');
});
test('failed client write rejects and does not report success or create a record',async()=>{
 const {d,records}=driver();d.setDoc=async()=>{throw Object.assign(new Error('denied'),{code:'permission-denied'})};
 await assert.rejects(createContentStore(d).saveProject(sample(),undefined,true),/Firebase 저장 권한/);
 assert.equal(records.size,0);
});
test('client storage rejects a foreign owner and stale edit revisions',async()=>{
 const {d}=driver();const store=createContentStore(d);const p=await store.saveProject(sample(),undefined,true);
 await assert.rejects(store.saveProject({...p,ownerId:'owner-b'},p.revision),/이 계정/);
 const revised=await store.saveProject({...p,content:{...p.content,intro:'수정됨'}},p.revision);
 await assert.rejects(store.saveProject(p,p.revision),/다른 변경/);
 assert.equal(revised.revision,2);assert.equal((await store.loadProject(p.id)).content.intro,'수정됨');
});
test('conversation persistence scopes thread IDs and restores saved messages',async()=>{
 const {d,records}=driver();const store=createContentStore(d);
 await store.saveThread('default_thread',[{id:'msg',role:'user',content:'내 대화',createdAt:'2026-10-01T00:00:00Z'}]);
 assert.ok(records.has('hub2_thread_owner-a_default_thread'));
 const restored=await store.loadThread('default_thread');assert.equal(restored.messages[0].content,'내 대화');
});
