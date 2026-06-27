# Aurora DEX Log — mobile web app

Phone-friendly tool for Stephanie to enter EX-10 DEX observations without working in Excel.
Installable (PWA), works offline, exports straight into the Project Aurora workbook.

## Use
1. Open index.html on your phone, then "Add to Home Screen" to install.
2. Add tab: enter each observation. Pick Baseline or After. Split available minutes into the buckets
   until the Reconcile meter turns green. Save stays locked until the window balances.
3. Logs tab: review entries; rows that don't balance show a CHECK badge.
4. Stats / Pareto: the current answer, computed only from what you've entered.
5. Export tab: "Copy After logs" is the recommended Excel handoff because the workbook already has the baseline row. Full CSV is available for archives.
   "Download JSON backup" saves everything; "Import" restores it.

## Built-in honesty rules
- Active speed = the log's own cases/min only. Blank shows "—"; it is never derived from cases ÷ pick-time.
- Planned break is separated from restart overrun.
- Loss bars are normalized min/hr, not raw minutes.
- After n=1 is flagged as a snapshot, not a trend. The 6/10 baseline is locked from deletion.

## Data
Saves on your device automatically (offline-safe). In the Claude in-app preview it may not persist
between sessions — open the downloaded file in your phone browser for full persistence, or host it.


## Cody merge upgrade notes
- Corrected the uploaded file naming into a normal PWA package: index.html, styles.css, app.js, manifest.json, service-worker.js, icon.svg.
- Save is now locked until the observation window balances. If minutes are unclassified, tap "Add to Unclassified" first.
- Export now offers "After logs" separately so Stephanie does not duplicate the locked 6/10 baseline in the workbook.
