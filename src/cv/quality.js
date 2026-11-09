/**
 * Quality gate of an adapted CV. Blocking checks must pass before the CV is
 * handed over; warnings are points the agent reviews with the user (a figure
 * absent from the base CV may be an invention). The offer match score is the
 * weighted share of the offer's keywords that the CV really contains.
 */
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { FindJobError } from "../core/store.js";
import { normalize } from "../core/text.js";
import { buildPdf, lastBuild } from "./latex.js";

export function stripComments(source) {
  return source.replace(/(^|[^\\])%.*$/gm, "$1");
}

export function splitDocument(source) {
  const clean = stripComments(source);
  const start = clean.indexOf("\\begin{document}");
  if (start < 0) return { preamble: clean, body: "" };
  const end = clean.indexOf("\\end{document}", start);
  return { preamble: clean.slice(0, start), body: clean.slice(start + 16, end < 0 ? undefined : end) };
}

/** Rough plain text of LaTeX: good enough to search words, figures and contacts. */
export function texToText(fragment) {
  return fragment
    .replace(/\\\\(\[[^\]]*\])?/g, "\n")
    .replace(/\\(begin|end)\{[^}]*\}/g, " ")
    .replace(/\\(vspace|hspace|setlength|addtolength|includegraphics|geometry|color|textcolor|definecolor|fontsize|columnratio|setcounter)\*?(\[[^\]]*\])?\{[^}]*\}/g, (match, command) =>
      command === "textcolor" ? match : " ",
    )
    .replace(/\\textcolor\{[^}]*\}/g, " ")
    .replace(/\\([&%$#_{}~^])/g, "$1")
    .replace(/\\[,;:! ]/g, " ")
    .replace(/\\[a-zA-Z@]+\*?(\[[^\]]*\])?/g, " ")
    .replace(/[{}]/g, " ")
    .replace(/~/g, " ")
    .replace(/--+/g, "–")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

const FIGURE_PATTERNS = [
  /\b(?:19|20)\d{2}\b/g,
  /\b\d+(?:[.,]\d+)?\s?(?:%|k€|K€|M€|€|\$|k\$|M\$)/g,
  /\+?\b\d+(?:[.,]\d+)?\s?(?:ans|an|years?|mois|months?|personnes|people|clients?|utilisateurs|users|projets|projects|collaborateurs|équipes?|teams?|pays|countries|sites|millions?|milliards?)\b/gi,
];

export function figures(text) {
  const found = new Set();
  // "40 %" and "40%" are the same figure.
  for (const pattern of FIGURE_PATTERNS) for (const [match] of text.matchAll(pattern)) found.add(match.replace(/\s+/g, "").toLowerCase());
  return found;
}

export function contacts(source) {
  const text = stripComments(source).replace(/\\([_@&%#])/g, "$1");
  const emails = [...new Set(text.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) ?? [])];
  const phones = [...new Set((text.match(/\+?\d[\d .\-()]{7,}\d/g) ?? []).map((p) => p.replace(/\D/g, "")).filter((p) => p.length >= 9 && p.length <= 15))];
  const links = [...new Set((text.match(/(?:linkedin\.com|github\.com|gitlab\.com)\/[\w\-/%.]+/gi) ?? []).map((l) => l.toLowerCase().replace(/\/$/, "")))];
  return { emails, phones, links };
}

function sections(body) {
  return [...body.matchAll(/\\(?:section|cvsection|cvsect|sectiontitle)\*?\{([^}]*)\}/g)].map(([, title]) => title.trim());
}

const EVIDENCE = /proj|r[ée]alis|exp[ée]rience|work|employment|parcours/i;
const NOT_EVIDENCE = /comp[ée]tence|skill|formation|education|langue|language|int[ée]r[êe]t|loisir|hobb/i;

/**
 * Plain text of the sections that can be checked against reality: projects
 * (on GitHub, online) and work experience. Skills, education and hobbies are excluded.
 */
export function evidenceText(body) {
  const marks = [...body.matchAll(/\\(?:section|cvsection|cvsect|sectiontitle)\*?\{([^}]*)\}/g)];
  return marks
    .map((mark, index) => ({ title: mark[1], content: body.slice(mark.index + mark[0].length, marks[index + 1]?.index ?? body.length) }))
    .filter(({ title }) => EVIDENCE.test(title) && !NOT_EVIDENCE.test(title))
    .map(({ content }) => texToText(content))
    .join("\n");
}

/** "fr" or "en" from common words: enough to tell a translated CV from the base. */
export function guessLanguage(text) {
  const words = ` ${normalize(text)} `;
  const count = (list) => list.reduce((n, w) => n + (words.split(` ${w} `).length - 1), 0);
  return count(["the", "and", "with", "of", "to", "for"]) > count(["le", "la", "les", "et", "des", "avec", "pour"]) ? "en" : "fr";
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** "Python" or "CI/CD|intégration continue" (alternatives). */
export function hasKeyword(normalizedText, keyword) {
  return String(keyword)
    .split("|")
    .map((alternative) => normalize(alternative))
    .filter(Boolean)
    .some((alternative) => new RegExp(`(^|[^a-z0-9])${escapeRegExp(alternative)}($|[^a-z0-9+#])`).test(normalizedText));
}

export function keywordCoverage(text, keywords = [], mustHave = []) {
  const normalizedText = normalize(text);
  const all = [...new Set([...mustHave, ...keywords])];
  const covered = all.filter((keyword) => hasKeyword(normalizedText, keyword));
  const missing = all.filter((keyword) => !covered.includes(keyword));
  const weight = (keyword) => (mustHave.includes(keyword) ? 2 : 1);
  const total = all.reduce((sum, keyword) => sum + weight(keyword), 0);
  const got = covered.reduce((sum, keyword) => sum + weight(keyword), 0);
  return {
    score: total ? Math.round((100 * got) / total) : null,
    covered,
    missing,
    mustHaveMissing: mustHave.filter((keyword) => missing.includes(keyword)),
  };
}

function lineSet(text) {
  return new Set(text.split("\n").map((line) => line.trim()).filter(Boolean));
}

function readAnalysis(path) {
  if (!path || !existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new FindJobError("INVALID_ANALYSIS", `${path} n’est pas un JSON valide : ${error.message}`);
  }
}

export function checkCv({ texPath, baseCvPath, maxPages = 2, engine = "auto", facts = [], preferences = {}, analysisPath, keywords, mustHave, rebuild = true }) {
  if (!existsSync(texPath)) throw new FindJobError("NOT_FOUND", `Fichier introuvable : ${texPath}`);
  const source = readFileSync(texPath, "utf8");
  const base = existsSync(baseCvPath) ? readFileSync(baseCvPath, "utf8") : "";
  const analysis = readAnalysis(analysisPath ?? join(dirname(texPath), "analyse.json"));
  const wanted = {
    keywords: keywords ?? analysis?.keywords ?? [],
    mustHave: mustHave ?? analysis?.mustHave ?? [],
  };

  const pdfPath = texPath.replace(/\.tex$/, ".pdf");
  const stale = !existsSync(pdfPath) || statSync(pdfPath).mtimeMs < statSync(texPath).mtimeMs;
  const build = rebuild || stale ? buildPdf(texPath, { resourceDirs: [dirname(baseCvPath)], engine }) : null;

  const doc = splitDocument(source);
  const baseDoc = splitDocument(base);
  const text = texToText(doc.body);
  const baseText = texToText(baseDoc.body);
  const checks = [];
  const add = (id, label, level, ok, detail, items) => checks.push({ id, label, level, ok, detail, ...(items?.length ? { items } : {}) });

  if (build)
    add(
      "compilation",
      "Compilation PDF",
      "bloquant",
      build.ok,
      build.ok ? `${basename(build.pdf)} produit avec ${build.engine} en ${(build.durationMs / 1000).toFixed(1)} s` : "La compilation a échoué",
      build.errors.map((e) => `${e.line ? `l.${e.line} : ` : ""}${e.message}`),
    );
  // Without a new compilation, the last one's log still tells pages and overflows.
  const compiled = build ?? lastBuild(texPath);
  const pages = compiled?.pages ?? null;
  if (pages != null && pages > 0)
    add("pages", "Longueur", "bloquant", pages <= maxPages, `${pages} page(s), maximum ${maxPages}`);

  const name = basename(texPath);
  add("nommage", "Nom des fichiers", "bloquant", /^cv_[a-z0-9_]+\.tex$/.test(name) && existsSync(pdfPath), `${name} et ${basename(pdfPath)}${existsSync(pdfPath) ? "" : " (PDF absent)"}`);

  const placeholders = [...doc.body.matchAll(/\b(TODO|FIXME|XXX|TBD)\b|lorem ipsum|\\lipsum|\[(?:à compléter|a completer|placeholder)\]|\?\?\?/gi)].map(([m]) => m);
  add("brouillon", "Aucun texte provisoire", "bloquant", placeholders.length === 0, placeholders.length ? "Marques de brouillon présentes" : "Aucune", [...new Set(placeholders)]);

  const baseContacts = contacts(base);
  const newContacts = contacts(source);
  const lostContacts = [
    ...baseContacts.emails.filter((e) => !newContacts.emails.includes(e)),
    ...baseContacts.phones.filter((p) => !newContacts.phones.includes(p)).map((p) => `téléphone ${p}`),
    ...baseContacts.links.filter((l) => !newContacts.links.includes(l)),
  ];
  add("identite", "Coordonnées conservées", "bloquant", lostContacts.length === 0, lostContacts.length ? "Coordonnées du modèle absentes" : "Courriel, téléphone et liens du modèle présents", lostContacts);

  if (base) {
    const changed = normalizeSpace(doc.preamble) !== normalizeSpace(baseDoc.preamble);
    const added = [...lineSet(doc.preamble)].filter((line) => !lineSet(baseDoc.preamble).has(line));
    add("modele", "Mise en forme du modèle", "avertissement", !changed, changed ? "Le préambule diffère du modèle : vérifier que le style reste identique" : "Préambule identique au modèle", added.slice(0, 8));

    add("adaptation", "CV réellement adapté", "avertissement", normalizeSpace(text) !== normalizeSpace(baseText), normalizeSpace(text) === normalizeSpace(baseText) ? "Le contenu est identique au modèle" : "Contenu adapté");

    const known = new Set([...figures(baseText), ...figures(texToText(baseDoc.preamble)), ...facts.flatMap((fact) => [...figures(fact)])]);
    const unknown = [...figures(text)].filter((figure) => !known.has(figure));
    add("faits", "Chiffres et dates vérifiables", "avertissement", unknown.length === 0, unknown.length ? "Absents du modèle et des faits confirmés : à vérifier avec la personne" : "Tous présents dans le modèle ou les faits confirmés", unknown);

    const removed = sections(baseDoc.body).filter((title) => !sections(doc.body).includes(title));
    add("sections", "Sections du modèle", "info", removed.length === 0, removed.length ? "Sections retirées ou renommées" : "Toutes conservées", removed);
  }

  if (compiled?.overfull?.length) {
    const wide = compiled.overfull.filter((box) => box.pt > 5);
    add("debordements", "Lignes qui débordent", "avertissement", wide.length === 0, wide.length ? `${wide.length} ligne(s) dépassent la marge de plus de 5 pt` : "Débordements négligeables", wide.map((b) => `l.${b.line} : ${b.pt.toFixed(1)} pt`));
  }
  if (compiled?.missingCharacters?.length)
    add("caracteres", "Caractères affichés", "bloquant", false, "Caractères absents de la police (ils ne s’afficheront pas)", compiled.missingCharacters);
  if (build?.active?.total)
    add("contenu-actif", "Liens et action d’ouverture", "info", false, "Certains portails refusent ces PDF : find-job build ID --sans-liens produit une version sans", [
      `${build.active.links} lien(s) cliquable(s)`,
      ...(build.active.openAction ? ["action d’ouverture"] : []),
    ]);

  const coverage = keywordCoverage(`${text}\n${texToText(doc.preamble)}`, wanted.keywords, wanted.mustHave);
  if (coverage.score != null) {
    add(
      "mots-cles",
      "Correspondance avec l’offre (objectif 100 %)",
      "avertissement",
      coverage.score === 100,
      `${coverage.score} % des mots-clés pondérés (${coverage.covered.length}/${coverage.covered.length + coverage.missing.length})`,
      coverage.missing.map((k) => (coverage.mustHaveMissing.includes(k) ? `${k} (essentiel)` : k)),
    );
    // Keywords the CV now shows but the base CV and the confirmed facts never mentioned.
    const proof = normalize(`${baseText}\n${texToText(baseDoc.preamble)}\n${facts.join("\n")}`);
    const additions = coverage.covered.filter((keyword) => !hasKeyword(proof, keyword));
    add("ajouts", "Ajouts à vérifier", "info", additions.length === 0, additions.length ? "Absents du CV de base : à garder seulement s’ils sont maîtrisés" : "Tous présents dans le CV de base ou les faits confirmés", additions);

    // Projects and experience are checkable (GitHub, live demos): what they say must stay the base CV's.
    const evidence = normalize(evidenceText(doc.body));
    if (base && evidence) {
      // A CV translated for an offer in another language rewords its projects: warn instead of blocking.
      const translated = guessLanguage(text) !== guessLanguage(baseText);
      const planted = additions.filter((keyword) => hasKeyword(evidence, keyword));
      add("projets", "Projets et expériences inchangés", translated ? "avertissement" : "bloquant", planted.length === 0, planted.length ? "Technologies absentes du CV de base ajoutées dans un projet ou une expérience : les déplacer dans les compétences" : "Aucune technologie ajoutée dans les projets ni les expériences", planted);
      const words = (value) => value.split(" ").map((word) => word.replace(/[.]+$/, ""));
      const known = new Set(words(normalize(`${baseText}\n${texToText(baseDoc.preamble)}`)));
      const fresh = [...new Set(words(evidence))].filter((word) => word.length > 2 && !known.has(word)).slice(0, 12);
      if (!translated)
        add("projets-texte", "Texte des projets", "avertissement", fresh.length === 0, fresh.length ? "Mots absents du CV de base dans les projets ou expériences : revenir au texte du modèle" : "Identique au CV de base", fresh);
    }
  } else add("mots-cles", "Correspondance avec l’offre (objectif 100 %)", "avertissement", false, "Aucun mot-clé fourni : écrire analyse.json pour mesurer la correspondance");

  const student = studentPosture(analysis, preferences);
  // The hook is the person's own words: copied as is from the base CV, never rewritten.
  const hook = base ? baseHook(base) : null;
  if (hook) {
    const kept = normalize(text).includes(normalize(hook));
    const translated = guessLanguage(text) !== guessLanguage(baseText);
    add(
      "accroche",
      "Accroche du CV de base",
      translated ? "avertissement" : "bloquant",
      kept,
      kept ? "Recopiée mot pour mot" : translated ? "CV traduit : vérifier que l’accroche est une traduction fidèle de celle du CV de base" : "L’accroche a été modifiée : remettre celle du CV de base, mot pour mot",
      kept ? [] : [hook.length > 160 ? `${hook.slice(0, 157)}…` : hook],
    );
  }

  const blocking = checks.filter((check) => check.level === "bloquant" && !check.ok);
  const warnings = checks.filter((check) => check.level === "avertissement" && !check.ok);
  return {
    ok: blocking.length === 0,
    verdict: blocking.length ? "à corriger" : warnings.length ? "prêt, points à vérifier" : "prêt",
    score: coverage.score,
    tex: texPath,
    pdf: existsSync(pdfPath) ? pdfPath : null,
    pages,
    keywords: coverage,
    additions: checks.find((check) => check.id === "ajouts")?.items ?? [],
    posture: student ? "etudiant" : "confirme",
    checks,
    build,
    at: new Date().toISOString(),
  };
}

/** Clichés that make a text sound generic or machine-written (matched without accents). */
const CLICHES = [
  "je me permets", "c est avec (un grand|un vif|beaucoup d) interet", "passionne", "dynamique", "n hesitez pas",
  "fort de", "je suis convaincu", "valeur ajoutee", "relever (de nouveaux |ce |les |des )?defis?", "prestigieu",
  "synergie", "incontournable", "tirer parti", "en somme", "veritable", "pleinement", "parfaitement en adequation",
  "au sein de votre (prestigieuse |belle )?(entreprise|societe|structure)", "je serais ravi", "motive", "enrichissant",
  "apporter ma pierre", "mettre a profit", "desireux", "vif interet", "a l ere de", "dans un monde",
];

export function cliches(text) {
  const plain = ` ${normalize(text)} `;
  const found = CLICHES.filter((pattern) => new RegExp(`(^|[^a-z0-9])${pattern}`).test(plain)).map((p) => p.replace(/\(.*?\)\??/g, "…").replace(/…+/g, "…"));
  const dashes = (String(text).match(/—/g) ?? []).length;
  if (dashes > 1) found.push(`${dashes} tirets cadratins (—)`);
  return found;
}

/** Student roles (internship, apprenticeship, first job) call for a learning posture. */
export function studentPosture(analysis, preferences = {}) {
  const declared = String(analysis?.posture ?? preferences.posture ?? "");
  if (/confirm|senior|experiment/i.test(declared)) return false;
  if (/etudiant|étudiant|student|humble|junior/i.test(declared)) return true;
  return /stage|altern|apprenti|intern|junior|graduate|premier emploi|trainee|v\.?i\.?e/i.test(String(analysis?.seniority ?? ""));
}

const LEARNING = [
  "apprend\\w*", "appris", "decouvr\\w*", "decouvert\\w*", "progress\\w*", "me former", "monter en competences?",
  "developper mes competences", "gagner en", "aux cotes d", "au contact d", "me perfectionner", "approfondir",
  "learn\\w*", "grow\\w*", "discover\\w*", "develop my skills", "alongside", "deepen\\w*",
];
const ASSERTIVE = [
  "je maitrise", "maitrise parfaite", "(un |une )?experte?", "mon expertise", "j excelle", "solide experience", "je transforme",
  "je batis", "batir", "je construis", "je fiabilise", "pour fiabiliser", "je garantis", "accomplir", "j apporte",
  "je vais apporter", "i master", "i excel", "proven track record", "i build", "i turn", "i deliver", "seasoned", "my expertise",
];

/** Says what the person wants to learn, without the tone of someone who already knows. */
export function reviewPosture(text) {
  const plain = ` ${normalize(text)} `;
  const has = (pattern) => new RegExp(`(^|[^a-z0-9])${pattern}([^a-z0-9]|$)`).test(plain);
  const problems = [];
  if (!LEARNING.some(has)) problems.push("ne dit pas ce que la personne souhaite apprendre (apprendre, découvrir, progresser aux côtés de…)");
  const show = (pattern) => pattern.replace(/\(.*?\)\??/g, "").replace(/e\?$/, "e").replace(/\bj /g, "j’").replace(/^je batis$|^batir$/, (m) => m.replace("batis", "bâtis").replace("batir", "bâtir"));
  for (const pattern of ASSERTIVE.filter(has)) problems.push(`ton de sachant : « ${show(pattern)} »`);
  return { ok: problems.length === 0, problems };
}

/**
 * The base CV's hook (accroche): the content of a Profile/Summary section, or
 * else the last prose paragraph between the header and the first section.
 * Null when the base CV has none.
 */
export function baseHook(baseSource) {
  const { body } = splitDocument(baseSource);
  const marks = [...body.matchAll(/\\(?:section|cvsection|cvsect|sectiontitle)\*?\{([^}]*)\}/g)];
  const profile = marks.findIndex((mark) => /profil|summary|r[ée]sum[ée]|propos|about|accroche|pr[ée]sentation|objecti/i.test(mark[1]));
  if (profile >= 0) {
    const mark = marks[profile];
    const text = texToText(body.slice(mark.index + mark[0].length, marks[profile + 1]?.index ?? body.length)).replace(/\s+/g, " ").trim();
    if (text.split(" ").length >= 6) return text;
  }
  const intro = body.slice(0, marks[0]?.index ?? body.length);
  const paragraphs = intro
    .split(/\n\s*\n/)
    .filter((paragraph) => !/minipage|\\href|@|\\\\|\\ifphoto|\\fa[A-Z]/.test(paragraph))
    .map((paragraph) => texToText(paragraph).replace(/\s+/g, " ").trim())
    .filter((text) => text.split(" ").length >= 8 && /[.!?)…]$/.test(text));
  return paragraphs.at(-1) ?? null;
}

/** Quality gate of lettre_<entreprise>.tex, always one page. */
export function checkLetter({ texPath, company, cvSource = "", resourceDirs = [], engine = "auto", rebuild = true, student = false }) {
  const checks = [];
  const add = (id, label, level, ok, detail, items) => checks.push({ id, label, level, ok, detail, ...(items?.length ? { items } : {}) });
  if (!existsSync(texPath)) {
    add("lettre", "Lettre de motivation", "bloquant", false, `${basename(texPath)} absente : find-job letter ID la crée depuis le modèle`);
    return { ok: false, verdict: "à écrire", tex: texPath, pdf: null, pages: null, checks, build: null };
  }
  const source = readFileSync(texPath, "utf8");
  const pdfPath = texPath.replace(/\.tex$/, ".pdf");
  const stale = !existsSync(pdfPath) || statSync(pdfPath).mtimeMs < statSync(texPath).mtimeMs;
  const build = rebuild || stale ? buildPdf(texPath, { resourceDirs, engine }) : null;
  const doc = splitDocument(source);
  const text = texToText(doc.body);

  if (build)
    add("compilation", "Compilation PDF", "bloquant", build.ok, build.ok ? `${basename(build.pdf)} produit` : "La compilation a échoué", build.errors.map((e) => `${e.line ? `l.${e.line} : ` : ""}${e.message}`));
  const lastLetter = build ?? lastBuild(texPath);
  if (lastLetter?.pages) add("pages", "Une page", "bloquant", lastLetter.pages <= 1, `${lastLetter.pages} page(s)`);
  add("nommage", "Nom des fichiers", "bloquant", /^lettre_[a-z0-9_]+\.tex$/.test(basename(texPath)) && existsSync(pdfPath), `${basename(texPath)} et ${basename(pdfPath)}`);
  const placeholders = [...source.matchAll(/\[à compléter[^\]]*\]|__[A-Z]+__|\b(TODO|XXX)\b/g)].map(([m]) => m);
  add("brouillon", "Aucun texte provisoire", "bloquant", placeholders.length === 0, placeholders.length ? "Champs encore à compléter" : "Aucun", [...new Set(placeholders)]);
  add("entreprise", "Entreprise nommée", "avertissement", normalize(text).includes(normalize(company)), `${company} ${normalize(text).includes(normalize(company)) ? "citée" : "jamais citée dans la lettre"}`);
  const email = contacts(cvSource).emails;
  const reachable = !email.length || email.some((address) => contacts(source).emails.includes(address));
  add("coordonnees", "Coordonnées", "avertissement", reachable, reachable ? "Courriel du CV présent" : "Aucun courriel du CV dans la lettre", reachable ? [] : email);
  const words = text.split(/\s+/).filter((w) => /\p{L}/u.test(w)).length;
  add("longueur", "Longueur", "avertissement", words >= 170 && words <= 400, `${words} mots (viser 200 à 350)`);
  const found = cliches(text);
  add("naturel", "Ton naturel", "avertissement", found.length === 0, found.length ? "Formules toutes faites à remplacer par du concret" : "Aucune formule toute faite repérée", found);
  if (student) {
    const posture = reviewPosture(text);
    add("posture", "Posture d’étudiant", "avertissement", posture.ok, posture.ok ? "Désir d’apprendre exprimé, sans ton de sachant" : "À rendre plus humble : apprendre en contribuant", posture.problems);
  }
  if (lastLetter?.missingCharacters?.length) add("caracteres", "Caractères affichés", "bloquant", false, "Caractères absents de la police", lastLetter.missingCharacters);

  const blocking = checks.filter((check) => check.level === "bloquant" && !check.ok);
  const warnings = checks.filter((check) => check.level === "avertissement" && !check.ok);
  return {
    ok: blocking.length === 0,
    verdict: blocking.length ? "à corriger" : warnings.length ? "prête, points à vérifier" : "prête",
    tex: texPath,
    pdf: existsSync(pdfPath) ? pdfPath : null,
    pages: lastLetter?.pages ?? null,
    words,
    checks,
    build,
  };
}

function normalizeSpace(text) {
  return text.replace(/\s+/g, " ").trim();
}

export function writeReport(report) {
  const file = join(dirname(report.tex), "qualite.json");
  const strip = (r) => r && { ...r, build: r.build && { ...r.build, tail: undefined } };
  writeFileSync(file, `${JSON.stringify({ ...strip(report), letter: strip(report.letter) }, null, 2)}\n`);
  return file;
}
