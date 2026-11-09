/**
 * find-job command line. Machine-facing commands print JSON on stdout and
 * structured errors on stderr with a non-zero exit code, so the skill can
 * chain them; `resume`, `help`, `setup` and `ui` print text for people.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { FindJobError } from "../core/store.js";
import { randomUUID } from "node:crypto";
import { initWorkspace, openWorkspace } from "../core/workspace.js";
import {
  STATUSES,
  cleanUrl,
  editApplication,
  ensureLetter,
  filterApplications,
  getApplication,
  listApplications,
  prepareApplication,
  removeApplication,
  setStatus,
} from "../core/applications.js";
import { readPlans, saveReview, setGoalProgress, setPlan, toggleRoutine, weekProgress } from "../core/plans.js";
import { WINDOWS, isoWeek, localDay, resolveWeek, searchWeekNumber } from "../core/dates.js";
import { snapshot, windowStats } from "../core/stats.js";
import { fetchOffer, offerMarkdown } from "../cv/offer.js";
import { buildPdf } from "../cv/latex.js";
import { letterPathFor, reviewApplication } from "../cv/review.js";
import { renderResume } from "./resume.js";
import { TOOLS, detectTools, installSkill, linkCommand, packageVersion } from "./setup.js";

const HELP = `find-job ${packageVersion()} — CV adaptés aux offres, suivi des candidatures et planification

Espace de travail
  find-job init [--cv cv.tex] [--name "Prénom Nom"]   Créer l’espace dans le dossier courant
  find-job status                                    État de l’espace (JSON)
  find-job resume [--json]                           Reprendre : semaine, relances, leçons, actions récentes

Adapter un CV à une offre
  find-job offer URL [URL…]                          Plusieurs offres lues en parallèle
  find-job prepare --offer FICHIER | --company X --title Y [--url U] [--location L] [--force]
                                                     Dossier candidatures/…/cv_<entreprise>.tex
  find-job build REF|FICHIER.tex [--sans-liens]      Compiler en PDF à côté du .tex ; --sans-liens : CV et lettre
                                                     sans liens ni action d’ouverture (portails stricts)
  find-job letter REF                                Créer lettre_<entreprise>.tex si elle manque
  find-job check REF|FICHIER.tex [--keywords a,b] [--must-have c,d] [--no-build]
                                                     Contrôle du CV et de la lettre + score

Suivre les candidatures
  find-job list [--since 24h|48h|7j|30j|90j] [--status S]
  find-job show REF
  find-job set REF --status S [--note "…"] [--at AAAA-MM-JJ]
  find-job edit REF [--notes …] [--location …] [--contact …] [--salary …] [--url …]
  find-job remove REF                                Retirer du suivi (le dossier reste)
  find-job stats [--since 7j]
  Statuts : ${Object.keys(STATUSES).join(", ")}

Planifier la semaine
  find-job plan show [--week S1|2026-W44]           Semaines numérotées depuis startWeek
  find-job plan set --file plan.json
  find-job plan done ROUTINE [--day AAAA-MM-JJ] [--undo] [--week W]
  find-job plan progress OBJECTIF VALEUR [--add] [--week W]
  find-job plan review --file bilan.json [--week W]

Mémoire
  find-job profile                                   Faits confirmés et préférences
  find-job profile fact "texte" [--tags a,b]         Enregistrer un fait confirmé par la personne
  find-job profile unfact ID
  find-job profile pref CLE VALEUR                   Ex. roles "Data engineer", locations "Lyon"
  find-job config CLE VALEUR                         maxPages, engine, candidateName, outputDir, startWeek
  find-job log "texte" [--type networking]           Noter une action hors candidature

Interface et installation
  find-job ui [--port 4321] [--no-open]              Tableau de bord local
  find-job setup [claude|codex] [--local] [--remove] Installer le skill et la commande

Options communes : --workspace DOSSIER (ou FIND_JOB_WORKSPACE)
`;

const OPTIONS = {
  workspace: { type: "string" },
  cv: { type: "string" },
  name: { type: "string" },
  json: { type: "boolean" },
  out: { type: "string" },
  offer: { type: "string" },
  company: { type: "string" },
  title: { type: "string" },
  url: { type: "string" },
  location: { type: "string" },
  contract: { type: "string" },
  source: { type: "string" },
  notes: { type: "string" },
  contact: { type: "string" },
  salary: { type: "string" },
  keywords: { type: "string" },
  "must-have": { type: "string" },
  "no-build": { type: "boolean" },
  "sans-liens": { type: "boolean" },
  force: { type: "boolean" },
  deadline: { type: "string" },
  since: { type: "string" },
  status: { type: "string" },
  note: { type: "string" },
  at: { type: "string" },
  week: { type: "string" },
  file: { type: "string" },
  day: { type: "string" },
  undo: { type: "boolean" },
  add: { type: "boolean" },
  tags: { type: "string" },
  type: { type: "string" },
  port: { type: "string" },
  host: { type: "string" },
  "no-open": { type: "boolean" },
  local: { type: "boolean" },
  remove: { type: "boolean" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "v" },
};

function print(data) {
  process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
}

function list(value) {
  return value
    ? value
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
    : undefined;
}

function readJson(file) {
  if (!file) throw new FindJobError("INVALID_INPUT", "--file est obligatoire.");
  try {
    return JSON.parse(readFileSync(resolve(file), "utf8"));
  } catch (error) {
    throw new FindJobError("INVALID_INPUT", `${file} : ${error.code === "ENOENT" ? "fichier introuvable" : error.message}`);
  }
}

function need(value, label) {
  if (!value) throw new FindJobError("INVALID_INPUT", `${label} est obligatoire. Voir : find-job help`);
  return value;
}

/** A tracked application (id, folder, company) or a .tex path. */
function resolveTex(ws, ref) {
  need(ref, "La candidature (ID, dossier ou fichier .tex)");
  if (ref.endsWith(".tex") && existsSync(resolve(ref))) {
    const tex = resolve(ref);
    const application = listApplications(ws).find((item) => resolve(ws.root, item.files.tex) === tex);
    return { tex, application };
  }
  const application = getApplication(ws, ref);
  return { tex: resolve(ws.root, application.files.tex), application };
}

async function run(argv) {
  const { values: o, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
  const [command = "help", ...rest] = positionals;
  if (o.version) return process.stdout.write(`${packageVersion()}\n`);
  if (o.help || command === "help") return process.stdout.write(HELP);

  switch (command) {
    case "init": {
      const ws = initWorkspace(o.workspace ?? process.cwd(), { cv: o.cv, name: o.name });
      return print({ ok: true, root: ws.root, config: ws.config });
    }
    case "setup":
      return setup(rest, o);
    case "ui": {
      const ws = openWorkspace(o.workspace);
      const { startServer } = await import("../server/server.js");
      const { url } = await startServer(ws, { port: o.port ? Number(o.port) : undefined, host: o.host, open: !o["no-open"] });
      process.stdout.write(`find-job : ${url}\n`);
      return new Promise(() => {}); // Serves until interrupted.
    }
  }

  const ws = openWorkspace(o.workspace);
  switch (command) {
    case "status": {
      const items = listApplications(ws);
      return print({
        ok: true,
        root: ws.root,
        config: ws.config,
        baseCvExists: existsSync(ws.baseCvPath),
        applications: items.length,
        currentWeek: isoWeek(),
        searchWeek: searchWeekNumber(isoWeek(), ws.config.startWeek),
        startWeek: ws.config.startWeek,
        hasPlan: !!readPlans(ws)[isoWeek()],
      });
    }
    case "resume":
      if (o.json) return print(snapshot(ws));
      return process.stdout.write(renderResume(snapshot(ws)));

    case "offer": {
      // Several URLs are read in parallel; each offer gets its own cache file.
      const urls = [...new Set(rest)];
      need(urls[0], "L’URL de l’offre");
      if (o.out && urls.length > 1) throw new FindJobError("INVALID_INPUT", "--out ne s’utilise qu’avec une seule URL.");
      const cache = join(ws.store.dir, "cache");
      mkdirSync(cache, { recursive: true });
      const tracked = listApplications(ws);
      const results = await Promise.all(
        urls.map(async (url) => {
          try {
            const offer = await fetchOffer(url);
            offer.url = cleanUrl(offer.url ?? url);
            const file = o.out ? resolve(o.out) : join(cache, `offre-${Date.now()}-${randomUUID().slice(0, 6)}.json`);
            writeFileSync(file, `${JSON.stringify(offer, null, 2)}\n`);
            ws.store.log("offer.read", `Offre lue : ${offer.title || url}${offer.company ? ` (${offer.company})` : ""}`, { url: offer.url, quality: offer.quality });
            const already = tracked.find((item) => cleanUrl(item.url) === offer.url);
            return {
              file,
              ...offer,
              text: offer.description.length > 300 ? `${offer.text.slice(0, 1500)}…` : offer.text,
              ...(already ? { alreadyTracked: { id: already.id, status: already.status, folder: already.folder } } : {}),
            };
          } catch (error) {
            return { url, error: { code: error.code ?? "OFFER_UNREACHABLE", message: error.message } };
          }
        }),
      );
      if (urls.length === 1) {
        if (results[0].error) throw new FindJobError(results[0].error.code, results[0].error.message);
        return print(results[0]);
      }
      return print({ count: results.length, offers: results });
    }
    case "prepare": {
      const offer = o.offer ? readJson(o.offer) : null;
      const application = prepareApplication(ws, {
        company: o.company ?? offer?.company,
        title: o.title ?? offer?.title,
        url: o.url ?? offer?.url,
        location: o.location ?? offer?.location,
        contract: o.contract ?? offer?.contract,
        deadline: o.deadline ?? offer?.validThrough,
        source: o.source,
        notes: o.notes,
        force: o.force,
      });
      if (offer) {
        writeFileSync(resolve(ws.root, application.files.offer), offerMarkdown(offer));
        writeFileSync(join(resolve(ws.root, application.folder), "offre.json"), `${JSON.stringify(offer, null, 2)}\n`);
      }
      return print({ ok: true, application, baseCv: ws.baseCvPath, tex: resolve(ws.root, application.files.tex), folder: resolve(ws.root, application.folder) });
    }
    case "build": {
      const { tex, application } = resolveTex(ws, rest[0]);
      const options = { resourceDirs: [resolve(ws.baseCvPath, "..")], engine: ws.config.engine };
      if (!o["sans-liens"]) {
        const result = buildPdf(tex, options);
        print(result);
        return result.ok ? 0 : 2;
      }
      // Portals that refuse "active content": the CV and its letter, without links nor open action.
      const letterTex = letterPathFor(ws, tex, application);
      const strip = ({ ok, pdf, pages, errors, active, log }) => ({ ok, pdf, pages, errors, active, log });
      const cv = strip(buildPdf(tex, { ...options, plain: true }));
      const letter = existsSync(letterTex) ? strip(buildPdf(letterTex, { ...options, plain: true })) : null;
      const ok = cv.ok && cv.active?.total === 0 && (!letter || (letter.ok && letter.active?.total === 0));
      if (application) ws.store.log("cv.plain", `Versions sans liens pour ${application.company}`, { id: application.id });
      print({ ok, cv, letter });
      return ok ? 0 : 2;
    }
    case "letter": {
      const { application, letter } = ensureLetter(ws, need(rest[0], "La candidature"));
      return print({ ok: true, letter, application });
    }
    case "check": {
      const { tex, application } = resolveTex(ws, rest[0]);
      const result = reviewApplication(ws, { tex, application, keywords: list(o.keywords), mustHave: list(o["must-have"]), rebuild: !o["no-build"] });
      print(result);
      return result.ok ? 0 : 2;
    }

    case "list": {
      const items = filterApplications(listApplications(ws), { since: o.since, status: o.status });
      return print(items.map(({ history, ...item }) => ({ ...item, lastChange: history.at(-1)?.at })));
    }
    case "show":
      return print(getApplication(ws, need(rest[0], "La candidature")));
    case "set":
      return print(setStatus(ws, need(rest[0], "La candidature"), need(o.status, "--status"), { note: o.note, at: o.at }));
    case "edit":
      return print(
        editApplication(ws, need(rest[0], "La candidature"), {
          notes: o.notes,
          location: o.location,
          contact: o.contact,
          salary: o.salary,
          url: o.url,
          title: o.title,
          company: o.company,
          contract: o.contract,
          source: o.source,
        }),
      );
    case "remove":
      return print({ removed: removeApplication(ws, need(rest[0], "La candidature")) });
    case "stats": {
      const items = listApplications(ws);
      if (o.since) return print(windowStats(items, o.since));
      return print(Object.fromEntries(Object.keys(WINDOWS).map((id) => [id, { ...windowStats(items, id), series: undefined }])));
    }

    case "plan":
      return plan(ws, rest, o);
    case "profile":
      return profile(ws, rest, o);
    case "config":
      return print(ws.setConfig(need(rest[0], "La clé"), need(rest[1], "La valeur")));
    case "log":
      return print(ws.store.log(o.type ?? "note", need(rest.join(" "), "Le texte")));
    default:
      throw new FindJobError("UNKNOWN_COMMAND", `Commande inconnue : ${command}. Voir : find-job help`);
  }
}

function plan(ws, [sub = "show", ...args], o) {
  const { startWeek } = ws.config;
  const current = isoWeek(o.day ? new Date(`${o.day}T12:00:00`) : new Date());
  // Before the search starts, planning and reviewing target week 1; ticks follow the day.
  const fallback = ["show", "set", "review"].includes(sub) && current < startWeek ? startWeek : current;
  const week = o.week ? resolveWeek(o.week, startWeek) : fallback;
  switch (sub) {
    case "show": {
      const found = readPlans(ws)[week];
      const label = `S${searchWeekNumber(week, startWeek)}`;
      if (!found) return print({ week, label, plan: null, hint: "Aucun plan : find-job plan set --file plan.json" });
      return print({ week, label, plan: found, progress: weekProgress(found, listApplications(ws)) });
    }
    case "set": {
      const input = readJson(o.file);
      return print(setPlan(ws, { ...input, week: o.week || input.week ? resolveWeek(o.week ?? input.week, startWeek) : week }));
    }
    case "done":
      return print(toggleRoutine(ws, week, need(args[0], "La routine"), o.day ?? localDay(), !o.undo));
    case "progress":
      return print(setGoalProgress(ws, week, need(args[0], "L’objectif"), need(args[1], "La valeur"), { add: o.add }));
    case "review":
      return print(saveReview(ws, week, readJson(o.file)));
    default:
      throw new FindJobError("UNKNOWN_COMMAND", `plan ${sub} : show, set, done, progress ou review.`);
  }
}

function profile(ws, [sub = "show", ...args], o) {
  switch (sub) {
    case "show":
      return print(ws.profile());
    case "fact":
      return print(ws.addFact(need(args.join(" "), "Le fait"), list(o.tags) ?? []));
    case "unfact":
      return print(ws.removeFact(need(args[0], "L’ID du fait")));
    case "pref":
      return print(ws.setPreference(need(args[0], "La clé"), args.slice(1).join(" ")));
    default:
      throw new FindJobError("UNKNOWN_COMMAND", `profile ${sub} : show, fact, unfact ou pref.`);
  }
}

async function setup(args, o) {
  const tools = args.length ? args : detectTools();
  const unknown = tools.filter((tool) => !TOOLS[tool]);
  if (unknown.length) throw new FindJobError("INVALID_INPUT", `Outil inconnu : ${unknown.join(", ")} (claude, codex).`);
  if (!tools.length) {
    process.stdout.write("Ni Claude Code ni Codex détectés. Forcez : find-job setup claude | find-job setup codex\n");
    return 1;
  }
  const lines = [`find-job ${packageVersion()} — ${o.remove ? "désinstallation" : "installation"}`];
  for (const tool of tools) lines.push(await installSkill(tool, { scope: o.local ? "project" : "user", remove: o.remove }));
  if (!o.local) lines.push(await linkCommand({ remove: o.remove }));
  if (!o.remove)
    lines.push(
      "",
      "Ensuite, dans le dossier qui contient votre CV .tex :",
      "  Claude Code : /find-job https://url-de-l-offre",
      "  Codex       : $find-job https://url-de-l-offre",
    );
  process.stdout.write(`${lines.join("\n")}\n`);
  return 0;
}

export async function main(argv) {
  try {
    const code = await run(argv);
    return typeof code === "number" ? code : 0;
  } catch (error) {
    const known = error instanceof FindJobError || error.code === "ERR_PARSE_ARGS_UNKNOWN_OPTION" || error.code === "ERR_PARSE_ARGS_INVALID_OPTION_VALUE";
    const payload = {
      error: {
        code: error instanceof FindJobError ? error.code : known ? "INVALID_ARGUMENTS" : "INTERNAL",
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      },
    };
    process.stderr.write(`${JSON.stringify(payload, null, 2)}\n`);
    if (!known) process.stderr.write(`${error.stack}\n`);
    return 1;
  }
}
