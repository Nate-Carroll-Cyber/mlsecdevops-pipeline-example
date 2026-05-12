// Import Firebase app initialization function
import { initializeApp, type FirebaseApp } from 'firebase/app';
// Import Firebase authentication functions and providers
import { getAuth, GoogleAuthProvider, type Auth } from 'firebase/auth';
// Import Firestore database functions
import { getFirestore, type Firestore } from 'firebase/firestore';
import { z } from 'zod';
// Import the Firebase configuration object
import firebaseConfig from '../../firebase-applet-config.json';

const FirebaseConfigSchema = z.object({
  apiKey: z.string().min(1),
  authDomain: z.string().min(1),
  projectId: z.string().min(1),
  appId: z.string().min(1),
  storageBucket: z.string().optional(),
  messagingSenderId: z.string().optional(),
  measurementId: z.string().optional(),
  firestoreDatabaseId: z.string().optional(),
});

// Parse without echoing the (potentially sensitive) config values on failure —
// just report which keys were missing/invalid.
const parsedFirebaseConfigResult = FirebaseConfigSchema.safeParse(firebaseConfig);
if (!parsedFirebaseConfigResult.success) {
  const badKeys = parsedFirebaseConfigResult.error.issues.map((issue) => issue.path.join('.')).join(', ');
  throw new Error(`Invalid firebase-applet-config.json (check: ${badKeys || 'schema'}).`);
}
const parsedFirebaseConfig = parsedFirebaseConfigResult.data;

// The Firebase Web SDK is browser-only — it touches `window`, IndexedDB and popup
// auth flows. This module is still imported during server-side rendering (App.tsx
// pulls it in eagerly), so initialization is deferred to the browser. On the server
// `app`/`auth`/`db`/`googleProvider` are `undefined`; every consumer touches them
// only from a `useEffect` or event handler, which never runs during SSR.
const isBrowser = typeof window !== 'undefined';

const app: FirebaseApp | undefined = isBrowser ? initializeApp(parsedFirebaseConfig) : undefined;

// Initialize and export the Firebase Auth instance
export const auth = (app ? getAuth(app) : undefined) as Auth;
// Initialize and export the Firestore database instance, using the specific database ID if provided
export const db = (app
  ? parsedFirebaseConfig.firestoreDatabaseId
    ? getFirestore(app, parsedFirebaseConfig.firestoreDatabaseId)
    : getFirestore(app)
  : undefined) as Firestore;
// Initialize and export the Google Auth Provider for sign-in
export const googleProvider = (isBrowser ? new GoogleAuthProvider() : undefined) as GoogleAuthProvider;

// Enum defining the types of Firestore operations for error tracking
export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

// Interface defining the structure of the error information object logged during Firestore errors
export interface FirestoreErrorInfo {
  error: string; // The error message
  operationType: OperationType; // The type of operation that failed
  path: string | null; // The Firestore path involved in the operation
  authInfo: {
    userId: string | undefined;
    hasAuthenticatedUser: boolean;
  };
}

// Function to handle and log Firestore errors comprehensively
export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  // Construct the error information object
  const errInfo: FirestoreErrorInfo = {
    // Extract the error message, handling both Error objects and strings
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth?.currentUser?.uid,
      hasAuthenticatedUser: Boolean(auth?.currentUser),
    },
    operationType,
    path
  };

  console.error('Firestore Error:', errInfo);
  throw new Error(`Firestore ${operationType} failed.`);
}
