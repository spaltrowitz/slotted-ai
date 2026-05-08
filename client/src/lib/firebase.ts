import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getMessaging, isSupported as isMessagingSupported } from 'firebase/messaging';
import { getPerformance } from 'firebase/performance';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? 'slotted-ai.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? 'slotted-ai',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? 'slotted-ai.firebasestorage.app',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

// Firebase Performance Monitoring (auto-tracks web vitals, network requests)
if (typeof window !== 'undefined' && import.meta.env.PROD) {
  try {
    getPerformance(app);
  } catch {
    // Performance monitoring not available
  }
}

// Firebase Cloud Messaging (lazy init)
let messagingInstance: ReturnType<typeof getMessaging> | null = null;
export const getMessagingInstance = async () => {
  const supported = await isMessagingSupported();
  if (!supported) {
    console.warn('Firebase Messaging is not supported in this browser');
    return null;
  }
  if (!messagingInstance) {
    messagingInstance = getMessaging(app);
  }
  return messagingInstance;
};

// Calendar scope will be requested server-side via a separate OAuth flow.
// Adding it here blocks sign-in unless the OAuth consent screen is verified.
