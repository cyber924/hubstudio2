# HubStudio2: 로그인 계정으로 직접 저장

브라우저의 Firebase Auth + Firestore SDK로 원고를 저장합니다. `FIREBASE_SERVICE_ACCOUNT_JSON`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`는 운영에 필요하지 않습니다. Gemini 키는 Vercel 서버에서만 사용하며 브라우저 번들에 포함하지 않습니다.

## 흐름

- 생성·검수·대화 해석: Firebase ID 토큰을 검증한 Vercel API가 Gemini를 호출하고 결과를 반환합니다. 서버는 원고나 작업을 저장하지 않습니다.
- 초안·수정·발행·삭제: 로그인한 브라우저가 `publishedContents/{원본ID}`를 직접 읽고 저장합니다. ownerId는 현재 Firebase UID, 서비스 표시는 hub2입니다. 발행 시 같은 문서의 status=published, visibility=public로 변경하고 상세 주소는 `/blog/{원본ID}`입니다. 기존 경주·홈다이닝 2개의 ID·소유자를 유지합니다.
- 수정은 Firestore transaction으로 revision 충돌을 검사합니다. 새 초안은 setDoc로 생성하며, 성공 메시지는 SDK 저장이 완료된 뒤에만 표시합니다.
- 대화: `contentProjects/hub2_thread_{UID}_{대화ID}`. recordType=hub2Thread, sourceSite=hub2, payloadJson에 최근 50개 메시지와 최종 작업 결과를 저장합니다. 계정마다 대화 ID가 분리됩니다.
- 에이전트: 브라우저에서 해석→생성/검수/교체/저장/발행을 순차 실행합니다. 자동 발행은 실제 검수 pass일 때만 합니다. 반복 작업 폴링과 서버 백그라운드 저장을 사용하지 않습니다. 실행 중 탭을 닫으면 작업을 계속하지 않습니다. 생성 후 확보된 초안은 후속 단계 실패 시에도 DB에 남습니다.
- 공개 웹진·초기 HTML·사이트맵은 Firestore REST 공개 조회를 사용합니다. 서버 관리자 인증은 사용하지 않습니다. 발행 후 목록은 fresh 조회하고 상세는 원본 문서를 직접 읽을 수 있습니다.

## 환경변수

- GEMINI_API_KEY: 기존 서버 키
- GEMINI_TEXT_MODEL: 선택. 기본 gemini-3.8-flash
- FIREBASE_PROJECT_ID=studio-9240700230-1dd9a
- APP_SITE_ID=hub2
- SITE_URL=https://hubstudio2.vercel.app

환경변수 변경 뒤 Vercel 재배포. `api/index.ts`는 생성·공개 SSR API, `dist`는 브라우저 앱입니다.

## Firestore 권한

기존 공유 DB의 규칙을 통째로 덮어쓰지 않습니다. `publishedContents`와 `contentProjects`에서 로그인 UID의 자기 문서 create/read/update/delete가 허용돼 있어야 합니다. 공개 원고는 visibility=public 문서만 익명 조회를 허용합니다. 업데이트 중 ownerId를 바꿀 수 없어야 합니다. 권한 거절은 화면에 Firebase 저장 권한 오류로 표시하며 샘플·메모리·localStorage 저장으로 대체하지 않습니다.

권한 오류 수정용 추가 규칙은 `firestore/hub2-permissions.rules.fragment`입니다. **GitHub 병합·Vercel 재배포만으로 Firestore 규칙은 배포되지 않습니다.** [공유 프로젝트 규칙 화면](https://console.firebase.google.com/project/studio-9240700230-1dd9a/firestore/databases/-default-/rules)에서 현재 규칙을 백업한 다음, `match /databases/{database}/documents` 블록 안에 추가하고 게시해야 합니다. 이 파일 전체로 기존 규칙을 교체하면 안 됩니다. 다른 서비스와 기존 공개 읽기 규칙을 유지합니다. 이미 같은 이름의 함수가 있다면 중복 없이 병합합니다.

추가 규칙은 로그인 UID와 ownerId가 같은 문서의 읽기를 허용합니다. 쓰기는 허브2 원고와 대화로 제한하고 소유자 변경을 금지합니다. 기존 두 공개 글의 themePersona=hub2 형식도 수정할 수 있습니다. 규칙 시뮬레이터에서 본인 초안 생성/조회/수정/발행/삭제와 대화 생성/수정을 허용하고, 익명 쓰기·다른 UID의 비공개 조회/수정·소유자 변경·hub3/hub4 문서 쓰기를 거절하는지 확인합니다. 여러 match의 허용 조건은 OR로 적용되므로 기존의 넓은 허용 규칙이 있다면 이 조각으로 제한되지 않습니다. 규칙은 실서비스에 아직 적용됐다고 가정하지 않습니다.

## 확인

npm run lint / npm run build / npm test. 로그인 후 초안 생성→보관함→새로고침→수정→발행→비로그인 상세 확인. 내 대화 새로고침 복원 및 다른 계정 격리 확인. `/api/config-status`는 storageMode=firebase-client, serverStorageCredentialsRequired=false여야 합니다. 실제 로그인 쓰기 검증은 로컬 테스트로 대체할 수 없습니다.
