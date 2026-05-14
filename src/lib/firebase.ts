import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { getFirestore, serverTimestamp } from 'firebase/firestore';

import firebaseConfigRaw from '../../firebase-applet-config.json';

// Firebase configuration
// We prioritize VITE_ environment variables for better security and flexibility.
// These MUST be set in the Google AI Studio Settings -> Secrets menu.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || firebaseConfigRaw.apiKey || '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || firebaseConfigRaw.authDomain || '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || firebaseConfigRaw.projectId || '',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || firebaseConfigRaw.storageBucket || '',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || firebaseConfigRaw.messagingSenderId || '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || firebaseConfigRaw.appId || '',
  firestoreDatabaseId: import.meta.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID || firebaseConfigRaw.firestoreDatabaseId || '(default)',
};

if (!firebaseConfig.apiKey) {
  console.warn("Firebase API Key is missing. If you're using Firebase, please set VITE_FIREBASE_API_KEY in secrets.");
}

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Initialize Firestore
// If the database ID is '(default)' or empty, we use the standard initialization
export const db = (firebaseConfig.firestoreDatabaseId && firebaseConfig.firestoreDatabaseId !== '(default)') 
  ? getFirestore(app, firebaseConfig.firestoreDatabaseId)
  : getFirestore(app);

console.log("Firebase initialized. Project:", firebaseConfig.projectId, "Database:", firebaseConfig.firestoreDatabaseId || 'default');

// Connection test as required by integration guidelines
import { doc, getDocFromCache } from 'firebase/firestore';
const testConnection = async () => {
  try {
    // We use a dummy doc to test connection readiness
    await getDocFromCache(doc(db, '_internal_', 'connection_test'));
  } catch (err) {
    // This is expected to fail or just warm up the client
  }
};
testConnection();

export const googleProvider = new GoogleAuthProvider();

export { serverTimestamp };

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export const loginWithGoogle = async () => {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    return result.user;
  } catch (error) {
    console.error("Login failed:", error);
    throw error;
  }
};

export const logout = async () => {
  try {
    await signOut(auth);
  } catch (error) {
    console.error("Logout failed:", error);
    throw error;
  }
};
