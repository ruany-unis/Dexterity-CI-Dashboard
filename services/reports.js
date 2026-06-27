// services/reports.js
// Pure export builders. Operate on the in-memory `logs` array, which is fed live
// from Firestore — so exports always reflect the current cloud data. No DOM here.

// Column order matches the Raw DEX Logs tab in the analysis workbook for paste-in.
export const COLS = [
  ["Date", "date"],
  ["Shift", "shift"],
  ["Period", "period"],
  ["Total Window Min", "totalWindowMin"],
  ["Planned Break Min", "plannedBreakMin"],
  ["Cases", "cases"],
  ["Pallets", "pallets"],
  ["Active Pick Min", "activePickMin"],
  ["Observed Cases per Min", "activeRateCpm"],
  ["Pallet Swap Min", "palletSwapMin"],
  ["Restart Overrun Min", "restartOverrunMin"],
  ["Unclassified/Unlogged Gap Min", "unclassifiedGapMin"],
  ["Equipment Stop Min", "equipmentStopMin"],
  ["Input Stop Min", "inputStopMin"],
  ["Labor/Multitask Min", "laborMultitaskMin"],
  ["Created By", "createdBy"],
  ["Notes", "notes"],
];

export function exportRows(logs, afterOnly) {
  return logs
    .filter((r) => !afterOnly || r.period === "After")
    .map((r) => COLS.map(([, k]) => r[k] ?? ""));
}

export function toCsv(logs, afterOnly) {
  const q = (v) => {
    v = String(v);
    return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  };
  return [
    COLS.map((c) => q(c[0])).join(","),
    ...exportRows(logs, afterOnly).map((r) => r.map(q).join(",")),
  ].join("\n");
}

export function toTsv(logs, afterOnly) {
  return [
    COLS.map((c) => c[0]).join("\t"),
    ...exportRows(logs, afterOnly).map((r) => r.join("\t")),
  ].join("\n");
}

export function buildJsonBackup(logs, savings) {
  return JSON.stringify({ logs, savings: savings || {} }, null, 2);
}
