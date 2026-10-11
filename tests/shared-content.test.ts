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
