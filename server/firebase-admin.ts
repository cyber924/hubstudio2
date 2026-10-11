import 'dotenv/config';
import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

export const projectId = process.env.FIREBASE_PROJECT_ID || 'studio-9240700230-1dd9a';

function adminApp() {
  const existing = getApps().find(app => app.name === 'hubstudio2');
  if (existing) return existing;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const email = process.env.FIREBASE_CLIENT_EMAIL;
  const key = process.env.FIREBASE_PRIVATE_KEY;
  const account = raw ? JSON.parse(raw) : email && key ? {
    projectId, clientEmail: email, privateKey: key.replace(/\\n/g, '\n'),
  } : null;
  if (account && (account.project_id || account.projectId) !== projectId) {
    throw Object.assign(new Error('Firebase 프로젝트와 서비스 계정이 일치하지 않습니다.'), { status: 503 });
  }
  if (!account && !process.env.GOOGLE_APPLICATION_CREDENTIALS && !process.env.FIRESTORE_EMULATOR_HOST) {
    throw Object.assign(new Error('서버 Firebase 인증 설정이 필요합니다. FIREBASE_SERVICE_ACCOUNT_JSON을 확인하세요.'), { status: 503 });
  }
  const app = initializeApp({ projectId, credential: account ? cert(account) : applicationDefault() }, 'hubstudio2');
  getFirestore(app).settings({ ignoreUndefinedProperties: true });
  return app;
}

export const adminDb = () => getFirestore(adminApp());
export const adminAuth = () => getAuth(adminApp());
