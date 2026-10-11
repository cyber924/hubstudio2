import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { adminDb } from '../server/firebase-admin.js';
import { COLLECTIONS, isPublished } from '../server/db.js';

// Run against a backed-up ORIGINAL Studio data/db.json, never generated seed data.
// Dry-run is the default. An explicit owner mapping is mandatory for preview identities.
const args = process.argv.slice(2);
const option = (name: string) => args[args.indexOf(name) + 1];
const sourcePath = option('--file');
if (!args.includes('--file') || !sourcePath) throw new Error('--file /path/to/original-db.json is required');
const sourceBytes = fs.readFileSync(sourcePath);
const source = JSON.parse(sourceBytes.toString('utf8'));
const siteId = process.env.APP_SITE_ID || 'hub2';
const owner = args.includes('--legacy-owner-uid') ? option('--legacy-owner-uid') : undefined;
if (!Array.isArray(source.projects)) throw new Error('projects array is missing');
const projects = source.projects.filter((p: any) => p.siteId === siteId).map((p: any) => {
  if (!p.id || !p.content?.title || !p.ownerId) throw new Error('Invalid project: missing id, content or owner');
  if (['dev_user', 'guest'].includes(p.ownerId)) {
    if (!owner) throw new Error('Preview owner found. Confirm ownership and supply --legacy-owner-uid REAL_FIREBASE_UID');
    p = { ...p, ownerId: owner };
  }
  const snapshot = source.publishedArticles?.find((a: any) => a.projectId === p.id);
  return { ...p, ...(snapshot ? { publishedArticleId: snapshot.id, publishedAt: snapshot.publishedAt } : {}) };
});
if (!projects.length) throw new Error('No projects belonging to this site');
if (new Set(projects.map((p: any) => p.id)).size !== projects.length) throw new Error('Duplicate project IDs');
if (args.includes('--expect-published') && projects.filter(isPublished).length !== Number(option('--expect-published'))) {
  throw new Error('Published count differs from expected; inspect the source before migrating');
}
const checksum = createHash('sha256').update(sourceBytes).digest('hex');
console.log(JSON.stringify({ sourceSha256: checksum, siteId, projects: projects.length, published: projects.filter(isPublished).length, apply: args.includes('--apply') }));
if (!args.includes('--apply')) process.exit(0);

const store = adminDb();
const records: Array<{ collection: string; id: string; data: any }> = [];
for (const project of projects) {
  records.push({ collection: COLLECTIONS.projects, id: project.id, data: project });
  if (isPublished(project)) {
    const id = project.publishedArticleId || project.id;
    records.push({ collection: COLLECTIONS.articles, id, data: {
      id, siteId, ownerId: project.ownerId, projectId: project.id, title: project.content.title,
      description: project.content.description, content: project.content, createdAt: project.createdAt,
      publishedAt: project.publishedAt || project.updatedAt,
    } });
  }
}
// Keep this restoration atomic and below Firestore's batch limit.
if (records.length > 450) throw new Error('Too many records for one safe recovery batch');
for (const record of records) {
  if ((await store.collection(record.collection).doc(record.id).get()).exists) {
    throw new Error(`Destination already exists: ${record.collection}/${record.id}; nothing was changed`);
  }
}
const batch = store.batch();
for (const record of records) batch.create(store.collection(record.collection).doc(record.id), record.data);
await batch.commit();
console.log('Recovery committed. Original source file was not modified.');
