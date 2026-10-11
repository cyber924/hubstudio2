import React, { useState, useEffect, useRef } from 'react';
import { 
  Compass, 
  PenTool, 
  Bot, 
  FolderHeart, 
  Sparkles, 
  RefreshCw, 
  ChevronRight, 
  Trash2, 
  UploadCloud, 
  CheckCircle, 
  AlertTriangle, 
  Plus, 
  Minus, 
  X, 
  Search, 
  Mic, 
  MicOff,
  Copy, 
  Download, 
  ArrowLeft,
  Loader2,
  Lock,
  Globe,
  Share2,
  Heart,
  User,
  LogOut,
  Mail,
  Key,
  Link
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// Import Firebase client auth and firestore SDK
import { auth as clientAuth, db as clientDb } from './lib/firebase';
import { collection, getDocs, query } from 'firebase/firestore';
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut as clientSignOut, 
  onAuthStateChanged 
} from 'firebase/auth';

// Typing interfaces synced with backend definitions
interface HubImage {
  id: string;
  sourceProject: string;
  title: string;
  tags: string[];
  visibility: 'public' | 'private';
  category?: string;
  thumbnailUrl: string;
  publicUrl?: string;
  updatedAt?: string;
  analysis?: {
    summary: string;
    subjects: string[];
    setting: string;
    readableText: string[];
    method: 'vision' | 'metadata';
    status: 'pending' | 'complete' | 'failed';
    sourceRevision: string;
  };
}

interface BlogSection {
  id: string;
  heading: string;
  body: string;
  imageId?: string;
  caption?: string;
  alt?: string;
}

interface BlogContent {
  title: string;
  description: string;
  intro: string;
  sections: BlogSection[];
  closing: string;
  faq: Array<{ question: string; answer: string }>;
  tags: string[];
}

interface ReviewIssue {
  id: string;
  sectionId?: string;
  kind: 'text' | 'image' | 'fact' | 'structure';
  reason: string;
  proposedAction: string;
  analysisMethod: 'vision' | 'metadata' | 'text';
}

interface ReviewReplacement {
  sectionId: string;
  beforeImageId?: string;
  afterImageId: string;
  matchQuality: 'exact' | 'approximate';
  method: 'vision' | 'metadata';
  reason: string;
}

interface ReviewResult {
  verdict: 'pass' | 'needs_changes' | 'hold';
  issues: ReviewIssue[];
  replacements: ReviewReplacement[];
  summary: string;
}

interface BlogProject {
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
}

interface AgentJob {
  id: string;
  siteId: string;
  ownerId: string;
  threadId: string;
  projectId?: string;
  requestId: string;
  action: string;
  status: 'queued' | 'running' | 'paused' | 'failed' | 'done' | 'cancelled';
  stage: 'plan' | 'generate' | 'review' | 'replace' | 'save' | 'publish' | 'verify' | 'report';
  autoPublish: boolean;
  result?: Record<string, any>;
  error?: { code: string; message: string; retryable: boolean };
}

interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  content: string;
  createdAt: string;
  jobId?: string;
  projectSnapshot?: BlogProject;
}

interface AgentThread {
  id: string;
  siteId: string;
  ownerId: string;
  title: string;
  createdAt: string;
}

type ViewType = 'magazine' | 'studio' | 'agent' | 'webzine' | 'projects' | 'blog-view';

export default function App() {
  // Navigation & Core States
  const [currentView, setCurrentView] = useState<ViewType>(window.location.pathname.startsWith('/blog/') ? 'blog-view' : ['/webzine', '/blog'].includes(window.location.pathname) ? 'webzine' : 'magazine');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [is404Error, setIs404Error] = useState(false);
  const [currentUser, setCurrentUser] = useState<{ uid: string; email: string | null; name: string } | null>(null);
  const [config, setConfig] = useState<{ configured: boolean; siteName: string; siteId: string } | null>(null);

  // New Webzine States
  const [publishedWebzineArticles, setPublishedWebzineArticles] = useState<BlogProject[]>((window as any).__PUBLIC_PROJECTS__ || []);
  const [webzineError, setWebzineError] = useState<string | null>(null);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [webzineLoading, setWebzineLoading] = useState(false);

  // Authentication Modal States
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [emailInput, setEmailInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  // Gallery view states
  const [images, setImages] = useState<HubImage[]>([]);
  const [selectedImages, setSelectedImages] = useState<HubImage[]>([]);
  const [activeImageDetail, setActiveImageDetail] = useState<HubImage | null>(null);
  const [projectToDelete, setProjectToDelete] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [publicArticles, setPublicArticles] = useState<any[]>(() => ((window as any).__PUBLIC_PROJECTS__ || []).map((project: any) => ({ ...project, id: project.publishedArticleId || project.id, projectId: project.id, publishedAt: project.publishedAt || project.updatedAt })));
  const [publicArticlesError, setPublicArticlesError] = useState<string | null>(null);
  const [homePage, setHomePage] = useState(1);
  const [studioPage, setStudioPage] = useState(1);

  // Studio states
  const [activeProject, setActiveProject] = useState<BlogProject | null>(null);
  const [studioLoading, setStudioLoading] = useState(false);
  const [isPlanRecommending, setIsPlanRecommending] = useState(false);
  const [editorialPlan, setEditorialPlan] = useState<any | null>(null);
  
  // Studio Inputs
  const [topicInput, setTopicInput] = useState('');
  const [keywordInput, setKeywordInput] = useState('');
  const [audienceInput, setAudienceInput] = useState('감성 라이프스타일 독자층');
  const [toneInput, setToneInput] = useState('차분하고 감성적인 에세이 어조');
  const [autoPublishInStudio, setAutoPublishInStudio] = useState(false);

  // Agent Co-Pilot states
  const [threadId, setThreadId] = useState('default_thread');
  const [threads, setThreads] = useState<AgentThread[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [agentInput, setAgentInput] = useState('');
  const [activeJob, setActiveJob] = useState<AgentJob | null>(null);
  const [voiceRecording, setVoiceRecording] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState('');

  // Reader mode state
  const [readingArticle, setReadingArticle] = useState<any | null>(() => { const project = (window as any).__PRE_RENDERED_PROJECT__; return project ? { ...project, id: project.publishedArticleId || project.id, projectId: project.id, publishedAt: project.publishedAt || project.updatedAt } : null; });

  // Projects list
  const [projectsList, setProjectsList] = useState<BlogProject[]>([]);

  // Advanced Google & Naver Search Optimization (SEO) & JSON-LD Injection
  useEffect(() => {
    if (activeProject) {
      const titleStr = `${activeProject.title} – Hub Studio 2`;
      const descStr = activeProject.content?.description || "Hub Studio 2에서 창작된 고품질 인공지능 매거진 아티클입니다.";
      
      // Update HTML metadata dynamically
      document.title = titleStr;
      
      let metaDesc = document.querySelector('meta[name="description"]');
      if (!metaDesc) {
        metaDesc = document.createElement('meta');
        metaDesc.setAttribute('name', 'description');
        document.head.appendChild(metaDesc);
      }
      metaDesc.setAttribute('content', descStr);

      let ogTitle = document.querySelector('meta[property="og:title"]');
      if (!ogTitle) {
        ogTitle = document.createElement('meta');
        ogTitle.setAttribute('property', 'og:title');
        document.head.appendChild(ogTitle);
      }
      ogTitle.setAttribute('content', titleStr);

      let ogDesc = document.querySelector('meta[property="og:description"]');
      if (!ogDesc) {
        ogDesc = document.createElement('meta');
        ogDesc.setAttribute('property', 'og:description');
        document.head.appendChild(ogDesc);
      }
      ogDesc.setAttribute('content', descStr);

      let ogUrl = document.querySelector('meta[property="og:url"]');
      if (!ogUrl) {
        ogUrl = document.createElement('meta');
        ogUrl.setAttribute('property', 'og:url');
        document.head.appendChild(ogUrl);
      }
      ogUrl.setAttribute('content', window.location.origin + window.location.pathname);

      // JSON-LD structured data block management
      let jsonLdScript = document.getElementById('hub-studio-jsonld');
      if (jsonLdScript) {
        jsonLdScript.remove();
      }
      
      let firstImgUrl = '';
      if (activeProject.content?.sections) {
        const firstSecWithImg = activeProject.content.sections.find(s => s.imageId);
        if (firstSecWithImg && firstSecWithImg.imageId) {
          const foundImg = getImgById(firstSecWithImg.imageId);
          if (foundImg) {
            firstImgUrl = foundImg.thumbnailUrl || foundImg.publicUrl || '';
          }
        }
      }

      const schemaData = {
        "@context": "https://schema.org",
        "@type": "Article",
        "headline": activeProject.title,
        "description": descStr,
        "image": firstImgUrl || "https://images.unsplash.com/photo-1542038784456-1ea8e935640e",
        "author": {
          "@type": "Person",
          "name": "Sungbae Park",
          "email": "sungbaep296@gmail.com"
        },
        "publisher": {
          "@type": "Organization",
          "name": "Hub Studio 2",
          "logo": {
            "@type": "ImageObject",
            "url": "https://images.unsplash.com/photo-1542038784456-1ea8e935640e"
          }
        },
        "datePublished": activeProject.createdAt,
        "dateModified": activeProject.updatedAt
      };

      const script = document.createElement('script');
      script.id = 'hub-studio-jsonld';
      script.type = 'application/ld+json';
      script.innerHTML = JSON.stringify(schemaData);
      document.head.appendChild(script);
    } else {
      document.title = "Hub Studio 2 – 감성 AI 매거진 에디토리얼 하우스";
    }
  }, [activeProject, images]);

  const getImgById = (id: string) => {
    if (!id) return null;
    let found = images.find(img => img.id === id);
    if (found) return found;

    if (id.startsWith('img_')) {
      const stripped = id.substring(4);
      found = images.find(img => img.id === stripped);
      if (found) return found;
    }

    const prepended = 'img_' + id;
    found = images.find(img => img.id === prepended);
    if (found) return found;

    return null;
  };
  
  // Toast notifications
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  // Auth Listener Setup
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(clientAuth, (user) => {
      if (user) {
        setCurrentUser({
          uid: user.uid,
          email: user.email,
          name: user.email ? user.email.split('@')[0] : '새로운 에디터'
        });
      } else {
        setCurrentUser(null);
      }
    });
    return () => unsubscribe();
  }, []);

  // Setup / Load initial data (triggered on mount or user changes)
  useEffect(() => {
    fetchConfig();
    loadImages();
    loadPublicArticles();
    loadProjects();
    loadThreads();
  }, [currentUser]);

  // Load published webzine articles list
  const loadPublishedWebzineArticles = async () => {
    setWebzineLoading(true);
    setWebzineError(null);
    try {
      const res = await checkedFetch('/api/projects?status=published');
      const data = await res.json();
      setPublishedWebzineArticles(data.items || []);
    } catch (e: any) {
      setWebzineError(e.message || '웹진을 불러오지 못했습니다.');
    } finally {
      setWebzineLoading(false);
    }
  };

  // Trigger webzine loader on view change
  useEffect(() => {
    if (currentView === 'webzine') {
      loadPublishedWebzineArticles();
    }
  }, [currentView]);

  // Handle URL deep link query parameters or direct blog paths on mount (Google & Naver SEO deep links)
  useEffect(() => {
    // 1. Check for server-side 404
    if ((window as any).__SEO_404__) {
      setIs404Error(true);
      return;
    }

    const pathname = window.location.pathname;
    const params = new URLSearchParams(window.location.search);
    const viewParam = params.get('view');
    const articleIdParam = params.get('articleId');

    if (['/webzine', '/blog'].includes(pathname)) {
      setCurrentView('webzine');
    } else if (pathname.startsWith('/blog/')) {
      const parts = pathname.split('/');
      const postId = parts[parts.length - 1];

      if ((window as any).__PRE_RENDERED_PROJECT__) {
        const proj = (window as any).__PRE_RENDERED_PROJECT__;
        const articleSnapshot = {
          id: proj.publishedArticleId || proj.id,
          siteId: proj.siteId,
          ownerId: proj.ownerId,
          projectId: proj.id,
          title: proj.content.title,
          description: proj.content.description,
          content: proj.content,
          createdAt: proj.createdAt,
          publishedAt: proj.updatedAt || proj.createdAt,
        };
        setReadingArticle(articleSnapshot);
        setCurrentView('blog-view');
      } else {
        setWebzineLoading(true);
        checkedFetch(`/api/blog/public/${postId}`)
          .then(res => res.ok ? res.json() : null)
          .then(proj => {
            if (proj && proj.content) {
              const articleSnapshot = {
                id: proj.publishedArticleId || proj.id,
                siteId: proj.siteId,
                ownerId: proj.ownerId,
                projectId: proj.id,
                title: proj.content.title,
                description: proj.content.description,
                content: proj.content,
                createdAt: proj.createdAt,
                publishedAt: proj.updatedAt || proj.createdAt,
              };
              setReadingArticle(articleSnapshot);
              setCurrentView('blog-view');
            } else {
              setIs404Error(true);
            }
          })
          .catch(() => {
            setIs404Error(true);
          })
          .finally(() => {
            setWebzineLoading(false);
          });
      }
    } else if (viewParam === 'webzine' && articleIdParam) {
      setWebzineLoading(true);
      checkedFetch(`/api/blog/public/${articleIdParam}`)
        .then(res => res.ok ? res.json() : null)
        .then(proj => {
          if (proj) {
            const articleSnapshot = {
              id: proj.publishedArticleId || proj.id,
              siteId: proj.siteId,
              ownerId: proj.ownerId,
              projectId: proj.id,
              title: proj.content.title,
              description: proj.content.description,
              content: proj.content,
              createdAt: proj.createdAt,
              publishedAt: proj.updatedAt || proj.createdAt,
            };
            setReadingArticle(articleSnapshot);
            setCurrentView('blog-view');
          } else {
            setCurrentView('webzine');
          }
        })
        .finally(() => {
          setWebzineLoading(false);
        });
    } else if (viewParam) {
      setCurrentView(viewParam as ViewType);
    }
  }, []);

  // Synchronize document head metadata and browser URL pathname dynamically (for Google / Naver SEO)
  useEffect(() => {
    if (currentView === 'blog-view' && readingArticle) {
      const artId = readingArticle.id || readingArticle.projectId;
      const targetPath = `/blog/${encodeURIComponent(artId)}`;
      if (window.location.pathname !== targetPath) {
        window.history.pushState({}, '', targetPath);
      }

      const pTitle = readingArticle.content.title || readingArticle.title || '감성 매거진 아티클';
      document.title = `${pTitle} | Hub Studio 2`;
      const descEl = document.querySelector('meta[name="description"]');
      if (descEl) descEl.setAttribute('content', readingArticle.content.description || '');

      // In client context, let's also make sure canonical tags dynamically updated
      let canonicalEl = document.querySelector('link[rel="canonical"]');
      if (!canonicalEl) {
        canonicalEl = document.createElement('link');
        canonicalEl.setAttribute('rel', 'canonical');
        document.head.appendChild(canonicalEl);
      }
      canonicalEl.setAttribute('href', window.location.origin + targetPath);
    } else if (currentView === 'webzine') {
      window.history.replaceState({}, '', '/webzine');
      document.querySelector('link[rel="canonical"]')?.setAttribute('href', window.location.origin + '/webzine');
      if (window.location.pathname.startsWith('/blog/')) {
        window.history.pushState({}, '', '/webzine');
      }
      document.title = "공식 웹진 아카이브 - Hub Studio 2";
      const descEl = document.querySelector('meta[name="description"]');
      if (descEl) descEl.setAttribute('content', "심사를 거쳐 최고 랭킹 점수를 획득하고 공식 발간된 슬로우 라이프스타일 저널 목록입니다.");
    } else if (currentView !== 'blog-view') {
      window.history.replaceState({}, '', currentView === 'magazine' ? '/' : `/?view=${currentView}`);
      document.querySelector('link[rel="canonical"]')?.setAttribute('href', window.location.origin + '/');
      document.title = "Hub Studio 2 (허브스튜디오2) - 감성 라이프스타일 비주얼 매거진";
      const descEl = document.querySelector('meta[name="description"]');
      if (descEl) descEl.setAttribute('content', "공통 이미지 자산을 감성적 가치로 큐레이션하여 깊이 있는 여행·생활 콘텐츠를 발행하는 라이프스타일 비주얼 매거진 서비스입니다.");
    }
  }, [currentView, readingArticle]);

  // Poll job status if a job is active
  useEffect(() => {
    let intervalId: any;
    if (activeJob && (activeJob.status === 'queued' || activeJob.status === 'running')) {
      intervalId = setInterval(async () => {
        try {
          const res = await fetchWithAuth(`/api/agent/jobs/${activeJob.id}`);
          const jobData = await res.json();
          setActiveJob(jobData);
          if (jobData.status === 'done' || jobData.status === 'failed' || jobData.status === 'cancelled') {
            clearInterval(intervalId);
            // Refresh thread messages
            loadThreadMessages(threadId);
            // Refresh projects and articles
            loadProjects();
            loadPublicArticles();
            if (jobData.projectId) {
              fetchAndLoadProject(jobData.projectId);
            }
            showToast(jobData.status === 'done' ? '에이전트가 작업을 무사히 마쳤습니다!' : '작업 중 에러가 발생했습니다.', jobData.status === 'done' ? 'success' : 'error');
          }
        } catch (err) {
          console.error(err);
        }
      }, 2000);
    }
    return () => clearInterval(intervalId);
  }, [activeJob]);

  const checkedFetch = async (url: string, options: RequestInit = {}) => {
    const response = await fetch(url, options);
    if (!response.headers.get('content-type')?.includes('application/json')) {
      throw new Error('서버 API 연결이 올바르지 않습니다. 잠시 후 다시 시도하세요.');
    }
    if (!response.ok) {
      const data = await response.clone().json();
      throw new Error(data.error?.message || `요청 실패 (${response.status})`);
    }
    return response;
  };

  const fetchWithAuth = async (url: string, options: RequestInit = {}) => {
    const user = clientAuth.currentUser;
    if (!user) throw new Error('로그인이 필요합니다.');
    const headers = new Headers(options.headers || {});
    headers.set('Authorization', `Bearer ${await user.getIdToken()}`);
    return checkedFetch(url, { ...options, headers });
  };

  // Loading functions
  const fetchConfig = async () => {
    try {
      const res = await fetch('/api/config-status');
      const data = await res.json();
      setConfig(data);
    } catch (e) {
      console.error(e);
    }
  };

  const loadImages = async () => {
    try {
      console.log('Fetching live images from Firestore collection "images"...');
      const q = query(collection(clientDb, 'images'));
      const querySnapshot = await getDocs(q);
      const list: any[] = [];
      
      querySnapshot.forEach((docSnap) => {
        const data = docSnap.data();
        if (data) {
          // Map firestore document data to HubImage structure
          const id = data.id || docSnap.id;
          const dataUrl = data.dataUrl || data.thumbnailUrl || data.publicUrl || "/images/travel_jeju_coast.jpg";
          
          let category = data.category;
          if (!category) {
            const titleAndTags = ((data.title || '') + ' ' + (data.tags || []).join(' ')).toLowerCase();
            if (titleAndTags.includes('풍경') || titleAndTags.includes('바다') || titleAndTags.includes('산') || titleAndTags.includes('하늘') || titleAndTags.includes('nature') || titleAndTags.includes('여행')) {
              category = 'nature';
            } else {
              category = 'lifestyle';
            }
          }

          list.push({
            id,
            sourceProject: data.sourceProject || 'hub_common',
            title: data.title || "Untitled Image",
            tags: data.tags || [],
            visibility: data.visibility || "public",
            ownerId: data.ownerId,
            category: category,
            width: data.width || 800,
            height: data.height || 600,
            mimeType: data.mimeType || 'image/webp',
            thumbnailUrl: dataUrl,
            publicUrl: dataUrl,
            updatedAt: data.updatedAt || data.createdAt || new Date().toISOString(),
            analysis: data.analysis || {
              summary: data.title || "Untitled Image",
              subjects: data.tags || [],
              setting: data.title || "Untitled Image",
              readableText: [],
              method: 'metadata',
              status: 'complete',
              sourceRevision: 'v1'
            }
          });
        }
      });
      
      console.log(`Successfully fetched ${list.length} live images from Firestore!`);

      // Fallback to Express API if Firestore is empty or fails
      if (list.length === 0) {
        const res = await fetch('/api/images?limit=150');
        const data = await res.json();
        list.push(...(data.items || []));
      }

      // Client-side deduplication based on ID!
      const uniqueList: any[] = [];
      const seen = new Set();
      for (const img of list) {
        if (img && img.id && !seen.has(img.id)) {
          seen.add(img.id);
          uniqueList.push(img);
        }
      }

      // Sort images by actual creation date/updatedAt in descending order (latest first!)
      uniqueList.sort((a: any, b: any) => {
        const dateA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
        const dateB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
        return dateB - dateA;
      });

      setImages(uniqueList);
    } catch (e) {
      console.error('Failed to load live images from Firestore, falling back to API:', e);
      try {
        const res = await fetch('/api/images?limit=150');
        const data = await res.json();
        const list = data.items || [];
        
        const uniqueList: any[] = [];
        const seen = new Set();
        for (const img of list) {
          if (img && img.id && !seen.has(img.id)) {
            seen.add(img.id);
            uniqueList.push(img);
          }
        }
        uniqueList.sort((a: any, b: any) => {
          const dateA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
          const dateB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
          return dateB - dateA;
        });
        setImages(uniqueList);
      } catch (err) {
        console.error('API fallback failed as well:', err);
      }
    }
  };

  const loadPublicArticles = async () => {
    setPublicArticlesError(null);
    try {
      const res = await checkedFetch('/api/blog/public');
      const data = await res.json();
      setPublicArticles(data.items || []);
    } catch (error: any) {
      setPublicArticlesError(error.message || '공개 글 조회에 실패했습니다.');
    }
  };

  const loadProjects = async () => {
    setProjectsError(null);
    if (!clientAuth.currentUser) { setProjectsList([]); setProjectsLoading(false); return; }
    setProjectsLoading(true);
    const uid = clientAuth.currentUser.uid;
    try {
      const res = await fetchWithAuth('/api/projects');
      const data = await res.json();
      if (clientAuth.currentUser?.uid === uid) setProjectsList(data.items || []);
    } catch (error: any) {
      if (clientAuth.currentUser?.uid === uid) setProjectsError(error.message || '보관함 조회에 실패했습니다.');
    } finally { setProjectsLoading(false); }
  };

  const loadThreads = async () => {
    if (!clientAuth.currentUser) { setThreads([]); return; }
    try {
      const res = await fetchWithAuth('/api/agent/threads');
      const data = await res.json();
      setThreads(data.items || []);
      if (data.items && data.items.length > 0) {
        setThreadId(data.items[0].id);
        loadThreadMessages(data.items[0].id);
      } else {
        loadThreadMessages('default_thread');
      }
    } catch (e) {
      console.error(e);
    }
  };

  const loadThreadMessages = async (tId: string) => {
    try {
      const res = await fetchWithAuth(`/api/agent/threads/${tId}`);
      const data = await res.json();
      setMessages(data.items || []);
    } catch (e) {
      console.error(e);
    }
  };

  const fetchAndLoadProject = async (projId: string) => {
    try {
      const res = await fetchWithAuth(`/api/projects/${projId}`);
      if (res.ok) {
        const data = await res.json();
        setActiveProject(data);
        // Fill settings
        setTopicInput(data.title);
        setKeywordInput(data.keyword);
        setAudienceInput(data.audience);
        setToneInput(data.tone);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Handle image selection
  const toggleImageSelection = (img: HubImage) => {
    const exists = selectedImages.some(i => i.id === img.id);
    if (exists) {
      setSelectedImages(selectedImages.filter(i => i.id !== img.id));
    } else {
      if (selectedImages.length >= 5) {
        showToast('사진은 최대 5장까지 선택 가능합니다.', 'info');
        return;
      }
      setSelectedImages([...selectedImages, img]);
    }
  };

  // Auth Operations
  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailInput || !passwordInput) {
      showToast('이메일과 비밀번호를 모두 입력해 주세요.', 'info');
      return;
    }
    setAuthLoading(true);
    try {
      if (authMode === 'login') {
        await signInWithEmailAndPassword(clientAuth, emailInput, passwordInput);
        showToast('성공적으로 로그인되었습니다!');
      } else {
        await createUserWithEmailAndPassword(clientAuth, emailInput, passwordInput);
        showToast('성공적으로 회원가입이 완료되었습니다!');
      }
      setAuthModalOpen(false);
      setEmailInput('');
      setPasswordInput('');
    } catch (err: any) {
      console.error(err);
      let errMsg = '인증에 실패했습니다. 다시 확인해 주세요.';
      if (err.code === 'auth/email-already-in-use') errMsg = '이미 가입된 이메일 주소입니다.';
      if (err.code === 'auth/weak-password') errMsg = '비밀번호는 최소 6자리 이상이어야 합니다.';
      if (err.code === 'auth/invalid-credential') errMsg = '이메일 또는 비밀번호가 올바르지 않습니다.';
      showToast(errMsg, 'error');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    if (!confirm('정말로 로그아웃 하시겠습니까?')) return;
    try {
      await clientSignOut(clientAuth);
      setActiveProject(null);
      setProjectsList([]);
      setMessages([]);
      showToast('성공적으로 로그아웃되었습니다.');
    } catch (err) {
      showToast('로그아웃 도중 오류 발생', 'error');
    }
  };

  // RECOMMEND EDITORIAL PLAN
  const handleRecommendPlan = async () => {
    if (selectedImages.length < 2 || selectedImages.length > 5) {
      showToast('에디터 기획 제안을 위해 2장 이상, 5장 이하의 사진을 보관 드로어에 담아주세요!', 'info');
      return;
    }
    if (!topicInput) {
      showToast('주제나 핵심 소재를 입력해 주세요.', 'info');
      return;
    }
    setIsPlanRecommending(true);
    setEditorialPlan(null);
    try {
      const res = await fetchWithAuth('/api/editorial-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: topicInput,
          imageIds: selectedImages.map(i => i.id)
        })
      });
      if (res.ok) {
        const plan = await res.json();
        setEditorialPlan(plan);
        setKeywordInput(plan.keyword || '');
        setToneInput(plan.tone || '');
        setAudienceInput(plan.audience || '');
        showToast('감성 기획 제안이 수립되었습니다. 내용을 조율해보세요!');
      } else {
        showToast('기획안 추천 생성에 실패했습니다.', 'error');
      }
    } catch (err) {
      showToast('네트워크 오류가 발생했습니다.', 'error');
    } finally {
      setIsPlanRecommending(false);
    }
  };

  // GENERATE BLOG FROM STUDIO
  const handleGenerateBlog = async () => {
    let activeImages = [...selectedImages];
    
    // Auto-select relevant images if user hasn't selected 2-5 images
    if (activeImages.length < 2) {
      const availablePool = images.length > 0 ? images : [];
      if (availablePool.length > 0) {
        // Find matching images based on keyword and topic
        const searchTerms = ((keywordInput || '') + ' ' + (topicInput || '')).toLowerCase();
        let matched = availablePool.filter(img => 
          img.tags.some(tag => searchTerms.includes(tag.toLowerCase())) ||
          img.title.toLowerCase().includes((keywordInput || '').toLowerCase())
        );
        
        if (matched.length < 2) {
          // Fallback to the first 3 images
          matched = availablePool.slice(0, 3);
        } else {
          matched = matched.slice(0, Math.min(3, matched.length));
        }
        
        activeImages = matched;
        setSelectedImages(matched);
        showToast(`선택된 사진이 부족하여 주제와 어울리는 사진 ${matched.length}장을 자동 선정하여 매칭했습니다!`, 'success');
      } else {
        showToast('사용 가능한 이미지 자산이 로드되지 않았습니다. 잠시 후 다시 시도해 주세요.', 'error');
        return;
      }
    } else if (activeImages.length > 5) {
      activeImages = activeImages.slice(0, 5);
      setSelectedImages(activeImages);
      showToast('선택한 사진이 5장을 초과하여 상위 5장으로 자동 매칭하여 집필을 진행합니다.', 'info');
    }

    if (!currentUser) {
      showToast('게스트 모드로 원고 생성을 진행합니다. 영구 저장을 원하시면 로그인을 완료해 주세요!', 'info');
    }

    if (!topicInput) {
      showToast('블로그 주제 또는 기획 방향을 지정해 주세요.', 'info');
      return;
    }

    setStudioLoading(true);
    try {
      const res = await fetchWithAuth('/api/blog/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: topicInput,
          tone: toneInput,
          audience: audienceInput,
          keyword: keywordInput,
          imageIds: activeImages.map(i => i.id),
          images: activeImages.map(img => ({
            id: img.id,
            title: img.title,
            tags: img.tags,
            category: img.category,
            analysis: img.analysis
          })) // Pass lightweight image objects omitting heavy base64 strings
        })
      });
      if (res.ok) {
        const project = await res.json();
        setActiveProject(project);
        loadProjects();
        showToast('아름다운 첫 에디토리얼 글 초안이 생성되었습니다! 아래에서 감상·수정하세요.');
      } else {
        showToast('글 원고 생성에 실패했습니다.', 'error');
      }
    } catch (err) {
      showToast('네트워크 통신 중 에러 발생', 'error');
    } finally {
      setStudioLoading(false);
    }
  };

  // SAVE PROJECT DRAFT MANUALLY
  const handleSaveProjectDraft = async () => {
    if (!activeProject) return;
    setStudioLoading(true);
    try {
      const res = await fetchWithAuth(`/api/projects/${activeProject.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: activeProject.content,
          expectedRevision: activeProject.revision
        })
      });
      if (res.ok) {
        const updated = await res.json();
        setActiveProject(updated);
        loadProjects();
        showToast('수정된 원고 초안이 안전하게 저장되었습니다!');
      } else if (res.status === 409) {
        showToast('다른 창에서 수정된 내역이 있습니다. 새로고침 후 진행해 주세요.', 'error');
      } else {
        showToast('초안 저장을 완료하지 못했습니다.', 'error');
      }
    } catch (err) {
      showToast('네트워크 오류 발생', 'error');
    } finally {
      setStudioLoading(false);
    }
  };

  // REVIEW BLOG ON STUDIO
  const handleReviewBlog = async () => {
    if (!activeProject) return;
    setStudioLoading(true);
    try {
      const res = await fetchWithAuth('/api/blog/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: activeProject.id,
          revision: activeProject.revision
        })
      });
      if (res.ok) {
        const reviewResult = await res.json();
        setActiveProject({ ...activeProject, review: reviewResult });
        showToast('시각-본문 매치 정합성 검수가 완수되었습니다. 결과를 확인해 보세요.');
      } else {
        showToast('검수 분석 처리 오류', 'error');
      }
    } catch (err) {
      showToast('네트워크 에러 발생', 'error');
    } finally {
      setStudioLoading(false);
    }
  };

  // AUTO IMAGE REPLACEMENT USING CALCULATED REVIEWS
  const handleApplyAutoReplacements = async () => {
    if (!activeProject) return;
    setStudioLoading(true);
    try {
      const res = await fetchWithAuth('/api/blog/replace-images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: activeProject.id,
          revision: activeProject.revision
        })
      });
      if (res.ok) {
        const result = await res.json();
        setActiveProject(result.project);
        showToast(`정합성이 높은 사진 ${result.replacedCount}장으로 매끄럽게 교체되었습니다!`);
      } else {
        showToast('이미지 자동 최적화 교체에 실패했습니다.', 'error');
      }
    } catch (err) {
      showToast('네트워크 통신 에러', 'error');
    } finally {
      setStudioLoading(false);
    }
  };

  // PUBLISH BLOG FROM STUDIO
  const handlePublishBlog = async () => {
    if (!activeProject) return;
    setStudioLoading(true);
    try {
      const res = await fetchWithAuth(`/api/projects/${activeProject.id}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expectedRevision: activeProject.revision
        })
      });
      if (res.ok) {
        const result = await res.json();
        setActiveProject(result.project);
        loadPublicArticles();
        loadProjects();
        showToast('축하합니다! 비주얼 매거진에 에세이가 공식 발행되었습니다.');
        // Switch to blog reading
        openArticleToRead(result.articleId);
      } else {
        showToast('공개 발행 과정에서 오류 발생', 'error');
      }
    } catch (err) {
      showToast('발행 처리 네트워크 실패', 'error');
    } finally {
      setStudioLoading(false);
    }
  };

  // DELETE PROJECT
  const handleDeleteProject = async (pId: string) => {
    try {
      const res = await fetchWithAuth(`/api/projects/${pId}`, { method: 'DELETE' });
      if (res.ok) {
        loadProjects();
        loadPublicArticles();
        loadPublishedWebzineArticles();
        if (activeProject?.id === pId) {
          setActiveProject(null);
        }
        showToast('프로젝트가 깔끔히 정리되었습니다.');
      } else {
        showToast('프로젝트 삭제 실패', 'error');
      }
    } catch (e) {
      showToast('네트워크 오류', 'error');
    }
  };

  // SEND MESSAGE TO AGENT COPILOT
  const handleSendMessage = async (textToSend?: string) => {
    if (!currentUser) {
      showToast('에이전트 동반자와 프로젝트 대화를 시작하기 위해 우측 상단에서 먼저 로그인해 주세요!', 'info');
      setAuthMode('login');
      setAuthModalOpen(true);
      return;
    }
    const rawMsg = textToSend || agentInput;
    if (!rawMsg.trim()) return;

    const reqId = 'req_' + Date.now();
    setAgentInput('');
    setVoiceTranscript('');

    const newJob: AgentJob = {
      id: 'job_pending',
      siteId: config?.siteId || 'hub2',
      ownerId: currentUser.uid,
      threadId,
      projectId: activeProject?.id,
      requestId: reqId,
      action: 'create',
      status: 'queued',
      stage: 'plan',
      autoPublish: autoPublishInStudio,
    };

    setActiveJob(newJob);

    // Append user message immediately to the screen locally
    const localUserMsg: ChatMessage = {
      id: 'local_usr_' + reqId,
      role: 'user',
      content: rawMsg,
      createdAt: new Date().toISOString()
    };
    setMessages(prev => [...prev, localUserMsg]);

    try {
      const res = await fetchWithAuth('/api/agent/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: reqId,
          message: rawMsg,
          threadId,
          projectId: activeProject?.id,
          autoPublish: autoPublishInStudio
        })
      });
      if (res.ok) {
        const job = await res.json();
        setActiveJob(job);
      } else {
        showToast('에이전트 태스크 대기열 등록 실패', 'error');
        setActiveJob(null);
      }
    } catch (e) {
      showToast('네트워크 통신 오류', 'error');
      setActiveJob(null);
    }
  };

  // VOICE COMMAND RECOGNITION (HTML5 Web Speech API integration)
  const handleToggleVoice = () => {
    if (voiceRecording) {
      setVoiceRecording(false);
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      showToast('이 브라우저는 음성 인식을 지원하지 않습니다. Chrome을 추천합니다.', 'info');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'ko-KR';
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setVoiceRecording(true);
      setVoiceTranscript('듣고 있습니다... 말씀해 주세요.');
    };

    recognition.onresult = (e: any) => {
      const resultText = e.results[0][0].transcript;
      setVoiceTranscript(resultText);
    };

    recognition.onerror = (err: any) => {
      console.error(err);
      setVoiceRecording(false);
      showToast('음성 인식 오류가 발생했습니다. 권한을 허용해 주세요.', 'error');
    };

    recognition.onend = () => {
      setVoiceRecording(false);
    };

    recognition.start();
  };

  const openArticleToRead = async (artId: string) => {
    try {
      const res = await fetch(`/api/blog/public/${artId}`);
      if (res.ok) {
        const article = await res.json();
        setReadingArticle(article);
        setCurrentView('blog-view');
      }
    } catch (e) {
      showToast('발행글 읽기 실패', 'error');
    }
  };

  // EXPORTS
  const handleCopyRawText = () => {
    if (!readingArticle) return;
    const content = readingArticle.content as BlogContent;
    const plainText = `${content.title}

${content.intro}

${content.sections.map(s => `[${s.heading}]\n${s.body}`).join('\n\n')}

${content.closing}

${content.faq.map(f => `Q: ${f.question}\nA: ${f.answer}`).join('\n')}`;

    navigator.clipboard.writeText(plainText);
    showToast('본문 일반 텍스트가 클립보드에 전체 복사되었습니다!');
  };

  const handleCopyHtml = () => {
    if (!readingArticle) return;
    const content = readingArticle.content as BlogContent;
    const htmlText = `<article>
  <h1>${content.title}</h1>
  <p class="intro">${content.intro}</p>
  ${content.sections.map(s => `
  <section>
    <h2>${s.heading}</h2>
    ${s.imageId ? `<img src="${window.location.origin}/api/images/${s.imageId}/public" alt="${s.alt || ''}">` : ''}
    <p>${s.body}</p>
  </section>`).join('')}
  <div class="closing">${content.closing}</div>
</article>`;

    navigator.clipboard.writeText(htmlText);
    showToast('공개 사진 주소가 내장된 HTML 소스가 클립보드에 복사되었습니다!');
  };

  return (
    <div className="min-h-screen flex flex-col font-sans selection:bg-amber-100 selection:text-amber-900 bg-[#FAF9F6] text-neutral-800 pb-16 lg:pb-0">
      
      {/* Dynamic Toast Alerts */}
      <AnimatePresence>
        {toast && (
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className={`fixed top-4 right-4 z-50 px-5 py-3 rounded-xl shadow-lg flex items-center gap-3 border ${
              toast.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' :
              toast.type === 'error' ? 'bg-rose-50 border-rose-200 text-rose-800' :
              'bg-amber-50 border-amber-200 text-amber-800'
            }`}
          >
            {toast.type === 'success' ? <CheckCircle className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
            <span className="text-sm font-medium">{toast.message}</span>
            <button onClick={() => setToast(null)} className="text-neutral-400 hover:text-neutral-700">
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Custom Delete Confirmation Modal */}
      <AnimatePresence>
        {projectToDelete && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          >
            <motion.div 
              initial={{ scale: 0.95, y: 15 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 15 }}
              className="bg-white max-w-sm w-full rounded-2xl p-6 border border-neutral-200 shadow-2xl relative text-left"
            >
              <h3 className="text-lg font-serif font-bold text-neutral-900 mb-2">프로젝트 삭제 확인</h3>
              <p className="text-neutral-500 text-xs leading-relaxed mb-6">
                정말로 이 에디토리얼 프로젝트를 삭제하시겠습니까? 관련된 웹진 공식 발행글과 편집 히스토리 파일이 영구히 정리되며 복구할 수 없습니다.
              </p>
              <div className="flex gap-2 justify-end">
                <button 
                  onClick={() => setProjectToDelete(null)}
                  className="px-4 py-2 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 text-xs font-semibold rounded-lg transition-colors"
                >
                  취소
                </button>
                <button 
                  onClick={() => {
                    handleDeleteProject(projectToDelete);
                    setProjectToDelete(null);
                  }}
                  className="px-4 py-2 bg-[#B23B1E] hover:bg-[#B23B1E]/90 text-white text-xs font-semibold rounded-lg transition-colors"
                >
                  프로젝트 삭제
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Auth Login/Signup Modal */}
      <AnimatePresence>
        {authModalOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          >
            <motion.div 
              initial={{ scale: 0.95, y: 15 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 15 }}
              className="bg-white max-w-md w-full rounded-2xl p-8 border border-neutral-200 shadow-2xl relative text-left"
            >
              <button 
                onClick={() => setAuthModalOpen(false)}
                className="absolute top-4 right-4 text-neutral-400 hover:text-neutral-700"
              >
                <X className="w-5 h-5" />
              </button>

              <h2 className="text-2xl font-serif font-extrabold text-neutral-900 tracking-tight mb-2">
                {authMode === 'login' ? '에디터 로그인' : '에디터 계정 생성'}
              </h2>
              <p className="text-neutral-400 text-xs mb-6">
                {authMode === 'login' ? '가입하신 정보로 로그인하고 매거진 프로젝트를 도킹해 보세요.' : '새로운 메인 필진으로 가입하고 슬로우 에세이 원고 작업을 시작해 보세요.'}
              </p>

              {/* Mode Toggle Tabs */}
              <div className="flex border-b border-neutral-100 mb-6">
                <button 
                  onClick={() => setAuthMode('login')}
                  className={`flex-1 pb-3 text-xs font-semibold text-center border-b-2 transition-all ${authMode === 'login' ? 'border-[#B23B1E] text-[#B23B1E]' : 'border-transparent text-neutral-400 hover:text-neutral-800'}`}
                >
                  기존 계정 로그인
                </button>
                <button 
                  onClick={() => setAuthMode('signup')}
                  className={`flex-1 pb-3 text-xs font-semibold text-center border-b-2 transition-all ${authMode === 'signup' ? 'border-[#B23B1E] text-[#B23B1E]' : 'border-transparent text-neutral-400 hover:text-neutral-800'}`}
                >
                  신규 회원 가입
                </button>
              </div>

              {/* Credentials form */}
              <form onSubmit={handleAuthSubmit} className="space-y-4">
                <div>
                  <label className="block text-[10px] font-bold text-neutral-500 uppercase tracking-widest mb-1">이메일 주소</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-3 w-4 h-4 text-neutral-400" />
                    <input 
                      type="email"
                      required
                      value={emailInput}
                      onChange={(e) => setEmailInput(e.target.value)}
                      placeholder="editor@hubmagazine.com"
                      className="w-full text-xs p-3 pl-10 bg-neutral-50 border border-neutral-200 rounded-xl focus:outline-none focus:border-[#B23B1E]"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-neutral-500 uppercase tracking-widest mb-1">비밀번호</label>
                  <div className="relative">
                    <Key className="absolute left-3 top-3 w-4 h-4 text-neutral-400" />
                    <input 
                      type="password"
                      required
                      value={passwordInput}
                      onChange={(e) => setPasswordInput(e.target.value)}
                      placeholder="••••••"
                      className="w-full text-xs p-3 pl-10 bg-neutral-50 border border-neutral-200 rounded-xl focus:outline-none focus:border-[#B23B1E]"
                    />
                  </div>
                </div>

                <button 
                  type="submit"
                  disabled={authLoading}
                  className="w-full py-3.5 bg-neutral-900 hover:bg-[#B23B1E] text-white text-xs font-semibold rounded-xl transition-all flex items-center justify-center gap-2 mt-6"
                >
                  {authLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  {authMode === 'login' ? '로그인 완료' : '회원가입 및 시작하기'}
                </button>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 1-Row, 3-Zone Top Navigation Contract */}
      <header className="sticky top-0 z-40 bg-[#FAF9F6]/90 backdrop-blur-md border-b border-neutral-200/60 py-4 px-6 md:px-12 flex items-center justify-between">
        {/* Zone 1: Brand Wordmark Element */}
        <div className="flex items-center gap-2">
          <button 
            onClick={() => setCurrentView('magazine')} 
            className="text-2xl font-serif tracking-tight font-extrabold text-neutral-900 hover:opacity-80 transition-opacity"
          >
            Hub Studio <span className="text-[#B23B1E]">2</span>
          </button>
        </div>

        {/* Zone 2: Navigation link group */}
        <nav className="hidden lg:flex items-center gap-8 text-sm font-medium text-neutral-600">
          <button 
            onClick={() => setCurrentView('magazine')} 
            className={`hover:text-neutral-900 transition-colors py-1 ${currentView === 'magazine' ? 'text-[#B23B1E] border-b border-[#B23B1E]' : ''}`}
          >
            매거진 피드
          </button>
          <button 
            onClick={() => setCurrentView('studio')} 
            className={`hover:text-neutral-900 transition-colors py-1 ${currentView === 'studio' ? 'text-[#B23B1E] border-b border-[#B23B1E]' : ''}`}
          >
            제작 작업실
          </button>
          <button 
            onClick={() => setCurrentView('agent')} 
            className={`hover:text-neutral-900 transition-colors py-1 ${currentView === 'agent' ? 'text-[#B23B1E] border-b border-[#B23B1E]' : ''}`}
          >
            에이전트 코파일럿
          </button>
          <button 
            onClick={() => setCurrentView('webzine')} 
            className={`hover:text-neutral-900 transition-colors py-1 ${currentView === 'webzine' ? 'text-[#B23B1E] border-b border-[#B23B1E]' : ''}`}
          >
            웹진
          </button>
          <button 
            onClick={() => setCurrentView('projects')} 
            className={`hover:text-neutral-900 transition-colors py-1 ${currentView === 'projects' ? 'text-[#B23B1E] border-b border-[#B23B1E]' : ''}`}
          >
            내 보관함
          </button>
        </nav>

        {/* Zone 3: Functional CTAs */}
        <div className="flex items-center gap-3">
          {currentUser ? (
            <div className="flex items-center gap-3">
              <span className="hidden sm:inline-flex items-center gap-1.5 text-xs font-mono text-neutral-600">
                <User className="w-3.5 h-3.5 text-neutral-400" />
                {currentUser.name} 에디터
              </span>
              <button 
                onClick={handleLogout}
                className="p-2 text-neutral-400 hover:text-[#B23B1E] hover:bg-neutral-100 rounded-lg transition-colors"
                title="로그아웃"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button 
                onClick={() => {
                  setAuthMode('login');
                  setAuthModalOpen(true);
                }}
                className="px-4 py-2 text-xs font-semibold text-neutral-600 hover:text-neutral-900 transition-colors"
              >
                로그인
              </button>
              <button 
                onClick={() => {
                  setAuthMode('signup');
                  setAuthModalOpen(true);
                }}
                className="px-4 py-2 text-xs font-semibold bg-neutral-900 text-white rounded-lg hover:bg-[#B23B1E] transition-colors"
              >
                회원가입
              </button>
            </div>
          )}

          {/* Mobile Hamburger Menu Button */}
          <button
            onClick={() => setMobileMenuOpen(true)}
            className="lg:hidden p-2 text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100 rounded-lg transition-colors"
            style={{ minHeight: '44px', minWidth: '44px' }}
            title="메뉴 열기"
          >
            <svg className="w-5.5 h-5.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        </div>
      </header>

      {/* Mobile Slide-In Navigation Drawer Overlay */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <>
            {/* Backdrop */}
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileMenuOpen(false)}
              className="lg:hidden fixed inset-0 z-50 bg-neutral-900/40 backdrop-blur-sm"
            />
            {/* Slide-In Menu panel */}
            <motion.div 
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="lg:hidden fixed right-0 top-0 bottom-0 w-80 z-50 bg-[#FAF9F6] shadow-2xl p-6 flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between border-b border-neutral-100 pb-4 mb-6">
                  <span className="font-serif font-bold text-xl text-neutral-900">Hub Studio <span className="text-[#B23B1E]">2</span></span>
                  <button 
                    onClick={() => setMobileMenuOpen(false)}
                    className="p-2 text-neutral-400 hover:text-neutral-900 hover:bg-neutral-100 rounded-lg"
                    style={{ minHeight: '44px', minWidth: '44px' }}
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <nav className="flex flex-col gap-3">
                  <button 
                    onClick={() => { setCurrentView('magazine'); setMobileMenuOpen(false); }}
                    className={`flex items-center gap-3.5 text-left py-3.5 px-4 rounded-xl transition-all font-medium text-sm ${currentView === 'magazine' ? 'bg-neutral-900 text-white shadow-sm' : 'text-neutral-600 hover:bg-neutral-100'}`}
                    style={{ minHeight: '48px' }}
                  >
                    <Compass className="w-4 h-4" />
                    매거진 피드
                  </button>
                  <button 
                    onClick={() => { setCurrentView('studio'); setMobileMenuOpen(false); }}
                    className={`flex items-center gap-3.5 text-left py-3.5 px-4 rounded-xl transition-all font-medium text-sm ${currentView === 'studio' ? 'bg-neutral-900 text-white shadow-sm' : 'text-neutral-600 hover:bg-neutral-100'}`}
                    style={{ minHeight: '48px' }}
                  >
                    <PenTool className="w-4 h-4" />
                    제작 작업실
                  </button>
                  <button 
                    onClick={() => { setCurrentView('agent'); setMobileMenuOpen(false); }}
                    className={`flex items-center gap-3.5 text-left py-3.5 px-4 rounded-xl transition-all font-medium text-sm ${currentView === 'agent' ? 'bg-neutral-900 text-white shadow-sm' : 'text-neutral-600 hover:bg-neutral-100'}`}
                    style={{ minHeight: '48px' }}
                  >
                    <Bot className="w-4 h-4" />
                    에이전트 코파일럿
                  </button>
                  <button 
                    onClick={() => { setCurrentView('webzine'); setMobileMenuOpen(false); }}
                    className={`flex items-center gap-3.5 text-left py-3.5 px-4 rounded-xl transition-all font-medium text-sm ${currentView === 'webzine' ? 'bg-neutral-900 text-white shadow-sm' : 'text-neutral-600 hover:bg-neutral-100'}`}
                    style={{ minHeight: '48px' }}
                  >
                    <Sparkles className="w-4 h-4" />
                    웹진
                  </button>
                  <button 
                    onClick={() => { setCurrentView('projects'); setMobileMenuOpen(false); }}
                    className={`flex items-center gap-3.5 text-left py-3.5 px-4 rounded-xl transition-all font-medium text-sm ${currentView === 'projects' ? 'bg-neutral-900 text-white shadow-sm' : 'text-neutral-600 hover:bg-neutral-100'}`}
                    style={{ minHeight: '48px' }}
                  >
                    <FolderHeart className="w-4 h-4" />
                    내 보관함
                  </button>
                </nav>
              </div>

              <div className="border-t border-neutral-100 pt-4">
                {currentUser ? (
                  <div className="flex flex-col gap-3">
                    <span className="flex items-center gap-2 text-xs font-mono text-neutral-600 px-2">
                      <User className="w-4 h-4 text-neutral-400" />
                      {currentUser.name} 에디터
                    </span>
                    <button 
                      onClick={() => { handleLogout(); setMobileMenuOpen(false); }}
                      className="w-full py-3.5 border border-neutral-200 hover:border-neutral-300 rounded-xl text-neutral-600 hover:text-[#B23B1E] hover:bg-neutral-50 font-medium text-xs transition-colors flex items-center justify-center gap-2"
                      style={{ minHeight: '44px' }}
                    >
                      <LogOut className="w-4 h-4" />
                      로그아웃
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    <button 
                      onClick={() => { setAuthMode('login'); setAuthModalOpen(true); setMobileMenuOpen(false); }}
                      className="w-full py-3.5 border border-neutral-200 hover:border-neutral-300 rounded-xl text-neutral-700 font-semibold text-xs transition-colors"
                      style={{ minHeight: '44px' }}
                    >
                      로그인
                    </button>
                    <button 
                      onClick={() => { setAuthMode('signup'); setAuthModalOpen(true); setMobileMenuOpen(false); }}
                      className="w-full py-3.5 bg-neutral-900 hover:bg-[#B23B1E] text-white rounded-xl font-semibold text-xs transition-colors"
                      style={{ minHeight: '44px' }}
                    >
                      회원가입
                    </button>
                  </div>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Main Content Area */}
      <main className="flex-grow">
        {is404Error ? (
          <div className="min-h-[70vh] flex flex-col items-center justify-center p-8 text-center max-w-md mx-auto">
            <svg className="w-16 h-16 text-[#B23B1E] mb-6" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
            <h1 className="text-2xl font-serif font-extrabold text-neutral-900 leading-tight mb-2">요청한 글을 찾을 수 없습니다.</h1>
            <p className="text-neutral-500 text-sm leading-relaxed mb-8">찾으시는 원고가 존재하지 않거나, 비공개 상태로 전환되었습니다. 보관함을 통해 다시 한 번 확인해 주세요.</p>
            <button 
              onClick={() => {
                setIs404Error(false);
                setCurrentView('magazine');
                window.location.href = '/';
              }} 
              className="px-6 py-3.5 bg-neutral-900 hover:bg-[#B23B1E] text-white text-xs font-semibold rounded-xl transition-all"
            >
              메인 홈으로 돌아가기
            </button>
          </div>
        ) : (
          <>
            {/* VIEW 1: MAGAZINE FEED */}
            {currentView === 'magazine' && (
          <div>
            {/* Top scrolling ribbon marquee */}
            <div className="bg-neutral-900 text-[#FAF9F6] text-xs font-mono tracking-widest py-2.5 overflow-hidden whitespace-nowrap">
              <div className="animate-[marquee_25s_linear_infinite] inline-block uppercase">
                SLOW TRAVEL · CURATED JOURNEYS · ESSENTIAL STORIES · HIGH-FIDELITY LIFESTYLE PHOTOGRAPHY · ARTISTIC INTENT &nbsp;·&nbsp;&nbsp;
                SLOW TRAVEL · CURATED JOURNEYS · ESSENTIAL STORIES · HIGH-FIDELITY LIFESTYLE PHOTOGRAPHY · ARTISTIC INTENT &nbsp;·&nbsp;&nbsp;
              </div>
            </div>

            {/* Featured Hero Banner Area */}
            <section className="relative h-[480px] w-full overflow-hidden bg-neutral-900 flex items-end">
              <img 
                src="/images/travel_jeju_coast.jpg" 
                alt="Jeju coast backdrop"
                className="absolute inset-0 w-full h-full object-cover opacity-75 object-center" 
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent" />
              
              <div className="relative z-10 max-w-4xl mx-auto px-6 md:px-12 pb-16 text-white text-left">
                <span className="text-xs font-mono tracking-widest uppercase text-amber-400">EDITOR'S SELECTION</span>
                <h1 className="text-4xl md:text-5xl font-serif font-extrabold tracking-tight mt-3 mb-4 leading-tight text-wrap">
                  천천히 흐르는 제주, 검은 돌과 에메랄드빛 바다 사이의 속삭임
                </h1>
                <p className="text-neutral-200 text-sm md:text-base leading-relaxed mb-6 max-w-2xl">
                  분주한 일상을 내려놓고 서귀포의 작은 해안 마을에서 보낸 3일간의 기록. 바다의 온전한 수평선과 따스한 에스프레소 향기가 머무는 곳에서 느낀 진정한 비움에 대하여 이야기합니다.
                </p>
                <div className="flex gap-4">
                  <button 
                    onClick={() => {
                      setSelectedImages(images.filter(i => i.id === 'img_jeju_beach'));
                      setCurrentView('studio');
                      setTopicInput('제주도 에메랄드 해안을 여행하며 느낀 슬로우 라이프와 자연 에세이');
                      setKeywordInput('제주도 슬로우 트래블');
                      showToast('사진 한 장과 주제가 작업실로 이송되었습니다.');
                    }}
                    className="px-5 py-3 text-xs bg-[#B23B1E] text-white hover:bg-amber-800 transition-all font-semibold rounded-lg"
                  >
                    이 사진으로 글 기획하기
                  </button>
                  <button 
                    onClick={() => {
                      const selected = images.find(i => i.id === 'img_jeju_beach');
                      if (selected) toggleImageSelection(selected);
                    }}
                    className="px-5 py-3 text-xs bg-white/20 hover:bg-white/30 backdrop-blur-md text-white border border-white/20 transition-all font-semibold rounded-lg"
                  >
                    보관 드로어에 추가
                  </button>
                </div>
              </div>
            </section>

            {/* Common Image Hub Section */}
            <section className="max-w-7xl mx-auto px-6 py-16">
              <div className="flex flex-col md:flex-row items-start md:items-end justify-between mb-8 border-b border-neutral-200 pb-6">
                <div>
                  <h2 className="text-3xl font-serif font-bold text-neutral-900 tracking-tight">공통 이미지 허브 자산</h2>
                  <p className="text-neutral-500 text-sm mt-1">공동으로 사용하는 고품질 라이프스타일 스톡 자산입니다. 사진을 조합해 에디터 글을 생성해 보세요.</p>
                </div>
                
                {/* Visual Category Navigation */}
                <div className="flex items-center gap-1.5 p-1 bg-neutral-100 rounded-lg mt-4 md:mt-0">
                  {['all', 'nature', 'lifestyle'].map(cat => (
                    <button 
                      key={cat}
                      onClick={() => setSelectedCategory(cat)}
                      className={`px-4 py-1.5 text-xs font-semibold rounded-md transition-all ${selectedCategory === cat ? 'bg-white text-[#B23B1E] shadow-sm' : 'text-neutral-500 hover:text-neutral-900'}`}
                    >
                      {cat === 'all' ? '전체 보기' : cat === 'nature' ? '자연 풍경' : '라이프스타일'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Images Grid */}
              <div id="common-hub-section" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 scroll-mt-20">
                {images
                  .filter(img => selectedCategory === 'all' || img.category === selectedCategory)
                  .map(img => {
                    const isSelected = selectedImages.some(i => i.id === img.id);
                    return (
                      <div 
                        key={img.id}
                        className="bg-white border border-neutral-200/60 rounded-xl overflow-hidden group hover:shadow-md transition-shadow flex flex-col"
                      >
                        <div className="relative aspect-[4/3] overflow-hidden bg-neutral-100">
                          <img 
                            src={img.thumbnailUrl} 
                            alt={img.title}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          />
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                               toggleImageSelection(img);
                            }}
                            className={`absolute top-3 right-3 p-2 rounded-full backdrop-blur-md transition-all ${
                              isSelected ? 'bg-[#B23B1E] text-white' : 'bg-black/40 text-white hover:bg-black/60'
                            }`}
                          >
                            <Plus className={`w-4 h-4 transition-transform ${isSelected ? 'rotate-45' : ''}`} />
                          </button>
                        </div>
                        <div className="p-4 flex-grow flex flex-col justify-between">
                          <div>
                            <h3 className="font-serif font-bold text-base text-neutral-800 line-clamp-1">{img.title}</h3>
                            <div className="flex flex-wrap items-center gap-1 text-[11px] text-neutral-400 mt-2">
                              {img.tags.slice(0, 3).map(tag => (
                                <span key={tag}>#{tag}</span>
                              ))}
                            </div>
                          </div>
                          
                          <div className="mt-4 pt-3 border-t border-neutral-100 flex items-center justify-between">
                            <button 
                              onClick={() => setActiveImageDetail(img)}
                              className="text-xs text-neutral-500 hover:text-[#B23B1E] font-semibold flex items-center gap-1"
                            >
                              시각 분석 데이터 <ChevronRight className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </section>

            {/* Published Articles Grid Section */}
            <section className="bg-[#FAF9F6] border-t border-neutral-200/60 py-16">
              <div className="max-w-7xl mx-auto px-6">
                <div className="mb-12 text-center max-w-xl mx-auto">
                  <span className="text-xs font-mono tracking-widest text-[#B23B1E] uppercase font-bold">LIFESTYLE ARCHIVE</span>
                  <h2 className="text-3xl font-serif font-extrabold text-neutral-900 tracking-tight mt-2">발행된 매거진 아티클</h2>
                  <p className="text-neutral-500 text-sm mt-2">허브스튜디오2에서 공통 이미지를 활용해 창조하고 다듬어 낸 독창적인 에세이 아카이브입니다.</p>
                </div>

                {publicArticlesError ? (
                  <div role="alert" className="bg-white border rounded-2xl p-8"><p>{publicArticlesError}</p><button className="mt-4 underline" onClick={loadPublicArticles}>다시 시도</button></div>
                ) : publicArticles.length === 0 ? (
                  <div className="bg-white border border-neutral-200/50 rounded-2xl p-12 text-center max-w-lg mx-auto">
                    <BookOpenFallback />
                    <h3 className="font-serif font-bold text-lg text-neutral-800 mt-4">아직 발행된 글이 없습니다</h3>
                    <p className="text-neutral-400 text-xs mt-1">제작 작업실이나 에이전트 대화창에서 신비롭고 아늑한 나만의 여행 에세이를 만들고 발행해 보세요!</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                    {publicArticles.map(art => (
                      <div 
                        key={art.id} 
                        onClick={() => openArticleToRead(art.id)}
                        className="bg-white border border-neutral-100 rounded-2xl overflow-hidden hover:shadow-lg transition-all cursor-pointer flex flex-col"
                      >
                        {art.content.sections.find((s: any) => s.imageId) && (
                          <div className="aspect-[16/10] bg-neutral-100">
                            <img 
                              src={getImgById(art.content.sections.find((s: any) => s.imageId).imageId)?.thumbnailUrl || '/images/travel_jeju_coast.jpg'} 
                              alt="article banner" 
                              className="w-full h-full object-cover"
                            />
                          </div>
                        )}
                        <div className="p-6 flex-grow flex flex-col justify-between">
                          <div>
                            <span className="text-[11px] font-mono text-neutral-400 tracking-wider">
                              {new Date(art.publishedAt).toLocaleDateString()} · PUBLISHED
                            </span>
                            <h3 className="font-serif font-bold text-xl text-neutral-900 mt-2 mb-3 tracking-tight line-clamp-2">
                              {art.title}
                            </h3>
                            <p className="text-neutral-500 text-xs leading-relaxed line-clamp-3">
                              {art.description}
                            </p>
                          </div>
                          <div className="flex items-center justify-between mt-6 pt-4 border-t border-neutral-100 text-xs font-semibold text-[#B23B1E]">
                            <span>전문 읽기 & 내보내기</span>
                            <ChevronRight className="w-4 h-4" />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          </div>
        )}

        {/* VIEW 2: CREATOR STUDIO */}
        {currentView === 'studio' && (
          <div className="max-w-7xl mx-auto px-6 py-10">
            
            {/* Split Page Title */}
            <div className="mb-8 border-b border-neutral-200 pb-5 flex flex-col md:flex-row md:items-end justify-between gap-4">
              <div>
                <h1 className="text-3xl font-serif font-bold text-neutral-900">Creator Studio</h1>
                <p className="text-neutral-400 text-xs mt-1">자산 탐색과 세밀한 에디터 교정, 품질 검수 및 자동 교정 프로세스를 진행합니다.</p>
              </div>
              
              {/* Reset active project if any */}
              {activeProject && (
                <button 
                  onClick={() => {
                    if (confirm('현재 편집 중인 프로젝트를 접고 새 작업을 시작할까요?')) {
                      setActiveProject(null);
                      setEditorialPlan(null);
                    }
                  }}
                  className="px-4 py-2 text-xs font-semibold bg-neutral-100 hover:bg-neutral-200 text-neutral-700 transition-all rounded-lg border border-neutral-200/50"
                >
                  새로운 글 만들기
                </button>
              )}
            </div>

            {/* Selection Drawer Header */}
            <div className="bg-amber-50/70 border border-amber-200/60 rounded-2xl p-5 mb-8">
              <div className="flex items-center justify-between border-b border-amber-200/40 pb-3 mb-4">
                <div className="flex items-center gap-2 text-amber-900">
                  <Sparkles className="w-4 h-4 text-amber-700 animate-pulse" />
                  <span className="text-xs font-bold font-mono uppercase tracking-wider">Image Collection Tray</span>
                  <span className="text-[11px] font-mono text-amber-700">({selectedImages.length}/5 selected)</span>
                </div>
                {selectedImages.length > 0 && (
                  <button 
                    onClick={() => setSelectedImages([])}
                    className="text-xs text-amber-700 hover:text-[#B23B1E] flex items-center gap-1"
                  >
                    전체 비우기
                  </button>
                )}
              </div>

              {selectedImages.length === 0 ? (
                <div className="text-center py-6">
                  <p className="text-neutral-400 text-xs leading-relaxed">
                    매거진 홈에서 공통 이미지를 <strong>2장 이상 5장 이하로 수집(선택)</strong>한 후 이 트레이를 통해 글 생성을 추진하세요.<br />
                    선택한 사진이 많을수록 풍부한 에디토리얼 단락이 창조됩니다.
                  </p>
                  <button 
                    onClick={() => setCurrentView('magazine')}
                    className="mt-3 text-xs text-[#B23B1E] hover:underline font-semibold"
                  >
                    사진 구경하러 가기 &rarr;
                  </button>
                </div>
              ) : (
                <div className="flex flex-wrap gap-4">
                  {selectedImages.map(img => (
                    <div key={img.id} className="relative group w-20 h-20 rounded-lg overflow-hidden border border-neutral-200 bg-neutral-100">
                      <img src={img.thumbnailUrl} className="w-full h-full object-cover" />
                      <button 
                        onClick={() => setSelectedImages(selectedImages.filter(i => i.id !== img.id))}
                        className="absolute -top-1 -right-1 p-1 bg-neutral-900 text-white rounded-full scale-75 hover:bg-[#B23B1E] transition-colors"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Complete Common Image Hub Explorer inside Creator Studio */}
            <div className="bg-white border border-neutral-200/60 rounded-2xl p-6 mb-8">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between border-b border-neutral-100 pb-3 mb-4 gap-2">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 bg-[#B23B1E]/10 text-[#B23B1E] rounded-lg">
                    <Globe className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold font-serif text-neutral-800">공동 자산 갤러리 탐색기 (전체 {images.length}개 보며 선택)</h3>
                    <p className="text-neutral-400 text-[10px] mt-0.5">작업실에서 {images.length}개 이상의 고화질 라이프스타일 자산을 직접 보며 2~5장을 선택해 보세요.</p>
                  </div>
                </div>

                {/* Sub-navigation for dense view */}
                <div className="flex items-center gap-1 bg-neutral-100 p-1 rounded-md text-[10px] font-semibold">
                  {['all', 'nature', 'lifestyle'].map(cat => (
                    <button
                      key={cat}
                      onClick={() => setSelectedCategory(cat)}
                      className={`px-3 py-1 rounded transition-all ${selectedCategory === cat ? 'bg-white text-[#B23B1E] shadow-xs' : 'text-neutral-500 hover:text-neutral-900'}`}
                    >
                      {cat === 'all' ? '전체 자산' : cat === 'nature' ? '자연 풍경' : '라이프스타일'}
                    </button>
                  ))}
                </div>
              </div>

              {/* High-density grid with small thumbnails */}
              <div id="studio-hub-section" className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4 max-h-[380px] overflow-y-auto pr-2 custom-scrollbar scroll-mt-20">
                {images
                  .filter(img => selectedCategory === 'all' || img.category === selectedCategory)
                  .map(img => {
                    const isSelected = selectedImages.some(i => i.id === img.id);
                    const imagePublicUrl = `${window.location.origin}/api/images/${img.id}/public`;
                    return (
                      <div 
                        key={img.id}
                        className={`bg-white border rounded-xl overflow-hidden flex flex-col justify-between transition-all group ${
                          isSelected ? 'border-[#B23B1E] bg-amber-50/10 shadow-xs' : 'border-neutral-200/50 hover:border-neutral-300'
                        }`}
                      >
                        <div className="relative aspect-[16/9] overflow-hidden bg-neutral-100">
                          <img 
                            src={img.thumbnailUrl} 
                            alt={img.title}
                            className="w-full h-full object-cover group-hover:scale-103 transition-transform duration-300"
                          />
                          
                          {/* Aspect Ratio Badge */}
                          <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 bg-black/75 backdrop-blur-xs text-[9px] font-mono font-extrabold text-white rounded">
                            16:9
                          </span>

                          {/* Selection Checkbox Overlay */}
                          <button 
                            onClick={() => toggleImageSelection(img)}
                            className={`absolute top-1.5 right-1.5 p-1.5 rounded-full backdrop-blur-xs transition-all ${
                              isSelected ? 'bg-[#B23B1E] text-white' : 'bg-black/40 text-white hover:bg-black/60'
                            }`}
                          >
                            <Plus className={`w-3.5 h-3.5 transition-transform ${isSelected ? 'rotate-45' : ''}`} />
                          </button>
                        </div>

                        <div className="p-2.5 flex-grow flex flex-col justify-between gap-1.5 text-left">
                          <div>
                            <h4 className="text-[11px] font-bold font-serif text-neutral-800 line-clamp-1" title={img.title}>
                              {img.title}
                            </h4>
                            <div className="flex flex-wrap gap-0.5 mt-1">
                              {img.tags.slice(0, 2).map(tag => (
                                <span key={tag} className="text-[9px] bg-neutral-100 text-neutral-500 px-1 py-0.5 rounded">
                                  #{tag}
                                </span>
                              ))}
                            </div>
                          </div>

                          <div className="pt-2 border-t border-neutral-100 flex items-center justify-between gap-1.5">
                            {/* Copy Image Address Button */}
                            <button 
                              onClick={() => {
                                navigator.clipboard.writeText(imagePublicUrl);
                                showToast('이미지 공개 URL 주소가 복사되었습니다!');
                              }}
                              className="px-1.5 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-[9px] font-bold rounded flex items-center gap-0.5 transition-all"
                              title="이미지 주소 복사"
                            >
                              <Link className="w-2.5 h-2.5" />
                              주소 복사
                            </button>

                            <button 
                              onClick={() => toggleImageSelection(img)}
                              className={`px-1.5 py-1 text-[9px] font-bold rounded transition-all ${
                                isSelected ? 'bg-amber-100 text-amber-900' : 'bg-neutral-200/60 hover:bg-neutral-200 text-neutral-600'
                              }`}
                            >
                              {isSelected ? '선택 해제' : '수집 담기'}
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>

            {/* Studio Workspace Layout */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
              
              {/* Left Column: Creator Inputs and Automated flows (5/12 cols) */}
              <div className="lg:col-span-5 flex flex-col gap-6">
                
                <div className="bg-white border border-neutral-200/60 rounded-2xl p-6">
                  <h3 className="font-serif font-bold text-lg text-neutral-800 border-b border-neutral-100 pb-3 mb-4">에디토리얼 사양 기획</h3>
                  
                  {/* Subject Input */}
                  <div className="mb-4">
                    <label className="block text-xs font-bold text-neutral-600 mb-2 uppercase tracking-wide">주제 및 소재</label>
                    <textarea 
                      value={topicInput}
                      onChange={(e) => setTopicInput(e.target.value)}
                      placeholder="예) 아늑한 안개 낀 침엽수림 속 글램핑 오두막에서 보낸 한적한 힐링 주말"
                      className="w-full text-xs p-3.5 bg-neutral-50 border border-neutral-200 rounded-lg focus:outline-none focus:border-[#B23B1E] min-h-[80px]"
                    />
                  </div>

                  {/* Settings Trigger Panel */}
                  <div className="flex gap-2 mb-6">
                    <button 
                      onClick={handleRecommendPlan}
                      disabled={isPlanRecommending}
                      className="flex-1 py-3 bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-900 text-xs font-semibold rounded-lg transition-all flex items-center justify-center gap-2"
                    >
                      {isPlanRecommending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                      사진 기반 감성기획 추천
                    </button>
                  </div>

                  {editorialPlan && (
                    <motion.div 
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="bg-neutral-50 rounded-xl p-4 mb-6 border border-neutral-200"
                    >
                      <h4 className="text-xs font-bold text-neutral-700 mb-2 font-serif uppercase tracking-wider">🌟 추천된 AI 기획 제안</h4>
                      <p className="text-xs font-serif font-semibold text-neutral-800 mb-1">{editorialPlan.title}</p>
                      <div className="text-[11px] text-neutral-500 space-y-1 mt-2">
                        <p>· <strong>핵심키워드:</strong> {editorialPlan.keyword}</p>
                        <p>· <strong>독자층:</strong> {editorialPlan.audience}</p>
                        <p>· <strong>권장 문체:</strong> {editorialPlan.tone}</p>
                      </div>
                    </motion.div>
                  )}

                  {/* Title & SEO Meta Specs */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div>
                      <label className="block text-xs font-bold text-neutral-600 mb-1.5 uppercase tracking-wide">핵심 타겟 키워드</label>
                      <input 
                        type="text"
                        value={keywordInput}
                        onChange={(e) => setKeywordInput(e.target.value)}
                        placeholder="예) 슬로우라이프 감성글"
                        className="w-full text-xs p-3 bg-neutral-50 border border-neutral-200 rounded-lg focus:outline-none focus:border-[#B23B1E]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-neutral-600 mb-1.5 uppercase tracking-wide">어조 / 문체</label>
                      <input 
                        type="text"
                        value={toneInput}
                        onChange={(e) => setToneInput(e.target.value)}
                        placeholder="예) 차분하고 이성적인 에세이조"
                        className="w-full text-xs p-3 bg-neutral-50 border border-neutral-200 rounded-lg focus:outline-none focus:border-[#B23B1E]"
                      />
                    </div>
                  </div>

                  <div className="mb-6">
                    <label className="block text-xs font-bold text-neutral-600 mb-1.5 uppercase tracking-wide">타겟 독자층</label>
                    <input 
                      type="text"
                      value={audienceInput}
                      onChange={(e) => setAudienceInput(e.target.value)}
                      placeholder="예) 주말 자연 힐링을 꿈꾸는 직장인"
                      className="w-full text-xs p-3 bg-neutral-50 border border-neutral-200 rounded-lg focus:outline-none focus:border-[#B23B1E]"
                    />
                  </div>

                  {/* Core Generation Action */}
                  <button 
                    onClick={handleGenerateBlog}
                    disabled={studioLoading}
                    className="w-full py-4 bg-neutral-900 hover:bg-[#B23B1E] text-white text-xs tracking-wider font-semibold rounded-lg transition-all flex items-center justify-center gap-2"
                  >
                    {studioLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <PenTool className="w-4 h-4" />}
                    감성 라이프스타일 글 생성하기
                  </button>
                </div>

                {/* Review Results Card (Visible only when review exists) */}
                {activeProject && (
                  <div className="bg-white border border-neutral-200/60 rounded-2xl p-6">
                    <div className="flex items-center justify-between border-b border-neutral-100 pb-3 mb-4">
                      <h3 className="font-serif font-bold text-lg text-neutral-800">품질 검수 & 이미지 최적화</h3>
                      <button 
                        onClick={handleReviewBlog}
                        disabled={studioLoading}
                        className="px-3.5 py-1.5 text-[11px] font-semibold bg-neutral-100 hover:bg-neutral-200 rounded-md text-neutral-700 transition-colors"
                      >
                        정밀 매치 분석
                      </button>
                    </div>

                    {!activeProject.review ? (
                      <div className="text-center py-6">
                        <p className="text-neutral-400 text-xs leading-relaxed">
                          글의 완성도를 보증하기 위해 본문-사진 적합성 매칭 검수를 돌려보세요. 안 어울리는 이미지는 허브의 유사 사진으로 완벽하게 교체할 수 있습니다.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <div className="flex items-center justify-between p-3.5 rounded-xl bg-amber-50 border border-amber-200">
                          <div>
                            <span className="text-xs font-mono text-amber-800 uppercase font-semibold">VERDICT: {activeProject.review.verdict.toUpperCase()}</span>
                            <p className="text-[11px] text-amber-700 leading-relaxed mt-1">{activeProject.review.summary}</p>
                          </div>
                        </div>

                        {activeProject.review.replacements.length > 0 ? (
                          <div className="p-4 bg-rose-50/50 border border-rose-200 rounded-xl">
                            <span className="text-xs font-semibold text-rose-800">교체 추천 항목 ({activeProject.review.replacements.length}장)</span>
                            <div className="space-y-2 mt-2">
                              {activeProject.review.replacements.map((r, i) => (
                                <div key={i} className="text-[11px] text-neutral-600 border-b border-rose-100 pb-1.5 last:border-0 last:pb-0">
                                  <strong>[섹션: {activeProject.content.sections.find(s => s.id === r.sectionId)?.heading || '섹션'}]</strong>
                                  <p className="mt-0.5">이유: {r.reason}</p>
                                  <p className="text-emerald-700 mt-0.5">추천 대체안 ID: {r.afterImageId}</p>
                                </div>
                              ))}
                            </div>
                            <button 
                              onClick={handleApplyAutoReplacements}
                              disabled={studioLoading}
                              className="w-full mt-3.5 py-2.5 bg-[#B23B1E] hover:bg-rose-900 text-white text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-1.5"
                            >
                              <RefreshCw className="w-3.5 h-3.5" />
                              추천 이미지로 자동 교체 적용
                            </button>
                          </div>
                        ) : (
                          <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs flex items-center gap-2">
                            <CheckCircle className="w-4 h-4" />
                            <span>현재 모든 단락의 사진이 본문 텍스트 감성과 모순 없이 완벽하게 조화됩니다!</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Right Column: Dynamic Live Preview Canvas & Workspace (7/12 cols) */}
              <div className="lg:col-span-7 flex flex-col gap-6">
                
                {activeProject ? (
                  <div className="bg-white border border-neutral-200/60 rounded-3xl shadow-sm overflow-hidden flex flex-col">
                    
                    {/* Workspace Top Toolbar */}
                    <div className="border-b border-neutral-200/60 bg-neutral-50 px-6 py-4 flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2 text-xs text-neutral-400 font-mono">
                        <span className="text-neutral-500 uppercase tracking-widest">Live Editor</span>
                        <span>·</span>
                        <span>Revision: {activeProject.revision}</span>
                        <span>·</span>
                        <span className="text-amber-700 font-semibold uppercase">{activeProject.status === 'draft' ? '발행 대기' : '발행 중'}</span>
                      </div>
                      
                      <div className="flex items-center gap-2">
                        <button 
                          onClick={handleSaveProjectDraft}
                          disabled={studioLoading}
                          className="px-4 py-2 text-xs font-semibold bg-neutral-100 hover:bg-neutral-200 text-neutral-700 border border-neutral-200/50 rounded-lg transition-colors"
                        >
                          초안 저장
                        </button>
                        <button 
                          onClick={handlePublishBlog}
                          disabled={studioLoading}
                          className="px-4 py-2 text-xs font-semibold bg-[#B23B1E] hover:bg-[#B23B1E]/90 text-white rounded-lg transition-colors"
                        >
                          공개 발행하기
                        </button>
                      </div>
                    </div>

                    {/* Highly Polished Manuscript Sheet */}
                    <div className="p-10 md:p-14 text-left max-w-3xl mx-auto">
                      
                      {/* Interactive Title */}
                      <input 
                        type="text"
                        value={activeProject.content.title}
                        onChange={(e) => {
                          const updated = { ...activeProject };
                          updated.content.title = e.target.value;
                          setActiveProject(updated);
                        }}
                        className="w-full text-3xl md:text-4xl font-serif font-extrabold text-neutral-900 focus:outline-none focus:border-b border-neutral-300 tracking-tight leading-tight mb-4"
                        placeholder="제목을 편집해 보세요."
                      />

                      <div className="flex items-center gap-3 text-neutral-400 text-xs font-mono tracking-wider border-b border-neutral-100 pb-5 mb-6">
                        <span>BY {currentUser?.name || 'Guest'}</span>
                        <span>·</span>
                        <span>{new Date(activeProject.createdAt).toLocaleDateString()}</span>
                      </div>

                      {/* Interactive Intro */}
                      <textarea 
                        value={activeProject.content.intro}
                        onChange={(e) => {
                          const updated = { ...activeProject };
                          updated.content.intro = e.target.value;
                          setActiveProject(updated);
                        }}
                        className="w-full text-sm md:text-base leading-relaxed text-neutral-600 focus:outline-none focus:border-l-2 border-[#B23B1E] pl-3 mb-8 min-h-[80px]"
                        placeholder="도입부를 입력하세요."
                      />

                      {/* Interactive Sections */}
                      <div className="space-y-10">
                        {activeProject.content.sections.map((sec, idx) => {
                          const imgObj = sec.imageId ? getImgById(sec.imageId) : null;
                          return (
                            <div key={sec.id} className="group border-l border-neutral-100 pl-4 py-1 hover:border-amber-400 transition-colors">
                              <input 
                                type="text"
                                value={sec.heading}
                                onChange={(e) => {
                                  const updated = { ...activeProject };
                                  updated.content.sections[idx].heading = e.target.value;
                                  setActiveProject(updated);
                                }}
                                className="w-full text-lg md:text-xl font-serif font-bold text-neutral-800 focus:outline-none focus:border-b border-neutral-200 mb-3"
                                placeholder="단락 소제목"
                              />

                              {/* Section Image rendering with replace select option */}
                              {sec.imageId && (
                                <div className="my-5 rounded-xl overflow-hidden bg-neutral-100 max-w-lg">
                                  <img 
                                    src={imgObj?.thumbnailUrl || '/images/travel_jeju_coast.jpg'} 
                                    alt={sec.alt || 'section image'} 
                                    className="w-full h-64 object-cover"
                                  />
                                  <div className="p-3 bg-neutral-50 border-t border-neutral-100 flex items-center justify-between gap-4">
                                    <input 
                                      type="text"
                                      value={sec.caption || ''}
                                      onChange={(e) => {
                                        const updated = { ...activeProject };
                                        updated.content.sections[idx].caption = e.target.value;
                                        setActiveProject(updated);
                                      }}
                                      className="text-[11px] text-neutral-500 bg-transparent focus:outline-none flex-grow"
                                      placeholder="사진의 캡션을 편집하세요."
                                    />
                                    
                                    {/* Manual image switcher */}
                                    <select 
                                      value={sec.imageId} 
                                      onChange={(e) => {
                                        const updated = { ...activeProject };
                                        updated.content.sections[idx].imageId = e.target.value;
                                        const found = getImgById(e.target.value);
                                        if (found) {
                                          updated.content.sections[idx].alt = found.title;
                                        }
                                        setActiveProject(updated);
                                        showToast('소단락 이미지가 직접 교체되었습니다.');
                                      }}
                                      className="text-[11px] font-mono text-[#B23B1E] bg-white border border-neutral-200 rounded px-1"
                                    >
                                      {images.map(img => (
                                        <option key={img.id} value={img.id}>{img.title}</option>
                                      ))}
                                    </select>
                                  </div>
                                </div>
                              )}

                              <textarea 
                                value={sec.body}
                                onChange={(e) => {
                                  const updated = { ...activeProject };
                                  updated.content.sections[idx].body = e.target.value;
                                  setActiveProject(updated);
                                }}
                                className="w-full text-xs md:text-sm leading-relaxed text-neutral-600 focus:outline-none focus:bg-neutral-50 p-2 rounded min-h-[120px]"
                                placeholder="단락 본문을 입력하세요."
                              />
                            </div>
                          );
                        })}
                      </div>

                      {/* Closing Edit */}
                      <div className="mt-12 pt-8 border-t border-neutral-200">
                        <h4 className="text-xs font-mono uppercase tracking-widest text-neutral-400 mb-2">Editor's Closing Note</h4>
                        <textarea 
                          value={activeProject.content.closing}
                          onChange={(e) => {
                            const updated = { ...activeProject };
                            updated.content.closing = e.target.value;
                            setActiveProject(updated);
                          }}
                          className="w-full text-sm leading-relaxed text-neutral-600 focus:outline-none focus:border-l-2 border-neutral-300 pl-3 min-h-[60px]"
                          placeholder="마무리 노트를 남기세요."
                        />
                      </div>
                    </div>

                  </div>
                ) : (
                  <div className="bg-white border border-neutral-200/50 rounded-3xl p-16 text-center shadow-sm flex flex-col items-center justify-center min-h-[500px]">
                    <CreatorStudioFallback />
                    <h3 className="font-serif font-bold text-lg text-neutral-800 mt-5">활성화된 원고 프로젝트가 없습니다</h3>
                    <p className="text-neutral-400 text-xs mt-1.5 max-w-md">
                      왼쪽 기획사양을 작성하여 AI 에세이를 생성하거나, 매거진 피드 또는 보관함에서 불러와서 라이브 교정을 실행하세요.
                    </p>
                  </div>
                )}

              </div>

            </div>

          </div>
        )}

        {/* VIEW 3: AGENT CO-PILOT */}
        {currentView === 'agent' && (
          <div className="max-w-7xl mx-auto px-6 py-8">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 min-h-[calc(100vh-140px)]">
              
              {/* Left Side: Agent Chat System (5/12 cols) */}
              <div className="lg:col-span-5 flex flex-col bg-white border border-neutral-200/60 rounded-3xl overflow-hidden shadow-sm h-full max-h-[80vh]">
                
                {/* Header info */}
                <div className="p-4 border-b border-neutral-100 bg-neutral-50 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Bot className="w-5 h-5 text-[#B23B1E]" />
                    <div>
                      <h2 className="text-xs font-bold font-serif text-neutral-800">에이전트 콘텐츠 동반자</h2>
                      <span className="text-[10px] font-mono text-neutral-400 uppercase tracking-widest">CURATION & CRITIC COPILOT</span>
                    </div>
                  </div>
                  {showResetConfirm ? (
                    <div className="flex items-center gap-2 bg-neutral-100 p-1 px-2.5 rounded-lg border border-neutral-200">
                      <span className="text-[10px] text-neutral-600 font-semibold">초기화 하시겠습니까?</span>
                      <button 
                        onClick={() => {
                          setMessages([]);
                          setThreadId('thread_' + Date.now());
                          setShowResetConfirm(false);
                          showToast('새 대화가 시작되었습니다.');
                        }}
                        className="text-[10px] font-bold text-[#B23B1E] hover:underline"
                      >
                        예
                      </button>
                      <span className="text-[9px] text-neutral-300">|</span>
                      <button 
                        onClick={() => setShowResetConfirm(false)}
                        className="text-[10px] font-bold text-neutral-500 hover:underline"
                      >
                        아니오
                      </button>
                    </div>
                  ) : (
                    <button 
                      onClick={() => setShowResetConfirm(true)}
                      className="text-[10px] font-semibold text-neutral-400 hover:text-[#B23B1E] hover:bg-neutral-100/80 px-2 py-1 rounded transition-colors"
                    >
                      대화 초기화
                    </button>
                  )}
                </div>

                {/* Chats Area */}
                <div className="flex-grow p-5 overflow-y-auto space-y-4 max-h-[55vh]">
                  {messages.length === 0 ? (
                    <div className="text-center py-10">
                      <div className="p-3 bg-neutral-100 text-neutral-400 rounded-full inline-block mb-3">
                        <Bot className="w-6 h-6 text-[#B23B1E]/60" />
                      </div>
                      <h4 className="font-serif font-semibold text-neutral-700 text-xs">안녕하세요, {currentUser?.name || '에디터'}님</h4>
                      <p className="text-neutral-400 text-[11px] mt-1.5 max-w-xs mx-auto">
                        자유롭게 원고 제작, 본문-사진 검수, 유사 사진 자동 교정, 초안 저장 또는 발행을 말씀해 보세요. 마이크를 켜고 말하셔도 좋습니다!
                      </p>
                    </div>
                  ) : (
                    messages.map((m, idx) => (
                      <div 
                        key={m.id || idx}
                        className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
                      >
                        <div 
                          className={`max-w-[85%] px-4 py-3 rounded-2xl text-xs leading-relaxed whitespace-pre-wrap ${
                            m.role === 'user' 
                              ? 'bg-[#B23B1E] text-white rounded-br-none' 
                              : 'bg-neutral-100 text-neutral-800 rounded-bl-none border border-neutral-200/40 font-serif'
                          }`}
                        >
                          {m.content}
                        </div>
                      </div>
                    ))
                  )}

                  {/* Quick actions presets - wrapped, no scrollbar, placed above the job status inside the chat container */}
                  <div className="flex flex-wrap gap-1.5 pt-3 border-t border-neutral-100/60 justify-center">
                    {[
                      '제주도 사진으로 멋진 에세이 초안 기획과 생성해줘.',
                      '비 오는 날 카페 테이블 사진으로 에세이 써줘.',
                      '작성된 초안 원고의 사진 매칭 검수해줘.',
                      '어울리지 않는 사진은 허브 유사사진으로 교체해주고 보고해줘.',
                      '이 초안을 검수한 뒤 비공개로 안전하게 저장해줘.',
                    ].map((preset, idx) => (
                      <button 
                        key={idx}
                        onClick={() => handleSendMessage(preset)}
                        className="px-2.5 py-1 text-[10px] bg-neutral-50 hover:bg-neutral-100 border border-neutral-200 hover:border-[#B23B1E] hover:text-[#B23B1E] rounded-full text-neutral-600 transition-colors whitespace-normal text-center"
                      >
                        {preset}
                      </button>
                    ))}
                  </div>

                  {/* Active Background job state indicator */}
                  {activeJob && (
                    <div className="flex items-center gap-3 p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs font-mono animate-pulse">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>[{activeJob.stage.toUpperCase()}] 에이전트가 단계를 분석하며 수행 중입니다...</span>
                    </div>
                  )}
                </div>

                {/* Chat Input panel with Voice recognition support */}
                <div className="p-4 border-t border-neutral-100 bg-neutral-50 flex items-center gap-2">
                  <button 
                    onClick={handleToggleVoice}
                    className={`p-3.5 rounded-full transition-all shrink-0 ${
                      voiceRecording ? 'bg-rose-500 text-white animate-bounce' : 'bg-neutral-200 hover:bg-neutral-300 text-neutral-600'
                    }`}
                    title="음성 명령 말하기"
                  >
                    {voiceRecording ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                  </button>

                  <div className="flex-grow relative">
                    <input 
                      type="text"
                      value={voiceRecording ? voiceTranscript : agentInput}
                      onChange={(e) => setAgentInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                      placeholder={voiceRecording ? "듣는 중..." : "에이전트에게 콘텐츠 명령을 입력하세요..."}
                      className="w-full text-xs p-3.5 bg-white border border-neutral-200 rounded-full focus:outline-none focus:border-[#B23B1E] pr-10"
                      disabled={voiceRecording}
                    />
                    {agentInput.trim() && (
                      <button 
                        onClick={() => handleSendMessage()}
                        className="absolute right-3 top-3.5 text-xs text-[#B23B1E] font-semibold"
                      >
                        전송
                      </button>
                    )}
                  </div>
                </div>

              </div>

              {/* Right Side: Active Project Snapshot and Manuscript workspace (7/12 cols) */}
              <div className="lg:col-span-7 flex flex-col bg-white border border-neutral-200/60 rounded-3xl overflow-hidden shadow-sm p-8 max-h-[80vh] overflow-y-auto">
                <div className="flex items-center justify-between border-b border-neutral-100 pb-3 mb-6">
                  <h3 className="font-serif font-bold text-lg text-neutral-800">에이전트 실시간 워크스페이스</h3>
                  <span className="text-[10px] font-mono text-neutral-400">CONTEXT SYNC VIEW</span>
                </div>

                {activeProject ? (
                  <div className="text-left">
                    <div className="mb-4 inline-flex items-center gap-2 px-3 py-1 bg-amber-50 text-amber-900 border border-amber-200 rounded-full text-[10px] font-mono uppercase tracking-wider font-semibold">
                      <span>SYNCED WORK: {activeProject.title.slice(0, 25)}...</span>
                    </div>

                    <h2 className="text-2xl font-serif font-extrabold text-neutral-900 leading-tight mb-4">{activeProject.content.title}</h2>
                    <p className="text-neutral-500 text-xs mb-6 pl-2 border-l-2 border-[#B23B1E] italic leading-relaxed">{activeProject.content.intro}</p>

                    <div className="space-y-6">
                      {activeProject.content.sections.map(s => (
                        <div key={s.id} className="text-xs text-neutral-700 leading-relaxed border-b border-neutral-100 pb-4 last:border-0 last:pb-0">
                          <h4 className="font-serif font-bold text-neutral-800 text-sm mb-2">{s.heading}</h4>
                          {s.imageId && (
                            <div className="my-3 rounded-lg overflow-hidden h-40 max-w-md bg-neutral-100">
                              <img src={getImgById(s.imageId)?.thumbnailUrl} className="w-full h-full object-cover" />
                            </div>
                          )}
                          <p>{s.body}</p>
                        </div>
                      ))}
                    </div>

                    <div className="mt-6 pt-4 border-t border-neutral-100 flex justify-end gap-3">
                      <button 
                        onClick={() => {
                          setCurrentView('studio');
                          showToast('에이전트가 완성한 프로젝트를 스튜디오 정밀 편집창에 도킹했습니다.');
                        }}
                        className="px-4 py-2 bg-neutral-900 hover:bg-[#B23B1E] text-white text-[11px] font-semibold rounded-lg transition-colors"
                      >
                        세밀 교정 에디터에서 열기
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-24 text-neutral-400 flex flex-col items-center justify-center">
                    <Bot className="w-12 h-12 text-[#B23B1E]/40 mb-3" />
                    <h4 className="font-serif font-bold text-neutral-700 text-xs">작동 상태 동기화 대기 중</h4>
                    <p className="text-[11px] max-w-xs mt-1 leading-relaxed">
                      왼쪽 대화창에 명령을 넣으면 에이전트가 생성한 원고 스냅샷과 실시간 기획 분석 결과가 이곳에 즉각 시각적으로 렌더링됩니다.
                    </p>
                  </div>
                )}
              </div>

            </div>
          </div>
        )}

        {/* VIEW 4: MY PROJECTS */}
        {currentView === 'projects' && (
          <div className="max-w-7xl mx-auto px-6 py-12">
            <div className="border-b border-neutral-200 pb-5 mb-8 text-left">
              <h1 className="text-3xl font-serif font-bold text-neutral-900">내 에디토리얼 보관함</h1>
              <p className="text-neutral-400 text-xs mt-1">내가 생성, 교정, 검수 중이거나 공식 발행한 소유 매거진 프로젝트 목록입니다.</p>
            </div>

            {!currentUser ? (
              <div className="bg-white border rounded-2xl p-8 text-center"><p>로그인하면 내 보관함을 확인할 수 있습니다.</p><button className="mt-4 underline" onClick={() => setAuthModalOpen(true)}>로그인</button></div>
            ) : projectsLoading ? <p className="py-12 text-center">보관함을 불러오는 중...</p> : projectsError ? (
              <div role="alert" className="bg-white border rounded-2xl p-8"><p>{projectsError}</p><button className="mt-4 underline" onClick={loadProjects}>다시 시도</button></div>
            ) : projectsList.length === 0 ? (
              <div className="bg-white border border-neutral-200/50 rounded-3xl p-16 text-center max-w-lg mx-auto">
                <BookOpenFallback />
                <h3 className="font-serif font-bold text-lg text-neutral-800 mt-4">보관된 프로젝트가 없습니다</h3>
                <p className="text-neutral-400 text-xs mt-1">제작 작업실에서 고품질 슬로우 트래블 매거진을 만들고 첫 여정을 기록해 보세요!</p>
                <button 
                  onClick={() => setCurrentView('studio')}
                  className="mt-5 px-5 py-2.5 bg-neutral-900 text-white text-xs font-semibold rounded-lg hover:bg-[#B23B1E] transition-colors"
                >
                  에세이 쓰러 가기
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {projectsList.map(proj => (
                  <div 
                    key={proj.id}
                    className="bg-white border border-neutral-200/60 rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between"
                  >
                    <div className="p-6 text-left">
                      <div className="flex items-center justify-between gap-3 mb-3">
                        <span className={`px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider font-semibold rounded-md border ${
                          proj.status === 'published' 
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-800' 
                            : 'bg-amber-50 border-amber-200 text-amber-800'
                        }`}>
                          {proj.status === 'published' ? '공개 발행 완료' : '발행 대기'}
                        </span>
                        <span className="text-[10px] font-mono text-neutral-400">REVISION: {proj.revision}</span>
                      </div>

                      <h3 className="font-serif font-bold text-lg text-neutral-900 line-clamp-2">{proj.content.title || proj.title}</h3>
                      <p className="text-neutral-500 text-xs mt-2 line-clamp-3 leading-relaxed">{proj.content.description}</p>
                      
                      <div className="text-[11px] font-mono text-neutral-400 mt-4 space-y-1">
                        <p>· 키워드: {proj.keyword}</p>
                        <p>· 수정일: {new Date(proj.updatedAt).toLocaleDateString()}</p>
                      </div>
                    </div>

                    <div className="px-6 py-4 bg-neutral-50/50 border-t border-neutral-100 flex items-center justify-between">
                      <button 
                        onClick={() => setProjectToDelete(proj.id)}
                        className="p-2 text-neutral-400 hover:text-[#B23B1E] hover:bg-neutral-100 rounded-lg transition-colors"
                        title="프로젝트 삭제"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>

                      <div className="flex gap-2">
                        <button 
                          onClick={() => {
                            fetchAndLoadProject(proj.id);
                            setCurrentView('studio');
                            showToast('선택한 에세이가 편집창에 도킹되었습니다.');
                          }}
                          className="px-3.5 py-2 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 text-xs font-semibold rounded-lg transition-colors"
                        >
                          편집
                        </button>
                        {proj.publishedArticleId && (
                          <button 
                            onClick={() => openArticleToRead(proj.publishedArticleId!)}
                            className="px-3.5 py-2 bg-[#B23B1E] hover:bg-[#B23B1E]/90 text-white text-xs font-semibold rounded-lg transition-colors"
                          >
                            발행글 보기
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* VIEW 4.5: WEBZINE GRID VIEW (Officially Published Articles Only) */}
        {currentView === 'webzine' && (
          <div className="max-w-7xl mx-auto px-6 py-12">
            <div className="border-b border-neutral-200 pb-5 mb-8 text-left flex flex-col md:flex-row md:items-end justify-between gap-4">
              <div>
                <h1 className="text-3xl font-serif font-bold text-neutral-900">공식 웹진 아카이브</h1>
                <p className="text-neutral-400 text-xs mt-1">심사를 거쳐 최고 랭킹 점수를 획득하고 공식 발간된 슬로우 라이프스타일 저널 목록입니다.</p>
              </div>
              <div className="bg-neutral-100 px-3 py-1.5 rounded-lg border border-neutral-200 text-xs font-mono text-neutral-500">
                {webzineError ? "조회 실패" : `TOTAL: ${publishedWebzineArticles.length} 발행물`}
              </div>
            </div>

            {webzineLoading ? (
              <div className="text-center py-20">
                <div className="animate-spin w-8 h-8 border-4 border-[#B23B1E] border-t-transparent rounded-full mx-auto mb-4"></div>
                <p className="text-neutral-400 text-sm font-mono">공식 발행 데이터베이스 동기화 중...</p>
              </div>
            ) : webzineError ? (
              <div role="alert" className="bg-white border rounded-2xl p-8"><p>{webzineError}</p><button className="mt-4 underline" onClick={loadPublishedWebzineArticles}>다시 시도</button></div>
            ) : publishedWebzineArticles.length === 0 ? (
              <div className="bg-white border border-neutral-200/50 rounded-3xl p-16 text-center max-w-lg mx-auto">
                <BookOpenFallback />
                <h3 className="font-serif font-bold text-lg text-neutral-800 mt-4">발행된 에세이가 없습니다</h3>
                <p className="text-neutral-400 text-xs mt-1">대시보드 "내 보관함"에서 발행 대기 상태의 고유 에디토리얼을 공식 출판해 보세요!</p>
                <button 
                  onClick={() => setCurrentView('projects')}
                  className="mt-5 px-5 py-2.5 bg-neutral-900 text-white text-xs font-semibold rounded-lg hover:bg-[#B23B1E] transition-colors"
                >
                  내 보관함 가기
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
                
                {/* Left Side: Editorial Articles list (takes 3 of 4 columns) */}
                <div className="lg:col-span-3 grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
                  {publishedWebzineArticles.map(proj => {
                    // Try to find the first image in sections for cover
                    const firstSectionWithImg = proj.content.sections.find((s: any) => s.imageId);
                    const coverImgObj = (firstSectionWithImg && firstSectionWithImg.imageId) ? getImgById(firstSectionWithImg.imageId) : null;
                    const coverUrl = coverImgObj?.thumbnailUrl || '/images/travel_jeju_coast.jpg';

                    return (
                      <div 
                        key={proj.id}
                        className="bg-white border border-neutral-200/60 rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-all flex flex-col h-[500px] justify-between"
                      >
                        {/* Article Representative Image cover */}
                        <div className="h-48 overflow-hidden bg-neutral-100 relative group">
                          <img src={coverUrl} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
                          <div className="absolute top-3 left-3 bg-neutral-900/80 backdrop-blur-sm text-[10px] font-mono tracking-widest text-[#FAF9F6] px-2.5 py-1 rounded-md uppercase font-bold">
                            OFFICIAL JOURNAL
                          </div>
                        </div>

                        <div className="p-6 text-left flex-grow">
                          <span className="text-[10px] font-mono text-neutral-400">
                            PUBLISHED · {new Date(proj.updatedAt).toLocaleDateString()}
                          </span>
                          <h3 className="font-serif font-extrabold text-lg text-neutral-900 mt-1.5 line-clamp-2 leading-snug">
                            <a href={`/blog/${encodeURIComponent(proj.publishedArticleId || proj.id)}`}>{proj.content.title || proj.title}</a>
                          </h3>
                          <p className="text-neutral-500 text-xs mt-2 line-clamp-3 leading-relaxed">
                            {proj.content.description}
                          </p>
                          
                          <div className="flex flex-wrap gap-1 mt-4">
                            {proj.content.tags && proj.content.tags.slice(0, 3).map((tag: string) => (
                              <span key={tag} className="px-2 py-0.5 bg-neutral-100 text-neutral-600 rounded text-[10px] font-mono">
                                #{tag}
                              </span>
                            ))}
                          </div>
                        </div>

                        <div className="px-6 py-4 bg-neutral-50 border-t border-neutral-100 flex items-center justify-between gap-3">
                          {/* Deep link copy button with Naver / Google search optimizations */}
                          <button 
                            onClick={() => {
                              const shareUrl = `${window.location.origin}/?view=webzine&articleId=${proj.id}`;
                              navigator.clipboard.writeText(shareUrl);
                              showToast('웹진 정밀 주소를 복사했습니다! 검색 색인 등록용으로 적합합니다.', 'success');
                            }}
                            className="p-2 text-neutral-400 hover:text-[#B23B1E] hover:bg-neutral-100 rounded-lg transition-colors flex items-center gap-1 text-[11px] font-mono"
                            title="네이버/구글 검색 전용 세부 주소 복사"
                          >
                            <Share2 className="w-3.5 h-3.5" /> 주소 복사
                          </button>

                          <button 
                            onClick={() => {
                              // Simulate mapping for reading view
                              const articleSnapshot = {
                                id: proj.publishedArticleId || proj.id,
                                siteId: proj.siteId,
                                ownerId: proj.ownerId,
                                projectId: proj.id,
                                title: proj.content.title,
                                description: proj.content.description,
                                content: proj.content,
                                createdAt: proj.createdAt,
                                publishedAt: proj.updatedAt,
                              };
                              setReadingArticle(articleSnapshot);
                              setCurrentView('blog-view');
                            }}
                            className="px-4 py-2 bg-neutral-950 text-white text-xs font-bold rounded-lg hover:bg-[#B23B1E] transition-colors"
                          >
                            원고 정독하기 &rarr;
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Right Side: Editorial 1:1 Square Ad banner (Prohibited from broken assets, uses verified base64) */}
                <div className="space-y-6">
                  <div className="bg-white border border-neutral-200/60 rounded-3xl p-6 shadow-sm sticky top-24 text-left">
                    <span className="text-[10px] font-mono tracking-widest text-neutral-400 uppercase font-black block mb-3">SPONSORED CONTENTS</span>
                    
                    {/* 1:1 Square Ad Area */}
                    <div className="aspect-square w-full bg-neutral-950 rounded-2xl overflow-hidden relative group shadow-inner border border-neutral-200/20">
                      <img 
                        src={images[2]?.thumbnailUrl || '/images/travel_product_cosmetic.jpg'} 
                        className="w-full h-full object-cover opacity-85 group-hover:scale-105 transition-transform duration-700" 
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent flex flex-col justify-end p-5">
                        <span className="text-[9px] font-mono text-[#B23B1E] uppercase font-bold bg-[#B23B1E]/10 border border-[#B23B1E]/30 px-2 py-0.5 rounded self-start mb-2">
                          PREMIUM BRAND AD
                        </span>
                        <h4 className="text-white font-serif font-bold text-sm leading-snug">
                          프리미엄 보태니컬 유기농 스킨케어 세럼
                        </h4>
                        <p className="text-neutral-300 text-[10px] mt-1 line-clamp-2 leading-relaxed">
                          제주의 맑은 유목 나무의 성분과 에메랄드 해변의 비타민을 가득 채운 프리미엄 라인업. 공식 판매 개시.
                        </p>
                      </div>
                    </div>

                    <div className="mt-4 text-center">
                      <a 
                        href="https://sungbaep296.github.io/organic-serum" 
                        target="_blank" 
                        rel="noopener noreferrer" 
                        className="block w-full py-2.5 text-center bg-neutral-100 hover:bg-[#B23B1E] hover:text-white rounded-xl text-xs font-bold text-neutral-800 transition-all border border-neutral-200/50"
                      >
                        스토어 혜택가로 둘러보기 &rarr;
                      </a>
                    </div>
                  </div>

                  {/* 1:1 Square Ad Area 2 */}
                  <div className="bg-amber-50/50 border border-amber-200/60 rounded-3xl p-6 text-left">
                    <span className="text-[10px] font-mono tracking-widest text-amber-700 uppercase font-black block mb-3">LIFESTYLE RECOMMENDATION</span>
                    
                    <div className="aspect-square w-full bg-neutral-900 rounded-2xl overflow-hidden relative group">
                      <img 
                        src={images[4]?.thumbnailUrl || '/images/travel_park_golf.jpg'} 
                        className="w-full h-full object-cover opacity-80 group-hover:scale-105 transition-transform duration-700" 
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-amber-950/90 via-amber-950/20 to-transparent flex flex-col justify-end p-5">
                        <span className="text-[9px] font-mono text-amber-300 uppercase font-bold bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 rounded self-start mb-2">
                          HEALTH & LIFE
                        </span>
                        <h4 className="text-white font-serif font-bold text-sm leading-snug">
                          서해안 프라이빗 파크골프 클럽 멤버십
                        </h4>
                        <p className="text-neutral-300 text-[10px] mt-1 line-clamp-2 leading-relaxed">
                          노을 지는 언덕에서의 품격 높은 만남. 친환경 18홀 필드 무제한 무료 라운딩 및 부티크 서비스.
                        </p>
                      </div>
                    </div>

                    <div className="mt-4">
                      <button 
                        onClick={() => showToast('서해안 멤버십 전용 하이파이브 초대장 준비 중입니다.', 'info')}
                        className="w-full py-2.5 bg-amber-900 text-white rounded-xl text-xs font-bold hover:bg-amber-950 transition-colors"
                      >
                        VIP 정식 상담 신청 (무료)
                      </button>
                    </div>
                  </div>
                </div>

              </div>
            )}
          </div>
        )}

        {/* VIEW 5: BLOG VIEW (SEO Reader mode) */}
        {currentView === 'blog-view' && readingArticle && (
          <div className="max-w-7xl mx-auto px-6 py-12 text-left">
            
            {/* Back to list button */}
            <button 
              onClick={() => setCurrentView('webzine')}
              className="mb-8 flex items-center gap-1.5 text-xs text-neutral-500 hover:text-neutral-900 font-semibold"
            >
              <ArrowLeft className="w-4 h-4" /> 웹진 목록으로 돌아가기
            </button>

            <div className="grid grid-cols-1 lg:grid-cols-4 gap-10">
              
              {/* Left Column: Core Blog/Prose Content (takes 3 of 4 columns) */}
              <div className="lg:col-span-3">
                {/* Reading header area */}
                <div className="border-b border-neutral-200/80 pb-6 mb-10">
                  <div className="flex items-center gap-2 mb-4">
                    <span className="text-xs font-mono tracking-widest text-[#B23B1E] uppercase font-bold">LIFESTYLE MAGAZINE</span>
                    <span className="text-neutral-300 font-mono text-xs">/</span>
                    <span className="text-xs font-mono text-neutral-400">{new Date(readingArticle.publishedAt).toLocaleDateString()} PUBLISHED</span>
                  </div>

                  <h1 className="text-3xl md:text-5xl font-serif font-extrabold text-neutral-900 leading-tight tracking-tight mb-4">
                    {readingArticle.content.title}
                  </h1>

                  <p className="text-neutral-500 text-sm md:text-base leading-relaxed max-w-3xl pl-3 border-l-2 border-[#B23B1E]">
                    {readingArticle.content.description}
                  </p>
                </div>

                {/* Export Toolbar panel */}
                <div className="bg-neutral-50 border border-neutral-200 rounded-2xl p-4 mb-10 flex flex-wrap items-center justify-between gap-3">
                  <span className="text-xs font-mono text-neutral-500">📥 내보내기 및 스토리지 옵션</span>
                  <div className="flex gap-2">
                    <button 
                      onClick={handleCopyRawText}
                      className="px-3.5 py-2 bg-white border border-neutral-200 hover:border-amber-400 rounded-lg text-xs font-semibold text-neutral-700 transition-colors flex items-center gap-1.5"
                    >
                      <Copy className="w-3.5 h-3.5" /> 본문 일반 텍스트 복사
                    </button>
                    <button 
                      onClick={handleCopyHtml}
                      className="px-3.5 py-2 bg-white border border-neutral-200 hover:border-amber-400 rounded-lg text-xs font-semibold text-neutral-700 transition-colors flex items-center gap-1.5"
                    >
                      <Share2 className="w-3.5 h-3.5" /> HTML 복사 (공개사진주소 포함)
                    </button>
                  </div>
                </div>

                {/* Immersive prose reading */}
                <div className="prose prose-neutral max-w-none text-neutral-800 text-sm md:text-base leading-relaxed space-y-8">
                  
                  <p className="text-neutral-700 text-sm md:text-base font-serif italic mb-8">
                    {readingArticle.content.intro}
                  </p>

                  <div className="space-y-12">
                    {readingArticle.content.sections.map((s: any) => {
                      const imgObj = s.imageId ? getImgById(s.imageId) : null;
                      return (
                        <div key={s.id} className="space-y-4">
                          <h3 className="text-xl md:text-2xl font-serif font-bold text-neutral-900 mt-8 mb-2">
                            {s.heading}
                          </h3>
                          
                          {s.imageId && (
                            <div className="my-6 rounded-2xl overflow-hidden max-w-3xl bg-neutral-100">
                              <img 
                                src={imgObj?.thumbnailUrl || '/images/travel_jeju_coast.jpg'} 
                                alt={s.alt || s.heading} 
                                className="w-full h-80 object-cover"
                              />
                              {s.caption && (
                                <div className="p-3 bg-neutral-50 border-t border-neutral-100 text-center text-xs font-serif text-neutral-500">
                                  {s.caption}
                                </div>
                              )}
                            </div>
                          )}
                          
                          <p className="whitespace-pre-wrap">{s.body}</p>
                        </div>
                      );
                    })}
                  </div>

                  {/* Reading FAQ block */}
                  {readingArticle.content.faq && readingArticle.content.faq.length > 0 && (
                    <div className="mt-16 pt-8 border-t border-neutral-200 bg-neutral-50 p-6 rounded-2xl">
                      <h4 className="font-serif font-bold text-lg text-neutral-900 mb-4">자주 묻는 질문 (FAQ)</h4>
                      <div className="space-y-4">
                        {readingArticle.content.faq.map((f: any, idx: number) => (
                          <div key={idx} className="space-y-1 border-b border-neutral-200/50 pb-3 last:border-0 last:pb-0">
                            <p className="text-xs font-bold text-neutral-800">Q. {f.question}</p>
                            <p className="text-xs text-neutral-600">A. {f.answer}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Tags footer */}
                  {readingArticle.content.tags && readingArticle.content.tags.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2 mt-8 pt-6 border-t border-neutral-100 text-xs font-mono text-neutral-400 uppercase tracking-widest">
                      <span>TAGS:</span>
                      {readingArticle.content.tags.map((tag: string) => (
                        <span key={tag} className="text-neutral-500">· #{tag}</span>
                      ))}
                    </div>
                  )}

                </div>
              </div>

              {/* Right Column: Sticky Sidebar containing the 1:1 Square Premium Lifestyle Ad */}
              <div className="lg:col-span-1 space-y-6">
                <div className="sticky top-24 bg-white border border-neutral-200/60 rounded-3xl p-6 shadow-sm text-left">
                  <span className="text-[10px] font-mono tracking-widest text-neutral-400 uppercase font-black block mb-3">SPONSORED CONTENTS</span>
                  
                  {/* 1:1 Square Ad Card */}
                  <div className="aspect-square w-full bg-neutral-950 rounded-2xl overflow-hidden relative group shadow-inner border border-neutral-200/20">
                    <img 
                      src={images[2]?.thumbnailUrl || '/images/travel_product_cosmetic.jpg'} 
                      className="w-full h-full object-cover opacity-85 group-hover:scale-105 transition-transform duration-700" 
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent flex flex-col justify-end p-5">
                      <span className="text-[9px] font-mono text-[#B23B1E] uppercase font-bold bg-[#B23B1E]/10 border border-[#B23B1E]/30 px-2 py-0.5 rounded self-start mb-2">
                        PREMIUM BRAND AD
                      </span>
                      <h4 className="text-white font-serif font-bold text-sm leading-snug">
                        프리미엄 보태니컬 유기농 스킨케어 세럼
                      </h4>
                      <p className="text-neutral-300 text-[10px] mt-1 line-clamp-2 leading-relaxed">
                        제주의 맑은 유목 나무의 성분과 에메랄드 해변의 비타민을 가득 채운 프리미엄 라인업. 공식 판매 개시.
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 text-center">
                    <a 
                      href="https://sungbaep296.github.io/organic-serum" 
                      target="_blank" 
                      rel="noopener noreferrer" 
                      className="block w-full py-2.5 text-center bg-neutral-100 hover:bg-[#B23B1E] hover:text-white rounded-xl text-xs font-bold text-neutral-800 transition-all border border-neutral-200/50"
                    >
                      상세 스토어 혜택가 &rarr;
                    </a>
                  </div>
                </div>

                <div className="bg-amber-50/50 border border-amber-200/60 rounded-3xl p-6 text-left">
                  <span className="text-[10px] font-mono tracking-widest text-amber-700 uppercase font-black block mb-3">LIFESTYLE RECOMMENDED</span>
                  
                  {/* 1:1 Square Ad Card 2 */}
                  <div className="aspect-square w-full bg-neutral-900 rounded-2xl overflow-hidden relative group">
                    <img 
                      src={images[4]?.thumbnailUrl || '/images/travel_park_golf.jpg'} 
                      className="w-full h-full object-cover opacity-80 group-hover:scale-105 transition-transform duration-700" 
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-amber-950/90 via-amber-950/20 to-transparent flex flex-col justify-end p-5">
                      <span className="text-[9px] font-mono text-amber-300 uppercase font-bold bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 rounded self-start mb-2">
                        HEALTH & LIFE
                      </span>
                      <h4 className="text-white font-serif font-bold text-sm leading-snug">
                        서해안 프라이빗 파크골프 클럽 멤버십
                      </h4>
                      <p className="text-neutral-300 text-[10px] mt-1 line-clamp-2 leading-relaxed">
                        노을 지는 언덕에서의 품격 높은 만남. 친환경 18홀 필드 무제한 무료 라운딩 및 부티크 서비스.
                      </p>
                    </div>
                  </div>

                  <div className="mt-4">
                    <button 
                      onClick={() => showToast('서해안 멤버십 전용 하이파이브 초대장 준비 중입니다.', 'info')}
                      className="w-full py-2.5 bg-amber-900 text-white rounded-xl text-xs font-bold hover:bg-amber-950 transition-colors"
                    >
                      VIP 정식 상담 신청
                    </button>
                  </div>
                </div>
              </div>

            </div>
          </div>
        )}

          </>
        )}
      </main>

      {/* Floating Image Detail Modal */}
      <AnimatePresence>
        {activeImageDetail && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 md:p-10"
          >
            <motion.div 
              initial={{ scale: 0.95, y: 10 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 10 }}
              className="bg-white max-w-4xl w-full rounded-2xl overflow-hidden shadow-2xl flex flex-col md:flex-row border border-neutral-200"
            >
              <div className="md:w-1/2 aspect-[4/3] md:aspect-auto bg-neutral-100 relative">
                <img src={activeImageDetail.thumbnailUrl} className="w-full h-full object-cover" />
                <button 
                  onClick={() => setActiveImageDetail(null)}
                  className="absolute top-4 left-4 p-2 rounded-full bg-black/40 hover:bg-black/60 text-white md:hidden"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="md:w-1/2 p-8 flex flex-col justify-between text-left">
                <div>
                  <div className="flex items-center justify-between border-b border-neutral-100 pb-3 mb-4">
                    <span className="text-[10px] font-mono text-neutral-400 uppercase tracking-widest">COMMON IMAGE DATA</span>
                    <button 
                      onClick={() => setActiveImageDetail(null)}
                      className="hidden md:block text-neutral-400 hover:text-neutral-700"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>

                  <h3 className="font-serif font-bold text-2xl text-neutral-900 leading-tight">{activeImageDetail.title}</h3>
                  <p className="text-xs text-neutral-400 mt-1 font-mono uppercase">ID: {activeImageDetail.id} / PROJECT: {activeImageDetail.sourceProject}</p>

                  <div className="mt-6 space-y-4">
                    <div>
                      <span className="text-[10px] font-mono font-bold text-neutral-400 uppercase tracking-wider block">AI 시각 융합 분석 (Vision summary)</span>
                      <p className="text-xs text-neutral-600 mt-1 leading-relaxed bg-neutral-50 p-3 rounded-lg border border-neutral-100 font-serif">
                        {activeImageDetail.analysis?.summary || '자세한 시각 분석 정보가 존재하지 않습니다.'}
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-4 text-xs font-mono">
                      <div>
                        <span className="text-[10px] text-neutral-400 block font-bold">주요 피사체</span>
                        <span className="text-neutral-700">{activeImageDetail.analysis?.subjects.join(', ') || '없음'}</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-neutral-400 block font-bold">배경 설정</span>
                        <span className="text-neutral-700">{activeImageDetail.analysis?.setting || '없음'}</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-8 pt-4 border-t border-neutral-100 flex gap-2">
                  <button 
                    onClick={() => {
                      toggleImageSelection(activeImageDetail);
                      setActiveImageDetail(null);
                    }}
                    className="flex-grow py-3 bg-neutral-950 text-white text-xs font-semibold rounded-lg hover:bg-[#B23B1E] transition-colors"
                  >
                    {selectedImages.some(i => i.id === activeImageDetail.id) ? '보관 드로어에서 제거' : '보관 드로어에 수집'}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Magazine Footer */}
      <footer className="border-t border-neutral-200 bg-neutral-50 px-12 py-8 mt-auto text-center md:text-left flex flex-col md:flex-row items-center justify-between text-xs text-neutral-400">
        <div>
          <span className="font-serif font-bold text-neutral-800 text-sm">Hub Studio 2</span>
          <p className="mt-1">© 2026 Hub Studio 2. 여행과 자연, 아늑한 순간을 기록하는 공동의 콘텐츠 작업실.</p>
        </div>
        <div className="flex gap-4 mt-4 md:mt-0 font-mono">
          <span>APP_SITE_ID: {config?.siteId || 'hub2'}</span>
          <span>·</span>
          <span>PLATFORM ACTIVE</span>
        </div>
      </footer>

      {/* Mobile-First Sticky Bottom Navigation Bar */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#FAF9F6]/95 backdrop-blur-md border-t border-neutral-200/80 px-4 py-2 flex items-center justify-around shadow-[0_-4px_12px_rgba(0,0,0,0.03)] pb-safe">
        <button 
          onClick={() => setCurrentView('magazine')}
          className={`flex flex-col items-center justify-center gap-1 transition-colors ${currentView === 'magazine' ? 'text-[#B23B1E]' : 'text-neutral-500 hover:text-neutral-900'}`}
          style={{ minHeight: '48px', minWidth: '55px' }}
        >
          <Compass className="w-5 h-5" />
          <span className="text-[9px] font-semibold tracking-tight font-sans">피드</span>
        </button>
        <button 
          onClick={() => setCurrentView('studio')}
          className={`flex flex-col items-center justify-center gap-1 transition-colors ${currentView === 'studio' ? 'text-[#B23B1E]' : 'text-neutral-500 hover:text-neutral-900'}`}
          style={{ minHeight: '48px', minWidth: '55px' }}
        >
          <PenTool className="w-5 h-5" />
          <span className="text-[9px] font-semibold tracking-tight font-sans">작업실</span>
        </button>
        <button 
          onClick={() => setCurrentView('agent')}
          className={`flex flex-col items-center justify-center gap-1 transition-colors ${currentView === 'agent' ? 'text-[#B23B1E]' : 'text-neutral-500 hover:text-neutral-900'}`}
          style={{ minHeight: '48px', minWidth: '55px' }}
        >
          <Bot className="w-5 h-5" />
          <span className="text-[9px] font-semibold tracking-tight font-sans">에이전트</span>
        </button>
        <button 
          onClick={() => setCurrentView('webzine')}
          className={`flex flex-col items-center justify-center gap-1 transition-colors ${currentView === 'webzine' ? 'text-[#B23B1E]' : 'text-neutral-500 hover:text-neutral-900'}`}
          style={{ minHeight: '48px', minWidth: '55px' }}
        >
          <Sparkles className="w-5 h-5" />
          <span className="text-[9px] font-semibold tracking-tight font-sans">웹진</span>
        </button>
        <button 
          onClick={() => setCurrentView('projects')}
          className={`flex flex-col items-center justify-center gap-1 transition-colors ${currentView === 'projects' ? 'text-[#B23B1E]' : 'text-neutral-500 hover:text-neutral-900'}`}
          style={{ minHeight: '48px', minWidth: '55px' }}
        >
          <FolderHeart className="w-5 h-5" />
          <span className="text-[9px] font-semibold tracking-tight font-sans">보관함</span>
        </button>
      </div>

    </div>
  );
}

// Fallback illustrations to ensure flawless visual presentation without extra image requests
function CreatorStudioFallback() {
  return (
    <div className="w-24 h-24 text-neutral-300">
      <svg viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-full h-full">
        <rect x="15" y="15" width="70" height="70" rx="8" />
        <line x1="15" y1="35" x2="85" y2="35" />
        <line x1="35" y1="15" x2="35" y2="85" />
        <circle cx="60" cy="60" r="12" className="text-[#B23B1E]/40" fill="currentColor" />
      </svg>
    </div>
  );
}

function BookOpenFallback() {
  return (
    <div className="w-20 h-20 text-neutral-300 mx-auto">
      <svg viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-full h-full">
        <path d="M12 25c10-5 30-5 38 4 8-9 28-9 38-4v56c-10-5-30-5-38 4-8-9-28-9-38-4V25z" />
        <path d="M50 29v56" />
      </svg>
    </div>
  );
}
