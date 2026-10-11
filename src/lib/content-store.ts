import { createFirestoreRest } from './firestore-rest';

export function createContentStore(driver:any=createFirestoreRest()) {
const {user}=driver;
const clean=(x:any)=>JSON.parse(JSON.stringify(x));
function normalizeProject(id:string,p:any) {
  if(!p||(p.sourceSite||p.siteId||p.themePersona)!=='hub2'||!p.ownerId)return null;
  let raw=p.content||p;
  if(p.contentJson){try{raw=JSON.parse(p.contentJson);}catch{throw new Error('저장된 원고 형식을 확인해주세요.');}}
  const sections=(raw.sections||[]).map((s:any,i:number)=>({id:s.id||`section_${i+1}`,heading:s.heading||s.title||'',body:s.body||s.content||'',imageId:s.imageId,caption:s.caption||s.imageCaption,alt:s.alt||s.imageCaption||s.title||''}));
  return clean({...p,schemaVersion:1,id,siteId:'hub2',title:p.title||raw.title,keyword:p.keyword||'',tone:p.tone||'',audience:p.audience||'',revision:p.revision||1,updatedAt:p.updatedAt||p.createdAt,selectedImageIds:p.selectedImageIds||p.imageIds||sections.map((s:any)=>s.imageId).filter(Boolean),content:{title:raw.title||p.title,description:raw.description||raw.metaDescription||raw.summary||'',intro:raw.intro||raw.summary||'',sections,closing:raw.closing||'',faq:raw.faq||[],tags:raw.tags||raw.seoTags||[]},...(p.status==='published'?{publishedArticleId:p.publishedArticleId||id}:{})});
}
function owned(p:any){if(!p||p.ownerId!==user().uid||p.siteId!=='hub2')throw new Error('이 계정의 허브스튜디오2 원고가 아닙니다.');return p;}
function failure(error:any,collection:string,operation:string):never{
 if(error?.code==='permission-denied')throw Object.assign(new Error(`Firebase ${operation} 권한 거절 (${collection}). 현재 로그인 계정의 원본 DB 요청이 거절됐습니다.`),{code:error.code,collection,operation});
 if(error?.status===409||error?.status===412)throw new Error('다른 변경이 먼저 저장됐습니다. 새로고침 후 다시 시도하세요.');
 throw error;
}
async function listProjects(){
 const uid=user().uid;const publicDocs=await driver.query('publishedContents',[['visibility','public']],true);
 let draftDocs:any[];
 try{draftDocs=await driver.query('contentProjects',[['ownerId',uid],['recordType','agentDraft']]);}catch(error){return failure(error,'contentProjects','초안 읽기');}
 const items=[...publicDocs,...draftDocs].map((d:any)=>normalizeProject(d.id,d)).filter((p:any)=>p&&p.ownerId===uid&&p.status!=='deleted');
 const unique=new Map<string,any>();for(const p of items)if(!unique.has(p.id))unique.set(p.id,p);
 return {items:[...unique.values()],warning:null};
}
async function loadProject(id:string){
 for(const collection of ['publishedContents','contentProjects']){
  try{const p=await driver.get(collection,id);if(p)return owned(normalizeProject(id,p));}catch(error){return failure(error,collection,'읽기');}
 }
 throw new Error('원고를 찾을 수 없습니다.');
}
function serialize(p:any){
 const {_collection,_updateTime,contentJson,content,id,recordType,...data}=p;
 return clean({...data,ownerId:user().uid,sourceSite:'hub2',siteId:'hub2',themePersona:'hub2',type:'blog',imageIds:p.selectedImageIds||[],contentJson:JSON.stringify(content),...(p.status==='published'?{}:{recordType:'agentDraft'})});
}
async function saveProject(p:any,expectedRevision?:number,isNew=false){
 owned(p);const collection=p.status==='published'?'publishedContents':'contentProjects';
 try{
  let current:any=null;
  if(!isNew){current=await loadProject(p.id);if(expectedRevision!==undefined&&current.revision!==expectedRevision)throw new Error('다른 변경이 먼저 저장됐습니다. 새로고침 후 다시 시도하세요.');}
  owned(p);
  const next=clean({...p,updatedAt:new Date().toISOString(),visibility:p.status==='published'?'public':'private',publishedArticleId:p.status==='published'?p.id:undefined,revision:(expectedRevision??0)+1});
  const data=serialize(next);
  if(current&&current._collection!==collection){
   const destination=await driver.get(collection,p.id);
   if(destination){owned(normalizeProject(p.id,destination));throw new Error('이미 발행된 문서입니다. 새로고침 후 다시 시도하세요.');}
   owned(p);
   await driver.commit([{collection,id:p.id,data},{collection:current._collection,id:p.id,delete:true,updateTime:current._updateTime}]);
   return owned(normalizeProject(p.id,await driver.get(collection,p.id)));
  }
  const stored=await driver.write(collection,p.id,data,current?._updateTime,isNew||!current);
  return owned(normalizeProject(p.id,stored));
 }catch(error){return failure(error,collection,'저장');}
}
async function publishProject(p:any){
 if(p.review?.verdict==='hold')throw new Error('검수 보류 상태입니다. 문제를 수정한 뒤 발행하세요.');
 return saveProject({...p,status:'published',publishedAt:p.publishedAt||new Date().toISOString()},p.revision);
}
async function removeProject(id:string){const p=await loadProject(id);try{owned(p);await driver.remove(p._collection,id,p._updateTime);}catch(error){failure(error,p._collection,'삭제');}}
const articleId=(id:string)=>`hub2_${user().uid}_${id}`;
async function listThreads(){
 try{
  const uid=user().uid;
  const rows=await driver.query('contentProjects',[['ownerId',uid],['recordType','reviewMessage']]);
  const groups=new Map<string,any>();
  for(const m of rows){
   if(m.sourceSite!=='hub2'||!m.articleId?.startsWith(`hub2_${uid}_`))continue;
   const id=m.articleId.slice(`hub2_${uid}_`.length);
   let t=groups.get(id);if(!t){t={id,messages:[],updatedAt:m.createdAt,title:'새 대화'};groups.set(id,t);}
   t.messages.push({id:m.messageId,role:m.role==='assistant'?'model':m.role,content:m.text,createdAt:m.createdAt,...(m.resultJson?JSON.parse(m.resultJson):{})});
   if(m.createdAt>t.updatedAt)t.updatedAt=m.createdAt;
  }
  for(const t of groups.values()){t.messages.sort((a:any,b:any)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));t.title=t.messages.find((m:any)=>m.role==='user')?.content.slice(0,60)||'새 대화';t.messages=t.messages.slice(-50);}
  return [...groups.values()].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
 }catch(error){return failure(error,'contentProjects','대화 읽기');}
}
async function loadThread(id:string){return (await listThreads()).find((t:any)=>t.id===id)||{id,messages:[]};}
async function saveThread(id:string,messages:any[],job?:any){
 const uid=user().uid,article=articleId(id);
 try{
  const existingIds=new Set((await loadThread(id)).messages.map((m:any)=>m.id));
  for(const m of messages.slice(-50).filter((m:any)=>!existingIds.has(m.id))){
   const {id:messageId,role,content,createdAt,...extra}=m;
   const data=clean({ownerId:uid,sourceSite:'hub2',articleId:article,recordType:'reviewMessage',messageId,role:role==='model'?'assistant':role,kind:role==='user'?'request':'report',text:content,createdAt,resultJson:JSON.stringify({...extra,...(job&&m===messages.at(-1)?{job}:{})})});
   try{await driver.write('contentProjects',`review_${article}_${messageId}`,data,undefined,true);}
   catch(error:any){if(error.status!==409)throw error;const existing=await driver.get('contentProjects',`review_${article}_${messageId}`);if(existing?.ownerId!==uid||existing.text!==content)throw new Error('대화 저장 충돌입니다. 새로고침 후 다시 시도하세요.');}
  }
  return {id,messages:messages.slice(-50),job};
 }catch(error){return failure(error,'contentProjects','대화 저장');}
}
return {user,owned,clean,normalizeProject,listProjects,loadProject,saveProject,publishProject,removeProject,listThreads,loadThread,saveThread};
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
