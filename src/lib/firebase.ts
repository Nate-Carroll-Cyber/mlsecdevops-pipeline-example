// Firebase Auth-only client. Phase 3 step 4 (5/5) retired Firestore: all data
// moved to Postgres behind /v1/* gateway routes (audit logs, governance config,
// system config, user profiles, KB policies). This file used to also initialize
// Firestore and a `handleFirestoreError` reporter; both are gone.
//
// Auth-model decision is still pending. Today the gateway accepts a shared
// `INTERCEPT_BEARER_TOKEN` plus a spoofable `x-counter-spy-user-id` header;
// Firebase Auth here only gives the browser a real uid + display fields to
// hand the backend. Future options: Firebase ID-token verification on the
// gateway, backend-issued JWTs, or replacing Firebase entirely.

import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, type Auth } from 'firebase/auth';
import { z } from 'zod';
import firebaseConfig from '../../firebase-applet-config.json';

const FirebaseConfigSchema = z.object({
  apiKey: z.string().min(1),
  authDomain: z.string().min(1),
  projectId: z.string().min(1),
  appId: z.string().min(1),
  storageBucket: z.string().optional(),
  messagingSenderId: z.string().optional(),
  measurementId: z.string().optional(),
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
// auth flows. This module is imported eagerly by App.tsx, which is rendered on
// the server, so initialization is deferred to the browser. On the server
// `auth`/`googleProvider` are `undefined`; every consumer touches them only
// from a `useEffect` or event handler, which never runs during SSR.
const isBrowser = typeof window !== 'undefined';

const app: FirebaseApp | undefined = isBrowser ? initializeApp(parsedFirebaseConfig) : undefined;

export const auth = (app ? getAuth(app) : undefined) as Auth;
export const googleProvider = (isBrowser ? new GoogleAuthProvider() : undefined) as GoogleAuthProvider;
