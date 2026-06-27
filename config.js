// config.js
// Single place for app configuration. Nothing app-specific should be hardcoded
// anywhere else.

// ---- 1) FIREBASE WEB APP CONFIG ----------------------------------------------
// Firebase Console > Project settings > "Your apps" > Web app > SDK setup.
// These values are NOT secrets — they ship to every browser. Access is controlled
// by Firestore Security Rules + Authentication, not by hiding this object.
export const firebaseConfig = {
  apiKey: "AIzaSyDJ-DZ1vpS50pJVoRLEDdsGnIwdPIOtOTk",
  authDomain: "project-aurora-c8ce0.firebaseapp.com",
  projectId: "project-aurora-c8ce0",
  storageBucket: "project-aurora-c8ce0.firebasestorage.app",
  messagingSenderId: "1066164866163",
  appId: "1:1066164866163:web:6a6bcabbbfece2838bee06",
  measurementId: "G-EF219C72D0",
};

// ---- 2) TEMPORARY ADMIN PASSWORD ---------------------------------------------
// NOTE (read this): a password stored in client-side JS on a static site is NOT
// real security — anyone can open DevTools and read it. It only gates casual
// access. It is kept here, in ONE place, per the brief. The real fix is
// role-based access via Firebase Auth custom claims or a users/{uid}.role field
// checked in Security Rules. See services/auth.js getProfile() for where role
// already lives in Firestore, ready for that upgrade.
export const ADMIN_PASSWORD = "Nacuchis1";

// ---- 3) FIRESTORE COLLECTION NAMES -------------------------------------------
// Declared centrally so future modules reference names from one place.
export const COLLECTIONS = {
  users: "users",
  dexLogs: "dexLogs",
  actionItems: "actionItems",
  kaizens: "kaizens",
  pareto: "pareto",
  metrics: "metrics",
  reports: "reports",
  receiving: "receiving",
  shipping: "shipping",
  settings: "settings",
  auditLog: "auditLog",
};
