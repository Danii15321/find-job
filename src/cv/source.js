/**
 * Edit an application's LaTeX from the dashboard: read the source, save it
 * without overwriting a change made elsewhere (VS Code, the agent), compile
 * it and review the application, like Overleaf's save-and-recompile.
 */
import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { getApplication } from "../core/applications.js";
import { FindJobError } from "../core/store.js";
import { PLAIN_SUFFIX, buildPdf } from "./latex.js";
import { letterPathFor, reviewApplication } from "./review.js";

const DOCS = ["cv", "letter"];
const MAX_SOURCE = 512_000;

function sourcePath(ws, application, doc) {
  if (!DOCS.includes(doc)) throw new FindJobError("INVALID_INPUT", `Document inconnu : ${doc} (cv ou letter).`);
  const cv = resolve(ws.root, application.files.tex);
  return doc === "cv" ? cv : letterPathFor(ws, cv, application);
}

export function readSource(ws, ref, doc = "cv") {
  const application = getApplication(ws, ref);
  const path = sourcePath(ws, application, doc);
  if (!existsSync(path)) throw new FindJobError("NOT_FOUND", `${relative(ws.root, path)} n’existe pas${doc === "letter" ? " : find-job letter ID la crée" : ""}.`);
  return { doc, path: relative(ws.root, path), content: readFileSync(path, "utf8"), mtimeMs: statSync(path).mtimeMs };
}

/** Writes only if the file is still the version the editor loaded (`mtimeMs`), unless `force`. */
export function writeSource(ws, ref, doc, content, { mtimeMs, force = false } = {}) {
  const application = getApplication(ws, ref);
  const path = sourcePath(ws, application, doc);
  if (typeof content !== "string") throw new FindJobError("INVALID_INPUT", "Contenu LaTeX manquant.");
  if (content.length > MAX_SOURCE) throw new FindJobError("INVALID_INPUT", "Fichier trop volumineux pour l’éditeur.");
  if (!/\\documentclass/.test(content)) throw new FindJobError("INVALID_INPUT", "Le document doit garder sa ligne \\documentclass.");
  if (existsSync(path) && !force && mtimeMs != null && Math.abs(statSync(path).mtimeMs - mtimeMs) > 1)
    throw new FindJobError("SOURCE_CHANGED", `${relative(ws.root, path)} a été modifié ailleurs depuis son ouverture.`, {
      content: readFileSync(path, "utf8"),
      mtimeMs: statSync(path).mtimeMs,
    });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, content);
  renameSync(temporary, path);
  return { application, path, mtimeMs: statSync(path).mtimeMs };
}

/** Save, compile, refresh a "sans liens" variant if one exists, then review the whole application. */
export function saveAndCompile(ws, ref, doc, content, options = {}) {
  const { application, path, mtimeMs } = writeSource(ws, ref, doc, content, options);
  const buildOptions = { resourceDirs: [resolve(ws.baseCvPath, "..")], engine: ws.config.engine };
  const build = buildPdf(path, buildOptions);
  // A stale variant would be worse than none: rebuild it with the new content.
  const plainPdf = path.replace(/\.tex$/, `${PLAIN_SUFFIX}.pdf`);
  const plain = build.ok && existsSync(plainPdf) ? buildPdf(path, { ...buildOptions, plain: true }).ok : null;

  const cvTex = resolve(ws.root, application.files.tex);
  const review = build.ok ? reviewApplication(ws, { tex: cvTex, application, rebuild: false, log: false }) : null;
  const target = doc === "cv" ? review : review?.letter;
  return {
    doc,
    mtimeMs,
    build: {
      ok: build.ok,
      pdf: build.pdf ? relative(ws.root, build.pdf) : null,
      pages: build.pages,
      durationMs: build.durationMs,
      errors: build.errors,
      overfull: build.overfull.filter((box) => box.pt > 5),
      missingCharacters: build.missingCharacters,
      ...(build.tail ? { tail: build.tail } : {}),
    },
    plain,
    review: review && {
      ok: review.ok,
      verdict: review.ok ? review.verdict : "à corriger",
      score: review.score,
      problems: (target?.checks ?? []).filter((check) => !check.ok && check.level !== "info"),
      otherDocOk: doc === "cv" ? review.letter.ok : review.ok,
    },
  };
}
