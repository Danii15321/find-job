/**
 * A workspace is the user's job-search folder: the base CV (.tex), one
 * folder per application under `candidatures/`, and the memory in `.find-job/`.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FindJobError, MEMORY_DIR, Store, newId } from "./store.js";
import { defaultStartWeek, isoWeek, nowIso, parseDay, weekStart } from "./dates.js";

export const DEFAULT_CONFIG = {
  version: 1,
  candidate: { name: "" },
  baseCv: "cv.tex",
  outputDir: "candidatures",
  maxPages: 1,
  engine: "auto",
  startWeek: null,
};

const BUILTIN_LETTER = fileURLToPath(new URL("../../templates/lettre.tex", import.meta.url));

const EMPTY_PROFILE = {
  version: 1,
  facts: [],
  preferences: {},
};

/** Nearest folder, from `start` upwards, that holds a find-job memory. */
export function findRoot(start = process.cwd()) {
  let current = resolve(start);
  for (;;) {
    if (existsSync(join(current, MEMORY_DIR, "config.json"))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export function openWorkspace(start) {
  const explicit = start ?? process.env.FIND_JOB_WORKSPACE;
  const root = explicit ? resolve(explicit) : findRoot();
  if (!root || !existsSync(join(root, MEMORY_DIR, "config.json")))
    throw new FindJobError(
      "WORKSPACE_NOT_INITIALIZED",
      `Aucun espace find-job trouvé${explicit ? ` dans ${resolve(explicit)}` : " ici ni dans les dossiers parents"}. Lancez : find-job init --cv mon_cv.tex`,
    );
  return new Workspace(root);
}

/** .tex files at the root that look like a complete document. */
export function detectBaseCv(root) {
  return readdirSync(root)
    .filter((name) => name.endsWith(".tex") && !name.startsWith("cv_") && !name.startsWith("lettre"))
    .filter((name) => /\\documentclass/.test(readFileSync(join(root, name), "utf8")));
}

export function initWorkspace(root, { cv, name } = {}) {
  root = resolve(root);
  const store = new Store(root);
  if (store.exists())
    throw new FindJobError("WORKSPACE_EXISTS", `${root} est déjà un espace find-job. Rien n’a été modifié.`);
  let baseCv = cv;
  if (!baseCv) {
    const candidates = detectBaseCv(root);
    if (candidates.length !== 1)
      throw new FindJobError(
        candidates.length ? "BASE_CV_AMBIGUOUS" : "BASE_CV_MISSING",
        candidates.length
          ? `Plusieurs CV possibles (${candidates.join(", ")}). Précisez : find-job init --cv FICHIER.tex`
          : "Aucun CV .tex trouvé à la racine. Placez-y votre CV puis : find-job init --cv FICHIER.tex",
        { candidates },
      );
    baseCv = candidates[0];
  }
  const absolute = resolve(root, baseCv);
  if (!existsSync(absolute)) throw new FindJobError("BASE_CV_MISSING", `CV introuvable : ${absolute}`);
  if (!/\\documentclass/.test(readFileSync(absolute, "utf8")))
    throw new FindJobError("BASE_CV_INVALID", `${baseCv} ne contient pas de \\documentclass : ce n’est pas un document LaTeX complet.`);
  const config = {
    ...DEFAULT_CONFIG,
    candidate: { name: name ?? guessName(readFileSync(absolute, "utf8")) },
    baseCv: relative(root, absolute),
    startWeek: defaultStartWeek(),
    createdAt: nowIso(),
  };
  store.withLock(() => {
    store.write("config.json", config);
    store.write("applications.json", { version: 1, items: [] });
    store.write("plans.json", { version: 1, weeks: {} });
    store.write("profile.json", EMPTY_PROFILE);
  });
  ensureGitignore(root);
  store.log("workspace.init", `Espace créé avec le CV de base ${config.baseCv}`);
  return new Workspace(root);
}

/** Build products are local; the memory and the CVs themselves are worth versioning. */
function ensureGitignore(root) {
  const file = join(root, ".gitignore");
  const wanted = [".find-job/.lock", ".find-job/*.tmp", ".find-job/cache/", "**/.build/"];
  const current = existsSync(file) ? readFileSync(file, "utf8") : "";
  const missing = wanted.filter((line) => !current.split("\n").includes(line));
  if (missing.length)
    writeFileSync(file, `${current}${current && !current.endsWith("\n") ? "\n" : ""}${missing.join("\n")}\n`);
}

/** Best effort from common CV macros: \name{First}{Last}, \author{…}, or a large heading. */
function guessName(tex) {
  const moderncv = /\\name\{([^}]*)\}\{([^}]*)\}/.exec(tex);
  if (moderncv) return `${moderncv[1]} ${moderncv[2]}`.trim();
  const author = /\\author\{([^}]*)\}/.exec(tex);
  if (author) return author[1].trim();
  const big = /\\(?:Huge|huge|LARGE)\s*(?:\\textbf\{|\\bfseries\s*)?([A-ZÀ-Ý][\p{L} .'-]{2,40})/u.exec(tex);
  return big ? big[1].trim() : "";
}

export class Workspace {
  constructor(root) {
    this.root = root;
    this.store = new Store(root);
  }

  get config() {
    const config = { ...DEFAULT_CONFIG, ...this.store.read("config.json", DEFAULT_CONFIG) };
    config.startWeek ??= defaultStartWeek(config.createdAt ? new Date(config.createdAt) : new Date());
    return config;
  }

  get baseCvPath() {
    return resolve(this.root, this.config.baseCv);
  }

  /** The workspace's own lettre.tex when present, otherwise the template shipped with find-job. */
  get letterTemplatePath() {
    const own = join(this.root, "lettre.tex");
    return existsSync(own) ? own : BUILTIN_LETTER;
  }

  get outputDir() {
    return resolve(this.root, this.config.outputDir);
  }

  profile() {
    return this.store.read("profile.json", EMPTY_PROFILE);
  }

  /** A fact the user confirmed about themselves, usable in any CV. */
  addFact(text, tags = []) {
    if (!String(text).trim()) throw new FindJobError("INVALID_INPUT", "Le fait est vide.");
    const fact = { id: newId("f"), text: String(text).trim(), tags, at: nowIso() };
    this.store.update("profile.json", EMPTY_PROFILE, (profile) => {
      profile.facts.push(fact);
    });
    this.store.log("profile.fact", `Fait confirmé : ${fact.text}`, { id: fact.id });
    return fact;
  }

  removeFact(id) {
    const removed = this.store.update("profile.json", EMPTY_PROFILE, (profile) => {
      const index = profile.facts.findIndex((fact) => fact.id === id);
      if (index < 0) throw new FindJobError("NOT_FOUND", `Fait inconnu : ${id}`);
      return profile.facts.splice(index, 1)[0];
    });
    this.store.log("profile.fact-removed", `Fait retiré : ${removed.text}`, { id });
    return removed;
  }

  setPreference(key, value) {
    if (!/^[a-z][a-z0-9_-]*$/i.test(key)) throw new FindJobError("INVALID_INPUT", `Clé de préférence invalide : ${key}`);
    this.store.update("profile.json", EMPTY_PROFILE, (profile) => {
      profile.preferences ??= {};
      if (value === "" || value === null) delete profile.preferences[key];
      else profile.preferences[key] = value;
    });
    this.store.log("profile.preference", `Préférence ${key} : ${value || "retirée"}`);
    return this.profile().preferences;
  }

  setConfig(key, value) {
    const allowed = { maxPages: "number", engine: ["auto", "pdflatex", "lualatex", "xelatex"], candidateName: "string", outputDir: "string", startWeek: "week" };
    // startWeek accepts an ISO week (2026-W44) or any date of that week (2026-10-26).
    if (key === "startWeek") {
      try {
        value = /^\d{4}-\d{2}-\d{2}$/.test(value) ? isoWeek(parseDay(value)) : (weekStart(value), value);
      } catch (error) {
        throw new FindJobError("INVALID_INPUT", error.message);
      }
    }
    if (!(key in allowed)) throw new FindJobError("INVALID_INPUT", `Réglage inconnu : ${key} (${Object.keys(allowed).join(", ")}).`);
    const rule = allowed[key];
    if (rule === "number" && !(Number(value) >= 1)) throw new FindJobError("INVALID_INPUT", `${key} doit être un nombre ≥ 1.`);
    if (Array.isArray(rule) && !rule.includes(value)) throw new FindJobError("INVALID_INPUT", `${key} : ${rule.join(" | ")}`);
    this.store.update("config.json", DEFAULT_CONFIG, (config) => {
      if (key === "candidateName") config.candidate = { ...config.candidate, name: value };
      else config[key] = rule === "number" ? Number(value) : value;
    });
    this.store.log("config", `Réglage ${key} = ${value}`);
    return this.config;
  }
}
