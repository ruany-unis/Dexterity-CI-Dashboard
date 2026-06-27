// firebase.js
// Initializes the Firebase app + Firestore with offline persistence.
// Auth lives in services/auth.js. Data access lives in services/database.js.
// Nothing here touches the DOM.

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import { firebaseConfig } from "./config.js";

export const app = initializeApp(firebaseConfig);

// Firestore WITH built-in offline persistence.
// This satisfies "Offline Persistence" natively:
//   - offline reads served from on-device IndexedDB
//   - offline writes queued locally and auto-synced on reconnect
//   - multi-tab consistency without "failed-precondition" errors
// No hand-rolled sync queue is needed on top of this.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
  }),
});

export const auth = getAuth(app);
