# Project Aurora — Firebase / Firestore Edition

DEX observation assistant, now backed by **Cloud Firestore** instead of Local Storage.
Data syncs in real time across every device. The UI, colors, layout, screens, and
workflows are unchanged. Still a static site — deploys straight to **GitHub Pages**,
no Node, no Express, no backend server.

## File map

```
project_aurora/
├── index.html            # unchanged except: <script type="module"> + one Offline badge
├── styles.css            # unchanged except: appended .net-badge rule
├── app.js                # UI + analytics; storage/auth/boot swapped to services (now a module)
├── config.js             # NEW — Firebase config, admin password, collection names (one place)
├── firebase.js           # NEW — Firebase init + Firestore offline persistence
├── services/
│   ├── auth.js           # NEW — anonymous auth (upgradeable), operator profile in users/{uid}
│   ├── database.js       # NEW — all dexLogs/settings/audit reads+writes, connectivity, errors
│   └── reports.js        # NEW — CSV/TSV/JSON export builders (moved out of app.js)
├── manifest.json         # unchanged
├── service-worker.js     # bumped to v2; caches the new files + Firebase SDK for offline
└── assets/               # unchanged
```

## What changed (and what did not)

- **No Local Storage for operational data.** `dexLogs` and savings live in Firestore.
  The operator profile (name/role) moved from `localStorage` to `users/{uid}`.
- **Real-time sync** via `onSnapshot()` — log on a phone, it appears on the laptop with
  no refresh and no sync button.
- **Offline** is handled by Firestore's built-in `persistentLocalCache` (in `firebase.js`):
  entries made offline are queued and auto-sync on reconnect. The header shows an
  **Offline** badge while disconnected. No hand-rolled sync queue.
- **Anonymous auth** runs automatically; the auth layer is modular so Google / Email /
  Azure AD / SSO drop into `services/auth.js` later without touching the UI.
- **UI untouched** beyond two additive changes: the `app.js` script tag became a module,
  and a small Offline badge was added to the existing header.

### Data model note (deliberate)
The dexLogs document keeps the app's existing field names (`totalWindowMin`,
`plannedBreakMin`, `palletSwapMin`, `restartOverrunMin`, `equipmentStopMin`,
`inputStopMin`, `laborMultitaskMin`, `unclassifiedGapMin`, `activePickMin`,
`activeRateCpm`, `cases`, `pallets`, `date`, `shift`, `period`, `notes`, `createdBy`).
Renaming to the spec's `…Minutes` variants would mean rewriting `calc()`, `aggregate()`,
`CATS`, and the CSV column map, and would break the analysis-workbook paste-in — net
negative. Audit fields are **added** on top by the service layer: `createdAt`,
`updatedAt`, `createdByUid`, `updatedByUid`, `device`.

## Firestore Security Rules (required)

Aurora is a shared team logger: every device (each with its own anonymous uid) must see
the same `dexLogs`. So data is shared across authenticated users, not scoped per-uid:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{collection}/{docId} {
      allow read, write: if request.auth != null;
    }
  }
}
```

Authenticated-but-open. Appropriate for a single-purpose internal tool. Tighten per
collection when real accounts and the `users.role` field drive access.

## Admin password — read this

`ADMIN_PASSWORD` is in `config.js`, in one place, as requested. Be clear-eyed: a password
in client-side JS on a public static site is **not** real security — anyone can read it in
DevTools. It only blocks casual clicks. The real control is role enforcement in Security
Rules using `users/{uid}.role` (already stored). Treat the password as a placeholder.

## Deploy (GitHub Pages)

1. Commit the whole folder to the Pages branch (root or `/docs`).
2. In the Firebase Console: **Authentication → Sign-in method → Anonymous → Enable**, and
   publish the Security Rules above.
3. Open the Pages URL. Anonymous sign-in is automatic; pick a name/role on the portal.

GitHub Pages serves over HTTPS, which Firebase Auth and service workers both require.

## Verify

- Open on two devices. Log an observation on one → it appears on the other with no refresh.
- Turn off wifi → the **Offline** badge shows; you can still log entries.
- Turn wifi back on → queued entries sync automatically.
- Export (CSV/TSV/JSON) reflects the live Firestore data; column order matches the workbook.

## Future modules

`config.js → COLLECTIONS` and `services/database.js → collectionStore()` already define and
support `actionItems`, `kaizens`, `pareto`, `metrics`, `reports`, `receiving`, `shipping`,
plus `auditLog` (written on every create/update/delete). A new module is a new collection
name + UI — no new data-layer code.

## Easy Mode (added on top, no logic removed)

Two entry modes share the same Firestore data and analytics.

**Easy Mode** — a guided, large-button flow for associates and first-time users:
1. *What happened?* (7 plain-language buttons)
2. *How long did it last?* (1/2/5/10/15 min or Custom)
3. *How many?* (cases / pallets, optional)
4. *Note* (optional; photo attach is stubbed for later)
5. *Save*

Plain labels map to the existing technical fields — the database is unchanged:

| Easy button | Stored field |
|---|---|
| DEX was running | `activePickMin` |
| Changing pallet | `palletSwapMin` |
| DEX did not restart after break | `restartOverrunMin` |
| Box / pallet problem | `inputStopMin` |
| Machine / sensor problem | `equipmentStopMin` |
| I was pulled away | `laborMultitaskMin` |
| I don't know | `unclassifiedGapMin` |

Each Easy save writes one self-balancing segment: `totalWindowMin = duration`,
`plannedBreakMin = 0`, the chosen field = duration. Reports and Pareto aggregate these
segments exactly as before. Because a segment always balances, associates cannot create
an unbalanced row — so Easy Mode shows only friendly prompts, never reconcile math.

**Advanced Mode** — the original full entry screen (window, planned break, all loss
buckets, reconcile meter, Baseline/After) is untouched.

**Role defaults:** Associate → Easy only. Lead → Easy (can switch). Manager → Advanced,
lands on Reports. Admin → Advanced, all tools. Roles with both modes get a "Switch to
Advanced / Easy" button on the entry screens. The 🤖/manager dashboards, Pareto, and
exports all read the same technical fields regardless of which mode created the row.

## Data-integrity tagging (Easy vs Advanced)

Every saved `dexLogs` document now carries:

```
entryMode:   "Easy" | "Advanced"
entryType:   "Event Segment" | "Observation Window"
source:      "Manual Entry"        (baseline: "System")
createdRole: <the role that created it>
```

Easy saves are tagged `Easy` / `Event Segment`; Advanced saves and the baseline are
`Advanced` / `Observation Window`. Tags are set on create only — editing an Advanced
window never rewrites them, so `createdRole` stays the true creator.

### How reports use the tags
- **Pareto / top issue:** all logs (events + windows). Floor events count toward loss tracking.
- **Productivity** — cases per available hour, cases/window, pallets/window, baseline-vs-after,
  and savings evidence — uses **Observation Windows only**. Easy event segments cannot distort
  these numbers.
- The Reports header now states the data in view: e.g. *"3 Productivity observation windows ·
  7 Floor event observations — Top logged issue: Pallet swap."* KPIs show window count and
  floor-event count separately.

### One migration note
Legacy rows with no `entryType` (anything saved before this change, including earlier test
data) are treated as **Observation Windows**, since every pre-tagging entry was a full window.
Before go-live, reset test data (Admin → Reset) so all real data is tagged from day one —
otherwise old untagged Easy test rows would be counted as productivity windows.

## Edit routing & report labeling (final pass)

**Editing respects the entry mode.** Tapping Edit on a log routes by its tags:
`entryMode === "Easy"` or `entryType === "Event Segment"` opens the **Easy** guided
editor; everything else opens the **Advanced** editor. Updates send only the segment/window
fields, so `entryMode`, `entryType`, `source`, `createdRole`, and `createdBy` are never
overwritten on edit. Warehouse Associates are never pushed into Advanced — the Edit button
is shown on their Easy events and hidden on Observation Windows they can't edit.

**Labeling.** The Pareto view is titled **"Top issues by logged minutes"** (all logs —
Easy events + Advanced windows). The Reports comparison stays **"Productivity observation
windows"** and continues to use windows only for cases-per-available-hour, cases/window,
pallets/window, baseline-vs-after, and savings evidence. Each log card also shows an
**Event** or **Window** tag so the source of every row is visible at a glance.
