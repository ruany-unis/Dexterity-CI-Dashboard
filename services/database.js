// services/database.js
// ALL Firestore reads/writes go through here. UI (app.js) calls these functions and
// never imports firebase/firestore directly.

import { db } from "../firebase.js";
import { authReady, currentUid, deviceLabel } from "./auth.js";
import { COLLECTIONS } from "../config.js";
import {
  collection,
  doc,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  where,
  orderBy,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

// Maps raw Firestore/network errors to short, friendly UI strings.
export function friendlyError(err) {
  const code = (err && err.code) || "";
  if (!navigator.onLine) return "Offline — your entry is saved and will sync.";
  if (code.includes("permission-denied")) return "Permission denied — check your access.";
  if (code.includes("unavailable")) return "Cloud unavailable — working offline, will sync.";
  if (code.includes("unauthenticated")) return "Sign-in issue — reconnecting…";
  return "Something went wrong, but your data is safe.";
}

// Order rows by numeric client timestamp (ms). serverTimestamp() is null on an
// offline write until it syncs, which would make offline rows sort wrong / jump on
// reconnect. Client epoch-ms is stable the instant the row is created.
function withMeta(record, isNew) {
  const now = Date.now();
  const meta = {
    updatedAt: now,
    updatedByUid: currentUid(),
    device: deviceLabel(),
  };
  if (isNew) {
    meta.createdAt = typeof record.createdAt === "number" ? record.createdAt : now;
    meta.createdByUid = currentUid();
  }
  return { ...record, ...meta };
}

// Best-effort audit entry. Never blocks or throws into the UI.
async function writeAudit(action, collectionName, docId) {
  try {
    await addDoc(collection(db, COLLECTIONS.auditLog), {
      action,
      collection: collectionName,
      docId: docId || null,
      uid: currentUid(),
      device: deviceLabel(),
      at: Date.now(),
    });
  } catch (e) {
    console.warn("[audit] skipped:", e?.code || e);
  }
}

// ============================ dexLogs (today's module) ========================
const dexRef = () => collection(db, COLLECTIONS.dexLogs);

// Realtime listener. cb(records, meta) fires on every change — including your own
// local writes (instantly, meta.pending=true) — so the UI refreshes with no page
// reload and no manual sync button. Returns an unsubscribe function.
export function subscribeDexLogs(cb) {
  let unsub = () => {};
  authReady
    .then(() => {
      const q = query(dexRef(), orderBy("createdAt", "asc"));
      unsub = onSnapshot(
        q,
        (snap) => {
          const records = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          cb(records, {
            fromCache: snap.metadata.fromCache,
            pending: snap.metadata.hasPendingWrites,
          });
        },
        (err) => {
          console.error("[dexLogs] subscribe error:", err);
          cb([], { fromCache: true, pending: false, error: friendlyError(err) });
        }
      );
    })
    .catch((err) => cb([], { fromCache: true, pending: false, error: friendlyError(err) }));
  return () => unsub();
}

export async function getDexLogs() {
  await authReady;
  const snap = await getDocs(query(dexRef(), orderBy("createdAt", "asc")));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function saveDexLog(record) {
  await authReady;
  const ref = await addDoc(dexRef(), withMeta(record, true));
  writeAudit("create", COLLECTIONS.dexLogs, ref.id);
  return ref.id;
}

export async function updateDexLog(id, record) {
  await authReady;
  await updateDoc(doc(db, COLLECTIONS.dexLogs, id), withMeta(record, false));
  writeAudit("update", COLLECTIONS.dexLogs, id);
}

export async function deleteDexLog(id) {
  await authReady;
  await deleteDoc(doc(db, COLLECTIONS.dexLogs, id));
  writeAudit("delete", COLLECTIONS.dexLogs, id);
}

// Delete every doc whose period === 'After'.
export async function clearAfterLogs() {
  await authReady;
  const snap = await getDocs(query(dexRef(), where("period", "==", "After")));
  const batch = writeBatch(db);
  snap.forEach((d) => batch.delete(d.ref));
  await batch.commit();
  writeAudit("clearAfter", COLLECTIONS.dexLogs);
}

// Wipe all dexLogs (baseline is a client constant, never stored).
export async function resetAllLogs() {
  await authReady;
  const snap = await getDocs(dexRef());
  const batch = writeBatch(db);
  snap.forEach((d) => batch.delete(d.ref));
  await batch.commit();
  writeAudit("resetAll", COLLECTIONS.dexLogs);
}

// Replace all dexLogs with the given records (used by JSON import). Atomic.
export async function replaceAllDexLogs(records) {
  await authReady;
  const existing = await getDocs(dexRef());
  const batch = writeBatch(db);
  existing.forEach((d) => batch.delete(d.ref));
  records.forEach((r) => batch.set(doc(dexRef()), withMeta(r, true)));
  await batch.commit();
  writeAudit("import", COLLECTIONS.dexLogs);
}

// ============================ settings / savings ==============================
const savingsDoc = () => doc(db, COLLECTIONS.settings, "savings");

export function subscribeSavings(cb) {
  let unsub = () => {};
  authReady
    .then(() => {
      unsub = onSnapshot(
        savingsDoc(),
        (snap) => cb(snap.exists() ? snap.data() : {}),
        (err) => {
          console.error("[savings] subscribe error:", err);
          cb({});
        }
      );
    })
    .catch(() => cb({}));
  return () => unsub();
}

export async function saveSavings(obj) {
  await authReady;
  await setDoc(savingsDoc(), { ...obj, updatedAt: Date.now(), updatedByUid: currentUid() }, { merge: true });
  writeAudit("update", COLLECTIONS.settings, "savings");
}

export async function getSavings() {
  await authReady;
  const snap = await getDoc(savingsDoc());
  return snap.exists() ? snap.data() : {};
}

// ============================ connectivity badge ==============================
export function onConnectivityChange(cb) {
  const emit = () => cb(navigator.onLine);
  window.addEventListener("online", emit);
  window.addEventListener("offline", emit);
  emit();
  return () => {
    window.removeEventListener("online", emit);
    window.removeEventListener("offline", emit);
  };
}

// ============================ future modules ==================================
// Generic store so future collections (actionItems, kaizens, pareto, metrics,
// reports, receiving, shipping) plug in with no new data-layer code.
export function collectionStore(name) {
  const ref = collection(db, name);
  return {
    name,
    subscribe(cb, sortField = "createdAt") {
      let unsub = () => {};
      authReady.then(() => {
        const q = sortField ? query(ref, orderBy(sortField, "asc")) : ref;
        unsub = onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
      });
      return () => unsub();
    },
    async add(record) {
      await authReady;
      const r = await addDoc(ref, withMeta(record, true));
      writeAudit("create", name, r.id);
      return r.id;
    },
    async update(id, record) {
      await authReady;
      await updateDoc(doc(db, name, id), withMeta(record, false));
      writeAudit("update", name, id);
    },
    async remove(id) {
      await authReady;
      await deleteDoc(doc(db, name, id));
      writeAudit("delete", name, id);
    },
  };
}

export const stores = {
  actionItems: collectionStore(COLLECTIONS.actionItems),
  kaizens: collectionStore(COLLECTIONS.kaizens),
  pareto: collectionStore(COLLECTIONS.pareto),
  metrics: collectionStore(COLLECTIONS.metrics),
  reports: collectionStore(COLLECTIONS.reports),
  receiving: collectionStore(COLLECTIONS.receiving),
  shipping: collectionStore(COLLECTIONS.shipping),
};
