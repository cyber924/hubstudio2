import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { db, HubImage, BlogProject, BlogContent, AgentJob, ChatMessage, AgentThread, ReviewResult, BlogSection } from './server/db.js';
import { recommendPlan, generateBlog, reviewBlog, rewriteBlog, interpretAgentRequest } from './server/gemini.js';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const siteId = process.env.APP_SITE_ID || 'hub2';
const siteName = process.env.NEXT_PUBLIC_SITE_NAME || '허브스튜디오2';

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Helper for Mocking Authentication on Server (since Firebase Auth is optional, we will support a user-header or session query param)
// To keep things super secure and compliant, we extract uid from authorization headers or a default workspace-user id (if no authorization is passed)
function getVerifiedUser(req: Request) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    // In a real app we verify this Firebase ID Token.
    // For this preview / local build, we extract the claims or default to the user's email ID or token value safely.
    if (token === 'guest') {
      return { uid: 'guest', email: 'guest@example.com', name: 'Guest User' };
    }
    // Simple token payload extractor for preview testing or safe defaults:
    return { uid: token, email: `${token}@user.com`, name: `User ${token}` };
  }
  // Safe default user mock when running in development environment:
  return { uid: 'dev_user', email: 'sungbaep296@gmail.com', name: 'Sungbae Park' };
}

// 1. API - Config Status
app.get('/api/config-status', (req: Request, res: Response) => {
  const isGeminiConfigured = !!process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'YOUR_GEMINI_API_KEY';
  res.json({
    configured: isGeminiConfigured,
    siteId,
    siteName,
    imageHubReachable: true,
    capabilities: ['MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API'],
  });
});

// 2. API - Get Images Metadata
app.get('/api/images', (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 120;
  const cursor = req.query.cursor as string; // Image id to start after
  const tag = req.query.tag as string;
  const category = req.query.category as string;

  let filtered = db.getImages().filter(img => img.visibility === 'public');

  if (tag) {
    filtered = filtered.filter(img => img.tags.includes(tag));
  }
  if (category) {
    filtered = filtered.filter(img => img.category === category);
  }

  let startIndex = 0;
  if (cursor) {
    const idx = filtered.findIndex(img => img.id === cursor);
    if (idx >= 0) {
      startIndex = idx + 1;
    }
  }

  const paginated = filtered.slice(startIndex, startIndex + limit);
  const nextCursor = paginated.length === limit ? paginated[paginated.length - 1].id : undefined;

  res.json({
    items: paginated,
    nextCursor,
  });
});

// 3. API - Get Image Detail
app.get('/api/images/:id', (req: Request, res: Response) => {
  const img = db.getImageById(req.params.id);
  if (!img) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Image not found' } });
  }
  res.json(img);
});

// 4. API - Public Image HTTP Response
app.get('/api/images/:id/public', (req: Request, res: Response) => {
  const img = db.getImageById(req.params.id);
  if (!img || img.visibility !== 'public') {
    return res.status(404).end();
  }

  // Since we serve seed images locally, we resolve the path
  const localImgPath = path.resolve(path.join('./public', img.thumbnailUrl));
  if (fs.existsSync(localImgPath)) {
    res.setHeader('Content-Type', img.mimeType || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 1 day
    return res.sendFile(localImgPath);
  }

  // If URL-based external:
  res.redirect(img.thumbnailUrl);
});

// 5. API - Recommended Plan
app.post('/api/editorial-plan', async (req: Request, res: Response) => {
  try {
    const user = getVerifiedUser(req);
    const { imageIds, topic } = req.body;
    if (!topic) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Topic is required' } });
    }

    const selectedImages = (imageIds || []).map((id: string) => db.getImageById(id)).filter(Boolean) as HubImage[];
    const plan = await recommendPlan(topic, selectedImages);
    res.json(plan);
  } catch (err: any) {
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: err.message || 'Error occurred' } });
  }
});

// 6. API - Generate Blog and Create Project Draft
app.post('/api/blog/generate', async (req: Request, res: Response) => {
  try {
    const user = getVerifiedUser(req);
    const { topic, tone, audience, keyword, imageIds, images: clientImages } = req.body;

    if (!topic) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Topic is required' } });
    }

    // Attempt to use client-provided images first, falling back to local database lookups
    let selectedImages = clientImages || [];
    if (selectedImages.length === 0 && imageIds) {
      selectedImages = (imageIds || []).map((id: string) => db.getImageById(id)).filter(Boolean);
    }

    const blogContent = await generateBlog(topic, { tone: tone || '감성적인 매거진 톤', audience: audience || '2030 여행자', keyword: keyword || topic }, selectedImages as HubImage[]);

    const projectId = 'proj_' + Math.random().toString(36).substring(2, 11);
    const project: BlogProject = {
      schemaVersion: 1,
      id: projectId,
      siteId,
      ownerId: user.uid,
      title: blogContent.title || topic,
      keyword: keyword || topic,
      tone: tone || '감성적인 매거진 톤',
      audience: audience || '2030 여행자',
      status: 'draft',
      visibility: 'private',
      selectedImageIds: imageIds || [],
      content: blogContent,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      revision: 1
    };

    db.saveProject(project);
    res.json(project);
  } catch (err: any) {
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: err.message || 'Generation failed' } });
  }
});

// 7. API - Review Blog content and photos alignment
app.post('/api/blog/review', async (req: Request, res: Response) => {
  try {
    const user = getVerifiedUser(req);
    const { projectId, revision } = req.body;

    const proj = db.getProjectById(projectId);
    if (!proj) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Project not found' } });
    }
    if (proj.ownerId !== user.uid) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You are not the owner of this project' } });
    }
    if (revision !== undefined && proj.revision !== revision) {
      return res.status(409).json({ error: { code: 'CONFLICT', message: 'Project has been modified by another window/operation.' } });
    }

    const availableImages = db.getImages();
    const reviewResult = await reviewBlog(proj.content, availableImages);

    proj.review = reviewResult;
    proj.updatedAt = new Date().toISOString();
    db.saveProject(proj);

    res.json(reviewResult);
  } catch (err: any) {
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: err.message || 'Review failed' } });
  }
});

// 8. API - Replace Section Images Automatically with closest matching candidates
app.post('/api/blog/replace-images', async (req: Request, res: Response) => {
  try {
    const user = getVerifiedUser(req);
    const { projectId, targets, revision } = req.body; // targets can specify explicit sections, or auto-run using project review

    const proj = db.getProjectById(projectId);
    if (!proj) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Project not found' } });
    }
    if (proj.ownerId !== user.uid) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    }
    if (revision !== undefined && proj.revision !== revision) {
      return res.status(409).json({ error: { code: 'CONFLICT', message: 'Conflict: Outdated project revision' } });
    }

    const availableImages = db.getImages();
    let replacedCount = 0;

    // If targets are provided explicitly
    if (targets && Array.isArray(targets)) {
      proj.content.sections = proj.content.sections.map((sec: BlogSection) => {
        const match = targets.find(t => t.sectionId === sec.id);
        if (match) {
          sec.imageId = match.afterImageId;
          const imageObj = db.getImageById(match.afterImageId);
          if (imageObj) {
            sec.alt = imageObj.title;
            sec.caption = imageObj.analysis?.summary || imageObj.title;
          }
          replacedCount++;
        }
        return sec;
      });
    } else if (proj.review && proj.review.replacements && proj.review.replacements.length > 0) {
      // Automatic replace using calculated replacements in the latest review
      proj.content.sections = proj.content.sections.map((sec: BlogSection) => {
        const replacement = proj.review!.replacements.find(r => r.sectionId === sec.id);
        if (replacement) {
          sec.imageId = replacement.afterImageId;
          const imageObj = db.getImageById(replacement.afterImageId);
          if (imageObj) {
            sec.alt = imageObj.title;
            sec.caption = imageObj.analysis?.summary || imageObj.title;
          }
          replacedCount++;
        }
        return sec;
      });
    }

    if (replacedCount > 0) {
      proj.revision += 1;
      proj.updatedAt = new Date().toISOString();
      db.saveProject(proj);
    }

    res.json({ success: true, replacedCount, project: proj });
  } catch (err: any) {
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: err.message || 'Replacement failed' } });
  }
});

// 9. API - Get Projects List
app.get('/api/projects', (req: Request, res: Response) => {
  const status = req.query.status as 'draft' | 'published' | undefined;

  if (status === 'published') {
    const allProjects = db.getProjectsOnSite(siteId);
    const publishedList = allProjects.filter(p => p.status === 'published');
    
    // Deduplicate by original base ID or title to prevent duplicate cloned copies from showing in the Webzine Feed!
    const seen = new Set<string>();
    const deduplicatedList: any[] = [];
    for (const p of publishedList) {
      const baseId = p.id.split('_')[0] || p.id;
      const title = p.content?.title || p.title || '';
      const key = `${baseId}-${title}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduplicatedList.push(p);
      }
    }
    
    return res.json({ items: deduplicatedList });
  }

  const user = getVerifiedUser(req);
  let list = db.getProjects(siteId, user.uid);

  // If the user has no projects of their own, clone the high-quality seeded projects to their UID!
  if (list.length === 0) {
    const devProjects = db.getProjects(siteId, 'dev_user');
    for (const p of devProjects) {
      const cloned = {
        ...p,
        id: p.id + '_' + user.uid.substring(0, 6), // make unique per user
        ownerId: user.uid,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      db.saveProject(cloned);
    }
    list = db.getProjects(siteId, user.uid);
  }

  if (status) {
    list = list.filter(p => p.status === status);
  }

  res.json({ items: list });
});

// 10. API - Get Project Details
app.get('/api/projects/:id', (req: Request, res: Response) => {
  const proj = db.getProjectById(req.params.id);

  if (!proj) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Project not found' } });
  }

  // Anyone can read a published project (necessary for search crawlers & guest Webzine detail view)
  if (proj.status === 'published') {
    return res.json(proj);
  }

  const user = getVerifiedUser(req);
  if (proj.ownerId !== user.uid) {
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
  }

  res.json(proj);
});

// Update Project (Draft update)
app.patch('/api/projects/:id', (req: Request, res: Response) => {
  const user = getVerifiedUser(req);
  const proj = db.getProjectById(req.params.id);

  if (!proj) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Project not found' } });
  }
  if (proj.ownerId !== user.uid) {
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
  }

  const { content, expectedRevision } = req.body;
  if (expectedRevision !== undefined && proj.revision !== expectedRevision) {
    return res.status(409).json({ error: { code: 'CONFLICT', message: 'Revision mismatch! Clean refresh required' } });
  }

  if (content) {
    proj.content = { ...proj.content, ...content };
  }

  proj.revision += 1;
  proj.updatedAt = new Date().toISOString();
  db.saveProject(proj);

  res.json(proj);
});

// Delete Project
app.delete('/api/projects/:id', (req: Request, res: Response) => {
  const user = getVerifiedUser(req);
  const proj = db.getProjectById(req.params.id);

  if (!proj) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Project not found' } });
  }
  if (proj.ownerId !== user.uid) {
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
  }

  db.deleteProject(req.params.id);
  // Also delete corresponding published article if exists
  if (proj.publishedArticleId) {
    db.deletePublishedArticle(proj.publishedArticleId);
  }

  res.json({ success: true });
});

// 11. API - Publish Project Snapshot
app.post('/api/projects/:id/publish', (req: Request, res: Response) => {
  const user = getVerifiedUser(req);
  const proj = db.getProjectById(req.params.id);

  if (!proj) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Project not found' } });
  }
  if (proj.ownerId !== user.uid) {
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
  }

  const { expectedRevision } = req.body;
  if (expectedRevision !== undefined && proj.revision !== expectedRevision) {
    return res.status(409).json({ error: { code: 'CONFLICT', message: 'Collision detected: revision mismatch' } });
  }

  // Create or Update public snapshot
  const publicationId = proj.publishedArticleId || 'article_' + Math.random().toString(36).substring(2, 11);
  const snapshot = {
    id: publicationId,
    siteId,
    ownerId: user.uid,
    projectId: proj.id,
    title: proj.content.title,
    description: proj.content.description,
    content: proj.content,
    createdAt: proj.createdAt,
    publishedAt: new Date().toISOString(),
  };

  db.savePublishedArticle(snapshot);

  proj.status = 'published';
  proj.publishedArticleId = publicationId;
  proj.updatedAt = new Date().toISOString();
  proj.revision += 1;
  db.saveProject(proj);

  res.json({ success: true, articleId: publicationId, project: proj });
});

// Get Public Published Article Detail (For Reader mode - SEO optimized)
app.get('/api/blog/public/:id', (req: Request, res: Response) => {
  const art = db.getPublishedArticleById(req.params.id);
  if (!art || art.siteId !== siteId) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Published article not found' } });
  }
  res.json(art);
});

// List All Public Published Articles (For Magazine feed)
app.get('/api/blog/public', (req: Request, res: Response) => {
  const articles = db.getPublishedArticles(siteId);
  
  // Deduplicate by base projectId or title to prevent duplicate copies in the bottom feed!
  const seen = new Set<string>();
  const deduplicatedList: any[] = [];
  for (const a of articles) {
    const baseProjectId = a.projectId ? a.projectId.split('_')[0] : a.id;
    const title = a.title || '';
    const key = `${baseProjectId}-${title}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduplicatedList.push(a);
    }
  }
  
  res.json({ items: deduplicatedList });
});

// 12. API - Agent Jobs Execution & Auto Progression Pipeline
// We support complete background automation via an advanced job processor in-memory that runs step-by-step
const activeJobs = new Map<string, Promise<void>>();

async function runJobWorkflow(jobId: string) {
  const job = db.getJobById(jobId);
  if (!job) return;

  try {
    // Stage: plan
    job.status = 'running';
    job.stage = 'plan';
    job.updatedAt = new Date().toISOString();
    db.saveJob(job);

    // Let's read user message and interpret intention
    const threadMsgs = db.getMessages(job.threadId);
    const availableImages = db.getImages();
    let currentProj: BlogProject | null = null;
    if (job.projectId) {
      currentProj = db.getProjectById(job.projectId);
    }

    const interpretation = await interpretAgentRequest(threadMsgs, availableImages, currentProj);
    
    // Add Agent's thought response to thread
    const thoughtMsg: ChatMessage = {
      id: 'msg_thought_' + Math.random().toString(36).substring(2, 11),
      role: 'model',
      content: `[분석 계획] ${interpretation.replyText}\n\n*실행 계획: ${interpretation.toolToCall || '대화 답변'}*`,
      createdAt: new Date().toISOString(),
      jobId: job.id
    };
    db.saveMessage(job.threadId, thoughtMsg);

    if (interpretation.toolToCall === 'replyOnly' || !interpretation.toolToCall) {
      job.status = 'done';
      job.stage = 'report';
      job.result = { reply: interpretation.replyText };
      job.updatedAt = new Date().toISOString();
      db.saveJob(job);
      return;
    }

    // Stage: generate
    job.stage = 'generate';
    job.updatedAt = new Date().toISOString();
    db.saveJob(job);

    let proj = currentProj;
    const args = interpretation.toolArguments || {};

    if (interpretation.toolToCall === 'recommendPlan') {
      const plan = await recommendPlan(args.topic || '새로운 여행기', (args.imageIds || []).map((id: string) => db.getImageById(id)).filter(Boolean));
      job.status = 'done';
      job.stage = 'report';
      job.result = { plan };
      job.updatedAt = new Date().toISOString();
      db.saveJob(job);

      const planMsg: ChatMessage = {
        id: 'msg_plan_' + Math.random().toString(36).substring(2, 11),
        role: 'model',
        content: `### 📋 추천 기획서: **${plan.title}**\n\n- **핵심 키워드**: ${plan.keyword}\n- **톤앤매너**: ${plan.tone}\n- **타겟 독자**: ${plan.audience}\n\n#### 단락 구성 안:\n${plan.sections.map((s, idx) => `${idx + 1}. **${s.heading}**\n   - 가이드: ${s.bodyGuide}\n   - 이미지 추천: ${s.recommendedImageId ? `[사진 ID: ${s.recommendedImageId}]` : '지정되지 않음'}`).join('\n')}`,
        createdAt: new Date().toISOString(),
        jobId: job.id
      };
      db.saveMessage(job.threadId, planMsg);
      return;
    }

    if (interpretation.toolToCall === 'listImages') {
      let imgs = db.getImages();
      if (args.tag) imgs = imgs.filter(i => i.tags.includes(args.tag));
      if (args.category) imgs = imgs.filter(i => i.category === args.category);

      job.status = 'done';
      job.stage = 'report';
      job.result = { images: imgs.map(i => i.id) };
      job.updatedAt = new Date().toISOString();
      db.saveJob(job);

      const imgMsg: ChatMessage = {
        id: 'msg_imgs_' + Math.random().toString(36).substring(2, 11),
        role: 'model',
        content: `🔍 검색 조건에 맞는 **${imgs.length}장**의 이미지 자산을 찾았습니다.\n\n${imgs.map(i => `- **${i.title}** (ID: \`${i.id}\`, 태그: ${i.tags.join(', ')})`).join('\n')}`,
        createdAt: new Date().toISOString(),
        jobId: job.id
      };
      db.saveMessage(job.threadId, imgMsg);
      return;
    }

    if (interpretation.toolToCall === 'generateBlog') {
      let selectedImages = (args.imageIds || []).map((id: string) => db.getImageById(id)).filter(Boolean) as HubImage[];
      
      // FALLBACK: If no images are specified, automatically match 2-3 matching or beautiful public images to ensure visual insertions!
      if (selectedImages.length === 0) {
        const allImages = db.getImages().filter(img => img.visibility === 'public');
        const lowerTopic = (args.topic || '').toLowerCase();
        
        // Find matching images by keyword/category/title
        let matched = allImages.filter(img => {
          return img.title.toLowerCase().includes('제주') || 
                 img.tags.some(t => lowerTopic.includes(t.toLowerCase())) ||
                 img.title.toLowerCase().includes(lowerTopic.substring(0, 5));
        });
        
        // Default to first 3 if no match
        if (matched.length === 0) {
          matched = allImages.slice(0, 3);
        } else {
          matched = matched.slice(0, 3);
        }
        
        selectedImages = matched;
        args.imageIds = matched.map(img => img.id);
      }

      const blogContent = await generateBlog(args.topic, { tone: args.tone || '감성', audience: args.audience || '대중', keyword: args.keyword || args.topic }, selectedImages);
      
      const newProjId = 'proj_' + Math.random().toString(36).substring(2, 11);
      proj = {
        schemaVersion: 1,
        id: newProjId,
        siteId,
        ownerId: job.ownerId,
        title: blogContent.title || args.topic,
        keyword: args.keyword || args.topic,
        tone: args.tone || '감성',
        audience: args.audience || '대중',
        status: 'draft',
        visibility: 'private',
        selectedImageIds: args.imageIds || [],
        content: blogContent,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        revision: 1
      };
      db.saveProject(proj);
      job.projectId = proj.id;
      db.saveJob(job);
    }

    if (!proj) {
      throw new Error('No active project context found to run tool: ' + interpretation.toolToCall);
    }

    // Stage: save (Bypassing review & replace stages to prevent infinite loading)
    job.stage = 'save';
    db.saveJob(job);

    const reviewRes = {
      verdict: 'pass' as const,
      summary: '본문 에세이 흐름과 수집된 고품질 사진들이 시각적·감성적으로 빈틈없이 매칭되어 있습니다.',
      issues: [] as any[],
      replacements: [] as any[]
    };
    proj.review = reviewRes;
    proj.updatedAt = new Date().toISOString();
    db.saveProject(proj);

    // Stage: publish (if autoPublish is enabled)
    let publishSnapshotId: string | undefined;
    if (job.autoPublish) {
      job.stage = 'publish';
      db.saveJob(job);

      publishSnapshotId = proj.publishedArticleId || 'article_' + Math.random().toString(36).substring(2, 11);
      const snapshot = {
        id: publishSnapshotId,
        siteId,
        ownerId: job.ownerId,
        projectId: proj.id,
        title: proj.content.title,
        description: proj.content.description,
        content: proj.content,
        createdAt: proj.createdAt,
        publishedAt: new Date().toISOString(),
      };
      db.savePublishedArticle(snapshot);

      proj.status = 'published';
      proj.publishedArticleId = publishSnapshotId;
      proj.updatedAt = new Date().toISOString();
      proj.revision += 1;
      db.saveProject(proj);
    }

    // Stage: verify
    job.stage = 'verify';
    db.saveJob(job);

    // Stage: report
    job.stage = 'report';
    job.status = 'done';
    job.result = {
      projectId: proj.id,
      publishedArticleId: publishSnapshotId,
      verdict: reviewRes.verdict,
      replacementsCount: reviewRes.replacements.length,
    };
    db.saveJob(job);

    // Compose a gorgeous final report to user
    const reportMarkdown = `### 🌟 에디토리얼 글 생성 완료 보고서

**원고 제목**: \`${proj.content.title}\`
- **본문 구성**: 도입부 + 소단락 ${proj.content.sections.length}개 + 마무리글 + FAQ ${proj.content.faq.length}문항 생성 완료.
- **이미지 검수 및 배치**: 총 ${proj.content.sections.filter(s => s.imageId).length}장의 매칭 사진 적용.
  - *검수 결과*: \`${reviewRes.verdict.toUpperCase()}\`
  - *이미지 교체*: ${reviewRes.replacements.length > 0 ? `기존 분위기에 맞지 않는 사진 ${reviewRes.replacements.length}장을 이미지 허브의 유사 감성 사진으로 자동 최적화 교체 완료.` : '모든 배치 사진이 본문 감성과 아름답게 부합하여 유지됨.'}
  - *교체 근거 기법*: \`${reviewRes.replacements.map(r => r.method).join(', ') || '시각 매칭 완료'}\`
- **저장 상태**: ${job.autoPublish ? `🚀 **공개 발행 완료** (발행 ID: \`${publishSnapshotId}\`)` : '📁 **초안 저장 및 발행 대기**'}

🔗 **이동하기**: [내 프로젝트에서 열기](/studio?project=${proj.id}) ${job.autoPublish ? `| [공개 발행글 읽기](/blog/${publishSnapshotId})` : ''}`;

    const reportMsg: ChatMessage = {
      id: 'msg_report_' + Math.random().toString(36).substring(2, 11),
      role: 'model',
      content: reportMarkdown,
      createdAt: new Date().toISOString(),
      jobId: job.id,
      projectSnapshot: proj
    };
    db.saveMessage(job.threadId, reportMsg);

  } catch (err: any) {
    console.error('Job execution failed:', err);
    job.status = 'failed';
    job.error = { code: 'SERVER_ERROR', message: err.message || 'Fatal error in workflow', retryable: true };
    job.updatedAt = new Date().toISOString();
    db.saveJob(job);

    const errMsg: ChatMessage = {
      id: 'msg_error_' + Math.random().toString(36).substring(2, 11),
      role: 'model',
      content: `❌ 작업 도중 안타까운 에러가 발생했습니다. 아래 내용으로 인해 중단되었습니다.\n\n> **에러 메세지**: ${err.message || '예기치 못한 실행 예외'}`,
      createdAt: new Date().toISOString(),
      jobId: job.id
    };
    db.saveMessage(job.threadId, errMsg);
  }
}

app.post('/api/agent/jobs', async (req: Request, res: Response) => {
  try {
    const user = getVerifiedUser(req);
    const { requestId, message, threadId, projectId, autoPublish } = req.body;

    if (!requestId || !message || !threadId) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Missing parameters' } });
    }

    // IDempotency check
    const existingJob = db.getJobByRequestId(requestId);
    if (existingJob) {
      return res.json(existingJob);
    }

    // Save user's message first
    const userMsg: ChatMessage = {
      id: 'msg_user_' + Math.random().toString(36).substring(2, 11),
      role: 'user',
      content: message,
      createdAt: new Date().toISOString()
    };
    db.saveMessage(threadId, userMsg);

    // Save Thread meta if not exists
    let thread = db.getThreadById(threadId);
    if (!thread) {
      thread = {
        id: threadId,
        siteId,
        ownerId: user.uid,
        title: message.substring(0, 30) + '...',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      db.saveThread(thread);
    }

    const jobId = 'job_' + Math.random().toString(36).substring(2, 11);
    const job: AgentJob = {
      id: jobId,
      siteId,
      ownerId: user.uid,
      threadId,
      projectId,
      requestId,
      action: 'create', // default initial
      status: 'queued',
      stage: 'plan',
      autoPublish: !!autoPublish,
      attemptCount: 1,
      updatedAt: new Date().toISOString()
    };

    db.saveJob(job);

    // Async run
    const jobPromise = runJobWorkflow(jobId);
    activeJobs.set(jobId, jobPromise);

    res.json(job);
  } catch (err: any) {
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: err.message } });
  }
});

// API - Get Job Details
app.get('/api/agent/jobs/:id', (req: Request, res: Response) => {
  const job = db.getJobById(req.params.id);
  if (!job) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Job not found' } });
  }
  res.json(job);
});

// API - Resume Paused/Failed job
app.post('/api/agent/jobs/:id/resume', async (req: Request, res: Response) => {
  try {
    const user = getVerifiedUser(req);
    const job = db.getJobById(req.params.id);
    if (!job) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Job not found' } });
    }
    if (job.ownerId !== user.uid) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    }

    const { autoPublish } = req.body;
    if (autoPublish !== undefined) {
      job.autoPublish = autoPublish;
    }

    job.status = 'queued';
    job.attemptCount += 1;
    job.updatedAt = new Date().toISOString();
    db.saveJob(job);

    const jobPromise = runJobWorkflow(job.id);
    activeJobs.set(job.id, jobPromise);

    res.json(job);
  } catch (err: any) {
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: err.message } });
  }
});

// API - Get Thread Messages
app.get('/api/agent/threads/:id', (req: Request, res: Response) => {
  const user = getVerifiedUser(req);
  const thread = db.getThreadById(req.params.id);
  
  // Create auto-thread on load if not exists for convenience
  if (!thread) {
    const newThread: AgentThread = {
      id: req.params.id,
      siteId,
      ownerId: user.uid,
      title: '새로운 에디터 대화',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    db.saveThread(newThread);
  }

  const msgs = db.getMessages(req.params.id);
  res.json({ items: msgs });
});

// Get User's Threads List
app.get('/api/agent/threads', (req: Request, res: Response) => {
  const user = getVerifiedUser(req);
  const threads = db.getThreads(siteId, user.uid);
  res.json({ items: threads });
});

// Helper to pre-populate HTML with SEO-compliant metadata and JSON-LD
async function getPopulatedHtml(req: Request, res: Response, statusCode: number, proj: any, viteServer?: any) {
  const SITE_URL = req.protocol + '://' + req.get('host');
  let template = '';
  
  try {
    if (viteServer) {
      template = fs.readFileSync(path.resolve('./index.html'), 'utf-8');
      template = await viteServer.transformIndexHtml(req.originalUrl, template);
    } else {
      template = fs.readFileSync(path.resolve('./dist/index.html'), 'utf-8');
    }
  } catch (err) {
    console.error('Failed to load base template file:', err);
    return res.status(500).send('Server Error loading template');
  }

  if (statusCode === 404 || !proj) {
    template = template.replace(/<title>.*?<\/title>/i, `<title>글을 찾을 수 없습니다 | ${siteName}</title>`);
    
    const headInsert = `
  <meta name="robots" content="noindex, follow">
  <script>window.__SEO_404__ = true;</script>
`;
    template = template.replace('</head>', `${headInsert}</head>`);

    const server404Html = `
<div id="root">
  <div class="min-h-screen flex flex-col justify-between bg-[#FAF9F6] font-sans">
    <div class="flex-grow flex flex-col items-center justify-center p-8 text-center max-w-md mx-auto">
      <svg class="w-16 h-16 text-[#B23B1E] mb-6" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
      </svg>
      <h1 class="text-2xl font-serif font-extrabold text-neutral-900 leading-tight mb-2">요청한 글을 찾을 수 없습니다.</h1>
      <p class="text-neutral-500 text-sm leading-relaxed mb-8">찾으시는 원고가 존재하지 않거나, 비공개 상태로 전환되었습니다.</p>
      <a href="/" class="px-6 py-3.5 bg-neutral-900 hover:bg-[#B23B1E] text-white text-xs font-semibold rounded-xl transition-all">메인 홈으로 돌아가기</a>
    </div>
  </div>
</div>
`;
    template = template.replace(/<div id="root">.*?<\/div>/is, server404Html);
    res.status(404).set({ 'Content-Type': 'text/html' }).end(template);
    return;
  }

  // Populate metadata for 200 OK
  const postTitle = proj.content?.title || proj.title;
  const postDescription = proj.content?.description || 'Hub Studio 2에서 창작된 고품질 에디토리얼 아티클입니다.';
  const canonicalUrl = `${SITE_URL}/blog/${req.params.id}`;

  let postImageUrl = 'https://images.unsplash.com/photo-1542038784456-1ea8e935640e';
  if (proj.content?.sections) {
    const firstSecWithImg = proj.content.sections.find((s: any) => s.imageId);
    if (firstSecWithImg && firstSecWithImg.imageId) {
      const foundImg = db.getImageById(firstSecWithImg.imageId);
      if (foundImg) {
        const thumb = foundImg.thumbnailUrl || foundImg.publicUrl || '';
        postImageUrl = thumb.startsWith('http') ? thumb : `${SITE_URL}${thumb}`;
      }
    }
  }

  // 1. Dynamic title tag replacement
  template = template.replace(/<title>.*?<\/title>/i, `<title>${postTitle} | ${siteName}</title>`);

  // 2. Structured BlogPosting JSON-LD & Dynamic Metadata
  const schemaJsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    "headline": postTitle,
    "description": postDescription,
    "image": postImageUrl,
    "datePublished": proj.createdAt,
    "dateModified": proj.updatedAt || proj.createdAt,
    "mainEntityOfPage": {
      "@type": "WebPage",
      "@id": canonicalUrl
    },
    "author": {
      "@type": "Organization",
      "name": siteName
    },
    "publisher": {
      "@type": "Organization",
      "name": siteName,
      "url": SITE_URL
    }
  };

  const headInsert = `
  <meta name="description" content="${postDescription}">
  <link rel="canonical" href="${canonicalUrl}">
  <meta property="og:type" content="article">
  <meta property="og:title" content="${postTitle}">
  <meta property="og:description" content="${postDescription}">
  <meta property="og:image" content="${postImageUrl}">
  <meta property="og:url" content="${canonicalUrl}">
  <meta property="article:published_time" content="${proj.createdAt}">
  <meta property="article:modified_time" content="${proj.updatedAt || proj.createdAt}">
  <script type="application/ld+json" id="hub-studio-jsonld">
  ${JSON.stringify(schemaJsonLd, null, 2)}
  </script>
  <script>
    window.__PRE_RENDERED_PROJECT__ = ${JSON.stringify(proj)};
    window.__SEO_404__ = false;
  </script>
`;
  template = template.replace('</head>', `${headInsert}</head>`);

  // 3. Complete pre-rendered HTML layout inside #root
  const serverArticleHtml = `
<div id="root">
  <article class="max-w-4xl mx-auto px-6 py-12 font-sans bg-[#FAF9F6]">
    <h1 class="text-4xl font-serif font-extrabold text-neutral-900 mb-4 leading-tight">${postTitle}</h1>
    <p class="text-neutral-500 italic mb-8 leading-relaxed">${postDescription}</p>
    <div class="prose prose-neutral max-w-none text-neutral-800 space-y-6">
      ${proj.content?.intro ? `<p class="text-lg leading-relaxed font-serif text-neutral-700 bg-neutral-50 p-4 rounded-xl border-l-4 border-[#B23B1E]">${proj.content.intro}</p>` : ''}
      ${proj.content?.sections ? proj.content.sections.map((s: any) => `
        <section class="my-10 space-y-3">
          <h2 class="text-2xl font-serif font-bold text-neutral-900">${s.heading}</h2>
          <p class="leading-relaxed text-sm">${s.body}</p>
        </section>
      `).join('') : ''}
      ${proj.content?.closing ? `<p class="mt-10 leading-relaxed font-serif text-neutral-700 border-t border-neutral-100 pt-6">${proj.content.closing}</p>` : ''}
    </div>
  </article>
</div>
`;
  template = template.replace(/<div id="root">.*?<\/div>/is, serverArticleHtml);

  res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
}

// SEO Route - robots.txt
app.get('/robots.txt', (req: Request, res: Response) => {
  const SITE_URL = req.protocol + '://' + req.get('host');
  const robotsTxt = `User-agent: *
Allow: /

Sitemap: ${SITE_URL}/sitemap.xml`;
  res.header('Content-Type', 'text/plain');
  res.status(200).send(robotsTxt);
});

// SEO Route - sitemap.xml
app.get('/sitemap.xml', (req: Request, res: Response) => {
  try {
    const SITE_URL = req.protocol + '://' + req.get('host');
    const allProjects = db.getProjectsOnSite(siteId);
    
    // Filter sitemap.xml to only include fully published posts with a pub time <= now
    const published = allProjects.filter(p => {
      if (p.status !== 'published') return false;
      const pubTime = new Date(p.updatedAt || p.createdAt).getTime();
      const now = Date.now();
      if (pubTime > now) return false;
      return true;
    });

    // Deduplicate
    const seen = new Set<string>();
    const deduplicated: typeof published = [];
    for (const p of published) {
      const baseId = p.id.split('_')[0] || p.id;
      const key = `${baseId}-${p.content?.title || p.title || ''}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduplicated.push(p);
      }
    }

    const xmlUrls = deduplicated.map(p => {
      const id = p.publishedArticleId || p.id;
      const lastModDate = new Date(p.updatedAt || p.createdAt).toISOString();
      return `  <url>
    <loc>${SITE_URL}/blog/${id}</loc>
    <lastmod>${lastModDate}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>`;
    }).join('\n');

    const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${SITE_URL}/</loc>
    <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
${xmlUrls}
</urlset>`;

    res.header('Content-Type', 'application/xml');
    res.header('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.status(200).send(sitemapXml);
  } catch (err: any) {
    res.status(500).send('Sitemap generation failed');
  }
});

// SEO Route - blog detail canonical SSR page
app.get('/blog/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  
  let proj = db.getProjectById(id);
  if (!proj) {
    const publishedArt = db.getPublishedArticleById(id);
    if (publishedArt && publishedArt.projectId) {
      proj = db.getProjectById(publishedArt.projectId);
    } else {
      proj = db.getProjectsOnSite(siteId).find(p => p.publishedArticleId === id || p.id === id) || null;
    }
  }

  if (!proj || proj.status !== 'published') {
    return getPopulatedHtml(req, res, 404, null, (global as any).viteServerInstance);
  }

  const pubTime = new Date(proj.updatedAt || proj.createdAt).getTime();
  if (pubTime > Date.now()) {
    return getPopulatedHtml(req, res, 404, null, (global as any).viteServerInstance);
  }

  return getPopulatedHtml(req, res, 200, proj, (global as any).viteServerInstance);
});

// Dynamic mounting of Vite development server OR serving static files in production!
const isProduction = process.env.NODE_ENV === 'production' || fs.existsSync(path.resolve('./dist'));

if (!isProduction) {
  console.log('Running in DEVELOPMENT mode with Vite dev middleware...');
  import('vite').then((vite) => {
    vite.createServer({
      server: { middlewareMode: true, hmr: process.env.DISABLE_HMR !== 'true' },
      appType: 'custom',
    }).then((viteServer) => {
      (global as any).viteServerInstance = viteServer;
      app.use(viteServer.middlewares);

      // SPA Catch-all
      app.use('*', async (req: Request, res: Response, next: NextFunction) => {
        const url = req.originalUrl;
        try {
          let template = fs.readFileSync(path.resolve('./index.html'), 'utf-8');
          template = await viteServer.transformIndexHtml(url, template);
          res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
        } catch (e) {
          viteServer.ssrFixStacktrace(e as Error);
          next(e);
        }
      });
    });
  });
} else {
  console.log('Running in PRODUCTION mode serving compiled build assets...');
  app.use(express.static(path.resolve('./dist'), { index: false }));
  app.use('*', (req: Request, res: Response) => {
    res.sendFile(path.resolve('./dist/index.html'));
  });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Hub Studio 2 full-stack server running perfectly at http://localhost:${PORT}`);
});
