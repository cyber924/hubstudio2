import test from 'node:test';
import assert from 'node:assert/strict';
import {createContentStore} from '../src/lib/content-store.ts';
import {createFirestoreRest,encodeFields,decodeFields} from '../src/lib/firestore-rest.ts';
const sample=()=>({id:'original',ownerId:'owner-a',siteId:'hub2',title:'실제 원고',status:'draft',visibility:'private',revision:1,createdAt:'2026-10-01T00:00:00Z',content:{title:'실제 원고',intro:'본문',sections:[],faq:[],tags:[]}});
function driver(){
 const records=new Map<string,any>();let version=0;
 const d:any={user:()=>({uid:'owner-a'}),query:async(c:string,filters:any[])=>[...records.values()].filter(p=>p._collection===c&&filters.every(([k,v])=>p[k]===v)),get:async(c:string,id:string)=>structuredClone(records.get(`${c}/${id}`)||null),write:async(c:string,id:string,p:any,time?:string,create=false)=>{
  const key=`${c}/${id}`,old=records.get(key);
  if(create&&old)throw Object.assign(new Error('exists'),{status:409});
  if(time&&old?._updateTime!==time)throw Object.assign(new Error('conflict'),{status:412});
  const next={...structuredClone(p),id,_collection:c,_updateTime:String(++version)};records.set(key,next);return next;
 },remove:async(c:string,id:string)=>records.delete(`${c}/${id}`)};
 d.commit=async(writes:any[])=>{
  for(const w of writes){const old=records.get(`${w.collection}/${w.id}`);if(w.delete?old?._updateTime!==w.updateTime:!!old)throw Object.assign(new Error('conflict'),{status:412});}
  for(const w of writes){if(w.delete)records.delete(`${w.collection}/${w.id}`);else await d.write(w.collection,w.id,w.data,undefined,true);}
 };
 return {d,records};
}
test('Hub1 schema stores a private agentDraft and atomically publishes contentJson at the original ID',async()=>{
 const {d,records}=driver();const store=createContentStore(d),created=await store.saveProject(sample(),undefined,true);
 const draft=records.get('contentProjects/original');assert.equal(draft.recordType,'agentDraft');assert.equal(draft.visibility,'private');assert.equal(JSON.parse(draft.contentJson).intro,'본문');assert.equal(draft.content,undefined);
 const restored=await createContentStore(d).loadProject('original');assert.equal(restored.content.intro,'본문');
 const published=await store.publishProject(created);assert.equal(published.visibility,'public');assert.equal(published.publishedArticleId,'original');assert.equal(records.has('contentProjects/original'),false);assert.equal(records.get('publishedContents/original').status,'published');
 assert.equal((await createContentStore(d).listProjects()).items.length,1);
});
test('failed publication leaves the private draft intact and reports no success',async()=>{
 const {d,records}=driver();const store=createContentStore(d),p=await store.saveProject(sample(),undefined,true);
 d.commit=async()=>{throw Object.assign(new Error('denied'),{code:'permission-denied'})};
 await assert.rejects(store.publishProject(p),(e:any)=>e.collection==='publishedContents'&&e.operation==='저장');
 assert.equal(records.has('contentProjects/original'),true);assert.equal(records.has('publishedContents/original'),false);
});
test('client storage rejects foreign owners, stale revisions and updateTime races',async()=>{
 const {d}=driver();const store=createContentStore(d),p=await store.saveProject(sample(),undefined,true);
 await assert.rejects(store.saveProject({...p,ownerId:'owner-b'},p.revision),/이 계정/);
 await store.saveProject({...p,content:{...p.content,intro:'수정됨'}},p.revision);
 await assert.rejects(store.saveProject(p,p.revision),/다른 변경/);
 const current=await store.loadProject(p.id);d.write=async()=>{throw Object.assign(new Error('race'),{status:412})};
 await assert.rejects(store.saveProject(current,current.revision),/다른 변경/);
});
test('Hub1 reviewMessage records restore chats and do not rewrite existing messages',async()=>{
 const {d,records}=driver();const store=createContentStore(d),m={id:'msg',role:'user',content:'내 대화',createdAt:'2026-10-01T00:00:00Z'};
 await store.saveThread('default_thread',[m]);await store.saveThread('default_thread',[m]);
 assert.equal(records.size,1);const record=records.get('contentProjects/review_hub2_owner-a_default_thread_msg');
 assert.equal(record.recordType,'reviewMessage');assert.equal(record.text,'내 대화');assert.equal(record.payloadJson,undefined);
 assert.equal((await createContentStore(d).loadThread('default_thread')).messages[0].content,'내 대화');
 records.set('contentProjects/other',{...record,id:'other',ownerId:'owner-b'});
 assert.equal((await store.loadThread('default_thread')).messages.length,1);
});
test('permission failures identify private draft versus conversation operations',async()=>{
 const {d}=driver();d.write=async()=>{throw Object.assign(new Error('denied'),{code:'permission-denied'})};
 await assert.rejects(createContentStore(d).saveProject(sample(),undefined,true),(e:any)=>e.collection==='contentProjects'&&e.operation==='저장');
 await assert.rejects(createContentStore(d).saveThread('default',[{id:'m',content:'hi',role:'user',createdAt:'2026-10-01T00:00:00Z'}]),(e:any)=>e.operation==='대화 저장');
});
test('REST transport sends current Firebase bearer tokens and refreshes once before rejecting denied writes',async()=>{
 const seen:any[]=[],tokens:any[]=[];
 const rest=createFirestoreRest({auth:{currentUser:{uid:'owner-a',getIdToken:async(force:boolean)=>{tokens.push(force);return force?'fresh-token':'old-token';}}},fetch:async(url:string,init:any)=>{seen.push({url,...init});return Response.json({error:{message:'denied'}},{status:403});}});
 await assert.rejects(rest.write('contentProjects','draft',sample(),undefined,true),(e:any)=>e.code==='permission-denied');
 assert.deepEqual(tokens,[false,true]);assert.equal(seen.length,2);assert.equal(seen[1].headers.Authorization,'Bearer fresh-token');assert.ok(seen[0].url.includes('/contentProjects?documentId=draft'));assert.equal(seen[0].method,'POST');assert.equal(JSON.parse(seen[0].body).fields.ownerId.stringValue,'owner-a');
});
test('REST missing private get uses an authenticated owner query and preserves denied queries as errors',async()=>{
 const seen:any[]=[];
 const rest=createFirestoreRest({auth:{currentUser:{uid:'owner-a',getIdToken:async()=> 'token'}},fetch:async(url:string,init:any)=>{seen.push({url,...init});if(url.includes(':runQuery'))return Response.json([]);return Response.json({error:{message:'denied'}},{status:403});}});
 assert.equal(await rest.get('contentProjects','not-created'),null);
 const q=JSON.parse(seen.at(-1).body).structuredQuery;assert.equal(q.where.fieldFilter.field.fieldPath,'ownerId');assert.equal(q.where.fieldFilter.value.stringValue,'owner-a');assert.equal(seen.at(-1).headers.Authorization,'Bearer token');
});
test('REST field codec preserves booleans, arrays, nested review data and JSON strings',()=>{
 const value={ownerId:'me',revision:2,flag:false,nested:{tags:['one'],null:null},contentJson:'{"intro":"내용"}'};
 assert.deepEqual(decodeFields(encodeFields(value)),value);
});
