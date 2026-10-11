# HubStudio2: 로그인 계정으로 직접 저장

브라우저의 Firebase Auth ID 토큰으로 Firestore REST API에 원고를 저장합니다. `FIREBASE_SERVICE_ACCOUNT_JSON`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`는 운영에 필요하지 않습니다. Gemini 키는 Vercel 서버에서만 사용하며 브라우저 번들에 포함하지 않습니다.

## 흐름

- 생성·검수·대화 해석: Firebase ID 토큰을 검증한 Vercel API가 Gemini를 호출하고 결과를 반환합니다. 서버는 원고나 작업을 저장하지 않습니다.
- 초안·수정·발행·삭제: 로그인한 브라우저가 `contentProjects/{원본ID}`에 초안을 저장하고 `publishedContents/{원본ID}`에 발행합니다. ownerId는 현재 Firebase UID, 서비스 표시는 hub2입니다. 발행 시 status=published, visibility=public로 기록하고 상세 주소는 `/blog/{원본ID}`입니다. 기존 경주·홈다이닝 2개의 ID·소유자를 유지합니다.
- 수정은 Firestore updateTime 조건으로 충돌을 검사합니다. 새 초안은 REST POST로 생성하며, 성공 메시지는 REST 저장이 완료된 뒤에만 표시합니다.
- 대화: 기존 reviewMessage 형식으로 메시지별 저장. 화면에서는 최근 50개 메시지를 복원합니다. 서비스·계정별 대화 ID를 분리합니다.
- 에이전트: 브라우저에서 해석→생성/검수/교체/저장/발행을 순차 실행합니다. 자동 발행은 실제 검수 pass일 때만 합니다. 반복 작업 폴링과 서버 백그라운드 저장을 사용하지 않습니다. 실행 중 탭을 닫으면 작업을 계속하지 않습니다. 생성 후 확보된 초안은 후속 단계 실패 시에도 DB에 남습니다.
- 공개 웹진·초기 HTML·사이트맵은 Firestore REST 공개 조회를 사용합니다. 서버 관리자 인증은 사용하지 않습니다. 발행 후 목록은 fresh 조회하고 상세는 원본 문서를 직접 읽을 수 있습니다.

## 환경변수

- GEMINI_API_KEY: 기존 서버 키
- GEMINI_TEXT_MODEL: 선택. 기본 gemini-3.8-flash
- FIREBASE_PROJECT_ID=studio-9240700230-1dd9a
- APP_SITE_ID=hub2
- SITE_URL=https://hubstudio2.vercel.app

환경변수 변경 뒤 Vercel 재배포. `api/index.ts`는 생성·공개 SSR API, `dist`는 브라우저 앱입니다.

## 기존 허브스튜디오1 저장 방식

Firebase 규칙 변경이나 서비스 계정 키는 요구하지 않습니다. 기준 소스는 cyber924/hubstudio의 app/page.tsx, app/lib/agent-jobs.ts, app/lib/review-store.ts입니다. 로그인 Firebase SDK에서 얻은 ID 토큰을 Bearer 헤더에 넣고 동일 공유 프로젝트의 Firestore REST API를 호출합니다. 401/403이면 토큰을 한 번 갱신하고 재시도하며, 계속 거절되면 실제 오류를 표시합니다.

- 초안: contentProjects, recordType=agentDraft, ownerId=현재 UID, contentJson=원고 JSON 문자열.
- 발행글: publishedContents, type=blog, status=published, visibility=public, contentJson=원고 JSON 문자열. hub2 구분 필드와 원본 ID는 보존합니다.
- 대화: contentProjects에 메시지별 문서, recordType=reviewMessage, articleId/ownerId/messageId/role/kind/text/createdAt/resultJson. articleId에 hub2와 UID를 넣어 다른 서비스/계정과 분리합니다. 기존 메시지는 다시 저장하지 않습니다.
- 읽기: 공개 발행글은 visibility=public 조회 후 본인/hub2 필터. 초안·대화는 ownerId와 기존 recordType으로 인증된 조회.
- 수정: Firestore updateTime 사전 조건을 사용하여 동시 수정 충돌을 거절합니다. 발행은 공개 문서 생성과 비공개 초안 제거를 원자적 commit으로 처리합니다.

## 확인

npm run lint / npm run build / npm test. 로그인 후 초안 생성→보관함→새로고침→수정→발행→비로그인 상세 확인. 내 대화 새로고침 복원 및 다른 계정 격리 확인. `/api/config-status`는 storageMode=firebase-client, serverStorageCredentialsRequired=false여야 합니다. 실제 로그인 쓰기 검증은 로컬 테스트로 대체할 수 없습니다.
