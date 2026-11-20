/**
 * Convert Google Gemini SDK failures into safe, actionable API errors.
 * Never forward upstream JSON (which can contain internal service metadata) to the browser.
 */
export interface PublicGeminiError extends Error {
  code: string;
  status: number;
}

export function geminiError(code: string, message: string, status = 503): PublicGeminiError {
  return Object.assign(new Error(message), { name: 'GeminiServiceError', code, status });
}

export function isGeminiError(error: unknown): error is PublicGeminiError {
  return error instanceof Error &&
    typeof (error as PublicGeminiError).code === 'string' &&
    (error as PublicGeminiError).code.startsWith('GEMINI_') &&
    typeof (error as PublicGeminiError).status === 'number';
}

export function normalizeGeminiError(error: unknown): PublicGeminiError {
  if (isGeminiError(error)) return error;

  const value = error as { message?: unknown; status?: unknown; code?: unknown } | null;
  const raw = [
    typeof value?.message === 'string' ? value.message : '',
    typeof value?.code === 'string' ? value.code : '',
    typeof error === 'string' ? error : '',
  ].join(' ');
  const upstreamStatus = typeof value?.status === 'number' ? value.status :
    (typeof value?.code === 'number' ? value.code : 0);

  if (/ACCOUNT_STATE_INVALID|bound service account is deleted or disabled/i.test(raw)) {
    return geminiError(
      'GEMINI_ACCOUNT_INACTIVE',
      'Gemini API 키에 연결된 Google 서비스 계정이 비활성화되었거나 삭제되었습니다. 관리자에게 정상 계정으로 발급한 API 키를 Vercel의 GEMINI_API_KEY에 등록하고 재배포하도록 요청하세요.'
    );
  }
  if (/API_KEY_INVALID|API key not valid|invalid API key|API key expired|API key.*leak|key.*revoked/i.test(raw) || upstreamStatus === 401) {
    return geminiError(
      'GEMINI_API_KEY_INVALID',
      'Gemini API 키가 유효하지 않습니다. Google AI Studio에서 키 상태를 확인하고 Vercel의 GEMINI_API_KEY를 갱신해 주세요.'
    );
  }
  if (/RESOURCE_EXHAUSTED|quota exceeded|rate limit/i.test(raw) || upstreamStatus === 429) {
    return geminiError('GEMINI_QUOTA_EXCEEDED', 'Gemini 사용량 한도에 도달했습니다. 할당량과 결제 상태를 확인하고 나중에 다시 시도해 주세요.', 429);
  }
  if (/PERMISSION_DENIED|permission denied/i.test(raw) || upstreamStatus === 403) {
    return geminiError('GEMINI_PERMISSION_DENIED', 'Gemini API 사용 권한이 없습니다. Google Cloud 프로젝트와 API 키 권한을 확인해 주세요.');
  }
  if (/NOT_FOUND|model.*not found|not supported/i.test(raw) || upstreamStatus === 404) {
    return geminiError('GEMINI_MODEL_UNAVAILABLE', '설정한 Gemini 모델에 접근할 수 없습니다. Vercel의 GEMINI_TEXT_MODEL과 모델 이용 권한을 확인해 주세요.');
  }
  if (upstreamStatus === 503 || /UNAVAILABLE|overloaded/i.test(raw)) {
    return geminiError('GEMINI_TEMPORARILY_UNAVAILABLE', 'Gemini 서비스가 일시적으로 응답하지 않습니다. 잠시 후 다시 시도해 주세요.');
  }

  return geminiError('GEMINI_REQUEST_FAILED', 'AI 글 생성 요청에 실패했습니다. Gemini 서버 설정과 Vercel 함수 로그를 확인해 주세요.', 502);
}
