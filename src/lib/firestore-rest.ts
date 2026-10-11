import { auth } from './firebase';
export const FIREBASE_PROJECT_ID = 'studio-9240700230-1dd9a';
const KEY = 'AIzaSyDEpFAsf1fI65xXklKYsukAWFYw5bzaHyc';
const BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;
export function encodeFields(data:any):any {
  const value=(x:any):any=> x===null?{nullValue:null}:Array.isArray(x)?{arrayValue:{values:x.map(value)}}:typeof x==='object'?{mapValue:{fields:encodeFields(x)}}:typeof x==='boolean'?{booleanValue:x}:typeof x==='number'?(Number.isInteger(x)?{integerValue:String(x)}:{doubleValue:x}):{stringValue:String(x)};
  return Object.fromEntries(Object.entries(data).filter(([,x])=>x!==undefined).map(([k,x])=>[k,value(x)]));
}
export function decodeFields(fields:any):any {
  const value=(x:any):any=>x.mapValue?decodeFields(x.mapValue.fields||{}):x.arrayValue?(x.arrayValue.values||[]).map(value):x.integerValue!==undefined?Number(x.integerValue):x.stringValue??x.timestampValue??x.booleanValue??x.doubleValue??null;
  return Object.fromEntries(Object.entries(fields||{}).map(([k,x])=>[k,value(x)]));
}
export function createFirestoreRest(driver:any={auth,fetch:(...args:any[])=>globalThis.fetch(args[0],args[1])}) {
  function user(){const u=driver.auth.currentUser;if(!u)throw new Error('로그인이 필요합니다.');return u;}
  async function request(path:string,init:any={},publicRead=false) {
    const account=publicRead?null:user();
    const send=async(force=false)=>{
      const token=account?await account.getIdToken(force):undefined;
      if(account&&user().uid!==account.uid)throw new Error('로그인 계정이 변경됐습니다. 다시 시도하세요.');
      return driver.fetch(`${BASE}${path}${path.includes('?')?'&':'?'}key=${KEY}`,{signal:AbortSignal.timeout(20000),...init,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})}});
    };
    let r=await send();
    if(account&&(r.status===401||r.status===403))r=await send(true);
    const body=await r.json().catch(()=>null);
    if(!r.ok)throw Object.assign(new Error(body?.error?.message||`Firebase 요청 실패 (${r.status})`),{code:r.status===403?'permission-denied':body?.error?.status,status:r.status});
    if(account&&user().uid!==account.uid)throw new Error('로그인 계정이 변경됐습니다. 다시 시도하세요.');
    return body;
  }
  function decode(d:any){return {...decodeFields(d.fields),_collection:d.name.split('/').at(-2),_updateTime:d.updateTime,id:d.name.split('/').pop()};}
  async function query(collection:string,filters:[string,string][],publicRead=false) {
    const results:any[]=[];let after:string|undefined;
    do {
      const parts=filters.map(([field,v])=>({fieldFilter:{field:{fieldPath:field},op:'EQUAL',value:{stringValue:v}}}));
      const structuredQuery:any={from:[{collectionId:collection}],where:parts.length===1?parts[0]:{compositeFilter:{op:'AND',filters:parts}},orderBy:[{field:{fieldPath:'__name__'},direction:'ASCENDING'}],limit:100};
      if(after)structuredQuery.startAt={values:[{referenceValue:after}],before:false};
      const rows=await request(':runQuery',{method:'POST',body:JSON.stringify({structuredQuery})},publicRead);
      const docs=rows.filter((row:any)=>row.document).map((row:any)=>row.document);
      results.push(...docs.map(decode));after=docs.length===100?docs.at(-1).name:undefined;
    }while(after);
    return results;
  }
  async function get(collection:string,id:string) {
    try{return decode(await request(`/${collection}/${encodeURIComponent(id)}`));}
    catch(error:any){
      if(error.status===404)return null;
      if(error.status!==403)throw error;
      // Same owner-scoped query fallback as Hub Studio 1: rules may deny
      // a get on a missing private document. Never turn a denied query into [].
      const rows=await query(collection,collection==='publishedContents'?[['visibility','public']]:[['ownerId',user().uid]] ,collection==='publishedContents');
      return rows.find((p:any)=>p.id===id)||null;
    }
  }
  async function write(collection:string,id:string,data:any,updateTime?:string,isNew=false) {
    if(data.ownerId!==user().uid)throw new Error('이 계정의 문서가 아닙니다.');
    const fields=encodeFields(data);
    const path=isNew?`/${collection}?documentId=${encodeURIComponent(id)}`:`/${collection}/${encodeURIComponent(id)}${updateTime?`?currentDocument.updateTime=${encodeURIComponent(updateTime)}`:''}`;
    return decode(await request(path,{method:isNew?'POST':'PATCH',body:JSON.stringify({fields})}));
  }
  async function remove(collection:string,id:string,updateTime?:string){return request(`/${collection}/${encodeURIComponent(id)}${updateTime?`?currentDocument.updateTime=${encodeURIComponent(updateTime)}`:''}`,{method:'DELETE'});}
  // Publishing and retiring the private draft must succeed together.
  async function commit(writes:any[]){
    if(writes.some(w=>!w.delete&&w.data.ownerId!==user().uid))throw new Error('이 계정의 문서가 아닙니다.');
    return request(':commit',{method:'POST',body:JSON.stringify({writes:writes.map(w=>w.delete?{delete:`${BASE.replace('https://firestore.googleapis.com/v1/','')}/${w.collection}/${w.id}`,currentDocument:{updateTime:w.updateTime}}:{update:{name:`${BASE.replace('https://firestore.googleapis.com/v1/','')}/${w.collection}/${w.id}`,fields:encodeFields(w.data)},currentDocument:w.updateTime?{updateTime:w.updateTime}:{exists:false}})})});
  }
  return {user,query,get,write,remove,commit};
}
