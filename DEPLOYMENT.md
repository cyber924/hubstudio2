# Hub Studio 2 배포와 원본 데이터 복구

## 원인

기존 Vite 배포는 프론트엔드만 생성하여 `/api/projects`, `/sitemap.xml`, `/robots.txt`가 404였습니다. 원고는 Firestore가 아니라 실행 환경의 `data/db.json`과 메모리에 저장됐습니다. 이 파일은 GitHub에 없습니다. 저장 실패도 로그만 남기므로 발행 성공 표시가 영구 저장을 보장하지 않았습니다.

## Vercel Production 환경변수

- `APP_SITE_ID=hub2`
- `SITE_URL=https://hubstudio2.vercel.app`
- `APP_URL=https://hubstudio2.vercel.app`
- `FIREBASE_PROJECT_ID=studio-9240700230-1dd9a`
- `FIREBASE_SERVICE_ACCOUNT_JSON`: 해당 프로젝트의 서버용 서비스 계정 JSON 전체. **GitHub·채팅·VITE 환경변수에 넣지 않습니다.** 대안은 `FIREBASE_CLIENT_EMAIL` + `FIREBASE_PRIVATE_KEY`입니다.
- `GEMINI_API_KEY`: 기존 서버용 Gemini 키. 공개 조회·보관함에는 필요하지 않습니다.
- `GEMINI_TEXT_MODEL`: 해당 키로 실제 사용 가능한 모델 ID.

환경변수 설정 후 재배포합니다. 서버는 `api/index.ts`에 연결되고 `dist/index.html`, 공개 이미지 메타데이터가 함수에 포함됩니다. 이미지 외부 URL은 기존 이미지 허브를 사용합니다. 글은 `hub2Projects`, 발행 스냅샷은 `hub2PublishedArticles`, 대화는 `hub2AgentThreads`, 작업은 `hub2AgentJobs`에 저장됩니다. 새 컬렉션의 브라우저 직접 접근은 필요하지 않습니다. 서버는 Firebase ID 토큰과 소유자를 검사합니다. 기존 다른 서비스의 Firestore rules를 덮어쓰지 않습니다.

## 기존 발행물 6개 복구

AI Studio/기존 실행 환경에서 **원래 `data/db.json`을 먼저 다운로드하고 백업**하세요. 저장소의 이미지 JSON은 글 백업이 아닙니다. 원본 없이 글이 복구됐다고 판단하면 안 됩니다.

먼저 로컬 환경변수에 서버 인증을 설정하고 아래 명령을 실행합니다.

```sh
npm run migrate:legacy -- --file /absolute/path/original-db.json --expect-published 6
```

미리보기 계정 `dev_user` 또는 `guest`가 있으면 소유자를 확인한 뒤 `--legacy-owner-uid 실제_Firebase_UID`를 추가하세요. 검증 출력의 프로젝트 수·발행 수를 확인한 다음 같은 명령에 `--apply`를 추가합니다. 기존 문서를 덮어쓰지 않으며 프로젝트와 발행 스냅샷은 한 배치로 저장됩니다. 원본 파일은 변경하지 않습니다.

## 완료 조건

`npm ci`, `npm run lint`, `npm run build`, `npm test` 성공. 운영 `/api/health` JSON 200, `/api/projects?status=published` 실제 글 6개, 로그인 계정의 보관함·발행·새로고침 확인. 비로그인 보관함 401. 메인·웹진 초기 HTML에 실제 상세 링크, 상세 초기 HTML에 본문과 canonical·BlogPosting, 없는 글 404, 동적 sitemap/robots 200을 확인합니다. 코드 검증은 데이터 복구와 운영 검증을 대신하지 않습니다.
