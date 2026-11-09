/**
 * Applications: one per targeted offer, with its folder, its two CV files
 * and the history of its statuses. History entries are what the dashboard
 * counts, so a status is never changed without one.
 */
import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { FindJobError, newId } from "./store.js";
import { localDay, nowIso, windowStart } from "./dates.js";
import { escapeLatex, frenchDate, slugify } from "./text.js";

export const STATUSES = {
  preparee: { label: "CV prêt", order: 0 },
  postulee: { label: "Postulée", order: 1 },
  relancee: { label: "Relancée", order: 2 },
  entretien: { label: "Entretien", order: 3 },
  offre: { label: "Offre reçue", order: 4 },
  refusee: { label: "Refusée", order: 5 },
  abandonnee: { label: "Abandonnée", order: 6 },
};

const EMPTY = { version: 1, items: [] };
const TRACKING_PARAM = /^(utm_|lever-|trk|tracking|refid$|gh_src$|ref$|fbclid$|gclid$|mc_)/i;

/** The offer URL without tracking parameters: what is stored, shown and compared. */
export function cleanUrl(url) {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    for (const key of [...parsed.searchParams.keys()]) if (TRACKING_PARAM.test(key)) parsed.searchParams.delete(key);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return String(url).trim();
  }
}

function sameOffer(a, b) {
  const strip = (u) => cleanUrl(u).replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "").toLowerCase();
  return !!a && !!b && strip(a) === strip(b);
}
const EDITABLE = ["company", "title", "url", "location", "source", "contract", "notes", "contact", "salary", "deadline"];

export function listApplications(ws) {
  return ws.store.read("applications.json", EMPTY).items;
}

export function getApplication(ws, ref) {
  const items = listApplications(ws);
  const found =
    items.find((item) => item.id === ref) ??
    items.find((item) => item.folder === ref || resolve(ws.root, item.folder) === resolve(ref)) ??
    items.filter((item) => item.companySlug === ref).at(-1);
  if (!found) throw new FindJobError("NOT_FOUND", `Candidature inconnue : ${ref}. Voir : find-job list`);
  return found;
}

/**
 * Create the application folder, start its CV from the base template and
 * record it. The CV keeps the required name cv_<entreprise>.tex/.pdf; the
 * folder carries the date and the role so two offers never collide.
 */
export function prepareApplication(ws, input) {
  const company = String(input.company ?? "").trim();
  const title = String(input.title ?? "").trim();
  if (!company) throw new FindJobError("INVALID_INPUT", "--company est obligatoire.");
  if (!title) throw new FindJobError("INVALID_INPUT", "--title est obligatoire.");
  if (!existsSync(ws.baseCvPath)) throw new FindJobError("BASE_CV_MISSING", `CV de base introuvable : ${ws.baseCvPath}`);
  const url = cleanUrl(input.url);
  const existing = listApplications(ws).find((item) => sameOffer(item.url, url));
  if (existing && !input.force)
    throw new FindJobError("ALREADY_TRACKED", `Cette offre est déjà suivie : ${existing.company} — ${existing.title} (${existing.id}, ${existing.folder}). --force pour préparer un second dossier.`, {
      id: existing.id,
      folder: existing.folder,
      status: existing.status,
    });
  const companySlug = slugify(company);
  const base = `${localDay()}_${companySlug}_${slugify(title, { maxLength: 30 })}`;
  // mkdir without `recursive` claims the folder atomically: offers prepared in parallel never share one.
  mkdirSync(ws.outputDir, { recursive: true });
  let folder;
  for (let n = 1; !folder; n++) {
    const candidate = join(ws.outputDir, n === 1 ? base : `${base}_${n}`);
    try {
      mkdirSync(candidate);
      folder = candidate;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }
  const tex = join(folder, `cv_${companySlug}.tex`);
  copyFileSync(ws.baseCvPath, tex);
  const letter = writeLetter(ws, folder, { companySlug, company, title });

  const now = nowIso();
  const application = {
    id: newId("c"),
    company,
    companySlug,
    title,
    url,
    location: input.location ?? "",
    source: input.source ?? sourceFromUrl(url),
    contract: input.contract ?? "",
    deadline: input.deadline ? String(input.deadline).slice(0, 10) : "",
    status: "preparee",
    createdAt: now,
    updatedAt: now,
    appliedAt: null,
    folder: relative(ws.root, folder),
    files: {
      tex: relative(ws.root, tex),
      pdf: relative(ws.root, join(folder, `cv_${companySlug}.pdf`)),
      offer: relative(ws.root, join(folder, "offre.md")),
      analysis: relative(ws.root, join(folder, "analyse.json")),
      letter: relative(ws.root, letter),
      letterPdf: relative(ws.root, letter.replace(/\.tex$/, ".pdf")),
    },
    match: null,
    quality: null,
    notes: input.notes ?? "",
    history: [{ at: now, status: "preparee", note: "CV préparé à partir du modèle" }],
  };
  ws.store.update("applications.json", EMPTY, (data) => {
    data.items.push(application);
  });
  ws.store.log("application.prepared", `CV et lettre en préparation pour ${company} — ${title}`, { id: application.id });
  return application;
}

/** Start lettre_<entreprise>.tex from the letter template, unless it already exists. */
function writeLetter(ws, folder, { companySlug, company, title }) {
  const file = join(folder, `lettre_${companySlug}.tex`);
  if (existsSync(file)) return file;
  const filled = readFileSync(ws.letterTemplatePath, "utf8")
    .replaceAll("__CANDIDAT__", escapeLatex(ws.config.candidate?.name || "[à compléter : prénom nom]"))
    .replaceAll("__ENTREPRISE__", escapeLatex(company))
    .replaceAll("__POSTE__", escapeLatex(title))
    .replaceAll("__DATE__", frenchDate());
  writeFileSync(file, filled);
  return file;
}

/** Add the cover letter to an application prepared before letters existed. */
export function ensureLetter(ws, ref) {
  const target = getApplication(ws, ref);
  const letter = writeLetter(ws, resolve(ws.root, target.folder), target);
  const updated = ws.store.update("applications.json", EMPTY, (data) => {
    const item = data.items.find((candidate) => candidate.id === target.id);
    item.files.letter = relative(ws.root, letter);
    item.files.letterPdf = relative(ws.root, letter.replace(/\.tex$/, ".pdf"));
    return item;
  });
  ws.store.log("application.letter", `Lettre de motivation commencée pour ${target.company}`, { id: target.id });
  return { application: updated, letter };
}

function sourceFromUrl(url) {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function setStatus(ws, ref, status, { note = "", at } = {}) {
  if (!STATUSES[status])
    throw new FindJobError("INVALID_INPUT", `Statut inconnu : ${status} (${Object.keys(STATUSES).join(", ")}).`);
  const target = getApplication(ws, ref);
  const when = at ? new Date(at).toISOString() : nowIso();
  if (Number.isNaN(Date.parse(when))) throw new FindJobError("INVALID_INPUT", `Date invalide : ${at}`);
  const updated = ws.store.update("applications.json", EMPTY, (data) => {
    const item = data.items.find((candidate) => candidate.id === target.id);
    item.status = status;
    item.updatedAt = nowIso();
    if (status === "postulee" && !item.appliedAt) item.appliedAt = when;
    item.history.push({ at: when, status, ...(note ? { note } : {}) });
    // A back-dated status (--at) takes its place in time; the current status stays the one just set.
    item.history.sort((a, b) => new Date(a.at) - new Date(b.at));
    return item;
  });
  ws.store.log("application.status", `${updated.company} : ${STATUSES[status].label}${note ? ` — ${note}` : ""}`, {
    id: updated.id,
    status,
  });
  return updated;
}

export function editApplication(ws, ref, fields) {
  const target = getApplication(ws, ref);
  const changes = Object.fromEntries(Object.entries(fields).filter(([key, value]) => EDITABLE.includes(key) && value !== undefined));
  if (!Object.keys(changes).length)
    throw new FindJobError("INVALID_INPUT", `Rien à modifier. Champs possibles : ${EDITABLE.join(", ")}.`);
  const updated = ws.store.update("applications.json", EMPTY, (data) => {
    const item = data.items.find((candidate) => candidate.id === target.id);
    Object.assign(item, changes, { updatedAt: nowIso() });
    return item;
  });
  ws.store.log("application.edited", `${updated.company} : ${Object.keys(changes).join(", ")} mis à jour`, { id: updated.id });
  return updated;
}

/** Stored by `check`: the last quality report and the offer match score. */
export function recordQuality(ws, ref, { match, quality }) {
  const target = getApplication(ws, ref);
  return ws.store.update("applications.json", EMPTY, (data) => {
    const item = data.items.find((candidate) => candidate.id === target.id);
    item.match = match;
    item.quality = quality;
    item.updatedAt = nowIso();
    return item;
  });
}

export function removeApplication(ws, ref) {
  const target = getApplication(ws, ref);
  ws.store.update("applications.json", EMPTY, (data) => {
    data.items = data.items.filter((item) => item.id !== target.id);
  });
  ws.store.log("application.removed", `${target.company} retirée du suivi (dossier conservé : ${target.folder})`, { id: target.id });
  return target;
}

/** Applications whose status changed to `status` inside [from, to). */
export function eventsWithStatus(items, status, from, to = new Date(8.64e15)) {
  const events = [];
  for (const item of items)
    for (const entry of item.history ?? [])
      if (entry.status === status) {
        const at = new Date(entry.at);
        if (at >= from && at < to) events.push({ item, at });
      }
  return events;
}

export function filterApplications(items, { since, status } = {}) {
  const from = since ? windowStart(since) : null;
  return items.filter((item) => {
    if (status && item.status !== status) return false;
    if (from && new Date(item.appliedAt ?? item.createdAt) < from) return false;
    return true;
  });
}

/** Sent without any answer for `days` days: worth a follow-up. */
export function followUpsDue(items, days = 7, now = new Date()) {
  return items.filter((item) => {
    if (!["postulee", "relancee"].includes(item.status)) return false;
    const last = new Date(item.history.at(-1)?.at ?? item.appliedAt ?? item.createdAt);
    return now - last >= days * 86_400_000;
  });
}
