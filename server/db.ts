import fs from 'fs';
import path from 'path';
import { adminDb, hasAdminCredentials } from './firebase-admin.js';
import { sharedPublicProjects, sharedOwnedProjects, identityContext } from './shared-content.js';

export interface ImageAnalysis {
  summary: string;
  subjects: string[];
  setting: string;
  readableText: string[];
  method: 'vision' | 'metadata';
  status: 'pending' | 'complete' | 'failed';
  model?: string;
  sourceRevision: string;
  analyzedAt?: string;
}

export interface HubImage {
  id: string;
  sourceProject: string;
  title: string;
  tags: string[];
  visibility: 'public' | 'private';
  ownerId?: string;
  category?: string;
  width?: number;
  height?: number;
  mimeType?: string;
  thumbnailUrl: string;
  publicUrl?: string;
  updatedAt?: string;
  analysis?: ImageAnalysis;
}

export interface BlogSection {
  id: string;
  heading: string;
  body: string;
  imageId?: string;
  caption?: string;
  alt?: string;
}

export interface BlogContent {
  title: string;
  description: string;
  intro: string;
  sections: BlogSection[];
  closing: string;
  faq: Array<{ question: string; answer: string }>;
  tags: string[];
}

export interface ReviewIssue {
  id: string;
  sectionId?: string;
  kind: 'text' | 'image' | 'fact' | 'structure';
  reason: string;
  proposedAction: string;
  analysisMethod: 'vision' | 'metadata' | 'text';
}

export interface ReviewReplacement {
  sectionId: string;
  beforeImageId?: string;
  afterImageId: string;
  matchQuality: 'exact' | 'approximate';
  method: 'vision' | 'metadata';
  reason: string;
}

export interface ReviewResult {
  verdict: 'pass' | 'needs_changes' | 'hold';
  issues: ReviewIssue[];
  replacements: ReviewReplacement[];
  summary: string;
}

export interface BlogProject {
  schemaVersion: 1;
  id: string;
  siteId: string;
  ownerId: string;
  title: string;
  keyword: string;
  tone: string;
  audience: string;
  status: 'draft' | 'published' | 'archived';
  visibility: 'private' | 'public';
  selectedImageIds: string[];
  content: BlogContent;
  review?: ReviewResult;
  publishedArticleId?: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  lastJobId?: string;
}

export interface AgentJob {
  id: string;
  siteId: string;
  ownerId: string;
  threadId: string;
  projectId?: string;
  requestId: string;
  action: 'create' | 'review' | 'rewrite' | 'publish' | 'reply';
  status: 'queued' | 'running' | 'paused' | 'failed' | 'done' | 'cancelled';
  stage: 'plan' | 'generate' | 'review' | 'replace' | 'save' | 'publish' | 'verify' | 'report';
  autoPublish: boolean;
  expectedRevision?: number;
  leaseUntil?: string;
  attemptCount: number;
  result?: Record<string, any>;
  error?: { code: string; message: string; retryable: boolean };
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  content: string;
  createdAt: string;
  jobId?: string;
  projectSnapshot?: BlogProject;
}

export interface AgentThread {
  id: string;
  siteId: string;
  ownerId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

interface Schema {
  images: HubImage[];
  projects: BlogProject[];
  jobs: AgentJob[];
  threads: AgentThread[];
  messages: Record<string, ChatMessage[]>;
  publishedArticles: any[];
}

// Helper function to parse Firestore REST documents
function parseFirestoreRestDoc(doc: any): HubImage | null {
  try {
    const fields = doc.fields;
    if (!fields) return null;

    let id = fields.id?.stringValue;
    if (!id && doc.name) {
      const parts = doc.name.split('/');
      id = parts[parts.length - 1];
    }
    if (!id) return null;

    const title = fields.title?.stringValue || "Untitled Image";

    let tags: string[] = [];
    if (fields.tags?.arrayValue?.values) {
      tags = fields.tags.arrayValue.values
        .map((v: any) => v.stringValue)
        .filter((v: any) => typeof v === 'string');
    }

    const visibility = (fields.visibility?.stringValue === 'private') ? 'private' : 'public';
    const ownerId = fields.ownerId?.stringValue || undefined;

    let category = fields.category?.stringValue;
    if (!category) {
      const titleAndTags = (title + ' ' + tags.join(' ')).toLowerCase();
      if (titleAndTags.includes('풍경') || titleAndTags.includes('바다') || titleAndTags.includes('산') || titleAndTags.includes('하늘') || titleAndTags.includes('nature') || titleAndTags.includes('여행')) {
        category = 'nature';
      } else {
        category = 'lifestyle';
      }
    }

    const ratio = fields.ratio?.stringValue || "1:1";
    const dataUrl = fields.dataUrl?.stringValue || fields.thumbnailUrl?.stringValue || fields.publicUrl?.stringValue || "/images/travel_jeju_coast.jpg";
    const updatedAt = fields.updatedAt?.stringValue || fields.createdAt?.stringValue || new Date().toISOString();

    let analysis: ImageAnalysis | undefined = undefined;
    const analysisField = fields.analysis?.mapValue?.fields;
    if (analysisField) {
      let subjects: string[] = [];
      if (analysisField.subjects?.arrayValue?.values) {
        subjects = analysisField.subjects.arrayValue.values
          .map((v: any) => v.stringValue)
          .filter((v: any) => typeof v === 'string');
      }

      let readableText: string[] = [];
      if (analysisField.readableText?.arrayValue?.values) {
        readableText = analysisField.readableText.arrayValue.values
          .map((v: any) => v.stringValue)
          .filter((v: any) => typeof v === 'string');
      }

      analysis = {
        summary: analysisField.summary?.stringValue || title,
        subjects: subjects,
        setting: analysisField.setting?.stringValue || title,
        readableText: readableText,
        method: (analysisField.method?.stringValue as any) || 'metadata',
        status: (analysisField.status?.stringValue as any) || 'complete',
        sourceRevision: analysisField.sourceRevision?.stringValue || 'v1',
        model: analysisField.model?.stringValue || undefined,
        analyzedAt: analysisField.analyzedAt?.stringValue || updatedAt,
      };
    } else {
      analysis = {
        summary: title,
        subjects: tags,
        setting: title,
        readableText: [],
        method: 'metadata',
        status: 'complete',
        sourceRevision: 'v1',
        analyzedAt: updatedAt,
      };
    }

    return {
      id,
      sourceProject: fields.sourceProject?.stringValue || 'hub_common',
      title,
      tags,
      visibility,
      ownerId,
      category,
      width: fields.width?.integerValue ? parseInt(fields.width.integerValue) : 800,
      height: fields.height?.integerValue ? parseInt(fields.height.integerValue) : 600,
      mimeType: fields.mimeType?.stringValue || 'image/webp',
      thumbnailUrl: dataUrl,
      publicUrl: dataUrl,
      updatedAt,
      analysis,
    };
  } catch (err) {
    console.error('Failed to parse firestore REST document:', err);
    return null;
  }
}

// Initial seed images loaded dynamically from generated_seeds.json or firestore_images_all.json
let SEED_IMAGES: HubImage[] = [];
try {
  const firestoreAllPath = path.resolve('./firestore_images_all.json');
  if (fs.existsSync(firestoreAllPath)) {
    const rawDocs = JSON.parse(fs.readFileSync(firestoreAllPath, 'utf8'));
    if (Array.isArray(rawDocs)) {
      SEED_IMAGES = rawDocs
        .map(doc => parseFirestoreRestDoc(doc))
        .filter((img): img is HubImage => img !== null);
      console.log(`Loaded ${SEED_IMAGES.length} parsed images from firestore_images_all.json`);
    }
  }

  if (SEED_IMAGES.length === 0) {
    const seedsPath = path.resolve('./server/generated_seeds.json');
    if (fs.existsSync(seedsPath)) {
      SEED_IMAGES = JSON.parse(fs.readFileSync(seedsPath, 'utf8'));
    }
  }
} catch (err) {
  console.error('Failed to load seed images from firestore_images_all.json or generated_seeds.json:', err);
}

const OLD_SEED_IMAGES: any[] = [
  {
    id: 'img_jeju_beach',
    sourceProject: 'hub_common',
    title: '제주도 1박 2일 가족여행, 성산일출봉과 바다',
    tags: ['여행', '블로그 대표 이미지', '해변'],
    visibility: 'public',
    category: 'nature',
    width: 800,
    height: 600,
    mimeType: 'image/jpeg',
    thumbnailUrl: '/images/travel_jeju_coast.jpg',
    publicUrl: '/images/travel_jeju_coast.jpg',
    updatedAt: new Date('2026-09-20T12:00:00.000Z').toISOString(),
    analysis: {
      summary: '제주도의 성산일출봉을 배경으로 가족과 함께 에메랄드빛 해변 바닷가를 거니는 행복한 모습',
      subjects: ['가족', '해변', '성산일출봉', '바다'],
      setting: '제주도 성산일출봉 해안가 야외',
      readableText: [],
      method: 'metadata',
      status: 'complete',
      sourceRevision: 'v1'
    }
  },
  {
    id: 'img_model_fashion',
    sourceProject: 'hub_common',
    title: '모델 이미지',
    tags: ['패션', '블로그 대표 이미지', '해변'],
    visibility: 'public',
    category: 'lifestyle',
    width: 800,
    height: 600,
    mimeType: 'image/jpeg',
    thumbnailUrl: '/images/travel_model_fashion.jpg',
    publicUrl: '/images/travel_model_fashion.jpg',
    updatedAt: new Date('2026-09-20T12:00:00.000Z').toISOString(),
    analysis: {
      summary: '바람이 불어오는 해변 모래사장 위에서 베이지색 롱 드레스를 입고 서 있는 모델의 자연스러운 분위기',
      subjects: ['여성 모델', '모래사장', '바다', '베이지색 드레스'],
      setting: '해질녘 무렵의 차분한 바닷가 모래사장',
      readableText: [],
      method: 'metadata',
      status: 'complete',
      sourceRevision: 'v1'
    }
  },
  {
    id: 'img_product_cosmetic',
    sourceProject: 'hub_common',
    title: '제품 촬영',
    tags: ['화장품', '블로그 대표 이미지', '해변'],
    visibility: 'public',
    category: 'lifestyle',
    width: 800,
    height: 600,
    mimeType: 'image/jpeg',
    thumbnailUrl: '/images/travel_product_cosmetic.jpg',
    publicUrl: '/images/travel_product_cosmetic.jpg',
    updatedAt: new Date('2026-09-20T12:00:00.000Z').toISOString(),
    analysis: {
      summary: '해변가 선명한 햇살 아래 유목 나무 위에 가지런히 놓인 스킨케어 유리 앰플 병들과 화장품 크림 용기',
      subjects: ['화장품 유리병', '유목 나무', '바다 배경', '모래'],
      setting: '자연 채광이 들어오는 해변가 야외 연출 컷',
      readableText: [],
      method: 'metadata',
      status: 'complete',
      sourceRevision: 'v1'
    }
  },
  {
    id: 'img_park_golf',
    sourceProject: 'hub_common',
    title: '파크골프 이미지',
    tags: ['파크골프', '업로드'],
    visibility: 'public',
    category: 'lifestyle',
    width: 800,
    height: 600,
    mimeType: 'image/jpeg',
    thumbnailUrl: '/images/travel_park_golf.jpg',
    publicUrl: '/images/travel_park_golf.jpg',
    updatedAt: new Date('2026-09-20T12:00:00.000Z').toISOString(),
    analysis: {
      summary: '햇살이 밝은 날, 녹색의 넓은 파크골프 경기장 잔디 위에서 나무 퍼터를 쥐고 빨간색 공을 홀컵에 퍼팅하는 시니어 여성',
      subjects: ['파크골프 퍼터', '빨간색 공', '홀컵', '시니어 여성'],
      setting: '쾌적한 야외 파크골프 클럽 전경',
      readableText: [],
      method: 'metadata',
      status: 'complete',
      sourceRevision: 'v1'
    }
  },
  {
    id: 'img_camping_forest',
    sourceProject: 'hub_common',
    title: '숲속의 안락한 글래핑 캐빈',
    tags: ['캠핑', '글램핑', '숲', '힐링', '감성'],
    visibility: 'public',
    category: 'nature',
    width: 800,
    height: 600,
    mimeType: 'image/jpeg',
    thumbnailUrl: '/images/travel_camping_forest.jpg',
    publicUrl: '/images/travel_camping_forest.jpg',
    updatedAt: new Date('2026-09-18T14:30:00.000Z').toISOString(),
    analysis: {
      summary: '침엽수림 숲속 안개가 낀 저녁, 노란 불빛이 은은하게 새어나오는 아늑한 삼각 오두막 캐빈',
      subjects: ['글램핑 캐빈', '소나무', '안개', '야외 조명'],
      setting: '깊은 침엽수 숲속 저녁',
      readableText: [],
      method: 'metadata',
      status: 'complete',
      sourceRevision: 'v1'
    }
  },
  {
    id: 'img_cozy_cafe',
    sourceProject: 'hub_common',
    title: '비 오는 날의 창가 카페 테이블',
    tags: ['카페', '커피', '힐링', '비', '독서'],
    visibility: 'public',
    category: 'lifestyle',
    width: 800,
    height: 600,
    mimeType: 'image/jpeg',
    thumbnailUrl: '/images/travel_cozy_cafe.jpg',
    publicUrl: '/images/travel_cozy_cafe.jpg',
    updatedAt: new Date('2026-09-20T10:15:00.000Z').toISOString(),
    analysis: {
      summary: '창밖에 비가 흘러내리는 날, 따뜻한 조명 아래 김이 나는 커피 잔과 펼쳐진 책',
      subjects: ['플랫화이트 커피', '다이어리', '우천 창문', '조명'],
      setting: '감성 카페 창가 테이블',
      readableText: [],
      method: 'metadata',
      status: 'complete',
      sourceRevision: 'v1'
    }
  }
];

// Read-only image metadata remains bundled; user content is always durable Firestore data.
export const COLLECTIONS = {
  projects: 'hub2Projects', articles: 'hub2PublishedArticles',
  jobs: 'hub2AgentJobs', threads: 'hub2AgentThreads',
};

export function isPublished(project: BlogProject) {
  const time = Date.parse((project as any).publishedAt || project.updatedAt || project.createdAt);
  return project.status === 'published' && Number.isFinite(time) && time <= Date.now();
}

export class FirestoreDatabase {
  constructor(private store = adminDb) {}
  getImages(): HubImage[] { return [...new Map(SEED_IMAGES.map(i => [i.id, i])).values()]; }
  getImageById(id: string): HubImage | null { return this.getImages().find(i => i.id === id || i.id === id.replace(/^img_/, '')) || null; }
  async saveImage(img: HubImage) { await this.store().collection('images').doc(img.id).set(img); }
  private async read<T>(collection: string, id: string): Promise<T | null> {
    const document = await this.store().collection(collection).doc(id).get();
    return document.exists ? { ...document.data(), id: document.id } as T : null;
  }
  private async site<T>(collection: string, siteId: string): Promise<T[]> {
    const result = await this.store().collection(collection).where('siteId', '==', siteId).get();
    return result.docs.map(d => ({ ...d.data(), id: d.id }) as T);
  }
  async getProjects(siteId: string, ownerId: string): Promise<BlogProject[]> {
    const stored = this.store !== adminDb || hasAdminCredentials() ? await this.site<BlogProject>(COLLECTIONS.projects, siteId) : [];
    const shared = this.store === adminDb && siteId === 'hub2' ? await sharedOwnedProjects(ownerId) : [];
    return [...new Map([...shared, ...stored].filter(p => p.ownerId === ownerId).map(p => [p.id, p])).values()];
  }
  async getProjectsOnSite(siteId: string) {
    const stored = this.store !== adminDb || hasAdminCredentials() ? await this.site<BlogProject>(COLLECTIONS.projects, siteId) : [];
    const shared = this.store === adminDb && siteId === 'hub2' ? await sharedPublicProjects() : [];
    return [...new Map([...shared, ...stored].map(p => [p.id, p])).values()];
  }
  async getProjectById(id: string) {
    if (this.store === adminDb) {
      const shared = (await sharedPublicProjects()).find(p => p.id === id || p.publishedArticleId === id);
      if (shared) return shared;
      const owner = identityContext.getStore()?.uid;
      if (owner) {
        const owned = (await sharedOwnedProjects(owner)).find(p => p.id === id);
        if (owned) return owned;
      }
      if (!hasAdminCredentials()) return null;
    }
    const direct = await this.read<BlogProject>(COLLECTIONS.projects, id);
    if (direct) return direct;
    const article = await this.getPublishedArticleById(id);
    return article?.projectId ? this.read<BlogProject>(COLLECTIONS.projects, article.projectId) : null;
  }
  async saveProject(project: BlogProject, expectedRevision?: number) {
    const ref = this.store().collection(COLLECTIONS.projects).doc(project.id);
    await this.store().runTransaction(async tx => {
      const current = await tx.get(ref);
      if (current.exists && expectedRevision !== undefined && current.data()?.revision !== expectedRevision) {
        throw Object.assign(new Error('다른 변경이 저장되었습니다. 새로고침 후 다시 시도하세요.'), { status: 409 });
      }
      tx.set(ref, project);
    });
  }
  async publishProject(project: BlogProject, article: any, expectedRevision: number) {
    const ref = this.store().collection(COLLECTIONS.projects).doc(project.id);
    await this.store().runTransaction(async tx => {
      const current = await tx.get(ref);
      if (!current.exists || current.data()?.revision !== expectedRevision) {
        throw Object.assign(new Error('발행 충돌: 새로고침 후 다시 시도하세요.'), { status: 409 });
      }
      tx.set(ref, { ...project, visibility: 'public', publishedAt: article.publishedAt });
      tx.set(this.store().collection(COLLECTIONS.articles).doc(article.id), article);
    });
  }
  async deleteProject(id: string) {
    const project = await this.getProjectById(id);
    const batch = this.store().batch();
    batch.delete(this.store().collection(COLLECTIONS.projects).doc(id));
    if (project?.publishedArticleId) batch.delete(this.store().collection(COLLECTIONS.articles).doc(project.publishedArticleId));
    await batch.commit();
  }
  async getJobs(siteId: string, ownerId: string) { return (await this.site<AgentJob>(COLLECTIONS.jobs, siteId)).filter(j => j.ownerId === ownerId); }
  async getJobById(id: string) { return this.read<AgentJob>(COLLECTIONS.jobs, id); }
  async getJobByRequestId(requestId: string, siteId: string, ownerId: string) {
    return (await this.getJobs(siteId, ownerId)).find(j => j.requestId === requestId) || null;
  }
  async saveJob(job: AgentJob) { await this.store().collection(COLLECTIONS.jobs).doc(job.id).set(job); }
  async getThreads(siteId: string, ownerId: string) { return (await this.site<AgentThread>(COLLECTIONS.threads, siteId)).filter(t => t.ownerId === ownerId); }
  async getThreadById(id: string) { return this.read<AgentThread>(COLLECTIONS.threads, id); }
  async saveThread(thread: AgentThread) { await this.store().collection(COLLECTIONS.threads).doc(thread.id).set(thread); }
  async getMessages(threadId: string): Promise<ChatMessage[]> {
    const result = await this.store().collection(COLLECTIONS.threads).doc(threadId).collection('messages').orderBy('createdAt').get();
    return result.docs.map(d => ({ ...d.data(), id: d.id }) as ChatMessage);
  }
  async saveMessage(threadId: string, message: ChatMessage) {
    await this.store().collection(COLLECTIONS.threads).doc(threadId).collection('messages').doc(message.id).set(message);
  }
  async getPublishedArticles(siteId: string) {
    const projects = await this.getProjectsOnSite(siteId);
    return projects.filter(isPublished).map(p => ({
      id: p.publishedArticleId || p.id, projectId: p.id, siteId: p.siteId,
      title: p.content.title, description: p.content.description, content: p.content,
      createdAt: p.createdAt, publishedAt: (p as any).publishedAt || p.updatedAt,
    }));
  }
  async getPublishedArticleById(id: string) { return this.read<any>(COLLECTIONS.articles, id); }
  async savePublishedArticle(article: any) { await this.store().collection(COLLECTIONS.articles).doc(article.id).set(article); }
  async deletePublishedArticle(id: string) { await this.store().collection(COLLECTIONS.articles).doc(id).delete(); }
}

export const db = new FirestoreDatabase();
