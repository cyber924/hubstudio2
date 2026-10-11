import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { adminAuth } from './server/firebase-admin.js';
import { identityContext, verifyIdentity, sharedPublicImage, invalidateSharedPublicProjects } from './server/shared-content.js';
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
    const user = process.env.FIREBASE_AUTH_EMULATOR_HOST ? await adminAuth().verifyIdToken(token) : await verifyIdentity(token);
    (req as any).verifiedUser = { uid: user.uid, email: user.email, name: user.name };
    identityContext.run({ uid: user.uid, token }, () => next());
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
    storageMode: 'firebase-client',
    serverStorageCredentialsRequired: false,
    geminiModel: process.env.GEMINI_TEXT_MODEL || 'gemini-3.8-flash',
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
  const img = db.getImageById(req.params.id) || await sharedPublicImage(req.params.id);
  if (!img || img.visibility !== 'public') {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Image not found' } });
  }
  res.json(img);
});

// 4. API - Public Image HTTP Response
app.get('/api/images/:id/public', async (req: Request, res: Response) => {
  const img = db.getImageById(req.params.id) || await sharedPublicImage(req.params.id);
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

    const available = Array.isArray(req.body.images) ? req.body.images : db.getImages();
    const selectedImages = available.filter((image: HubImage) => (imageIds || []).includes(image.id));
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

    const proj = req.body.project as BlogProject;
    if (!proj) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Project not found' } });
    }
    if (proj.siteId !== siteId || proj.ownerId !== user.uid) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You are not the owner of this project' } });
    }
    if (revision !== undefined && proj.revision !== revision) {
      return res.status(409).json({ error: { code: 'CONFLICT', message: 'Project has been modified by another window/operation.' } });
    }

    const availableImages = Array.isArray(req.body.images) ? req.body.images : db.getImages();
    const reviewResult = await reviewBlog(proj.content, availableImages);

    proj.review = reviewResult;
    proj.updatedAt = new Date().toISOString();

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

    const proj = req.body.project as BlogProject;
    if (!proj) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Project not found' } });
    }
    if (proj.siteId !== siteId || proj.ownerId !== user.uid) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    }
    if (revision !== undefined && proj.revision !== revision) {
      return res.status(409).json({ error: { code: 'CONFLICT', message: 'Conflict: Outdated project revision' } });
    }

    const availableImages = Array.isArray(req.body.images) ? req.body.images : db.getImages();
    let replacedCount = 0;

    // If targets are provided explicitly
    if (targets && Array.isArray(targets)) {
      proj.content.sections = proj.content.sections.map((sec: BlogSection) => {
        const match = targets.find(t => t.sectionId === sec.id);
        if (match) {
          sec.imageId = match.afterImageId;
          const imageObj = availableImages.find((image: HubImage) => image.id === match.afterImageId);
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
          const imageObj = availableImages.find((image: HubImage) => image.id === replacement.afterImageId);
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
      // The authenticated client persists the returned project.
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
    if (req.query.fresh === '1') invalidateSharedPublicProjects();
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

  res.json({ items: list, warning: identityContext.getStore()?.archiveWarning || null });
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
// Private persistence is performed by the signed-in Firestore client.
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
  if (req.query.fresh === '1') invalidateSharedPublicProjects();
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
app.post('/api/agent/interpret', async (req: Request, res: Response) => {
  const user = getVerifiedUser(req);
  const project = req.body.project as BlogProject | undefined;
  if (project && (project.ownerId !== user.uid || project.siteId !== siteId)) return res.status(403).json({error:{message:'다른 계정의 원고를 사용할 수 없습니다.'}});
  const messages = Array.isArray(req.body.messages) ? req.body.messages.slice(-30) : [];
  const images = Array.isArray(req.body.images) ? req.body.images.slice(0,200) : [];
  if (!messages.length) return res.status(400).json({error:{message:'메시지가 필요합니다.'}});
  res.json(await interpretAgentRequest(messages, images, project || null));
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
  if (!image) return `${SITE_URL}/api/images/${encodeURIComponent(id)}/public`;
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
