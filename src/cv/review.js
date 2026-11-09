/**
 * Full review of one application, CV and cover letter together. Shared by
 * `find-job check` and the dashboard editor so both judge a file the same way.
 */
import { readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { recordQuality } from "../core/applications.js";
import { checkCv, checkLetter, writeReport } from "./quality.js";

export function letterPathFor(ws, tex, application) {
  return application?.files.letter ? resolve(ws.root, application.files.letter) : join(dirname(tex), basename(tex).replace(/^cv_/, "lettre_"));
}

export function reviewApplication(ws, { tex, application, keywords, mustHave, rebuild = true, log = true }) {
  const profile = ws.profile();
  const report = checkCv({
    texPath: tex,
    baseCvPath: ws.baseCvPath,
    maxPages: ws.config.maxPages,
    engine: ws.config.engine,
    facts: profile.facts.map((fact) => fact.text),
    preferences: profile.preferences,
    keywords,
    mustHave,
    rebuild,
  });
  // The cover letter is part of every application: same folder, lettre_<entreprise>.tex.
  report.letter = checkLetter({
    texPath: letterPathFor(ws, tex, application),
    company: application?.company ?? basename(tex, ".tex").replace(/^cv_/, ""),
    cvSource: readFileSync(tex, "utf8"),
    resourceDirs: [resolve(ws.baseCvPath, "..")],
    engine: ws.config.engine,
    rebuild,
    student: report.posture === "etudiant",
  });
  const ok = report.ok && report.letter.ok;
  const reportFile = writeReport(report);
  if (application) {
    const failed = [
      ...report.checks.filter((c) => !c.ok && c.level !== "info").map((c) => c.id),
      ...report.letter.checks.filter((c) => !c.ok).map((c) => `lettre:${c.id}`),
    ];
    recordQuality(ws, application.id, {
      match: report.keywords.score == null ? null : { score: report.keywords.score, covered: report.keywords.covered.length, missing: report.keywords.missing, additions: report.additions },
      quality: { verdict: ok ? report.verdict : "à corriger", ok, pages: report.pages, letter: report.letter.verdict, at: report.at, failed },
    });
    if (log)
      ws.store.log("cv.checked", `CV et lettre ${application.company} : ${ok ? report.verdict : "à corriger"}${report.score != null ? ` · ${report.score} %` : ""}`, { id: application.id });
  }
  return { ...report, ok, report: reportFile };
}
