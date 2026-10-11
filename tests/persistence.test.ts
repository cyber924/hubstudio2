import test from 'node:test';
import assert from 'node:assert/strict';
import { FirestoreDatabase, COLLECTIONS } from '../server/db.js';

function storage() {
  const records = new Map<string, any>();
  let failCommit = false;
  const snapshot = (path: string) => ({ id: path.split('/').pop(), exists: records.has(path), data: () => structuredClone(records.get(path)) });
  const store: any = {
    collection(name: string) {
      return { doc(id: string) { return { path: `${name}/${id}`, get: async () => snapshot(`${name}/${id}`) }; } };
    },
    async runTransaction(operation: any) {
      const pending: Array<[string, any]> = [];
      await operation({ get: async (ref: any) => snapshot(ref.path), set: (ref: any, data: any) => pending.push([ref.path, structuredClone(data)]) });
      if (failCommit) throw new Error('remote write denied');
      for (const [path, data] of pending) records.set(path, data);
    },
  };
  return { store, records, fail: () => { failCommit = true; } };
}

const project: any = { id: 'original-project', siteId: 'hub2', ownerId: 'real-uid', revision: 1, status: 'draft', content: { title: '원본 글' } };

test('a fresh database instance reads the durable project instead of resetting or adding samples', async () => {
  const remote = storage();
  await new FirestoreDatabase(() => remote.store).saveProject(project);
  const restarted = new FirestoreDatabase(() => remote.store);
  assert.deepEqual(await restarted.getProjectById(project.id), project);
  assert.equal(remote.records.size, 1);
});

test('remote save failure rejects and never reports a stored project', async () => {
  const remote = storage();
  remote.fail();
  await assert.rejects(new FirestoreDatabase(() => remote.store).saveProject(project), /remote write denied/);
  assert.equal(remote.records.size, 0);
});

test('failed publication commits neither published status nor snapshot', async () => {
  const remote = storage();
  const db = new FirestoreDatabase(() => remote.store);
  await db.saveProject(project);
  remote.fail();
  await assert.rejects(db.publishProject({ ...project, status: 'published', revision: 2 }, { id: 'original-article', publishedAt: '2026-01-01T00:00:00Z' }, 1));
  assert.equal(remote.records.get(`${COLLECTIONS.projects}/${project.id}`).status, 'draft');
  assert.ok(!remote.records.has(`${COLLECTIONS.articles}/original-article`));
});

test('publication persists both records and rejects a stale revision', async () => {
  const remote = storage();
  const db = new FirestoreDatabase(() => remote.store);
  await db.saveProject(project);
  await db.publishProject({ ...project, status: 'published', revision: 2 }, { id: 'original-article', publishedAt: '2026-01-01T00:00:00Z' }, 1);
  assert.equal(remote.records.get(`${COLLECTIONS.projects}/${project.id}`).visibility, 'public');
  assert.equal(remote.records.get(`${COLLECTIONS.articles}/original-article`).id, 'original-article');
  await assert.rejects(db.saveProject({ ...project, revision: 3 }, 1), (error: any) => error.status === 409);
});
