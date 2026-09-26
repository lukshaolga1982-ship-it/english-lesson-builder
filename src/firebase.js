import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { getAnalytics, isSupported } from 'firebase/analytics';

const firebaseConfig = {
  apiKey: 'AIzaSyDK1qnkw0ierODsWMaSrJRt5KMPgV40Coc',
  authDomain: 'english-lesson-builder.firebaseapp.com',
  projectId: 'english-lesson-builder',
  storageBucket: 'english-lesson-builder.firebasestorage.app',
  messagingSenderId: '695778376023',
  appId: '1:695778376023:web:290e6f3462656dfe60e612',
  measurementId: 'G-V592VX8PSG',
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

if (typeof window !== 'undefined') {
  isSupported().then((supported) => {
    if (supported) getAnalytics(app);
  }).catch(() => {});
}
