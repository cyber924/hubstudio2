import test from 'node:test';
import assert from 'node:assert/strict';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';

process.env.VERCEL = '1';
process.env.NODE_ENV = 'production';
process.env.SITE_URL = 'https://hubstudio2.vercel.app';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:9999';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
const { db } = await import('../server/db.js');
const { default: handler } = await import('../api/index.js');
const { adminAuth } = await import('../server/firebase-admin.js');
// Mock only emulator user lookup; token claim validation still runs in the SDK.
adminAuth().getUser = async uid => ({ uid, disabled: false, tokensValidAfterTime: '1970-01-01T00:00:00Z' }) as any;

const fixtures = Array.from({ length: 6 }, (_, i) => ({
  schemaVersion: 1 as const, id: `test_project_${i}`, siteId: 'hub2', ownerId: 'owner-a',
  title: '같은 제목도 다른 글이면 모두 표시', keyword: 'test', tone: 'test', audience: 'test',
  status: 'published' as const, visibility: 'public' as const, selectedImageIds: [], revision: 1,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z',
  publishedArticleId: `test_article_${i}`,
  content: { title: '제목 <script>alert(1)</script>', description: '따옴표 " & 설명',
    intro: '실제 본문 시작', sections: [{ id: 's1', heading: '소제목', body: '읽을 수 있는 본문' }],
    closing: '마무리', faq: [], tags: [] },
}));
db.getProjectsOnSite = async () => structuredClone(fixtures);
db.getProjects = async (_site, owner) => structuredClone(fixtures.filter(p => p.ownerId === owner));
db.getProjectById = async id => structuredClone(fixtures.find(p => p.id === id || p.publishedArticleId === id) || null);
// Exercise the actual Express/Vercel adapter without opening a network listener.
function exchange(url: string, options: RequestInit = {}): Promise<Response> {
  return new Promise((resolve, reject) => {
    const request = new IncomingMessage(new Socket());
    request.url = new URL(url, 'http://localhost').pathname + new URL(url, 'http://localhost').search;
    request.method = options.method || 'GET';
    request.headers = Object.fromEntries(new Headers(options.headers).entries());
    request.headers.host = 'localhost';
    if (options.body) request.headers['content-length'] = String(Buffer.byteLength(String(options.body)));
    const response = new ServerResponse(request);
    const chunks: Buffer[] = [];
    response.write = ((chunk: any) => { chunks.push(Buffer.from(chunk)); return true; }) as any;
    response.end = ((chunk: any) => {
      if (chunk) chunks.push(Buffer.from(chunk));
      const headers = new Headers();
      for (const [key, value] of Object.entries(response.getHeaders())) headers.set(key, String(value));
      resolve(new Response(Buffer.concat(chunks), { status: response.statusCode, headers }));
      return response;
    }) as any;
    try { handler(request as any, response as any); if (options.body) request.push(String(options.body)); request.push(null); } catch (error) { reject(error); }
  });
}
const base = 'http://localhost';
const request = (path: string, options?: RequestInit) => exchange(`${base}/api/index?__route=${encodeURIComponent(path)}`, options);

test('rewrite preserves query and public API returns all six distinct projects as JSON', async () => {
  const response = await exchange(`${base}/api/index?__route=/api/projects&status=published`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type')!, /application\/json/);
  assert.equal((await response.json()).items.length, 6);
});

test('private archive rejects missing and forged UID authentication', async () => {
  assert.equal((await request('/api/projects')).status, 401);
  assert.equal((await request('/api/projects', { headers: { Authorization: 'Bearer owner-a' } })).status, 401);
});

test('emulator ID tokens scope the archive to their verified UID', async () => {
  const token = (uid: string) => {
    const now = Math.floor(Date.now() / 1000);
    const encode = (value: any) => Buffer.from(JSON.stringify(value)).toString('base64url');
    return `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ sub: uid, user_id: uid, aud: 'studio-9240700230-1dd9a', iss: 'https://securetoken.google.com/studio-9240700230-1dd9a', iat: now, exp: now + 3600, auth_time: now, firebase: { sign_in_provider: 'password' } })}.`;
  };
  for (const [uid, count] of [['owner-a', 6], ['owner-b', 0]] as const) {
    const response = await request('/api/projects', { headers: { Authorization: `Bearer ${token(uid)}` } });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).items.length, count);
  }
});

test('home and webzine initial HTML contain actual detail anchors', async () => {
  for (const path of ['/', '/webzine', '/blog']) {
    const response = await request(path);
    assert.equal(response.status, 200);
    const html = await response.text();
    for (const project of fixtures) assert.ok(html.includes(`href="/blog/${project.publishedArticleId}"`));
    assert.equal((html.match(/rel="canonical"/g) || []).length, 1);
  }
});

test('article contains escaped body, unique metadata, safe bootstrap and BlogPosting', async () => {
  const response = await request('/blog/test_article_0');
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.ok(html.includes('읽을 수 있는 본문'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.equal((html.match(/rel="canonical"/g) || []).length, 1);
  assert.equal((html.match(/name="description"/g) || []).length, 1);
  const schema = JSON.parse(html.match(/id="hub-studio-jsonld">(.*?)<\/script>/s)![1]);
  assert.equal(schema['@type'], 'BlogPosting');
  assert.equal(schema.datePublished, fixtures[0].updatedAt);
  assert.ok(html.includes('https://hubstudio2.vercel.app/blog/test_article_0'));
});

test('missing and unpublished details return real 404; project alias redirects once', async () => {
  assert.equal((await request('/blog/nonexistent')).status, 404);
  const alias = await request('/blog/test_project_0', { redirect: 'manual' });
  assert.equal(alias.status, 308);
  assert.equal(alias.headers.get('location'), 'https://hubstudio2.vercel.app/blog/test_article_0');
  const original = db.getProjectById;
  try {
    db.getProjectById = async () => ({ ...fixtures[0], status: 'draft' });
    assert.equal((await request('/blog/test_article_0')).status, 404);
    assert.equal((await request('/api/blog/public/test_article_0')).status, 404);
    db.getProjectById = async () => ({ ...fixtures[0], updatedAt: '2099-01-01T00:00:00Z' });
    assert.equal((await request('/blog/test_article_0')).status, 404);
  } finally { db.getProjectById = original; }
});

test('DB-backed image is served through a public HTTPS-compatible image endpoint', async () => {
  const image = db.getImages().find(image => image.thumbnailUrl.startsWith('data:'));
  assert.ok(image);
  const response = await request(`/api/images/${image.id}/public`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type')!, /^image\//);
  assert.ok((await response.arrayBuffer()).byteLength > 100);
});

test('sitemap and robots use HTTPS and the same six published identities', async () => {
  const response = await request('/sitemap.xml');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type')!, /xml/);
  const xml = await response.text();
  assert.equal((xml.match(/<loc>/g) || []).length, 9);
  for (const project of fixtures) assert.ok(xml.includes(`https://hubstudio2.vercel.app/blog/${project.publishedArticleId}`));
  const robots = await (await request('/robots.txt')).text();
  assert.ok(robots.includes('Sitemap: https://hubstudio2.vercel.app/sitemap.xml'));
});

test('database failures remain errors instead of successful empty results', async () => {
  const original = db.getProjectsOnSite;
  try {
    db.getProjectsOnSite = async () => { throw new Error('database unavailable'); };
    const response = await exchange(`${base}/api/index?__route=/api/projects&status=published`);
    assert.equal(response.status, 503);
    assert.ok((await response.json()).error);
    assert.equal((await request('/sitemap.xml')).status, 503);
  } finally { db.getProjectsOnSite = original; }
});

test('client-mode generation returns a draft and never calls server persistence',async()=>{
 const now=Math.floor(Date.now()/1000),encode=(v:any)=>Buffer.from(JSON.stringify(v)).toString('base64url');
 const token=`${encode({alg:'none',typ:'JWT'})}.${encode({sub:'owner-a',user_id:'owner-a',aud:'studio-9240700230-1dd9a',iss:'https://securetoken.google.com/studio-9240700230-1dd9a',iat:now,exp:now+3600,auth_time:now,firebase:{sign_in_provider:'password'}})}.`;
 const originalFetch=globalThis.fetch,originalSave=db.saveProject,originalKey=process.env.GEMINI_API_KEY;
 let writes=0;db.saveProject=async()=>{writes++;throw new Error('server write forbidden')};
 process.env.GEMINI_API_KEY='test-key';
 globalThis.fetch=async()=>Response.json({candidates:[{content:{role:'model',parts:[{text:JSON.stringify(fixtures[0].content)}]},finishReason:'STOP'}]});
 try {
   const response=await request('/api/blog/generate',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({topic:'클라이언트 저장',imageIds:[],images:[]})});
   assert.equal(response.status,200);const p=await response.json();assert.equal(p.ownerId,'owner-a');assert.equal(p.status,'draft');assert.equal(writes,0);
   const foreign=await request('/api/blog/review',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({project:{...fixtures[0],ownerId:'owner-b'}})});
   assert.equal(foreign.status,403);
   const status=await request('/api/config-status');const config=await status.json();assert.equal(config.storageMode,'firebase-client');assert.equal(config.serverStorageCredentialsRequired,false);
 } finally {globalThis.fetch=originalFetch;db.saveProject=originalSave;if(originalKey===undefined)delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY=originalKey;}
});
