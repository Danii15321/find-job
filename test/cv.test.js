import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseOffer, offerMarkdown } from "../src/cv/offer.js";
import { parseLog, detectEngine } from "../src/cv/latex.js";
import { checkCv, cliches, contacts, evidenceText, figures, guessLanguage, keywordCoverage, baseHook, reviewPosture, studentPosture, texToText } from "../src/cv/quality.js";
import { SAMPLE_CV, cli, latexAvailable, tempWorkspace } from "./helpers.js";

const JOB_PAGE = `<html><head><title>Offre</title>
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebPage"},{"@type":"JobPosting",
"title":"Data Engineer H/F","hiringOrganization":{"@type":"Organization","name":"Acme &amp; Fils"},
"jobLocation":{"@type":"Place","address":{"addressLocality":"Lyon","addressCountry":"FR"}},"employmentType":"FULL_TIME",
"description":"&lt;p&gt;Vous construirez des pipelines &lt;b&gt;Python&lt;/b&gt; et Airflow pour nos équipes produit. ${"Détails du poste. ".repeat(30)}&lt;/p&gt;"}]}
</script></head><body><main><h1>Data Engineer</h1></main></body></html>`;

test("JobPosting JSON-LD is preferred to page text", () => {
  const offer = parseOffer(JOB_PAGE, "https://jobs.example.com/1");
  assert.equal(offer.title, "Data Engineer H/F");
  assert.equal(offer.company, "Acme & Fils");
  assert.equal(offer.location, "Lyon, FR");
  assert.equal(offer.quality, "structured");
  assert.match(offer.description, /pipelines Python et Airflow/);
  assert.match(offerMarkdown({ ...offer, url: "u" }), /^# Data Engineer H\/F — Acme & Fils/);
});

test("pages without readable content are reported as thin", () => {
  const offer = parseOffer("<html><head><title>Chargement…</title></head><body><div id=root></div></body></html>");
  assert.equal(offer.quality, "thin");
  assert.ok(offer.hint);
});

test("LaTeX logs yield errors, pages and overfull boxes", () => {
  const log = [
    "./cv.tex:42: Undefined control sequence.",
    "l.42 \\foo",
    "Overfull \\hbox (12.5pt too wide) in paragraph at lines 30--31",
    "Missing character: There is no ✓ in font cmr10!",
    "Output written on cv.pdf (2 pages, 51234 bytes).",
  ].join("\n");
  const parsed = parseLog(log);
  assert.equal(parsed.errors[0].line, 42);
  assert.equal(parsed.pages, 2);
  assert.equal(parsed.overfull[0].pt, 12.5);
  assert.deepEqual(parsed.missing, ["✓"]);
  assert.equal(detectEngine("\\usepackage{fontspec}").endsWith("latex"), true);
  assert.equal(detectEngine("% !TEX program = lualatex\n\\documentclass{article}"), "lualatex");
  assert.equal(detectEngine("\\documentclass{article}"), "pdflatex");
});

test("text, figures and contacts are extracted from LaTeX", () => {
  const text = texToText("\\textbf{Gain} de 40\\,\\% en 2023 \\\\ \\vspace{3mm} équipe de 6 personnes");
  assert.deepEqual([...figures(text)].sort(), ["2023", "40%", "6personnes"].sort());
  const c = contacts("\\href{mailto:a.b@example.com}{a.b@example.com} 06 12 34 56 78 % 07 00 00 00 00\nlinkedin.com/in/ab");
  assert.deepEqual(c.emails, ["a.b@example.com"]);
  assert.deepEqual(c.phones, ["0612345678"]);
  assert.deepEqual(c.links, ["linkedin.com/in/ab"]);
});

test("keyword coverage weighs essential keywords and accepts alternatives", () => {
  const cov = keywordCoverage("Pipelines Python, intégration continue, C++ et Node.js", ["CI/CD|intégration continue", "Kafka", "C++", "node.js"], ["Python", "Airflow"]);
  assert.deepEqual(cov.mustHaveMissing, ["Airflow"]);
  assert.ok(cov.covered.includes("C++") && cov.covered.includes("node.js"));
  assert.equal(cov.score, Math.round((100 * 5) / 8));
});

const LETTER_BODY = `Votre équipe construit des outils de prévision pour les entrepôts, et c'est précisément le genre de problème qui me fait avancer. Depuis trois ans, je conçois des pipelines de données qui alimentent les tableaux de bord des équipes logistiques, et j'aimerais poursuivre ce travail chez Acme.

Chez Logistique Rhône, j'ai migré l'entrepôt de données vers PostgreSQL et dbt. Le temps de calcul des rapports quotidiens a nettement baissé, et les équipes reçoivent désormais leurs chiffres avant neuf heures. J'ai aussi mis en place des tests de qualité sur les tables critiques, ce qui a évité plusieurs erreurs de livraison.

J'aimerais apporter cette rigueur à vos flux Airflow et apprendre à vos côtés sur les sujets de temps réel que vous décrivez dans l'offre. Je suis disponible dès le mois prochain, à Lyon ou en télétravail partiel.

Je serais heureuse d'en parler avec vous lors d'un échange.

Je vous prie d'agréer, Madame, Monsieur, mes salutations distinguées.`;

test("end to end: prepare, adapt, write the letter, check and track", { skip: !latexAvailable && "pdflatex absent" }, () => {
  const dir = tempWorkspace();
  assert.equal(cli(["init"], dir).code, 0);
  const prepared = cli(["prepare", "--company", "Acme", "--title", "Data Engineer", "--url", "https://jobs.example.com/acme/1"], dir);
  assert.equal(prepared.code, 0, prepared.stderr);
  const { tex, folder, application } = prepared.json;
  const letter = join(folder, "lettre_acme.tex");
  assert.ok(existsSync(letter), "prepare starts the cover letter");
  assert.match(readFileSync(letter, "utf8"), /\\newcommand\{\\entreprise\}\{Acme\}/);

  const unchanged = cli(["check", application.id], dir);
  assert.equal(unchanged.code, 2, "the unwritten letter blocks delivery");
  assert.equal(unchanged.json.checks.find((c) => c.id === "adaptation").ok, false);
  assert.equal(unchanged.json.letter.checks.find((c) => c.id === "brouillon").ok, false);

  const source = readFileSync(tex, "utf8")
    .replace("{\\large Ingénieure données}", "{\\large Data Engineer}")
    .replace("40\\,\\%", "60\\,\\%")
    .replace("06 12 34 56 78", "")
    .replace("\\textbf{Outils :} Git, Docker, Linux", "\\textbf{Outils :} Git, Docker, Linux, Kafka")
    .replace("\\section{Langues}", "\\section{Langues}\nTODO");
  writeFileSync(tex, source);
  writeFileSync(join(folder, "analyse.json"), JSON.stringify({ mustHave: ["Python", "Airflow"], keywords: ["Kafka"] }));
  writeFileSync(
    letter,
    readFileSync(letter, "utf8")
      .replace(/\[à compléter : courriel[^\]]*\]/, "camille.martin@example.com \\quad 06 12 34 56 78 \\quad Lyon")
      .replace("[à compléter : corps de la lettre]", LETTER_BODY),
  );
  const report = cli(["check", application.id], dir);
  assert.equal(report.code, 2, "blocking failures exit with 2");
  const failed = Object.fromEntries(report.json.checks.map((c) => [c.id, c]));
  assert.equal(failed.identite.ok, false);
  assert.equal(failed.brouillon.ok, false);
  assert.deepEqual(failed.faits.items, ["60%"]);
  assert.equal(report.json.score, 100);
  assert.deepEqual(report.json.additions, ["Kafka"], "keywords absent from the base CV are reported");
  assert.equal(failed.accroche.ok, true, "the base CV's hook is kept as is");
  assert.equal(report.json.letter.ok, true, JSON.stringify(report.json.letter.checks.filter((c) => !c.ok)));
  assert.ok(existsSync(join(folder, "qualite.json")));

  writeFileSync(tex, source.replace("TODO", "").replace("\\textbullet{}  \\textbullet{}", "\\textbullet{} 06 12 34 56 78 \\textbullet{}"));
  const fixed = cli(["check", tex], dir);
  assert.equal(fixed.code, 0, JSON.stringify(fixed.json?.checks.filter((c) => !c.ok)));
  for (const file of ["cv_acme.tex", "cv_acme.pdf", "lettre_acme.tex", "lettre_acme.pdf"]) assert.ok(existsSync(join(folder, file)), file);
  assert.equal(fixed.json.pages, 1);
  assert.equal(fixed.json.letter.pages, 1);
  assert.equal(cli(["check", tex], dir).code, 0, "an unchanged, already compiled CV stays deliverable");

  const fixedSource = readFileSync(tex, "utf8");
  writeFileSync(tex, fixedSource.replace(/Ingénieure données avec 5 ans[^\n]*/, "Ingénieure données à Lyon, je rends les données fiables pour les équipes qui en dépendent."));
  const rewritten = cli(["check", tex], dir);
  const accroche = rewritten.json.checks.find((c) => c.id === "accroche");
  assert.equal(accroche.ok, false);
  assert.equal(accroche.level, "bloquant");
  assert.equal(rewritten.code, 2, "a rewritten hook blocks delivery");
  writeFileSync(tex, fixedSource);
  assert.ok(!existsSync(join(folder, "missfont.log")));

  assert.equal(cli(["set", application.id, "--status", "postulee"], dir).code, 0);
  const shown = cli(["show", application.id], dir).json;
  assert.equal(shown.match.score, 100);
  assert.equal(shown.status, "postulee");
  assert.match(cli(["resume"], dir).stdout, /1 envoyée/);
});

test("a CV longer than one page is blocked by default", { skip: !latexAvailable && "pdflatex absent" }, () => {
  const dir = tempWorkspace();
  cli(["init"], dir);
  const { tex } = cli(["prepare", "--company", "Long", "--title", "x"], dir).json;
  writeFileSync(tex, readFileSync(tex, "utf8").replace("\\section{Langues}", "\\newpage\\section{Langues}"));
  const report = cli(["check", tex, "--keywords", "Python"], dir);
  assert.equal(report.json.checks.find((c) => c.id === "pages").ok, false);
  assert.equal(report.code, 2);
});

test("the base hook is found and letters avoid stock phrases", () => {
  const intro = (paragraph) => `\\documentclass{article}\\begin{document}
\\begin{minipage}{\\linewidth}{\\LARGE Camille Martin}\\\\ Élève ingénieur – Informatique\\\\ \\href{mailto:a@b.fr}{a@b.fr}\\end{minipage}

\\vspace{8pt}
{\\color{lightgray}\\hrule height 0.4pt}

${paragraph}

\\section{Compétences} Python
\\end{document}`;
  assert.equal(
    baseHook(intro("Étudiant en informatique à Polytech, recherchant un stage de 5-6 mois en IA Software Engineering (fullStack).")),
    "Étudiant en informatique à Polytech, recherchant un stage de 5-6 mois en IA Software Engineering (fullStack).",
  );
  assert.equal(baseHook(intro("")), null, "no hook: the header is never taken for one");
  assert.match(baseHook(readFileSync(SAMPLE_CV, "utf8")), /^Ingénieure données avec 5 ans/, "a Profile section is the hook");
  assert.deepEqual(cliches("Passionné et dynamique, je me permets de postuler."), ["je me permets", "passionne", "dynamique"]);
  assert.deepEqual(cliches(LETTER_BODY), []);
});

test("a broken document reports the LaTeX error", { skip: !latexAvailable && "pdflatex absent" }, () => {
  const dir = tempWorkspace();
  cli(["init"], dir);
  const { tex } = cli(["prepare", "--company", "Bad", "--title", "x"], dir).json;
  writeFileSync(tex, readFileSync(tex, "utf8").replace("\\section{Profil}", "\\section{Profil}\\undefinedmacro"));
  const result = cli(["build", tex], dir);
  assert.equal(result.code, 2);
  assert.match(result.json.errors[0].message, /Undefined control sequence/);
  assert.equal(result.json.pdf, null);
});

test("errors are structured JSON with a code", () => {
  const dir = tempWorkspace();
  const missing = cli(["status"], dir);
  assert.equal(missing.code, 1);
  assert.equal(missing.error.code, "WORKSPACE_NOT_INITIALIZED");
  const unknown = cli(["frobnicate"], dir);
  assert.equal(unknown.code, 1);
});

test("internships call for a learning posture in the letter", () => {
  assert.equal(studentPosture({ seniority: "stage" }), true);
  assert.equal(studentPosture({ seniority: "internship" }), true);
  assert.equal(studentPosture({ seniority: "senior" }), false);
  assert.equal(studentPosture({ seniority: "senior" }, { posture: "étudiant humble" }), true);
  assert.equal(studentPosture({ seniority: "stage", posture: "confirme" }), false);

  const assertive = reviewPosture("Élève ingénieur, je construis des agents IA. Je cherche un stage pour fiabiliser les agents de Joule Studio.");
  assert.equal(assertive.ok, false);
  assert.ok(assertive.problems.some((p) => p.includes("apprendre")));
  assert.ok(assertive.problems.some((p) => p.includes("je construis")));
  assert.ok(reviewPosture("J’apporte une pratique concrète des LLMs.").problems.some((p) => p.includes("j’apporte")));

  const humble = "Élève ingénieur à Polytech, j’ai découvert les agents IA en les construisant et en les testant sur mes projets. Je souhaite apprendre à les fiabiliser à grande échelle en contribuant aux tests de Joule Studio.";
  assert.deepEqual(reviewPosture(humble).problems, []);
  assert.equal(reviewPosture("Je progresserai aux côtés d’experts de la donnée.").ok, true, "learning from experts is not boasting");
});

test("projects and experience are read apart from skills", () => {
  const body = "\\section{Compétences} Python, Kafka \\section{Projets réalisés} Assistant RAG en FastAPI \\section{Expérience} Stage Agile \\section{Formation} Polytech";
  const text = evidenceText(body);
  assert.match(text, /FastAPI/);
  assert.match(text, /Agile/);
  assert.doesNotMatch(text, /Kafka|Polytech/);
  assert.equal(guessLanguage("Conception de pipelines avec Python et SQL pour les équipes"), "fr");
  assert.equal(guessLanguage("Built pipelines with Python and SQL for the teams"), "en");
});

test("a technology added inside a project blocks delivery", { skip: !latexAvailable && "pdflatex absent" }, () => {
  const dir = tempWorkspace();
  cli(["init"], dir);
  const { tex, folder } = cli(["prepare", "--company", "Proj", "--title", "Data Engineer"], dir).json;
  writeFileSync(join(folder, "analyse.json"), JSON.stringify({ keywords: ["Kafka"], mustHave: ["Python"] }));
  const source = readFileSync(tex, "utf8");
  writeFileSync(tex, source.replace("traitant 2 millions", "Kafka traitant 2 millions"));
  const report = cli(["check", tex], dir);
  const projets = report.json.checks.find((c) => c.id === "projets");
  assert.equal(projets.ok, false);
  assert.equal(projets.level, "bloquant");
  assert.deepEqual(projets.items, ["Kafka"]);
  assert.equal(report.code, 2);
  writeFileSync(tex, source.replace("\\textbf{Outils :} Git, Docker, Linux", "\\textbf{Outils :} Git, Docker, Linux, Kafka"));
  const fixed = cli(["check", tex], dir).json.checks;
  assert.equal(fixed.find((c) => c.id === "projets").ok, true, "the skills section is the right place");
  assert.equal(fixed.find((c) => c.id === "projets-texte").ok, true);
});

test("portals that refuse active content get a variant without links", { skip: !latexAvailable && "pdflatex absent" }, () => {
  const dir = tempWorkspace();
  cli(["init"], dir);
  const { application, folder } = cli(["prepare", "--company", "Strict", "--title", "Data Engineer"], dir).json;
  const normal = cli(["build", application.id], dir).json;
  assert.ok(normal.active.links > 0, "the CV links its e-mail and LinkedIn");
  assert.equal(normal.active.openAction, 1);

  const plain = cli(["build", application.id, "--sans-liens"], dir);
  assert.equal(plain.code, 0, plain.stderr);
  assert.equal(plain.json.cv.active.total, 0);
  assert.equal(plain.json.letter.active.total, 0);
  assert.equal(plain.json.cv.pages, 1);
  for (const file of ["cv_strict_sans_liens.pdf", "lettre_strict_sans_liens.pdf", "cv_strict.pdf"]) assert.ok(existsSync(join(folder, file)), file);
  assert.equal(readFileSync(join(folder, "cv_strict.tex"), "utf8"), readFileSync(SAMPLE_CV, "utf8"), "the source is untouched");

  const shown = cli(["resume", "--json"], dir).json.applications[0];
  assert.match(shown.plain.cv, /cv_strict_sans_liens\.pdf$/);
  assert.match(shown.plain.letter, /lettre_strict_sans_liens\.pdf$/);
});
