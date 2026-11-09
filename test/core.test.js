import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { addDays, isoWeek, isoWeekday, weekDays, weekStart, shiftWeek } from "../src/core/dates.js";
import { slugify, htmlToText } from "../src/core/text.js";
import { initWorkspace, openWorkspace } from "../src/core/workspace.js";
import { prepareApplication, setStatus, followUpsDue, listApplications, filterApplications } from "../src/core/applications.js";
import { setPlan, toggleRoutine, setGoalProgress, saveReview, weekProgress, validatePlan, lessons } from "../src/core/plans.js";
import { windowStats } from "../src/core/stats.js";
import { tempWorkspace } from "./helpers.js";

test("ISO weeks match the calendar, including year boundaries", () => {
  assert.equal(isoWeek(new Date(2026, 9, 24)), "2026-W43");
  assert.equal(isoWeek(new Date(2026, 0, 1)), "2026-W01");
  assert.equal(isoWeek(new Date(2027, 0, 1)), "2026-W53");
  assert.equal(isoWeek(new Date(2021, 0, 3)), "2020-W53");
  assert.equal(weekStart("2026-W43"), "2026-10-19");
  assert.equal(weekStart("2026-W01"), "2025-12-29");
  assert.deepEqual(weekDays("2026-W43").at(-1), "2026-10-25");
  assert.equal(isoWeekday("2026-10-25"), 7);
  assert.equal(shiftWeek("2026-W53", 1), "2027-W01");
  assert.equal(addDays("2026-10-31", 1), "2026-11-01");
});

test("company slugs give the required file name", () => {
  assert.equal(slugify("Société Générale"), "societe_generale");
  assert.equal(slugify("Acme SAS"), "acme");
  assert.equal(slugify("L'Oréal & Co."), "l_oreal_et_co");
  assert.equal(slugify("!!!"), "entreprise");
});

test("HTML becomes readable text", () => {
  const text = htmlToText("<p>Missions&nbsp;:</p><ul><li>Python &amp; SQL</li><li>Airflow</li></ul><script>x()</script>");
  assert.match(text, /Missions :/);
  assert.match(text, /• Python & SQL/);
  assert.doesNotMatch(text, /x\(\)/);
});

test("init detects the base CV and refuses to run twice", () => {
  const dir = tempWorkspace();
  const ws = initWorkspace(dir);
  assert.equal(ws.config.baseCv, "cv.tex");
  assert.equal(ws.config.candidate.name, "Camille Martin");
  assert.match(readFileSync(join(dir, ".gitignore"), "utf8"), /\.build/);
  assert.throws(() => initWorkspace(dir), { code: "WORKSPACE_EXISTS" });
  assert.equal(openWorkspace(dir).root, dir);
});

test("prepare copies the template under cv_<entreprise>.tex and records history", () => {
  const ws = initWorkspace(tempWorkspace());
  const a = prepareApplication(ws, { company: "Société Générale", title: "Data Engineer", url: "https://www.welcometothejungle.com/x" });
  assert.match(a.files.tex, /cv_societe_generale\.tex$/);
  assert.match(a.files.pdf, /cv_societe_generale\.pdf$/);
  assert.equal(a.source, "welcometothejungle.com");
  assert.ok(existsSync(join(ws.root, a.files.tex)));
  const b = prepareApplication(ws, { company: "Société Générale", title: "Data Engineer" });
  assert.notEqual(a.folder, b.folder, "two offers never share a folder");
  assert.throws(() => prepareApplication(ws, { company: "", title: "x" }), { code: "INVALID_INPUT" });
});

test("statuses are timed; follow-ups are due after 7 quiet days", () => {
  const ws = initWorkspace(tempWorkspace());
  const a = prepareApplication(ws, { company: "Acme", title: "Dev" });
  const sent = setStatus(ws, a.id, "postulee", { at: new Date(Date.now() - 9 * 86_400_000).toISOString() });
  assert.ok(sent.appliedAt);
  assert.equal(sent.history.at(-1).status, "preparee", "history is chronological");
  assert.equal(followUpsDue(listApplications(ws)).length, 0, "the latest event is the recent preparation");
  assert.throws(() => setStatus(ws, a.id, "nope"), { code: "INVALID_INPUT" });
  assert.equal(filterApplications(listApplications(ws), { since: "7j" }).length, 0);
  assert.equal(filterApplications(listApplications(ws), { since: "30j" }).length, 1);
});

test("window stats count events inside each period", () => {
  const ws = initWorkspace(tempWorkspace());
  const a = prepareApplication(ws, { company: "A", title: "x" });
  const b = prepareApplication(ws, { company: "B", title: "y" });
  setStatus(ws, a.id, "postulee", { at: new Date(Date.now() - 30 * 3_600_000).toISOString() });
  setStatus(ws, b.id, "postulee");
  setStatus(ws, b.id, "entretien");
  const items = listApplications(ws);
  assert.equal(windowStats(items, "24h").applied, 1);
  assert.equal(windowStats(items, "48h").applied, 2);
  assert.equal(windowStats(items, "48h").responseRate, 50);
  assert.equal(windowStats(items, "7j").series.length, 7);
  assert.equal(windowStats(items, "7j").series.reduce((n, s) => n + s.applied, 0), 2);
});

test("plans validate, keep ticks across updates and measure progress", () => {
  const ws = initWorkspace(tempWorkspace());
  assert.throws(() => validatePlan({ goals: [{ label: "x", target: 0 }] }), (e) => e.code === "INVALID_PLAN" && e.details.issues.length > 0);
  const week = isoWeek();
  const days = weekDays(week);
  setPlan(ws, {
    objective: "Deux entretiens",
    goals: [
      { key: "cand", label: "5 candidatures", metric: "applications", target: 5 },
      { key: "net", label: "Messages", metric: "manual", target: 4 },
    ],
    routines: [{ key: "veille", label: "Veille", days: [1, 2, 3, 4, 5, 6, 7] }],
  });
  toggleRoutine(ws, week, "veille", days[0]);
  setGoalProgress(ws, week, "net", 2);
  setGoalProgress(ws, week, "net", 1, { add: true });
  assert.throws(() => setGoalProgress(ws, week, "cand", 3), { code: "INVALID_INPUT" });
  const a = prepareApplication(ws, { company: "A", title: "x" });
  setStatus(ws, a.id, "postulee");

  const updated = setPlan(ws, { objective: "Deux entretiens", goals: [{ key: "net", label: "Messages", metric: "manual", target: 4 }], routines: [{ key: "veille", label: "Veille 30 min" }] });
  assert.deepEqual(updated.done.veille, [days[0]], "ticks of a kept routine survive");
  assert.equal(updated.progress.net, 3);

  const p = weekProgress(updated, listApplications(ws));
  assert.equal(p.goals[0].actual, 3);
  assert.ok(p.score > 0 && p.score <= 100);
  assert.ok(["a-venir", "en-avance", "dans-le-rythme", "en-retard"].includes(p.pace));

  const review = saveReview(ws, week, { wins: "ok", lessons: "Postuler le matin\n\nRelancer à J+7" });
  assert.deepEqual(review.lessons, ["Postuler le matin", "Relancer à J+7"]);
  assert.equal(lessons(openWorkspace(ws.root).store.read("plans.json", {}).weeks).length, 2);
});

test("the journal keeps every action, newest first", () => {
  const ws = initWorkspace(tempWorkspace());
  ws.store.log("note", "Appel avec une recruteuse");
  const [last] = ws.store.journal();
  assert.equal(last.summary, "Appel avec une recruteuse");
  ws.addFact("Permis B");
  assert.equal(ws.profile().facts[0].text, "Permis B");
});
