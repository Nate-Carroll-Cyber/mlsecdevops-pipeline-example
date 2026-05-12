// Import Firebase app initialization function
import { initializeApp } from 'firebase/app';
// Import Firebase authentication functions and providers
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
// Import Firestore database functions
import { getFirestore, doc, setDoc, getDoc, collection, addDoc, serverTimestamp, query, orderBy, limit, onSnapshot } from 'firebase/firestore';
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

// Initialize the Firebase app with the provided configuration
const app = initializeApp(parsedFirebaseConfig);
// Initialize and export the Firebase Auth instance
export const auth = getAuth(app);
// Initialize and export the Firestore database instance, using the specific database ID if provided
export const db = parsedFirebaseConfig.firestoreDatabaseId
  ? getFirestore(app, parsedFirebaseConfig.firestoreDatabaseId)
  : getFirestore(app);
// Initialize and export the Google Auth Provider for sign-in
export const googleProvider = new GoogleAuthProvider();

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
      userId: auth.currentUser?.uid,
      hasAuthenticatedUser: Boolean(auth.currentUser),
    },
    operationType,
    path
  };

  console.error('Firestore Error:', errInfo);
  throw new Error(`Firestore ${operationType} failed.`);
}
