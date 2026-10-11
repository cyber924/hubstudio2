import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyDEpFAsf1fI65xXklKYsukAWFYw5bzaHyc",
  authDomain: "studio-9240700230-1dd9a.firebaseapp.com",
  projectId: "studio-9240700230-1dd9a",
  storageBucket: "studio-9240700230-1dd9a.appspot.com",
};

// Initialize Firebase client-side SDK safely
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
export const auth = getAuth(app);
export const db = getFirestore(app);
