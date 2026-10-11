import { collection, doc, getDoc, getDocs, query, where, setDoc, runTransaction, deleteDoc } from 'firebase/firestore';
import { auth, db } from './firebase';

export function createContentStore(driver: any = { auth, db, collection, doc, getDoc, getDocs, query, where, setDoc, runTransaction, deleteDoc }) {
  const { auth, db, collection, doc, getDoc, getDocs, query, where, setDoc, runTransaction, deleteDoc } = driver;
function user() { const u=auth.currentUser; if(!u) throw new Error('로그인이 필요합니다.'); return u; }
const clean = (x:any) => JSON.parse(JSON.stringify(x));
function normalizeProject(id:string,p:any) {
  const marker=p.sourceSite||p.siteId||p.themePersona;
  if(marker!=='hub2'||!p.ownerId) return null;
  const raw=p.content||p;
  const sections=(raw.sections||[]).map((s:any,i:number)=>({id:s.id||`section_${i+1}`,heading:s.heading||s.title||'',body:s.body||s.content||'',imageId:s.imageId,caption:s.caption||s.imageCaption,alt:s.alt||s.imageCaption||s.title||''}));
  return clean({...p,schemaVersion:1,id,siteId:'hub2',title:p.title||raw.title,keyword:p.keyword||'',tone:p.tone||'',audience:p.audience||'',revision:p.revision||1,updatedAt:p.updatedAt||p.createdAt,selectedImageIds:p.selectedImageIds||sections.map((s:any)=>s.imageId).filter(Boolean),content:{title:raw.title||p.title,description:raw.description||raw.metaDescription||raw.summary||'',intro:raw.intro||raw.summary||'',sections,closing:raw.closing||'',faq:raw.faq||[],tags:raw.tags||raw.seoTags||[]},...(p.status==='published'?{publishedArticleId:p.publishedArticleId||id}:{})});
}
function owned(p:any) { if(!p||p.ownerId!==user().uid||p.siteId!=='hub2') throw new Error('이 계정의 허브스튜디오2 원고가 아닙니다.'); return p; }
function failure(error:any):never { if(error?.code==='permission-denied') throw new Error('Firebase 저장 권한이 없습니다. publishedContents·contentProjects에서 로그인 계정의 자기 문서 읽기·쓰기를 허용해야 합니다.'); throw error; }
async function listProjects() {
  const uid=user().uid;
  try {
    const docs: any=await getDocs(query(collection(db,'publishedContents'),where('ownerId','==',uid)));
    return {items:docs.docs.map((d:any)=>normalizeProject(d.id,d.data())).filter(Boolean),warning:null};
  } catch(error:any) {
    if(error.code!=='permission-denied') throw error;
    const docs: any=await getDocs(query(collection(db,'publishedContents'),where('visibility','==','public')));
    return {items:docs.docs.map((d:any)=>normalizeProject(d.id,d.data())).filter((p:any)=>p&&p.ownerId===uid),warning:'내 공개 발행글을 불러왔습니다. 비공개 초안은 현재 읽기 권한이 없어 표시되지 않습니다.'};
  }
}
async function loadProject(id:string) {
  try { const d=await getDoc(doc(db,'publishedContents',id)); if(!d.exists()) throw new Error('원고를 찾을 수 없습니다.'); return owned(normalizeProject(d.id,d.data())); } catch(error) { return failure(error); }
}
async function saveProject(p:any,expectedRevision?:number,isNew=false) {
  owned(p);
  const ref=doc(db,'publishedContents',p.id);
  const data=clean({...p,ownerId:user().uid,siteId:'hub2',sourceSite:'hub2',themePersona:'hub2',type:'blog',updatedAt:new Date().toISOString(),visibility:p.status==='published'?'public':'private',publishedArticleId:p.status==='published'?p.id:undefined,revision:(expectedRevision??0)+1});
  try {
    if(isNew) { await setDoc(ref,data); return data; }
    await runTransaction(db,async (tx:any)=>{
      const current=await tx.get(ref); if(!current.exists()) throw new Error('원고를 찾을 수 없습니다.');
      const original=owned(normalizeProject(current.id,current.data()));
      if(expectedRevision!==undefined&&original.revision!==expectedRevision) throw new Error('다른 변경이 먼저 저장됐습니다. 새로고침 후 다시 시도하세요.');
      tx.set(ref,data,{merge:true});
    });
    return data;
  } catch(error) { return failure(error); }
}
async function publishProject(p:any) {
  if(p.review?.verdict==='hold') throw new Error('검수 보류 상태입니다. 문제를 수정한 뒤 발행하세요.');
  const saved = await saveProject({...p,status:'published',publishedAt:p.publishedAt||new Date().toISOString(),publishedArticleId:p.id},p.revision);
  return saved;
}
async function removeProject(id:string) { await loadProject(id); try{await deleteDoc(doc(db,'publishedContents',id));}catch(error){failure(error);} }
const threadId=(id:string)=>`hub2_thread_${user().uid}_${id}`;
async function listThreads() {
  try {
    const result: any=await getDocs(query(collection(db,'contentProjects'),where('ownerId','==',user().uid)));
    return result.docs.filter((d:any)=>d.data().recordType==='hub2Thread'&&d.data().sourceSite==='hub2').map((d:any)=>JSON.parse(d.data().payloadJson)).sort((a:any,b:any)=>b.updatedAt.localeCompare(a.updatedAt));
  } catch(error) { return failure(error); }
}
async function loadThread(id:string) { return (await listThreads()).find((t:any)=>t.id===id)||{id,messages:[]}; }
async function saveThread(id:string,messages:any[],job?:any) {
  const payload=clean({id,ownerId:user().uid,siteId:'hub2',title:messages.find(m=>m.role==='user')?.content?.slice(0,60)||'새 대화',createdAt:messages[0]?.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString(),messages:messages.slice(-50),...(job?{job}:{})});
  try {await setDoc(doc(db,'contentProjects',threadId(id)),{ownerId:user().uid,sourceSite:'hub2',recordType:'hub2Thread',updatedAt:payload.updatedAt,payloadJson:JSON.stringify(payload)});return payload;}catch(error){return failure(error);}
}
  return { user, owned, clean, normalizeProject, listProjects, loadProject, saveProject, publishProject, removeProject, listThreads, loadThread, saveThread };
}
const clientStore = createContentStore();
const { user, owned, clean } = clientStore;
export const { normalizeProject, listProjects, loadProject, saveProject, publishProject, removeProject, listThreads, loadThread, saveThread } = clientStore;

export async function clientRequest(url:string, options:RequestInit, remote:(url:string,options:RequestInit)=>Promise<Response>, context:{project?:any,images:any[],messages:any[]}) : Promise<Response> {
  const method=options.method||'GET';
  const body=options.body?JSON.parse(String(options.body)):{};
  const response=(data:any)=>Response.json(data);
  const projectRoute=url.match(/^\/api\/projects\/([^/]+)(\/publish)?$/);
  if(url==='/api/projects'&&method==='GET') return response(await listProjects());
  if(projectRoute) {
    const id=decodeURIComponent(projectRoute[1]);
    if(method==='GET') return response(await loadProject(id));
    if(method==='DELETE') {await removeProject(id);return response({success:true});}
    const p=context.project?.id===id?context.project:await loadProject(id);
    if(projectRoute[2]) {const saved=await publishProject(p);return response({success:true,articleId:saved.id,project:saved});}
    return response(await saveProject({...p,content:body.content||p.content},body.expectedRevision??p.revision));
  }
  if(url==='/api/agent/threads') return response({items:await listThreads()});
  if(url.startsWith('/api/agent/threads/')) return response({items:(await loadThread(decodeURIComponent(url.split('/').pop()!))).messages});
  const post=async(path:string,data:any)=>{
    const r=await remote(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
    return r.json();
  };
  if(url==='/api/editorial-plan') return response(await post(url,{...body,images:context.images}));
  if(url==='/api/blog/generate') {const generated=await post(url,body);return response(await saveProject(generated,undefined,true));}
  if(url==='/api/blog/review'||url==='/api/blog/replace-images') {
    const p=context.project?.id===body.projectId?context.project:await loadProject(body.projectId);
    owned(p);
    const result=await post(url,{...body,project:p,images:context.images});
    const next=url.endsWith('/review')?{...p,review:result}:result.project;
    const saved=await saveProject(next,p.revision);
    return response(url.endsWith('/review')?{...result,project:saved}:{...result,project:saved});
  }
  if(url==='/api/agent/jobs') {
    const uid=user().uid;
    const now=new Date().toISOString();
    const conversation=[...context.messages,{id:crypto.randomUUID(),role:'user',content:body.message,createdAt:now}];
    await saveThread(body.threadId,conversation);
    const interpretation=await post('/api/agent/interpret',{messages:conversation.slice(-30),project:context.project,images:context.images});
    const args=interpretation.toolArguments||{};
    let p=context.project;
    let report=interpretation.replyText||'';
    let result:any={};
    const tool=interpretation.toolToCall;
    if(tool==='generateBlog') {
      let chosen=context.images.filter(i=>(args.imageIds||[]).includes(i.id));
      if(!chosen.length) chosen=context.images.slice(0,3);
      const generated=await post('/api/blog/generate',{...args,topic:args.topic||body.message,imageIds:chosen.map(i=>i.id),images:chosen});
      p=await saveProject(generated,undefined,true);
      const review=await post('/api/blog/review',{project:p,projectId:p.id,images:context.images});
      p=await saveProject({...p,review},p.revision);
      if(body.autoPublish&&p.review?.verdict==='pass') p=await publishProject(p);
      report+=`\n\n**원고:** ${p.title}\n**검수:** ${p.review.verdict}\n**DB 저장:** 완료\n**발행:** ${p.status==='published'?'완료':'초안 보관'}`;
    } else if(tool==='recommendPlan') {
      result.plan=await post('/api/editorial-plan',{topic:args.topic||body.message,imageIds:args.imageIds||[],images:context.images});
      report+='\n\n'+JSON.stringify(result.plan,null,2);
    } else if(tool==='listImages') {
      const found=context.images.filter(i=>(!args.tag||i.tags.includes(args.tag))&&(!args.category||i.category===args.category));
      report+='\n\n'+found.map(i=>`- ${i.title}`).join('\n');
    } else if(['reviewBlog','replaceSectionImages','saveDraft','publishBlog'].includes(tool)) {
      if(!p) throw new Error('먼저 보관함에서 원고를 선택하세요.');
      owned(p);
      if(tool==='reviewBlog') p=await saveProject({...p,review:await post('/api/blog/review',{project:p,projectId:p.id,images:context.images})},p.revision);
      else if(tool==='replaceSectionImages') {
        if(!p.review) p={...p,review:await post('/api/blog/review',{project:p,projectId:p.id,images:context.images})};
        const changed=await post('/api/blog/replace-images',{project:p,projectId:p.id,images:context.images});
        p=await saveProject(changed.project,p.revision);report+=`\n\n이미지 ${changed.replacedCount}개 교체·DB 저장 완료`;
      } else if(tool==='publishBlog') p=await publishProject(p);
      else p=await saveProject(p,p.revision);
      report+=`\n\n**원고:** ${p.title}\n**DB 저장:** 완료${tool==='reviewBlog'?`\n**검수:** ${p.review.verdict}`:''}`;
    } else if(tool!=='replyOnly'&&tool) throw new Error('지원하지 않는 에이전트 작업입니다.');
    if (user().uid !== uid) throw new Error('로그인 계정이 변경됐습니다. 다시 시도하세요.');
    const job=clean({id:'job_'+crypto.randomUUID(),siteId:'hub2',ownerId:uid,threadId:body.threadId,requestId:body.requestId,projectId:p?.id,action:'create',status:'done',stage:'report',autoPublish:!!body.autoPublish,updatedAt:new Date().toISOString(),result:{...result,projectId:p?.id,publishedArticleId:p?.status==='published'?p.id:undefined}});
    const reply=clean({id:crypto.randomUUID(),role:'model',content:report,createdAt:new Date().toISOString(),jobId:job.id,projectSnapshot:p});
    await saveThread(body.threadId,[...conversation,reply],job);
    return response(job);
  }
  return remote(url,options);
}
