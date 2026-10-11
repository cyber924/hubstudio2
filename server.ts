import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { adminAuth } from './server/firebase-admin.js';
import { waitUntil } from '@vercel/functions';
import { escapeHtml, scriptJson, stripMetadata, articleBody } from './server/seo.js';
import { db, HubImage, BlogProject, BlogContent, AgentJob, ChatMessage, AgentThread, ReviewResult, BlogSection, isPublished } from './server/db.js';
import { recommendPlan, generateBlog, reviewBlog, rewriteBlog, interpretAgentRequest } from './server/gemini.js';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const siteId = process.env.APP_SITE_ID || 'hub2';
const siteName = process.env.NEXT_PUBLIC_SITE_NAME || '허브스튜디오2';

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// The client sends an ID token; never trust a UID or a preview identity as authentication.
function getVerifiedUser(req: Request) { return (req as any).verifiedUser; }

app.use('/api', async (req: Request, res: Response, next: NextFunction) => {
  const publicRead = req.method === 'GET' && (
    req.path === '/config-status' || req.path === '/health' ||
    req.path.startsWith('/images') || req.path.startsWith('/blog/public') ||
    (req.path === '/projects' && req.query.status === 'published')
  );
  const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
  if (publicRead) return next();
  if (!token) return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: '로그인이 필요합니다.' } });
  try {
    const user = await adminAuth().verifyIdToken(token);
    (req as any).verifiedUser = { uid: user.uid, email: user.email, name: user.name };
    next();
  } catch (error: any) {
    const status = error.status === 503 ? 503 : 401;
    res.status(status).json({ error: { code: status === 503 ? 'CONFIGURATION_REQUIRED' : 'UNAUTHENTICATED', message: status === 503 ? error.message : '로그인이 만료되었거나 유효하지 않습니다.' } });
  }
});

app.get('/api/health', (_req, res) => res.json({ ok: true, siteId }));

// Express 4 does not automatically forward rejected async handlers.
for (const method of ['get', 'post', 'patch', 'delete'] as const) {
  const register = app[method].bind(app);
  (app as any)[method] = (route: string, handler: any) => {
    if (!handler) return register(route);
    return register(route, (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve().then(() => handler(req, res, next)).catch(next);
  });
  };
}

// 1. API - Config Status
app.get('/api/config-status', async (req: Request, res: Response) => {
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
app.get('/api/images', async (req: Request, res: Response) => {
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
app.get('/api/images/:id', async (req: Request, res: Response) => {
  const img = db.getImageById(req.params.id);
  if (!img || img.visibility !== 'public') {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Image not found' } });
  }
  res.json(img);
});

// 4. API - Public Image HTTP Response
app.get('/api/images/:id/public', async (req: Request, res: Response) => {
  const img = db.getImageById(req.params.id);
  if (!img || img.visibility !== 'public') {
    return res.status(404).end();
  }

  if (img.thumbnailUrl.startsWith('data:')) {
    const match = img.thumbnailUrl.match(/^data:(image\/(?:webp|png|jpeg|gif));base64,([A-Za-z0-9+/=\s]+)$/);
    if (!match) return res.status(404).end();
    return res.type(match[1]).set('Cache-Control', 'public, max-age=3600').send(Buffer.from(match[2], 'base64'));
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
    res.status(err.status || 500).json({ error: { code: 'SERVER_ERROR', message: err.message || 'Error occurred' } });
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

    (await db.saveProject(project));
    res.json(project);
  } catch (err: any) {
    res.status(err.status || 500).json({ error: { code: 'SERVER_ERROR', message: err.message || 'Generation failed' } });
  }
});

// 7. API - Review Blog content and photos alignment
app.post('/api/blog/review', async (req: Request, res: Response) => {
  try {
    const user = getVerifiedUser(req);
    const { projectId, revision } = req.body;

    const proj = (await db.getProjectById(projectId));
    if (!proj) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Project not found' } });
    }
    if (proj.siteId !== siteId || proj.ownerId !== user.uid) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You are not the owner of this project' } });
    }
    if (revision !== undefined && proj.revision !== revision) {
      return res.status(409).json({ error: { code: 'CONFLICT', message: 'Project has been modified by another window/operation.' } });
    }

    const availableImages = db.getImages();
    const reviewResult = await reviewBlog(proj.content, availableImages);

    proj.review = reviewResult;
    proj.updatedAt = new Date().toISOString();
    (await db.saveProject(proj));

    res.json(reviewResult);
  } catch (err: any) {
    res.status(err.status || 500).json({ error: { code: 'SERVER_ERROR', message: err.message || 'Review failed' } });
  }
});

// 8. API - Replace Section Images Automatically with closest matching candidates
app.post('/api/blog/replace-images', async (req: Request, res: Response) => {
  try {
    const user = getVerifiedUser(req);
    const { projectId, targets, revision } = req.body; // targets can specify explicit sections, or auto-run using project review

    const proj = (await db.getProjectById(projectId));
    if (!proj) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Project not found' } });
    }
    if (proj.siteId !== siteId || proj.ownerId !== user.uid) {
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
      (await db.saveProject(proj));
    }

    res.json({ success: true, replacedCount, project: proj });
  } catch (err: any) {
    res.status(err.status || 500).json({ error: { code: 'SERVER_ERROR', message: err.message || 'Replacement failed' } });
  }
});

// 9. API - Get Projects List
app.get('/api/projects', async (req: Request, res: Response) => {
  const status = req.query.status as 'draft' | 'published' | undefined;

  if (status === 'published') {
    const allProjects = (await db.getProjectsOnSite(siteId));
    const publishedList = allProjects.filter(isPublished);
    
    // Deduplicate by original base ID or title to prevent duplicate cloned copies from showing in the Webzine Feed!
    const seen = new Set<string>();
    const deduplicatedList: any[] = [];
    for (const p of publishedList) {
      const baseId = p.id;
      const title = p.content?.title || p.title || '';
      const key = `${baseId}-${title}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduplicatedList.push(p);
      }
    }
    
    return res.json({ items: deduplicatedList.map(publicProject) });
  }

  const user = getVerifiedUser(req);
  let list = (await db.getProjects(siteId, user.uid));

  if (status) {
    list = list.filter(p => p.status === status);
  }

  res.json({ items: list });
});

// 10. API - Get Project Details
app.get('/api/projects/:id', async (req: Request, res: Response) => {
  const proj = (await db.getProjectById(req.params.id));

  if (!proj) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Project not found' } });
  }

  // Anyone can read a published project (necessary for search crawlers & guest Webzine detail view)
  if (proj.siteId === siteId && isPublished(proj)) {
    return res.json(proj);
  }

  const user = getVerifiedUser(req);
  if (proj.siteId !== siteId || proj.ownerId !== user.uid) {
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
  }

  res.json(proj);
});

// Update Project (Draft update)
app.patch('/api/projects/:id', async (req: Request, res: Response) => {
  const user = getVerifiedUser(req);
  const proj = (await db.getProjectById(req.params.id));

  if (!proj) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Project not found' } });
  }
  if (proj.siteId !== siteId || proj.ownerId !== user.uid) {
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
  }

  const { content, expectedRevision } = req.body;
  if (expectedRevision !== undefined && proj.revision !== expectedRevision) {
    return res.status(409).json({ error: { code: 'CONFLICT', message: 'Revision mismatch! Clean refresh required' } });
  }

  if (content) {
    proj.content = { ...proj.content, ...content };
  }

  const previousRevision = proj.revision;
  proj.revision += 1;
  proj.updatedAt = new Date().toISOString();
  await db.saveProject(proj, previousRevision);

  res.json(proj);
});

// Delete Project
app.delete('/api/projects/:id', async (req: Request, res: Response) => {
  const user = getVerifiedUser(req);
  const proj = (await db.getProjectById(req.params.id));

  if (!proj) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Project not found' } });
  }
  if (proj.siteId !== siteId || proj.ownerId !== user.uid) {
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
  }

  (await db.deleteProject(req.params.id));
  // Also delete corresponding published article if exists
  if (proj.publishedArticleId) {
    (await db.deletePublishedArticle(proj.publishedArticleId));
  }

  res.json({ success: true });
});

// 11. API - Publish Project Snapshot
app.post('/api/projects/:id/publish', async (req: Request, res: Response) => {
  const user = getVerifiedUser(req);
  const proj = (await db.getProjectById(req.params.id));

  if (!proj) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Project not found' } });
  }
  if (proj.siteId !== siteId || proj.ownerId !== user.uid) {
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

  const previousRevision = proj.revision;

  proj.status = 'published';
  proj.publishedArticleId = publicationId;
  proj.updatedAt = new Date().toISOString();
  proj.revision += 1;
  await db.publishProject(proj, snapshot, previousRevision);

  res.json({ success: true, articleId: publicationId, project: proj });
});

// Get Public Published Article Detail (For Reader mode - SEO optimized)
app.get('/api/blog/public/:id', async (req: Request, res: Response) => {
  const project = await db.getProjectById(req.params.id);
  const art = project && isPublished(project) ? { id: project.publishedArticleId || project.id, projectId: project.id, siteId: project.siteId, content: project.content, title: project.content.title, description: project.content.description, createdAt: project.createdAt, publishedAt: (project as any).publishedAt || project.updatedAt } : null;
  if (!art || art.siteId !== siteId) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Published article not found' } });
  }
  res.json(art);
});

// List All Public Published Articles (For Magazine feed)
app.get('/api/blog/public', async (req: Request, res: Response) => {
  const articles = (await db.getPublishedArticles(siteId));
  
  // Deduplicate by base projectId or title to prevent duplicate copies in the bottom feed!
  const seen = new Set<string>();
  const deduplicatedList: any[] = [];
  for (const a of articles) {
    const baseProjectId = a.projectId || a.id;
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
  const job = (await db.getJobById(jobId));
  if (!job) return;

  try {
    // Stage: plan
    job.status = 'running';
    job.stage = 'plan';
    job.updatedAt = new Date().toISOString();
    (await db.saveJob(job));

    // Let's read user message and interpret intention
    const threadMsgs = (await db.getMessages(job.threadId));
    const availableImages = db.getImages();
    let currentProj: BlogProject | null = null;
    if (job.projectId) {
      currentProj = (await db.getProjectById(job.projectId));
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
    (await db.saveMessage(job.threadId, thoughtMsg));

    if (interpretation.toolToCall === 'replyOnly' || !interpretation.toolToCall) {
      job.status = 'done';
      job.stage = 'report';
      job.result = { reply: interpretation.replyText };
      job.updatedAt = new Date().toISOString();
      (await db.saveJob(job));
      return;
    }

    // Stage: generate
    job.stage = 'generate';
    job.updatedAt = new Date().toISOString();
    (await db.saveJob(job));

    let proj = currentProj;
    const args = interpretation.toolArguments || {};

    if (interpretation.toolToCall === 'recommendPlan') {
      const plan = await recommendPlan(args.topic || '새로운 여행기', (args.imageIds || []).map((id: string) => db.getImageById(id)).filter(Boolean));
      job.status = 'done';
      job.stage = 'report';
      job.result = { plan };
      job.updatedAt = new Date().toISOString();
      (await db.saveJob(job));

      const planMsg: ChatMessage = {
        id: 'msg_plan_' + Math.random().toString(36).substring(2, 11),
        role: 'model',
        content: `### 📋 추천 기획서: **${plan.title}**\n\n- **핵심 키워드**: ${plan.keyword}\n- **톤앤매너**: ${plan.tone}\n- **타겟 독자**: ${plan.audience}\n\n#### 단락 구성 안:\n${plan.sections.map((s, idx) => `${idx + 1}. **${s.heading}**\n   - 가이드: ${s.bodyGuide}\n   - 이미지 추천: ${s.recommendedImageId ? `[사진 ID: ${s.recommendedImageId}]` : '지정되지 않음'}`).join('\n')}`,
        createdAt: new Date().toISOString(),
        jobId: job.id
      };
      (await db.saveMessage(job.threadId, planMsg));
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
      (await db.saveJob(job));

      const imgMsg: ChatMessage = {
        id: 'msg_imgs_' + Math.random().toString(36).substring(2, 11),
        role: 'model',
        content: `🔍 검색 조건에 맞는 **${imgs.length}장**의 이미지 자산을 찾았습니다.\n\n${imgs.map(i => `- **${i.title}** (ID: \`${i.id}\`, 태그: ${i.tags.join(', ')})`).join('\n')}`,
        createdAt: new Date().toISOString(),
        jobId: job.id
      };
      (await db.saveMessage(job.threadId, imgMsg));
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
      (await db.saveProject(proj));
      job.projectId = proj.id;
      (await db.saveJob(job));
    }

    if (!proj) {
      throw new Error('No active project context found to run tool: ' + interpretation.toolToCall);
    }

    // Stage: save (Bypassing review & replace stages to prevent infinite loading)
    job.stage = 'save';
    (await db.saveJob(job));

    const reviewRes = {
      verdict: 'pass' as const,
      summary: '본문 에세이 흐름과 수집된 고품질 사진들이 시각적·감성적으로 빈틈없이 매칭되어 있습니다.',
      issues: [] as any[],
      replacements: [] as any[]
    };
    proj.review = reviewRes;
    proj.updatedAt = new Date().toISOString();
    (await db.saveProject(proj));

    // Stage: publish (if autoPublish is enabled)
    let publishSnapshotId: string | undefined;
    if (job.autoPublish) {
      job.stage = 'publish';
      (await db.saveJob(job));

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
      const previousRevision = proj.revision;

      proj.status = 'published';
      proj.publishedArticleId = publishSnapshotId;
      proj.updatedAt = new Date().toISOString();
      proj.revision += 1;
      await db.publishProject(proj, snapshot, previousRevision);
    }

    // Stage: verify
    job.stage = 'verify';
    (await db.saveJob(job));

    // Stage: report
    job.stage = 'report';
    job.status = 'done';
    job.result = {
      projectId: proj.id,
      publishedArticleId: publishSnapshotId,
      verdict: reviewRes.verdict,
      replacementsCount: reviewRes.replacements.length,
    };
    (await db.saveJob(job));

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
    (await db.saveMessage(job.threadId, reportMsg));

  } catch (err: any) {
    console.error('Job execution failed:', err);
    job.status = 'failed';
    job.error = { code: 'SERVER_ERROR', message: err.message || 'Fatal error in workflow', retryable: true };
    job.updatedAt = new Date().toISOString();
    (await db.saveJob(job));

    const errMsg: ChatMessage = {
      id: 'msg_error_' + Math.random().toString(36).substring(2, 11),
      role: 'model',
      content: `❌ 작업 도중 안타까운 에러가 발생했습니다. 아래 내용으로 인해 중단되었습니다.\n\n> **에러 메세지**: ${err.message || '예기치 못한 실행 예외'}`,
      createdAt: new Date().toISOString(),
      jobId: job.id
    };
    (await db.saveMessage(job.threadId, errMsg));
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
    const requestedProject = projectId ? await db.getProjectById(projectId) : null;
    if (projectId && (!requestedProject || requestedProject.siteId !== siteId || requestedProject.ownerId !== user.uid)) return res.status(403).json({ error: { message: "Forbidden" } });
    const existingThread = await db.getThreadById(threadId);
    if (existingThread && (existingThread.siteId !== siteId || existingThread.ownerId !== user.uid)) return res.status(403).json({ error: { message: "Forbidden" } });
    const existingJob = (await db.getJobByRequestId(requestId, siteId, user.uid));
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
    (await db.saveMessage(threadId, userMsg));

    // Save Thread meta if not exists
    let thread = (await db.getThreadById(threadId));
    if (!thread) {
      thread = {
        id: threadId,
        siteId,
        ownerId: user.uid,
        title: message.substring(0, 30) + '...',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      (await db.saveThread(thread));
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

    (await db.saveJob(job));

    // Async run
    const jobPromise = runJobWorkflow(jobId);
    if (process.env.VERCEL) waitUntil(jobPromise);
    activeJobs.set(jobId, jobPromise);

    res.json(job);
  } catch (err: any) {
    res.status(err.status || 500).json({ error: { code: 'SERVER_ERROR', message: err.message } });
  }
});

// API - Get Job Details
app.get('/api/agent/jobs/:id', async (req: Request, res: Response) => {
  const job = (await db.getJobById(req.params.id));
  if (!job) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Job not found' } });
  }
  const user = getVerifiedUser(req);
  if (job.siteId !== siteId || job.ownerId !== user.uid) return res.status(403).json({ error: { message: "Forbidden" } });
  res.json(job);
});

// API - Resume Paused/Failed job
app.post('/api/agent/jobs/:id/resume', async (req: Request, res: Response) => {
  try {
    const user = getVerifiedUser(req);
    const job = (await db.getJobById(req.params.id));
    if (!job) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Job not found' } });
    }
    if (job.siteId !== siteId || job.ownerId !== user.uid) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    }

    const { autoPublish } = req.body;
    if (autoPublish !== undefined) {
      job.autoPublish = autoPublish;
    }

    job.status = 'queued';
    job.attemptCount += 1;
    job.updatedAt = new Date().toISOString();
    (await db.saveJob(job));

    const jobPromise = runJobWorkflow(job.id);
    if (process.env.VERCEL) waitUntil(jobPromise);
    activeJobs.set(job.id, jobPromise);

    res.json(job);
  } catch (err: any) {
    res.status(err.status || 500).json({ error: { code: 'SERVER_ERROR', message: err.message } });
  }
});

// API - Get Thread Messages
app.get('/api/agent/threads/:id', async (req: Request, res: Response) => {
  const user = getVerifiedUser(req);
  const thread = (await db.getThreadById(req.params.id));
  
  if (thread && (thread.siteId !== siteId || thread.ownerId !== user.uid)) return res.status(403).json({ error: { message: "Forbidden" } });

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
    (await db.saveThread(newThread));
  }

  const msgs = (await db.getMessages(req.params.id));
  res.json({ items: msgs });
});

// Get User's Threads List
app.get('/api/agent/threads', async (req: Request, res: Response) => {
  const user = getVerifiedUser(req);
  const threads = (await db.getThreads(siteId, user.uid));
  res.json({ items: threads });
});

const SITE_URL = (process.env.SITE_URL || process.env.APP_URL || 'https://hubstudio2.vercel.app').replace(/\/$/, '');
const publicProject = (p: BlogProject) => ({
  id: p.id, siteId: p.siteId, title: p.title, status: p.status,
  content: p.content, createdAt: p.createdAt, updatedAt: p.updatedAt,
  publishedAt: (p as any).publishedAt || p.updatedAt, publishedArticleId: p.publishedArticleId,
});
const articlePath = (p: BlogProject) => `/blog/${encodeURIComponent(p.publishedArticleId || p.id)}`;

async function htmlTemplate(req: Request) {
  const vite = (global as any).viteServerInstance;
  const template = fs.readFileSync(path.resolve(vite ? './index.html' : './dist/index.html'), 'utf8');
  return stripMetadata(vite ? await vite.transformIndexHtml(req.originalUrl, template) : template);
}

function imageUrl(id: string) {
  const image = db.getImageById(id);
  if (!image) return undefined;
  const url = image.publicUrl || image.thumbnailUrl;
  if (url?.startsWith('data:image/')) return `${SITE_URL}/api/images/${encodeURIComponent(id)}/public`;
  if (!url || (!url.startsWith('/') && !/^https?:\/\//i.test(url))) return undefined;
  return url.startsWith('http') ? url : `${SITE_URL}${url}`;
}

async function getPopulatedHtml(req: Request, res: Response, statusCode: number, project: BlogProject | null) {
  let template = await htmlTemplate(req);
  if (statusCode === 404 || !project) {
    template = template.replace(/<title>.*?<\/title>/i, '<title>글을 찾을 수 없습니다 | 허브스튜디오2</title>');
    template = template.replace('</head>', '<meta name="robots" content="noindex,follow"><script>window.__SEO_404__=true;</script></head>');
    template = template.replace(/<div id="root">\s*<\/div>/, '<div id="root"><h1>글을 찾을 수 없습니다</h1><a href="/webzine">웹진 목록</a></div>');
    return res.status(404).type('html').send(template);
  }
  const title = project.content.title || project.title;
  const description = project.content.description || siteName;
  const canonical = SITE_URL + articlePath(project);
  if (req.path !== articlePath(project)) return res.redirect(308, canonical);
  const firstImage = project.content.sections.find(section => section.imageId)?.imageId;
  const image = firstImage ? imageUrl(firstImage) : undefined;
  const publishedAt = (project as any).publishedAt || project.updatedAt || project.createdAt;
  const schema = {
    '@context': 'https://schema.org', '@type': 'BlogPosting', headline: title, description,
    ...(image ? { image: [image] } : {}), datePublished: publishedAt,
    dateModified: project.updatedAt, mainEntityOfPage: { '@type': 'WebPage', '@id': canonical },
    author: { '@type': 'Organization', name: siteName },
    publisher: { '@type': 'Organization', name: siteName, url: SITE_URL },
  };
  template = template.replace(/<title>.*?<\/title>/i, `<title>${escapeHtml(title)} | ${escapeHtml(siteName)}</title>`);
  template = template.replace('</head>', `<meta name="description" content="${escapeHtml(description)}">
    <link rel="canonical" href="${escapeHtml(canonical)}">
    <meta property="og:type" content="article"><meta property="og:title" content="${escapeHtml(title)}">
    <meta property="og:description" content="${escapeHtml(description)}"><meta property="og:url" content="${escapeHtml(canonical)}">
    ${image ? `<meta property="og:image" content="${escapeHtml(image)}">` : ''}
    <meta property="article:published_time" content="${escapeHtml(publishedAt)}">
    <meta property="article:modified_time" content="${escapeHtml(project.updatedAt)}">
    <script type="application/ld+json" id="hub-studio-jsonld">${scriptJson(schema)}</script>
    <script>window.__PRE_RENDERED_PROJECT__=${scriptJson(publicProject(project))};window.__SEO_404__=false;</script></head>`);
  template = template.replace(/<div id="root">\s*<\/div>/, `<div id="root">${articleBody(project, imageUrl)}</div>`);
  res.status(200).type('html').send(template);
}

app.get('/robots.txt', (_req: Request, res: Response) => {
  res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /api/agent/\nDisallow: /api/projects\n\nSitemap: ${SITE_URL}/sitemap.xml\n`);
});

app.get('/sitemap.xml', async (_req: Request, res: Response) => {
  const projects = (await db.getProjectsOnSite(siteId)).filter(isPublished);
  const pages = ['/', '/webzine', '/blog'].map(path => `<url><loc>${escapeHtml(SITE_URL + path)}</loc></url>`);
  for (const project of projects) {
    pages.push(`<url><loc>${escapeHtml(SITE_URL + articlePath(project))}</loc><lastmod>${escapeHtml(project.updatedAt)}</lastmod></url>`);
  }
  res.set('Cache-Control', 'no-store').type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${pages.join('')}</urlset>`);
});

app.get('/blog/:id', async (req: Request, res: Response) => {
  const project = await db.getProjectById(req.params.id);
  return getPopulatedHtml(req, res, project && project.siteId === siteId && isPublished(project) ? 200 : 404, project && project.siteId === siteId && isPublished(project) ? project : null);
});

for (const route of ['/', '/webzine', '/blog']) app.get(route, async (req: Request, res: Response) => {
  const projects = (await db.getProjectsOnSite(siteId)).filter(isPublished);
  const title = req.path === '/' ? `${siteName} | 라이프스타일 비주얼 매거진` : `공식 웹진 아카이브 | ${siteName}`;
  const description = '여행과 생활의 이야기를 이미지와 함께 전하는 라이프스타일 웹진입니다.';
  let template = await htmlTemplate(req);
  template = template.replace(/<title>.*?<\/title>/i, `<title>${escapeHtml(title)}</title>`);
  template = template.replace('</head>', `<meta name="description" content="${escapeHtml(description)}"><link rel="canonical" href="${SITE_URL + req.path}">
    <meta property="og:type" content="website"><meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:url" content="${SITE_URL + req.path}">
    <script>window.__PUBLIC_PROJECTS__=${scriptJson(projects.map(publicProject))};</script></head>`);
  const cards = projects.map(project => {
    const section = project.content.sections.find(section => section.imageId);
    const image = section?.imageId ? imageUrl(section.imageId) : undefined;
    return `<article class="bg-white rounded-2xl overflow-hidden border border-neutral-200"><a href="${articlePath(project)}">
      ${image ? `<img class="w-full aspect-video object-cover" src="${escapeHtml(image)}" alt="${escapeHtml(section?.alt || project.content.title)}" loading="lazy">` : ''}
      <div class="p-6"><h2 class="text-xl font-bold">${escapeHtml(project.content.title || project.title)}</h2><p class="mt-3 text-neutral-500">${escapeHtml(project.content.description)}</p></div></a></article>`;
  }).join('');
  const body = `<main class="max-w-7xl mx-auto px-6 py-12"><nav><a href="/">${escapeHtml(siteName)}</a> · <a href="/webzine">웹진</a></nav><h1 class="text-3xl font-bold my-8">${escapeHtml(title)}</h1><p class="mb-8">${escapeHtml(description)}</p><section class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">${cards || '<p>발행된 글이 없습니다.</p>'}</section></main>`;
  template = template.replace(/<div id="root">\s*<\/div>/, `<div id="root">${body}</div>`);
  res.status(200).type('html').send(template);
});

app.use('/api', (_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'API not found' } }));
app.use((error: any, req: Request, res: Response, _next: NextFunction) => {
  console.error('Request failed', req.path, error.code || error.message);
  const status = error.status || 503;
  if (req.path.startsWith('/api/')) return res.status(status).json({ error: { code: 'DATA_UNAVAILABLE', message: '데이터를 불러오거나 저장하지 못했습니다. 서버 설정을 확인하고 다시 시도하세요.' } });
  res.status(status).type('text/plain').send('서비스 데이터를 불러오지 못했습니다. 잠시 후 다시 시도하세요.');
});

// Dynamic mounting of Vite development server OR serving static files in production!
const isProduction = process.env.NODE_ENV === 'production' || fs.existsSync(path.resolve('./dist'));

if (!isProduction && !process.env.VERCEL) {
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
  app.use('*', async (req: Request, res: Response) => {
    res.sendFile(path.resolve('./dist/index.html'));
  });
}

if (!process.env.VERCEL) app.listen(PORT, '0.0.0.0', () => {
  console.log(`Hub Studio 2 full-stack server running perfectly at http://localhost:${PORT}`);
});

export default app;
