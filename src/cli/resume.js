/** Plain-text summary used to pick up the work in a new conversation. */
import { searchWeekNumber } from "../core/dates.js";

const PACE = {
  "a-venir": "semaine à venir",
  "en-avance": "en avance",
  "dans-le-rythme": "dans le rythme",
  "en-retard": "en retard",
};

function weekLabel(id, start) {
  const n = searchWeekNumber(id, start);
  return n >= 1 ? `Semaine ${n} (${id})` : `Avant la semaine 1 (${id})`;
}

function when(iso) {
  const d = new Date(iso);
  return d.toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function renderResume(s) {
  const out = [];
  const name = s.workspace.candidate?.name;
  out.push(`find-job — ${name ? `${name} · ` : ""}${s.workspace.root}`);
  out.push(`CV de base : ${s.workspace.baseCv} · candidatures dans ${s.workspace.outputDir}/ · ${s.workspace.maxPages} page(s) max`);
  out.push("");

  const plan = s.plans[s.focusWeek];
  const progress = s.progress[s.focusWeek];
  if (s.focusWeek !== s.currentWeek) out.push(`La recherche démarre lundi : semaine 1 = ${s.startWeek}.`);
  if (plan) {
    out.push(`${weekLabel(s.focusWeek, s.startWeek)}${plan.objective ? ` — ${plan.objective}` : ""}`);
    out.push(`  Score ${progress.score} % (attendu à ce jour ≈ ${progress.expected} %) : ${PACE[progress.pace]}`);
    for (const goal of progress.goals) out.push(`  ▸ ${goal.label} : ${goal.actual}/${goal.target}${goal.unit ? ` ${goal.unit}` : ""}`);
    for (const routine of progress.routines) out.push(`  ▸ ${routine.label} : ${routine.done.length}/${routine.scheduled.length} jour(s)`);
    const today = progress.daily.find((day) => day.isToday);
    const left = today?.routines.filter((r) => !r.done) ?? [];
    if (left.length) out.push(`  Aujourd’hui reste : ${left.map((r) => r.label).join(" · ")}`);
  } else {
    out.push(`${weekLabel(s.focusWeek, s.startWeek)} : aucun plan. Proposer d’en établir un avec la personne.`);
  }
  out.push("");

  const w7 = s.windows["7j"];
  const w30 = s.windows["30j"];
  out.push(`Candidatures suivies : ${s.applications.length}`);
  out.push(`  7 jours : ${w7.applied} envoyée(s), ${w7.prepared} CV préparé(s), ${w7.interviews} entretien(s)`);
  out.push(`  30 jours : ${w30.applied} envoyée(s)${w30.responseRate != null ? `, ${w30.responseRate} % de réponses` : ""}${w30.averageMatch != null ? `, correspondance moyenne ${w30.averageMatch} %` : ""}`);
  const waiting = s.applications.filter((a) => a.status === "preparee");
  const unfinished = waiting.filter((a) => !a.quality?.ok || !a.pdfReady || !a.letterReady);
  const ready = waiting.filter((a) => !unfinished.includes(a));
  const due = (a) => (a.deadline ? ` — clôture ${a.deadline}` : "");
  if (unfinished.length) out.push(`  Dossiers à finir (CV ou lettre non validés) : ${unfinished.map((a) => `${a.company} (${a.id})${due(a)}`).join(", ")}`);
  if (ready.length) out.push(`  Prêts, non envoyés : ${ready.map((a) => `${a.company} (${a.id})${due(a)}`).join(", ")}`);
  const followUps = s.applications.filter((a) => s.followUpsDue.includes(a.id));
  if (followUps.length)
    out.push(`  Relances conseillées (7 j sans nouvelle) : ${followUps.map((a) => `${a.company} — ${a.title} (${a.id})`).join(", ")}`);
  out.push("");

  if (s.lessons.length) {
    out.push("Leçons des bilans précédents :");
    for (const lesson of s.lessons.slice(0, 6)) out.push(`  - [S${searchWeekNumber(lesson.week, s.startWeek)}] ${lesson.text}`);
    out.push("");
  }
  const facts = s.profile.facts ?? [];
  const prefs = Object.entries(s.profile.preferences ?? {});
  out.push(`Profil : ${facts.length} fait(s) confirmé(s)${prefs.length ? ` · ${prefs.map(([k, v]) => `${k} = ${v}`).join(" · ")}` : ""}`);
  for (const fact of facts.slice(-8)) out.push(`  • ${fact.text} (${fact.id})`);
  out.push("");

  out.push("Dernières actions :");
  for (const event of s.journal.slice(0, 10)) out.push(`  ${when(event.at)}  ${event.summary}`);
  if (!s.journal.length) out.push("  (aucune)");
  return `${out.join("\n")}\n`;
}
