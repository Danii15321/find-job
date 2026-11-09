/**
 * Calendar helpers. Days and weeks are local to the user's machine: a
 * routine done at 23:30 belongs to that evening, not to the next UTC day.
 */

const DAY = 86_400_000;

export const WINDOWS = {
  "24h": { label: "24 heures", ms: DAY },
  "48h": { label: "48 heures", ms: 2 * DAY },
  "7j": { label: "7 jours", ms: 7 * DAY },
  "30j": { label: "30 jours", ms: 30 * DAY },
  "90j": { label: "3 mois", ms: 90 * DAY },
};

export function pad(n) {
  return String(n).padStart(2, "0");
}

/** YYYY-MM-DD in local time. */
export function localDay(date = new Date()) {
  const d = new Date(date);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Local midnight of a YYYY-MM-DD string. */
export function parseDay(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(`Date invalide : ${day} (attendu AAAA-MM-JJ).`);
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(day, n) {
  const d = parseDay(day);
  d.setDate(d.getDate() + n);
  return localDay(d);
}

/** ISO 8601 week id, e.g. 2026-W43. */
export function isoWeek(date = new Date()) {
  const d = new Date(date);
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayNr = (target.getDay() + 6) % 7; // Monday = 0
  target.setDate(target.getDate() - dayNr + 3); // Thursday of this week
  const firstThursday = new Date(target.getFullYear(), 0, 4);
  const diff = (target - firstThursday) / DAY;
  const week = 1 + Math.round((diff - 3 + ((firstThursday.getDay() + 6) % 7)) / 7);
  return `${target.getFullYear()}-W${pad(week)}`;
}

/** Monday (YYYY-MM-DD) of an ISO week id. */
export function weekStart(weekId) {
  const match = /^(\d{4})-W(\d{2})$/.exec(weekId);
  if (!match) throw new Error(`Semaine invalide : ${weekId} (attendu AAAA-Www, ex. 2026-W43).`);
  const [, y, w] = match.map(Number);
  const jan4 = new Date(y, 0, 4);
  const monday = new Date(jan4);
  monday.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7) + (w - 1) * 7);
  return localDay(monday);
}

export function weekDays(weekId) {
  const start = weekStart(weekId);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export function shiftWeek(weekId, n) {
  return isoWeek(parseDay(addDays(weekStart(weekId), 7 * n)));
}

/** ISO weekday: Monday = 1 … Sunday = 7. */
export function isoWeekday(day) {
  return ((parseDay(day).getDay() + 6) % 7) + 1;
}

/**
 * Week numbers of the search itself: week 1 is `startWeek`, the week the user
 * starts searching; earlier weeks give 0 or less.
 */
export function searchWeekNumber(weekId, startWeek) {
  return Math.round((parseDay(weekStart(weekId)) - parseDay(weekStart(startWeek))) / (7 * DAY)) + 1;
}

/** "S3" or "3" → ISO week id relative to `startWeek`; ISO ids pass through. */
export function resolveWeek(value, startWeek) {
  const match = /^S?(-?\d{1,3})$/i.exec(String(value).trim());
  if (!match) return value;
  return shiftWeek(startWeek, Number(match[1]) - 1);
}

/** On a weekend the search starts the coming Monday, otherwise this week. */
export function defaultStartWeek(date = new Date()) {
  const d = new Date(date);
  const weekday = (d.getDay() + 6) % 7; // Monday = 0
  if (weekday >= 5) d.setDate(d.getDate() + 7 - weekday);
  return isoWeek(d);
}

export function windowStart(windowId, now = new Date()) {
  const window = WINDOWS[windowId];
  if (!window) throw new Error(`Période inconnue : ${windowId} (${Object.keys(WINDOWS).join(", ")}).`);
  return new Date(now.getTime() - window.ms);
}

export function nowIso() {
  return new Date().toISOString();
}
