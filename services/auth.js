// services/auth.js
// Authentication layer. Today: anonymous. Built so Google / Email / Azure AD / SSO
// drop in later without touching the UI — the app only calls the functions exported
// here, never the Firebase auth SDK directly.

import { auth, db } from "../firebase.js";
import {
  signInAnonymously,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import {
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { COLLECTIONS } from "../config.js";

let _user = null;

// Resolves once we have a signed-in user (uid). The app awaits this before
// reading/writing so nothing races ahead of authentication.
export const authReady = new Promise((resolve, reject) => {
  onAuthStateChanged(auth, (u) => {
    if (u) {
      _user = u;
      resolve(u);
    }
  });
  signInAnonymously(auth).catch((err) => {
    console.error("[auth] anonymous sign-in failed:", err);
    reject(err);
  });
});

export function currentUid() {
  return _user?.uid || null;
}

export function deviceLabel() {
  // Lightweight, non-PII device hint for the audit trail. No localStorage.
  const p = (navigator.userAgentData?.platform || navigator.platform || "web").toString();
  return p.slice(0, 24);
}

// ---- App-level operator profile (name + role), stored per device/uid ----------
// This replaces the old localStorage USER_KEY. Each device's anonymous uid maps to
// the operator profile chosen on the portal screen. Roles live in Firestore now,
// which is exactly where Security-Rules-based role enforcement will read them later.
export async function getProfile() {
  await authReady;
  const ref = doc(db, COLLECTIONS.users, currentUid());
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data() : null;
}

export async function saveProfile({ name, role }) {
  await authReady;
  const ref = doc(db, COLLECTIONS.users, currentUid());
  await setDoc(
    ref,
    {
      name,
      role,
      uid: currentUid(),
      device: deviceLabel(),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

export async function clearProfile() {
  await authReady;
  await deleteDoc(doc(db, COLLECTIONS.users, currentUid()));
}

// ---- Future provider hooks (intentionally inert until enabled) ----------------
// To upgrade, enable the provider in the Firebase Console and implement here; the
// rest of the app stays unchanged.
//   export async function signInWithGoogle() { ... GoogleAuthProvider ... }
//   export async function signInWithEmail(email, pw) { ... }
//   export async function signInWithAzureAD() { ... OAuthProvider('microsoft.com') ... }
