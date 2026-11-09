/**
 * Weekly plans: what the user intends to do (goals and routines) next to what
 * actually happened. Goals on applications are measured from the tracked
 * history; other goals and routines are ticked by the user. A review closes
 * the week and its lessons feed the next plan.
 */
import { FindJobError, newId } from "./store.js";
import { isoWeek, isoWeekday, localDay, nowIso, parseDay, weekDays, weekStart } from "./dates.js";
import { slugify } from "./text.js";
import { eventsWithStatus, listApplications } from "./applications.js";

export const METRICS = {
  applications: { label: "candidatures envoyées", status: "postulee" },
  prepared: { label: "CV préparés", status: "preparee" },
  followups: { label: "relances", status: "relancee" },
  interviews: { label: "entretiens", status: "entretien" },
  manual: { label: "suivi manuel" },
};

const EMPTY = { version: 1, weeks: {} };

export function readPlans(ws) {
  return ws.store.read("plans.json", EMPTY).weeks;
}

function key(entry, fallbackPrefix, index) {
  return slugify(entry.key || entry.label || `${fallbackPrefix}_${index + 1}`, { maxLength: 32 });
}

/** Validate a plan description written by the agent from the user's words. */
export function validatePlan(input) {
  const issues = [];
  const week = input.week ?? isoWeek();
  try {
    weekStart(week);
  } catch (error) {
    issues.push({ path: "week", message: error.message });
  }
  const goals = (input.goals ?? []).map((goal, index) => {
    const path = `goals[${index}]`;
    if (!goal.label) issues.push({ path: `${path}.label`, message: "Libellé obligatoire." });
    const metric = goal.metric ?? "manual";
    if (!METRICS[metric]) issues.push({ path: `${path}.metric`, message: `Mesure inconnue (${Object.keys(METRICS).join(", ")}).` });
    if (!(Number(goal.target) > 0)) issues.push({ path: `${path}.target`, message: "Cible numérique > 0 obligatoire." });
    return { key: key(goal, "objectif", index), label: String(goal.label ?? ""), metric, target: Number(goal.target), unit: goal.unit ?? "" };
  });
  const routines = (input.routines ?? []).map((routine, index) => {
    const path = `routines[${index}]`;
    if (!routine.label) issues.push({ path: `${path}.label`, message: "Libellé obligatoire." });
    const days = routine.days ?? [1, 2, 3, 4, 5];
    if (!Array.isArray(days) || !days.length || days.some((d) => !Number.isInteger(d) || d < 1 || d > 7))
      issues.push({ path: `${path}.days`, message: "Jours ISO de 1 (lundi) à 7 (dimanche)." });
    return {
      key: key(routine, "routine", index),
      label: String(routine.label ?? ""),
      days: [...new Set(days)].sort(),
      ...(routine.minutes ? { minutes: Number(routine.minutes) } : {}),
      ...(routine.time ? { time: String(routine.time) } : {}),
    };
  });
  for (const [list, name] of [[goals, "goals"], [routines, "routines"]]) {
    const seen = new Set();
    list.forEach((entry, index) => {
      if (seen.has(entry.key)) issues.push({ path: `${name}[${index}].key`, message: `Clé en double : ${entry.key}` });
      seen.add(entry.key);
    });
  }
  if (!goals.length && !routines.length) issues.push({ path: "", message: "Un plan contient au moins un objectif ou une routine." });
  if (issues.length) throw new FindJobError("INVALID_PLAN", "Plan invalide.", { issues });
  return { week, objective: String(input.objective ?? ""), goals, routines, notes: input.notes ?? "" };
}

/** Set or replace a week's plan; ticks and manual progress of kept keys survive. */
export function setPlan(ws, input) {
  const plan = validatePlan(input);
  const saved = ws.store.update("plans.json", EMPTY, (data) => {
    const previous = data.weeks[plan.week];
    const keepDone = Object.fromEntries(
      Object.entries(previous?.done ?? {}).filter(([routine]) => plan.routines.some((r) => r.key === routine)),
    );
    const keepProgress = Object.fromEntries(
      Object.entries(previous?.progress ?? {}).filter(([goal]) => plan.goals.some((g) => g.key === goal)),
    );
    data.weeks[plan.week] = {
      ...plan,
      id: previous?.id ?? newId("p"),
      start: weekStart(plan.week),
      done: keepDone,
      progress: keepProgress,
      review: previous?.review ?? null,
      createdAt: previous?.createdAt ?? nowIso(),
      updatedAt: nowIso(),
    };
    return data.weeks[plan.week];
  });
  ws.store.log("plan.set", `Plan de la semaine ${plan.week}${plan.objective ? ` : ${plan.objective}` : ""}`, { week: plan.week });
  return saved;
}

function requireWeek(data, week) {
  const plan = data.weeks[week];
  if (!plan) throw new FindJobError("NOT_FOUND", `Aucun plan pour ${week}. Voir : find-job plan show`);
  return plan;
}

export function toggleRoutine(ws, week, routineKey, day = localDay(), done) {
  parseDay(day);
  if (isoWeek(parseDay(day)) !== week) throw new FindJobError("INVALID_INPUT", `${day} n’appartient pas à la semaine ${week}.`);
  const result = ws.store.update("plans.json", EMPTY, (data) => {
    const plan = requireWeek(data, week);
    const routine = plan.routines.find((r) => r.key === routineKey);
    if (!routine) throw new FindJobError("NOT_FOUND", `Routine inconnue : ${routineKey} (${plan.routines.map((r) => r.key).join(", ")}).`);
    const days = new Set(plan.done[routineKey] ?? []);
    const next = done ?? !days.has(day);
    if (next) days.add(day);
    else days.delete(day);
    plan.done[routineKey] = [...days].sort();
    plan.updatedAt = nowIso();
    return { routine, day, done: next };
  });
  ws.store.log("plan.routine", `${result.done ? "Fait" : "Décoché"} : ${result.routine.label} (${day})`, { week, routine: routineKey, day });
  return result;
}

export function setGoalProgress(ws, week, goalKey, value, { add = false } = {}) {
  const result = ws.store.update("plans.json", EMPTY, (data) => {
    const plan = requireWeek(data, week);
    const goal = plan.goals.find((g) => g.key === goalKey);
    if (!goal) throw new FindJobError("NOT_FOUND", `Objectif inconnu : ${goalKey}`);
    if (goal.metric !== "manual")
      throw new FindJobError("INVALID_INPUT", `« ${goal.label} » se mesure automatiquement (${METRICS[goal.metric].label}).`);
    const current = plan.progress[goalKey] ?? 0;
    const next = Math.max(0, add ? current + Number(value) : Number(value));
    if (!Number.isFinite(next)) throw new FindJobError("INVALID_INPUT", "Valeur numérique attendue.");
    plan.progress[goalKey] = next;
    plan.updatedAt = nowIso();
    return { goal, value: next };
  });
  ws.store.log("plan.progress", `${result.goal.label} : ${result.value}/${result.goal.target}`, { week, goal: goalKey });
  return result;
}

export function saveReview(ws, week, input) {
  const lessons = (Array.isArray(input.lessons) ? input.lessons : String(input.lessons ?? "").split("\n"))
    .map((lesson) => String(lesson).trim())
    .filter(Boolean);
  const review = {
    wins: String(input.wins ?? "").trim(),
    blockers: String(input.blockers ?? "").trim(),
    lessons,
    nextFocus: String(input.nextFocus ?? "").trim(),
    mood: input.mood ? Number(input.mood) : null,
    at: nowIso(),
  };
  const saved = ws.store.update("plans.json", EMPTY, (data) => {
    const plan = requireWeek(data, week);
    plan.review = { ...review, score: weekProgress(plan, listApplications(ws)).score };
    plan.updatedAt = nowIso();
    return plan.review;
  });
  ws.store.log("plan.review", `Bilan de ${week} (${saved.score} %) : ${lessons.length} leçon(s)`, { week });
  return saved;
}

/** Planned versus done, for one week, as of `now`. */
export function weekProgress(plan, applications, now = new Date()) {
  const days = weekDays(plan.week);
  const from = parseDay(days[0]);
  const to = parseDay(days[6]);
  to.setDate(to.getDate() + 1);
  const today = localDay(now);
  const elapsedDays = days.filter((day) => day <= today).length;

  const goals = plan.goals.map((goal) => {
    const metric = METRICS[goal.metric];
    const events = metric.status ? eventsWithStatus(applications, metric.status, from, to) : [];
    const actual = metric.status ? events.length : (plan.progress?.[goal.key] ?? 0);
    return {
      ...goal,
      actual,
      ratio: Math.min(1, actual / goal.target),
      byDay: Object.fromEntries(days.map((day) => [day, events.filter((e) => localDay(e.at) === day).length])),
    };
  });

  const routines = plan.routines.map((routine) => {
    const scheduled = days.filter((day) => routine.days.includes(isoWeekday(day)));
    const done = (plan.done?.[routine.key] ?? []).filter((day) => days.includes(day));
    const due = scheduled.filter((day) => day <= today);
    return {
      ...routine,
      scheduled,
      done,
      ratio: scheduled.length ? Math.min(1, done.length / scheduled.length) : 0,
      dueRatio: due.length ? Math.min(1, done.filter((d) => due.includes(d)).length / due.length) : 1,
    };
  });

  const parts = [...goals.map((g) => g.ratio), ...routines.map((r) => r.ratio)];
  const score = parts.length ? Math.round((100 * parts.reduce((a, b) => a + b, 0)) / parts.length) : 0;
  // Pace compares progress with the share of the week already elapsed.
  const expected = Math.round((100 * elapsedDays) / 7);
  const pace = elapsedDays === 0 ? "a-venir" : score >= expected ? "en-avance" : score >= expected - 15 ? "dans-le-rythme" : "en-retard";

  const daily = days.map((day) => ({
    day,
    weekday: isoWeekday(day),
    isToday: day === today,
    isPast: day < today,
    routines: routines
      .filter((r) => r.scheduled.includes(day))
      .map((r) => ({ key: r.key, label: r.label, done: r.done.includes(day) })),
    applications: eventsWithStatus(applications, "postulee", parseDay(day), parseDay(addOne(day))).length,
  }));

  return { week: plan.week, days, goals, routines, daily, score, expected, pace, elapsedDays };
}

function addOne(day) {
  const d = parseDay(day);
  d.setDate(d.getDate() + 1);
  return localDay(d);
}

/** Every review lesson, newest week first: the input of the next plan. */
export function lessons(weeks) {
  return Object.values(weeks)
    .filter((plan) => plan.review?.lessons?.length)
    .sort((a, b) => b.week.localeCompare(a.week))
    .flatMap((plan) => plan.review.lessons.map((text) => ({ week: plan.week, text })));
}

export function weekHistory(weeks, applications, now = new Date()) {
  return Object.values(weeks)
    .sort((a, b) => a.week.localeCompare(b.week))
    .map((plan) => {
      const progress = weekProgress(plan, applications, now);
      return { week: plan.week, objective: plan.objective, score: plan.review?.score ?? progress.score, reviewed: !!plan.review };
    });
}
