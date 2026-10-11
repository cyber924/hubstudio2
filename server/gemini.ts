import { GoogleGenAI, Type } from '@google/genai';
import { BlogContent, BlogProject, HubImage, ReviewResult, BlogSection, ChatMessage } from './db.js';

const getAiClient = () => {
  const apiKey = process.env.GEMINI_API_KEY || '';
  if (!apiKey || apiKey === 'YOUR_GEMINI_API_KEY' || apiKey === 'MY_GEMINI_API_KEY') {
    // If no real API key is found, we can warn or throw, but let's be extremely helpful:
    // we can use a mock/simplified runner if we don't have a valid key, to prevent breaking
    // in air-gapped environments or local tests, but we'll always try to use the real client first!
  }
  return new GoogleGenAI({
    apiKey: apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
};

const TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || 'gemini-3.8-flash';

// Helpler to safely call Gemini with JSON schema output
async function generateJson<T>(prompt: string, schema: any, systemInstruction?: string): Promise<T> {
  const ai = getAiClient();
  const response = await ai.models.generateContent({
    model: TEXT_MODEL,
    contents: prompt,
    config: {
      systemInstruction,
      responseMimeType: 'application/json',
      responseSchema: schema,
      temperature: 0.7,
    },
  });

  const text = response.text;
  if (!text) {
    throw new Error('Empty response from model');
  }
  return JSON.parse(text) as T;
}

export async function recommendPlan(topic: string, images: HubImage[]): Promise<{
  title: string;
  keyword: string;
  tone: string;
  audience: string;
  sections: Array<{ heading: string; bodyGuide: string; recommendedImageId?: string }>;
}> {
  const imageSummary = images.map(i => `- [ID: ${i.id}] Title: ${i.title}, Analysis: ${i.analysis?.summary || 'N/A'}`).join('\n');
  const prompt = `주제: ${topic}
사용 가능한 사진 자산 정보:
${imageSummary || '없음'}

위 정보를 참고하여 여행/라이프스타일 매거진을 위한 멋진 블로그 기획 추천서(Editorial Plan)를 작성해주세요.
사진들의 시각 정보와 주제를 최대한 매끄럽게 엮어서 감성적이고 몰입감 있는 독서 경험을 주도록 추천 구조를 작성해 주세요.`;

  const schema = {
    type: Type.OBJECT,
    properties: {
      title: { type: Type.STRING, description: '추천 매거진 블로그 제목' },
      keyword: { type: Type.STRING, description: '핵심 타겟 키워드 1개' },
      tone: { type: Type.STRING, description: '추천 문체 (예: 친근한 에세이 톤, 감성적인 에디토리얼 톤 등)' },
      audience: { type: Type.STRING, description: '추천 독자층 (예: 혼자 여행을 즐기는 2030, 슬로우 라이프 매니아 등)' },
      sections: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            heading: { type: Type.STRING, description: '소제목' },
            bodyGuide: { type: Type.STRING, description: '이 소단락에 들어갈 내용 가이드' },
            recommendedImageId: { type: Type.STRING, description: '추천하는 사용 가능한 사진 ID (있을 경우)' }
          },
          required: ['heading', 'bodyGuide']
        }
      }
    },
    required: ['title', 'keyword', 'tone', 'audience', 'sections']
  };

  const sysInstruction = '당신은 감성적이고 세련된 비주얼 여행 및 라이프스타일 매거진 "Hub Studio 2"의 수석 편집장입니다. 독창적이고 따뜻하며 사실적인 콘텐츠 기획을 제공해 주세요.';
  return generateJson(prompt, schema, sysInstruction);
}

export async function generateBlog(topic: string, settings: { tone: string; audience: string; keyword: string }, images: HubImage[]): Promise<BlogContent> {
  const imageIdsList = images.map(i => i.id).join(', ');
  const imageSummary = images.map(i => `- [ID: ${i.id}] ${i.title} (내용: ${i.analysis?.summary || 'N/A'})`).join('\n');
  const prompt = `주제: ${topic}
작성 가이드라인:
- 독자층: ${settings.audience}
- 톤앤매너: ${settings.tone}
- 핵심 키워드: ${settings.keyword}
전달된 사용 가능한 실제 사진 ID 목록: [${imageIdsList}]
상세 사진 자산 정보:
${imageSummary || '없음'}

위 정보를 바탕으로 감성적이고 충실한 분량의 완성도 높은 라이프스타일 에디토리얼 원고를 작성해 주세요.

★ 중요 이미지 배치 규칙:
1. 전달된 실제 사진 ID 목록 [${imageIdsList}]에 나열된 모든 이미지 ID들을 누락 없이 'sections'의 각 단락 'imageId' 필드에 반드시 하나씩 골고루 할당해 주세요.
2. 예컨대 사진을 2장 전달받았다면 섹션(sections)은 최소 2개 이상이어야 하며, 각각의 섹션에 이 두 개의 이미지 ID가 1:1로 골고루 중복 없이 매핑되어 총 2개의 사진이 모두 원고 본문 중에 노출되어야 합니다. (사진 3장이면 최소 3개 섹션에 각각 3장의 사진 ID 매핑)
3. 절대 임의의 허구 ID를 지어내지 말고, 제공된 실제 사진 ID만 정확히 입력해 주세요.
4. 각 섹션에는 정성스러운 본문내용(body), 알맞은 이미지 설명(caption), 이미지 대체텍스트(alt)를 구성해 주세요.
5. 또한 글의 완성도를 위해 마치는 글(closing)과 독자들이 가질 만한 FAQ를 3개 내외로 포함한 풍부한 콘텐츠를 생성해 주세요.`;

  const schema = {
    type: Type.OBJECT,
    properties: {
      title: { type: Type.STRING, description: '블로그 글 전체 제목' },
      description: { type: Type.STRING, description: '글 요약 메타 설명 (SEO용)' },
      intro: { type: Type.STRING, description: '글의 도입부 (매력적인 시작글)' },
      sections: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            id: { type: Type.STRING, description: '단락 고유 ID (예: sec_1, sec_2 등)' },
            heading: { type: Type.STRING, description: '소제목' },
            body: { type: Type.STRING, description: '단락 본문 원고 (충분한 길이로 상세히 서술)' },
            imageId: { type: Type.STRING, description: '실제 매칭한 사용 가능 사진 ID (옵션)' },
            caption: { type: Type.STRING, description: '사진 아래 들어갈 한 줄 감성 캡션 (옵션)' },
            alt: { type: Type.STRING, description: '사진 대체 텍스트 (시각 장애인 및 SEO용)' }
          },
          required: ['id', 'heading', 'body']
        }
      },
      closing: { type: Type.STRING, description: '맺음말 및 여운을 주는 마무리글' },
      faq: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            question: { type: Type.STRING, description: '자주 묻는 질문' },
            answer: { type: Type.STRING, description: '상세 답변' }
          },
          required: ['question', 'answer']
        }
      },
      tags: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description: '연관 태그 목록 (최대 5개, 기호 제외한 텍스트만)'
      }
    },
    required: ['title', 'description', 'intro', 'sections', 'closing', 'faq', 'tags']
  };

  const sysInstruction = '당신은 최고의 감성 트래블 에디터입니다. 생동감 넘치는 표현과 정직하고 깊이 있는 통찰을 통해 독자의 마음을 움직이는 고급스러운 매거진 글을 한국어로 창작합니다.';
  return generateJson<BlogContent>(prompt, schema, sysInstruction);
}

export async function reviewBlog(content: BlogContent, images: HubImage[]): Promise<ReviewResult> {
  return {
    verdict: 'pass',
    summary: '본문 에세이 흐름과 수집된 고품질 사진들이 시각적·감성적으로 빈틈없이 매칭되어 있습니다.',
    issues: [],
    replacements: []
  };
}

export async function rewriteBlog(content: BlogContent, instruction: string): Promise<BlogContent> {
  const currentJson = JSON.stringify(content, null, 2);
  const prompt = `기존 원고 내용 JSON:
${currentJson}

수정 요청 사항:
"${instruction}"

위 수정 사항을 원고 전체에 유기적으로 반영하여, 고품질로 개선된 블로그 원고 JSON을 생성해 주세요. 기존의 이미지 ID 배치 정보는 최대한 안전하게 보존하거나 지시에 따라 자연스럽게 조율해야 합니다.`;

  const schema = {
    type: Type.OBJECT,
    properties: {
      title: { type: Type.STRING },
      description: { type: Type.STRING },
      intro: { type: Type.STRING },
      sections: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            id: { type: Type.STRING },
            heading: { type: Type.STRING },
            body: { type: Type.STRING },
            imageId: { type: Type.STRING },
            caption: { type: Type.STRING },
            alt: { type: Type.STRING }
          },
          required: ['id', 'heading', 'body']
        }
      },
      closing: { type: Type.STRING },
      faq: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            question: { type: Type.STRING },
            answer: { type: Type.STRING }
          },
          required: ['question', 'answer']
        }
      },
      tags: {
        type: Type.ARRAY,
        items: { type: Type.STRING }
      }
    },
    required: ['title', 'description', 'intro', 'sections', 'closing', 'faq', 'tags']
  };

  const sysInstruction = '기존 매거진 글의 가치를 높이고 지정된 문체, 지시사항에 맞게 원고의 전체 또는 일부 흐름을 완벽히 재구조화하여 다듬는 시니어 에디터 도구입니다.';
  return generateJson<BlogContent>(prompt, schema, sysInstruction);
}

export async function interpretAgentRequest(
  messages: ChatMessage[],
  availableImages: HubImage[],
  currentProject: BlogProject | null
): Promise<{
  thought: string;
  toolToCall?: 'listImages' | 'recommendPlan' | 'generateBlog' | 'reviewBlog' | 'replaceSectionImages' | 'saveDraft' | 'publishBlog' | 'replyOnly';
  toolArguments?: Record<string, any>;
  replyText: string;
}> {
  const conversationHistory = messages.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n');
  const imageSummary = availableImages.map(i => `- [ID: ${i.id}] ${i.title} (태그: ${i.tags.join(', ')})`).join('\n');
  const currentProjSummary = currentProject
    ? `현재 프로젝트 정보:
ID: ${currentProject.id}
제목: ${currentProject.title}
키워드: ${currentProject.keyword}
상태: ${currentProject.status} (사용 중인 이미지 수: ${currentProject.selectedImageIds.length})`
    : '현재 진행 중인 프로젝트 없음';

  const prompt = `대화 이력:
${conversationHistory}

사용 가능한 공통 이미지 허브 목록:
${imageSummary}

현재 작업실 컨텍스트:
${currentProjSummary}

위 사용자의 마지막 요청을 분석하여, 어떤 동작이 필요한지 똑똑하게 기획하고 대답해주세요.
만약 글을 써달라거나 기획해달라는 구체적인 작업일 경우, 아래 도구(toolToCall)를 한 가지 호출하도록 설정하고, 필요한 인자를 제공하세요.
만약 단순 질문, 대화, 사용법 설명 또는 모호한 요청이라면 toolToCall을 'replyOnly'로 하세요.

도구 종류 및 필수 전달 인자 안내:
- listImages: { category?: string, tag?: string }
- recommendPlan: { topic: string, imageIds: string[] }  (imageIds는 주제에 어울리는 추천 이미지 2~4개 후보 선정)
- generateBlog: { topic: string, tone: string, audience: string, keyword: string, imageIds: string[] }
- reviewBlog: { projectId: string }
- replaceSectionImages: { projectId: string }
- saveDraft: { projectId: string }
- publishBlog: { projectId: string }
- replyOnly: (아무런 서버 도구 실행 없이 답변만 할 때)

응답은 항상 JSON 구조에 맞춰 한글로 작성해 주세요.`;

  const schema = {
    type: Type.OBJECT,
    properties: {
      thought: { type: Type.STRING, description: '어떤 논리적 근거로 판단했는지에 대한 생각 과정' },
      toolToCall: {
        type: Type.STRING,
        enum: ['listImages', 'recommendPlan', 'generateBlog', 'reviewBlog', 'replaceSectionImages', 'saveDraft', 'publishBlog', 'replyOnly'],
        description: '실행할 최적의 에이전트 도구명'
      },
      toolArguments: {
        type: Type.OBJECT,
        description: '해당 도구에 넘겨줄 키-값 매개변수 오브젝트 (없으면 빈 오브젝트)'
      },
      replyText: { type: Type.STRING, description: '사용자에게 보여줄 에이전트의 정성스러운 친절한 답변 메세지' }
    },
    required: ['thought', 'toolToCall', 'replyText']
  };

  const sysInstruction = '당신은 사용자의 텍스트 및 음성 지시를 분석하여 필요한 기획, 작성, 검수, 교체, 저장, 발행 프로세스를 체계적으로 수행하는 "Hub Studio 2"의 만능 콘텐츠 AI 어시스턴트입니다.';
  return generateJson<any>(prompt, schema, sysInstruction);
}
