import fs from 'fs';
import path from 'path';

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

const DATA_DIR = path.resolve('./data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

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

class FileDatabase {
  private memoryDb: Schema = {
    images: [],
    projects: [],
    jobs: [],
    threads: [],
    messages: {},
    publishedArticles: [],
  };

  constructor() {
    this.init();
  }

  private init() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    if (fs.existsSync(DB_FILE)) {
      try {
        const raw = fs.readFileSync(DB_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        this.memoryDb = {
          images: parsed.images || [],
          projects: parsed.projects || [],
          jobs: parsed.jobs || [],
          threads: parsed.threads || [],
          messages: parsed.messages || {},
          publishedArticles: parsed.publishedArticles || [],
        };
      } catch (err) {
        console.error('Failed to parse db.json, resetting database file.', err);
        this.memoryDb = {
          images: [...SEED_IMAGES],
          projects: [],
          jobs: [],
          threads: [],
          messages: {},
          publishedArticles: [],
        };
        this.save();
      }
    } else {
      this.memoryDb = {
        images: [...SEED_IMAGES],
        projects: [],
        jobs: [],
        threads: [],
        messages: {},
        publishedArticles: [],
      };
      this.save();
    }

    // Ensure we always have seed images and reset to real images from firestore_images_all.json
    this.memoryDb.images = [...SEED_IMAGES];
    this.save();

    // Ensure we always have some draft projects seeded so they do not show empty if they had drafts before
    if (this.memoryDb.projects.length === 0) {
      const projId1 = 'proj_jeju_draft';
      const projId2 = 'proj_golf_draft';
      this.memoryDb.projects = [
        {
          schemaVersion: 1,
          id: projId1,
          siteId: 'hub2',
          ownerId: 'dev_user',
          title: '푸른 바람을 머금은 제주, 온 가족이 함께 걷는 성산일출봉 해변',
          keyword: '제주도 가족여행',
          tone: '차분하고 감성적인 에세이 어조',
          audience: '감성 라이프스타일 독자층',
          status: 'published',
          visibility: 'private',
          selectedImageIds: ['img_7iLRc6oD_1789876355881', 'img_7iLRc6oD_1789876428855'],
          createdAt: new Date(Date.now() - 3600000).toISOString(),
          updatedAt: new Date().toISOString(),
          revision: 1,
          content: {
            title: '푸른 바람을 머금은 제주, 온 가족이 함께 걷는 성산일출봉 해변',
            description: '온 가족이 함께 떠난 제주도 1박 2일 여행 기록. 성산일출봉과 해변의 아늑한 아침 공기 속 힐링 여정.',
            intro: '때로는 일상에서 벗어나 파도 소리에 귀를 기울이는 것만으로도 충분한 위로가 됩니다. 에메랄드빛 바다가 감싸 안은 제주의 바람 속으로 온 가족이 함께 발걸음을 옮겼습니다.',
            sections: [
              {
                id: 'sec_1',
                heading: '성산일출봉을 배경으로 펼쳐진 아침 바다',
                body: '이른 아침의 공기는 살짝 알싸하지만 가슴 속을 맑은 생동감으로 채워줍니다. 저 멀리 성산일출봉이 든든한 실루엣으로 서 있고, 밀려오는 파도는 은은한 햇살을 받아 반짝입니다. 아이의 고사리 같은 손을 잡고 해변을 걷는 부모의 뒷모습에는 어떤 말보다 깊은 평온함이 고여 있습니다.',
                imageId: 'img_7iLRc6oD_1789876355881',
                caption: '바다와 마주하는 아침, 제주 성산일출봉 해안가',
                alt: '성산일출봉 해변을 걷는 가족'
              },
              {
                id: 'sec_2',
                heading: '바람이 드레스를 흔드는 고요한 해변에서',
                body: '모래사장 위로 부드러운 바람이 스쳐 지나가며 자연스러운 리듬을 만듭니다. 바람에 흩날리는 롱 드레스를 여미며 해변을 가만히 내려다보는 순간, 자연과 인간이 하나가 된 듯한 예술적인 구도가 흐릅니다. 바다가 전해주는 위로와 여백은 우리의 일상을 다시 한번 풍요롭게 다듬어 줍니다.',
                imageId: 'img_7iLRc6oD_1789876428855',
                caption: '해질녘 모래사장 위에서 마주하는 자연스러운 바람',
                alt: '해변에서 생각에 잠긴 모델 여성'
              }
            ],
            closing: '여정은 끝나도 기억 속 제주의 푸른 파도는 오래도록 마음속에서 찰랑일 것입니다. 가족과 함께 걸었던 이 모래사장의 추억은 삶의 든든한 에너지가 되어 주겠지요.',
            faq: [
              { question: '제주도 1박 2일 가족 코스로 성산일출봉은 어떨까요?', answer: '경사가 완만하고 경치가 훌륭해 부모님이나 아이 동반으로 해변 산책로를 걷기 아주 좋습니다.' },
              { question: '사진 촬영하기 좋은 최적의 시간대는 언제인가요?', answer: '오전 8~10시 사이의 사광(자연광)이 들어오는 아침 시간대가 가장 맑고 입체적인 톤으로 촬영됩니다.' }
            ],
            tags: ['제주여행', '가족여행', '힐링에세이', '성산일출봉']
          }
        },
        {
          schemaVersion: 1,
          id: projId2,
          siteId: 'hub2',
          ownerId: 'dev_user',
          title: '초록빛 필드 위에서 나누는 정다운 교감, 파크골프의 매력',
          keyword: '파크골프 라이프스타일',
          tone: '차분하고 감성적인 에세이 어조',
          audience: '감성 라이프스타일 독자층',
          status: 'published',
          visibility: 'private',
          selectedImageIds: ['img_7iLRc6oD_1789876484663', 'img_7iLRc6oD_1789876529414'],
          createdAt: new Date(Date.now() - 7200000).toISOString(),
          updatedAt: new Date().toISOString(),
          revision: 1,
          content: {
            title: '초록빛 필드 위에서 나누는 정다운 교감, 파크골프의 매력',
            description: '소박하고 건강하게 즐기는 잔디 위 활기찬 파크골프 라이프스타일 에세이.',
            intro: '바쁘게 굴러가는 도시를 조금만 비껴나면, 잔디 냄새 가득한 초록빛 공간을 만날 수 있습니다. 무겁지 않은 채 하나를 쥐고 사랑하는 이와 정답게 대화를 나누며 걷는 파크골프는 단순한 스포츠 이상의 즐거움을 줍니다.',
            sections: [
              {
                id: 'sec_1',
                heading: '부드러운 스윙, 잔디밭에서 가볍게 굴러가는 주홍빛 골프공',
                body: '파크골프의 매력은 가벼움에 있습니다. 맑은 가을날, 부드럽게 잔디를 스치며 주홍빛 공이 굴러갈 때의 경쾌한 소리는 가슴 속 깊은 체증을 쓸어내려 줍니다. 시니어들뿐만 아니라 모든 세대가 부담 없이 소통하기에 가장 알맞은 친화적인 게임입니다.',
                imageId: 'img_7iLRc6oD_1789876484663',
                caption: '필드 잔디 위에 경쾌하게 멈춰 선 주홍빛 파크골프공',
                alt: '파크골프공 스윙 전경'
              },
              {
                id: 'sec_2',
                heading: '노부부의 해사한 미소, 정겨운 하이파이브',
                body: '서로의 자세를 다정하게 봐주고 퍼팅이 깔끔하게 성공할 때마다 환한 미소를 지으며 손을 맞부딪히는 노부부의 모습만큼 아름다운 전경이 또 있을까요? 넓은 하늘 아래, 건강한 걸음을 이어가며 건강과 사랑을 동시에 돌보는 슬기로운 삶의 방식입니다.',
                imageId: 'img_7iLRc6oD_1789876529414',
                caption: '서로를 바라보며 잔잔하게 미소 짓는 노부부의 필드 위 힐링 모먼트',
                alt: '골프를 치며 미소 짓는 부부'
              }
            ],
            closing: '주말 오후의 따스한 햇살 속에서 흘린 은근한 땀방울이 온몸의 에너지를 깨워줍니다. 가볍게 어깨동무를 하고 정겨운 대화를 건네며 집으로 돌아가는 길은 무척 가볍습니다.',
            faq: [
              { question: '일반 골프와 파크골프의 가장 큰 차이점은 무엇인가요?', answer: '파크골프는 하나의 클럽과 플라스틱 공을 사용하여 공원처럼 가까운 전용 소규모 야외 경기장에서 아주 가볍게 진행되는 점이 다릅니다.' },
              { question: '가족 삼대(3대)가 함께 참여할 수도 있나요?', answer: '장비 조작법이 매우 안전하고 부상 위험이 극히 낮아, 어린아이부터 조부모까지 누구나 즉시 함께 즐길 수 있습니다.' }
            ],
            tags: ['파크골프', '건강수명', '가을산책', '시니어라이프']
          }
        }
      ];
      this.save();
    }

    // Ensure we always have corresponding published articles seeded for the published projects
    const publishedProjects = this.memoryDb.projects.filter(p => p.status === 'published');
    for (const proj of publishedProjects) {
      const exists = this.memoryDb.publishedArticles.some(a => a.projectId === proj.id);
      if (!exists) {
        const publicationId = proj.publishedArticleId || 'article_' + Math.random().toString(36).substring(2, 11);
        proj.publishedArticleId = publicationId;
        const snapshot = {
          id: publicationId,
          siteId: proj.siteId,
          ownerId: proj.ownerId,
          projectId: proj.id,
          title: proj.content.title,
          description: proj.content.description,
          content: proj.content,
          createdAt: proj.createdAt,
          publishedAt: proj.updatedAt || new Date().toISOString(),
        };
        this.memoryDb.publishedArticles.push(snapshot);
      }
    }
    this.save();
  }

  private save() {
    try {
      const tempPath = DB_FILE + '.tmp';
      fs.writeFileSync(tempPath, JSON.stringify(this.memoryDb, null, 2), 'utf-8');
      fs.renameSync(tempPath, DB_FILE);
    } catch (err) {
      console.error('Failed to write db.json atomically:', err);
    }
  }

  // IMAGE Operations
  public getImages(): HubImage[] {
    const unique: HubImage[] = [];
    const seen = new Set<string>();
    for (const img of this.memoryDb.images) {
      if (img && img.id && !seen.has(img.id)) {
        seen.add(img.id);
        unique.push(img);
      }
    }
    return unique;
  }

  public getImageById(id: string): HubImage | null {
    return this.memoryDb.images.find(img => img.id === id) || null;
  }

  public saveImage(img: HubImage) {
    const idx = this.memoryDb.images.findIndex(i => i.id === img.id);
    if (idx >= 0) {
      this.memoryDb.images[idx] = img;
    } else {
      this.memoryDb.images.push(img);
    }
    this.save();
  }

  // PROJECT Operations
  public getProjects(siteId: string, ownerId: string): BlogProject[] {
    return this.memoryDb.projects.filter(p => p.siteId === siteId && p.ownerId === ownerId);
  }

  public getProjectsOnSite(siteId: string): BlogProject[] {
    return this.memoryDb.projects.filter(p => p.siteId === siteId);
  }

  public getProjectById(id: string): BlogProject | null {
    return this.memoryDb.projects.find(p => p.id === id) || null;
  }

  public saveProject(proj: BlogProject) {
    const idx = this.memoryDb.projects.findIndex(p => p.id === proj.id);
    if (idx >= 0) {
      this.memoryDb.projects[idx] = proj;
    } else {
      this.memoryDb.projects.push(proj);
    }
    this.save();
  }

  public deleteProject(id: string) {
    this.memoryDb.projects = this.memoryDb.projects.filter(p => p.id !== id);
    this.save();
  }

  // JOB Operations
  public getJobs(siteId: string, ownerId: string): AgentJob[] {
    return this.memoryDb.jobs.filter(j => j.siteId === siteId && j.ownerId === ownerId);
  }

  public getJobById(id: string): AgentJob | null {
    return this.memoryDb.jobs.find(j => j.id === id) || null;
  }

  public getJobByRequestId(requestId: string): AgentJob | null {
    return this.memoryDb.jobs.find(j => j.requestId === requestId) || null;
  }

  public saveJob(job: AgentJob) {
    const idx = this.memoryDb.jobs.findIndex(j => j.id === job.id);
    if (idx >= 0) {
      this.memoryDb.jobs[idx] = job;
    } else {
      this.memoryDb.jobs.push(job);
    }
    this.save();
  }

  // THREAD & MESSAGE Operations
  public getThreads(siteId: string, ownerId: string): AgentThread[] {
    return this.memoryDb.threads.filter(t => t.siteId === siteId && t.ownerId === ownerId);
  }

  public getThreadById(id: string): AgentThread | null {
    return this.memoryDb.threads.find(t => t.id === id) || null;
  }

  public saveThread(thread: AgentThread) {
    const idx = this.memoryDb.threads.findIndex(t => t.id === thread.id);
    if (idx >= 0) {
      this.memoryDb.threads[idx] = thread;
    } else {
      this.memoryDb.threads.push(thread);
    }
    this.save();
  }

  public getMessages(threadId: string): ChatMessage[] {
    return this.memoryDb.messages[threadId] || [];
  }

  public saveMessage(threadId: string, msg: ChatMessage) {
    if (!this.memoryDb.messages[threadId]) {
      this.memoryDb.messages[threadId] = [];
    }
    const idx = this.memoryDb.messages[threadId].findIndex(m => m.id === msg.id);
    if (idx >= 0) {
      this.memoryDb.messages[threadId][idx] = msg;
    } else {
      this.memoryDb.messages[threadId].push(msg);
    }
    this.save();
  }

  // PUBLISHED ARTICLES Operations
  public getPublishedArticles(siteId: string): any[] {
    return this.memoryDb.publishedArticles.filter(a => a.siteId === siteId);
  }

  public getPublishedArticleById(id: string): any | null {
    return this.memoryDb.publishedArticles.find(a => a.id === id) || null;
  }

  public savePublishedArticle(art: any) {
    const idx = this.memoryDb.publishedArticles.findIndex(a => a.id === art.id);
    if (idx >= 0) {
      this.memoryDb.publishedArticles[idx] = art;
    } else {
      this.memoryDb.publishedArticles.push(art);
    }
    this.save();
  }

  public deletePublishedArticle(id: string) {
    this.memoryDb.publishedArticles = this.memoryDb.publishedArticles.filter(a => a.id !== id);
    this.save();
  }
}

export const db = new FileDatabase();
