import { AsyncLocalStorage } from 'node:async_hooks';
import type { BlogProject } from './db.js';
import { projectId } from './firebase-admin.js';

export const identityContext = new AsyncLocalStorage<{ uid: string; token: string; archiveWarning?: string }>();
const apiKey = process.env.FIREBASE_WEB_API_KEY || 'AIzaSyDEpFAsf1fI65xXklKYsukAWFYw5bzaHyc';
const endpoint = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery`;
export function decodeValue(value: any): any {
  if (value.mapValue) return Object.fromEntries(Object.entries(value.mapValue.fields || {}).map(([k,v]) => [k, decodeValue(v)]));
  if (value.arrayValue) return (value.arrayValue.values || []).map(decodeValue);
  if (value.integerValue !== undefined) return Number(value.integerValue);
  return value.stringValue ?? value.timestampValue ?? value.booleanValue ?? value.doubleValue ?? null;
}
export function sharedProject(doc: any): BlogProject | null {
  const fields = Object.fromEntries(Object.entries(doc.fields || {}).map(([k,v]) => [k,decodeValue(v)]));
  let p = fields;
  if (typeof fields.projectJson === 'string') { try { p = { ...fields, ...JSON.parse(fields.projectJson) }; } catch { return null; } }
  const marker = p.sourceSite || p.siteId || p.themePersona || (p.recordType === 'hub2Project' ? 'hub2' : '');
  if (marker !== 'hub2' || !p.ownerId || !p.title) return null;
  const id = doc.name.split('/').pop();
  const raw = p.content || p;
  const sections = (raw.sections || []).map((s: any, i: number) => ({ id: s.id || `section_${i+1}`, heading: s.heading || s.title || '', body: s.body || s.content || '', imageId: s.imageId, caption: s.caption || s.imageCaption, alt: s.alt || s.imageCaption || s.heading || s.title || '' }));
  return { schemaVersion: 1, id, siteId: 'hub2', ownerId: p.ownerId, title: p.title, keyword: p.keyword || '', tone: p.tone || '', audience: p.audience || '', status: p.status, visibility: p.visibility || 'private', selectedImageIds: p.selectedImageIds || sections.map((s:any)=>s.imageId).filter(Boolean), content: { title: raw.title || p.title, description: raw.description || raw.metaDescription || raw.summary || '', intro: raw.intro || raw.summary || '', sections, closing: raw.closing || '', faq: raw.faq || [], tags: raw.tags || raw.seoTags || [] }, createdAt: p.createdAt, updatedAt: p.updatedAt || p.createdAt, revision: p.revision || 1, ...(p.status === 'published' ? { publishedArticleId: p.publishedArticleId || id, publishedAt: p.publishedAt || p.updatedAt || p.createdAt } : {}) } as BlogProject;
}
async function query(collection: string, field: string, value: string, token?: string) {
  const docs: any[] = [];
  let after: string | undefined;
  do {
    const structuredQuery: any = { from: [{ collectionId: collection }], where: { fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: { stringValue: value } } }, orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }], limit: 100 };
    if (after) structuredQuery.startAt = { values: [{ referenceValue: after }], before: false };
    const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ structuredQuery }), signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw Object.assign(new Error(`이미지 허브 ${collection} 조회 실패 (${response.status})`), { status: response.status === 403 ? 403 : 503 });
    const rows = await response.json() as any[];
    const page = rows.filter(r => r.document).map(r => r.document);
    docs.push(...page);
    after = page.length === 100 ? page.at(-1).name : undefined;
  } while (after);
  return docs.map(sharedProject).filter((p): p is BlogProject => !!p);
}
let cached: { until: number; projects: BlogProject[] } | undefined;
export async function sharedPublicProjects() {
  if (cached && cached.until > Date.now()) return cached.projects;
  const projects = (await query('publishedContents', 'visibility', 'public')).filter(p => p.status === 'published' && p.visibility === 'public');
  cached = { until: Date.now()+30000, projects };
  return projects;
}
export async function sharedOwnedProjects(ownerId: string) {
  const identity = identityContext.getStore();
  if (!identity || identity.uid !== ownerId) return [];
  try {
    return await query('publishedContents', 'ownerId', ownerId, identity.token);
  } catch (error: any) {
    if (error.status !== 403) throw error;
    // Public documents remain readable under the existing shared DB rules.
    // Scope these records to the verified Firebase UID, never a client-supplied owner.
    const records = (await sharedPublicProjects()).filter(p => p.ownerId === identity.uid);
    identity.archiveWarning = '내가 발행한 공개 글을 불러왔습니다. 비공개 초안은 현재 읽기 권한이 없어 표시되지 않습니다.';
    return records;
  }
}
export async function verifyIdentity(token: string) {
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: token }), signal: AbortSignal.timeout(10000) });
  const body = await response.json() as any;
  const user = body.users?.[0];
  if (!response.ok || !user?.localId || user.disabled) throw Object.assign(new Error('로그인이 만료되었거나 유효하지 않습니다.'), { status: 401 });
  return { uid: user.localId, email: user.email, name: user.displayName };
}
export async function sharedPublicImage(id: string) {
  const url = endpoint.replace(':runQuery', `/images/${encodeURIComponent(id)}`);
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (response.status === 404 || response.status === 403) return null;
  if (!response.ok) throw Object.assign(new Error('이미지 허브 이미지 조회 실패'), { status: 503 });
  const doc = await response.json() as any;
  const f = Object.fromEntries(Object.entries(doc.fields || {}).map(([k,v]) => [k, decodeValue(v)]));
  if (f.visibility !== 'public') return null;
  const src = f.dataUrl || f.thumbnailUrl || f.publicUrl;
  if (typeof src !== 'string' || !/^(data:image\/|https:\/\/)/.test(src)) return null;
  return { id, title: f.title || '', visibility: 'public' as const, thumbnailUrl: src, mimeType: f.mimeType || 'image/webp' };
}

export function invalidateSharedPublicProjects() { cached = undefined; }
export async function sharedPublicProjectById(id: string) {
  const response = await fetch(endpoint.replace(':runQuery', `/publishedContents/${encodeURIComponent(id)}`), { signal: AbortSignal.timeout(20000) });
  if (response.status === 404 || response.status === 403) return null;
  if (!response.ok) throw Object.assign(new Error('공개 원고 조회 실패'), { status: 503 });
  const p = sharedProject(await response.json());
  return p?.visibility === 'public' && p.status === 'published' ? p : null;
}
