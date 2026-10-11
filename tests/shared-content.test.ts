import test from 'node:test';
import assert from 'node:assert/strict';
import { sharedProject } from '../server/shared-content.js';
const doc = (persona: string) => ({ name: 'projects/shared/databases/(default)/documents/publishedContents/blog_original', fields: { themePersona: { stringValue: persona }, ownerId: { stringValue: 'original-owner' }, title: { stringValue: '원본 제목' }, status: { stringValue: 'published' }, visibility: { stringValue: 'public' }, summary: { stringValue: '원본 소개' }, createdAt: { stringValue: '2026-10-02T00:00:00Z' }, sections: { arrayValue: { values: [{ mapValue: { fields: { title: { stringValue: '원본 소제목' }, content: { stringValue: '원본 본문' }, imageId: { stringValue: 'original-image' }, imageCaption: { stringValue: '원본 캡션' } } } }] } } } });
test('shared legacy publication preserves original identity, body and image mapping', () => {
  const p = sharedProject(doc('hub2'))!;
  assert.equal(p.id, 'blog_original'); assert.equal(p.ownerId, 'original-owner');
  assert.equal(p.publishedArticleId, 'blog_original');
  assert.equal(p.content.intro, '원본 소개');
  assert.equal(p.content.sections[0].body, '원본 본문');
  assert.equal(p.content.sections[0].caption, '원본 캡션');
  assert.deepEqual(p.selectedImageIds, ['original-image']);
});
test('other studios and records without a studio marker are excluded', () => {
  assert.equal(sharedProject(doc('hub3')), null);
  assert.equal(sharedProject(doc('hub4')), null);
  assert.equal(sharedProject(doc('')), null);
});
test('Hub1-compatible contentJson renders the full published body and original images',()=>{
 const d:any=doc('hub2');delete d.fields.sections;delete d.fields.summary;
 d.fields.contentJson={stringValue:JSON.stringify({title:'저장한 제목',intro:'저장한 소개',sections:[{heading:'소제목',body:'새 본문',imageId:'original-image'}],closing:'마무리'})};
 const p=sharedProject(d)!;
 assert.equal(p.content.intro,'저장한 소개');assert.equal(p.content.sections[0].body,'새 본문');assert.equal(p.content.sections[0].imageId,'original-image');assert.equal(p.content.closing,'마무리');
});

test('archive permission denial returns only the verified owners public posts with an explicit notice', async () => {
  const { identityContext, sharedOwnedProjects } = await import('../server/shared-content.js');
  const originalFetch = globalThis.fetch;
  const mine = doc('hub2');
  const other = structuredClone(mine);
  other.name = other.name.replace('blog_original', 'other_blog');
  other.fields.ownerId.stringValue = 'another-owner';
  globalThis.fetch = async (_url, options) => {
    const q = JSON.parse(String(options?.body)).structuredQuery;
    if (q.where.fieldFilter.field.fieldPath === 'ownerId') return new Response('{}', { status: 403 });
    return Response.json([{ document: mine }, { document: other }]);
  };
  try {
    const context = { uid: 'original-owner', token: 'verified-token', archiveWarning: undefined as string | undefined };
    await identityContext.run(context, async () => {
      const list = await sharedOwnedProjects(context.uid);
      assert.deepEqual(list.map(p=>p.id), ['blog_original']);
      assert.ok(context.archiveWarning?.includes('비공개 초안'));
      assert.deepEqual(await sharedOwnedProjects('another-owner'), []);
    });
  } finally { globalThis.fetch = originalFetch; }
});
