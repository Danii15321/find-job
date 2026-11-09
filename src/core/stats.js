/**
 * Dashboard figures for the rolling windows (24 h, 48 h, 7, 30 and 90 days)
 * and the snapshot used by `resume` and the local interface.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { WINDOWS, isoWeek, localDay, searchWeekNumber, windowStart } from "./dates.js";
import { STATUSES, eventsWithStatus, followUpsDue, listApplications } from "./applications.js";
import { lessons, readPlans, weekHistory, weekProgress } from "./plans.js";

/** Bucket size per window: hours for a day or two, days for a month, weeks beyond. */
const BUCKETS = { "24h": 3_600_000, "48h": 4 * 3_600_000, "7j": 86_400_000, "30j": 86_400_000, "90j": 7 * 86_400_000 };

export function windowStats(items, windowId, now = new Date()) {
  const from = windowStart(windowId, now);
  // Inclusive of `now`: an event written in the same millisecond still counts.
  const until = new Date(now.getTime() + 1);
  const count = (status) => eventsWithStatus(items, status, from, until).length;
  const applied = eventsWithStatus(items, "postulee", from, until);
  const answered = applied.filter(({ item }) => ["entretien", "offre", "refusee"].includes(item.status)).length;
  const scores = items
    .filter((item) => item.match?.score != null && new Date(item.createdAt) >= from)
    .map((item) => item.match.score);

  // Buckets follow the calendar (hour, local day, ISO week) and end with the current one.
  const size = BUCKETS[windowId];
  const n = Math.ceil(WINDOWS[windowId].ms / size);
  const end = bucketEnd(now, size);
  const starts = Array.from({ length: n }, (_, i) => shift(end, size, i - n));
  const series = starts.map((start) => ({ start: start.toISOString(), applied: 0, prepared: 0 }));
  for (const [status, field] of [["postulee", "applied"], ["preparee", "prepared"]])
    for (const { at } of eventsWithStatus(items, status, starts[0], end)) {
      let index = n - 1;
      while (index > 0 && at < starts[index]) index--;
      series[index][field] += 1;
    }

  return {
    window: windowId,
    label: WINDOWS[windowId].label,
    from: from.toISOString(),
    prepared: count("preparee"),
    applied: applied.length,
    followups: count("relancee"),
    interviews: count("entretien"),
    offers: count("offre"),
    refusals: count("refusee"),
    responseRate: applied.length ? Math.round((100 * answered) / applied.length) : null,
    averageMatch: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
    bucketMs: size,
    series,
  };
}

/** Start of the bucket after the one containing `now`. */
function bucketEnd(now, size) {
  const d = new Date(now);
  if (size < 86_400_000) {
    d.setMinutes(0, 0, 0);
    d.setHours(Math.floor(d.getHours() / (size / 3_600_000)) * (size / 3_600_000));
  } else {
    d.setHours(0, 0, 0, 0);
    if (size > 86_400_000) d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Monday
  }
  return shift(d, size, 1);
}

/** Calendar-aware shift: days and weeks keep local midnight across DST changes. */
function shift(date, size, count) {
  const d = new Date(date);
  if (size < 86_400_000) d.setTime(d.getTime() + count * size);
  else d.setDate(d.getDate() + count * (size / 86_400_000));
  return d;
}

function existing(ws, path) {
  return existsSync(resolve(ws.root, path)) ? path : null;
}

export function allWindows(items, now = new Date()) {
  return Object.fromEntries(Object.keys(WINDOWS).map((id) => [id, windowStats(items, id, now)]));
}

export function pipeline(items) {
  return Object.fromEntries(Object.keys(STATUSES).map((status) => [status, items.filter((item) => item.status === status).length]));
}

/** Everything the interface and `resume` need, in one read of the memory. */
export function snapshot(ws, now = new Date()) {
  const items = listApplications(ws);
  const weeks = readPlans(ws);
  const currentWeek = isoWeek(now);
  const { startWeek } = ws.config;
  // The week worth showing: the current one, or week 1 while the search has not started.
  const focusWeek = currentWeek < startWeek ? startWeek : currentWeek;
  const progress = Object.fromEntries(Object.values(weeks).map((plan) => [plan.week, weekProgress(plan, items, now)]));
  return {
    generatedAt: now.toISOString(),
    today: localDay(now),
    workspace: { root: ws.root, ...ws.config },
    statuses: STATUSES,
    applications: items.map((item) => ({
      ...item,
      pdfReady: existsSync(resolve(ws.root, item.files.pdf)),
      letterReady: !!item.files.letterPdf && existsSync(resolve(ws.root, item.files.letterPdf)),
      // Variants for portals that refuse active content, when they were built.
      plain: {
        cv: existing(ws, item.files.pdf.replace(/\.pdf$/, "_sans_liens.pdf")),
        letter: item.files.letterPdf ? existing(ws, item.files.letterPdf.replace(/\.pdf$/, "_sans_liens.pdf")) : null,
      },
    })),
    pipeline: pipeline(items),
    windows: allWindows(items, now),
    followUpsDue: followUpsDue(items, 7, now).map((item) => item.id),
    currentWeek,
    startWeek,
    focusWeek,
    searchWeek: searchWeekNumber(currentWeek, startWeek),
    plans: weeks,
    progress,
    history: weekHistory(weeks, items, now),
    lessons: lessons(weeks),
    profile: ws.profile(),
    journal: ws.store.journal(80),
  };
}
