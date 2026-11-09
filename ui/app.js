/*
 * find-job interface. One snapshot of the memory (GET /api/state) drives
 * every view; the server announces writes from the CLI or the agent over
 * server-sent events, and the page re-reads the snapshot. Writes made here go
 * through the same validated operations as the CLI.
 */

import { mountEditor } from "./editor.js";

const token = document.querySelector('meta[name="find-job-token"]').content;
const main = document.getElementById("main");
const DAY = 86_400_000;
const WINDOWS = { "24h": ["24 h", DAY], "48h": ["48 h", 2 * DAY], "7j": ["7 jours", 7 * DAY], "30j": ["30 jours", 30 * DAY], "90j": ["3 mois", 90 * DAY] };
const WEEKDAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const PACE = { "a-venir": "Semaine à venir", "en-avance": "En avance", "dans-le-rythme": "Dans le rythme", "en-retard": "En retard" };

let state = null;
let seen = null; // application ids already displayed, to animate new ones
const born = new Set();
const previous = new Map(); // last value shown per counter, for count-up
const VIEWS = ["dashboard", "applications", "week", "editor"];
const ui = load("ui", { view: "dashboard", window: "7j", since: "all", status: "", q: "", week: null, editing: null });
if (!VIEWS.includes(ui.view)) ui.view = "dashboard";
let editor = null; // the mounted editor, kept across dashboard refreshes
const open = new Set();

function load(key, fallback) {
  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem(`find-job:${key}`) ?? "{}") };
  } catch {
    return { ...fallback };
  }
}
function save() {
  if (!VIEWS.includes(ui.view)) ui.view = "dashboard";
  try {
    const { view, window, since, status, editing } = ui;
    localStorage.setItem("find-job:ui", JSON.stringify({ view, window, since, status, editing }));
  } catch {
    // Private mode: preferences simply aren't remembered.
  }
}

/* ── helpers ──────────────────────────────────────────────────────────── */
const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const pad = (n) => String(n).padStart(2, "0");
const localDay = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDay = (s) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
function isoWeek(date) {
  const t = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  t.setDate(t.getDate() - ((t.getDay() + 6) % 7) + 3);
  const jan4 = new Date(t.getFullYear(), 0, 4);
  return `${t.getFullYear()}-W${pad(1 + Math.round(((t - jan4) / DAY - 3 + ((jan4.getDay() + 6) % 7)) / 7))}`;
}
function weekStart(id) {
  const [, y, w] = /^(\d{4})-W(\d{2})$/.exec(id).map(Number);
  const jan4 = new Date(y, 0, 4);
  const monday = new Date(jan4);
  monday.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7) + (w - 1) * 7);
  return monday;
}
const shiftWeek = (id, n) => {
  const d = weekStart(id);
  d.setDate(d.getDate() + 7 * n);
  return isoWeek(d);
};
/** Week 1 is the week the search starts (config startWeek), not the ISO calendar week. */
const weekNo = (id) => Math.round((weekStart(id) - weekStart(state.startWeek)) / (7 * DAY)) + 1;
const weekName = (id) => (weekNo(id) >= 1 ? `Semaine ${weekNo(id)}` : "Avant la semaine 1");
const weekShort = (id) => (weekNo(id) >= 1 ? `S${weekNo(id)}` : "Prépa");
const fmt = (iso, opts) => new Date(iso).toLocaleDateString("fr-FR", opts);
const fmtTime = (iso) => new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
function relative(iso) {
  const diff = Date.now() - new Date(iso);
  const min = Math.round(diff / 60_000);
  if (min < 1) return "à l’instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.round(h / 24);
  if (d < 31) return `il y a ${d} j`;
  return fmt(iso, { day: "numeric", month: "short" });
}
function hue(text) {
  let h = 0;
  for (const c of String(text)) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}
const initials = (name) =>
  String(name)
    .split(/[\s-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
const fileUrl = (path, download) => `/files?path=${encodeURIComponent(path)}${download ? "&download" : ""}`;
const statusLabel = (s) => state.statuses[s]?.label ?? s;

function eventsWithStatus(items, status, from, to = new Date(8.64e15)) {
  let n = 0;
  for (const item of items) for (const h of item.history ?? []) if (h.status === status && new Date(h.at) >= from && new Date(h.at) < to) n++;
  return n;
}

async function api(path, body, method = "POST") {
  const response = await fetch(path, {
    method,
    headers: { "content-type": "application/json", "x-find-job-token": token },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message ?? `Erreur ${response.status}`);
  await refresh();
  return data.result;
}

function toast(message, kind = "") {
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.textContent = message;
  document.getElementById("toasts").append(el);
  setTimeout(() => {
    el.classList.add("leave");
    el.addEventListener("animationend", () => el.remove());
  }, 2600);
}

function confetti(x, y, count = 26) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const colors = ["#2dd4bf", "#818cf8", "#fbbf24", "#4ade80", "#f472b6"];
  for (let i = 0; i < count; i++) {
    const p = document.createElement("i");
    p.className = "confetti";
    const angle = Math.random() * Math.PI * 2;
    const dist = 50 + Math.random() * 90;
    p.style.cssText = `left:${x}px;top:${y}px;background:${colors[i % colors.length]};--dx:${Math.cos(angle) * dist}px;--dy:${Math.sin(angle) * dist - 40}px;--r:${Math.random() * 540}deg`;
    document.body.append(p);
    p.addEventListener("animationend", () => p.remove());
  }
}
const centerOf = (el) => {
  const r = el.getBoundingClientRect();
  return [r.left + r.width / 2, r.top + r.height / 2];
};

function countUp(root) {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  for (const el of root.querySelectorAll("[data-count]")) {
    const to = Number(el.dataset.count);
    const key = el.dataset.key;
    const from = previous.has(key) ? previous.get(key) : 0;
    previous.set(key, to);
    if (reduce || from === to) {
      el.textContent = to;
      continue;
    }
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / 900);
      el.textContent = Math.round(from + (to - from) * (1 - Math.pow(1 - t, 3)));
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
}

function ring(value, { size = 120, stroke = 10, expected = null, label = "", small = false } = {}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, value ?? 0));
  // A tick on the ring marks the share of the week already elapsed.
  let mark = "";
  if (expected != null) {
    const a = (expected / 100) * 2 * Math.PI;
    const at = (radius) => [size / 2 + Math.cos(a) * radius, size / 2 + Math.sin(a) * radius];
    const [ix, iy] = at(r - stroke / 2 - 3);
    const [ox, oy] = at(r + stroke / 2 + 3);
    mark = `<line class="expected" x1="${ix}" y1="${iy}" x2="${ox}" y2="${oy}"><title>Attendu à ce jour : ${expected} %</title></line>`;
  }
  return `<div class="ring${small ? " sm" : ""}" style="width:${size}px;height:${size}px">
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <defs><linearGradient id="ring-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--accent)"/><stop offset="1" stop-color="var(--accent-2)"/></linearGradient></defs>
      <circle class="track" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="${stroke}"/>
      <circle class="bar" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="${stroke}"
        stroke-dasharray="${c}" stroke-dashoffset="${c}" data-offset="${c * (1 - v / 100)}"/>
      ${mark}
    </svg>
    ${small ? "" : `<div class="label"><b>${value == null ? "—" : `${Math.round(v)}<small>%</small>`}</b>${label ? `<span>${esc(label)}</span>` : ""}</div>`}
  </div>`;
}
function animateRings(root) {
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      for (const bar of root.querySelectorAll(".ring .bar")) bar.style.strokeDashoffset = bar.dataset.offset;
      for (const bar of root.querySelectorAll(".progress > i[data-width]")) bar.style.width = bar.dataset.width;
    }),
  );
}

/* ── data ─────────────────────────────────────────────────────────────── */
async function refresh() {
  const response = await fetch("/api/state", { cache: "no-store" });
  if (!response.ok) throw new Error("Lecture de la mémoire impossible.");
  const next = await response.json();
  const ids = new Set(next.applications.map((a) => a.id));
  if (seen) for (const id of ids) if (!seen.has(id)) born.add(id);
  seen = ids;
  state = next;
  ui.week ??= state.focusWeek;
  render();
}

let deferred = false;
function render() {
  if (ui.view === "editor" && renderEditor()) return;
  // Never re-render under the user's typing; the next blur catches up.
  const active = document.activeElement;
  if (active && main.contains(active) && /^(INPUT|TEXTAREA)$/.test(active.tagName) && active.type !== "checkbox") {
    if (!deferred) {
      deferred = true;
      active.addEventListener("blur", () => ((deferred = false), render()), { once: true });
    }
    return;
  }
  navState();
  const views = { dashboard, applications, week };
  main.innerHTML = (canEdit() ? "" : STALE_SERVER) + views[ui.view]();
  after[ui.view]?.();
  countUp(main);
  animateRings(main);
  born.clear();
}

/** A server started before an update lacks the newest routes: say so instead of failing silently. */
const canEdit = () => !!state.server?.features?.includes("editor");
const STALE_SERVER = `<div class="stale-server" role="alert"><b>Tableau de bord à relancer.</b> Il a été lancé avec une version antérieure de find-job : l’éditeur et les dernières fonctions n’y sont pas encore. Arrêtez-le, puis relancez <code>find-job ui</code> depuis votre dossier.</div>`;

function navState() {
  const name = state.workspace.candidate?.name;
  document.getElementById("candidate").textContent = name || "Recherche d’emploi";
  document.getElementById("workspace").textContent = state.workspace.root;
  document.getElementById("nav-count").textContent = state.applications.length || "";
  const progress = state.progress[state.focusWeek];
  document.getElementById("nav-score").textContent = progress ? `${progress.score}%` : "";
  const active = ui.view === "editor" ? "applications" : ui.view;
  for (const button of document.querySelectorAll(".nav button")) button.classList.toggle("active", button.dataset.view === active);
}

/**
 * The editor survives dashboard refreshes (each save writes the memory, which
 * triggers one): it is mounted once per application and only updated after.
 */
function renderEditor() {
  const application = state.applications.find((a) => a.id === ui.editing);
  if (!application || !canEdit()) {
    ui.view = "applications";
    save();
    return false;
  }
  navState();
  if (editor?.id === application.id && main.contains(main.querySelector(".editor-view"))) {
    editor.update(application);
    return true;
  }
  editor?.destroy();
  editor = mountEditor(main, {
    application: { ...application },
    doc: ui.editingDoc,
    token,
    esc,
    fileUrl,
    toast,
    onCompiled: () => refresh().catch(() => {}),
  });
  return true;
}

function openEditor(id, doc = "cv") {
  ui.editing = id;
  ui.editingDoc = doc;
  go("editor");
}

const after = {
  dashboard() {
    placeThumb();
    drawChart();
  },
};

/* ── dashboard ────────────────────────────────────────────────────────── */
function dashboard() {
  const w = state.windows[ui.window];
  const [label, ms] = WINDOWS[ui.window];
  const now = new Date(state.generatedAt);
  const from = new Date(now - ms);
  const before = new Date(from - ms);
  const prev = (status) => eventsWithStatus(state.applications, status, before, from);
  const delta = (current, past) => {
    const d = current - past;
    if (!d) return `<span>= période précédente</span>`;
    return `<span class="${d > 0 ? "up" : "down"}">${d > 0 ? "▲" : "▼"} ${Math.abs(d)}</span> vs ${label} précédents`;
  };
  const name = state.workspace.candidate?.name?.split(" ")[0];
  const hour = new Date().getHours();
  const hello = hour < 5 || hour >= 18 ? "Bonsoir" : "Bonjour";
  const segments = Object.entries(WINDOWS)
    .map(([id, [text]]) => `<button data-window="${id}" class="${id === ui.window ? "active" : ""}">${text}</button>`)
    .join("");

  return `<section class="view">
    <div class="view-head">
      <div><h1>${hello}${name ? ` ${esc(name)}` : ""}</h1>
      <p>${fmt(now, { weekday: "long", day: "numeric", month: "long" })} · ${state.focusWeek === state.currentWeek ? weekName(state.currentWeek).toLowerCase() : `la semaine 1 commence lundi ${fmt(weekStart(state.startWeek), { day: "numeric", month: "long" })}`}</p></div>
      <div class="segmented" role="tablist" aria-label="Période">${segments}<span class="thumb"></span></div>
    </div>
    <div class="grid kpis stagger">
      ${kpi("primary", "Candidatures envoyées", w.applied, delta(w.applied, prev("postulee")), "applied")}
      ${kpi("violet", "CV adaptés", w.prepared, delta(w.prepared, prev("preparee")), "prepared")}
      ${kpi("amber", "Entretiens", w.interviews, delta(w.interviews, prev("entretien")), "interviews")}
      ${kpi("blue", "Taux de réponse", w.responseRate, w.averageMatch != null ? `Correspondance moyenne des CV : <b>${w.averageMatch} %</b>` : "Réponses : entretien, offre ou refus", "rate", "%")}
    </div>
    <div class="grid two">
      <div class="card">
        <div class="card-head"><h2>Activité · ${label}</h2>
          <div class="legend"><span><i style="background:var(--accent)"></i>Envoyées</span><span><i style="background:var(--surface-3)"></i>CV adaptés</span></div></div>
        <div class="chart" id="chart"></div>
      </div>
      <div class="card">
        <div class="card-head"><h2>À faire maintenant</h2><span class="muted">${fmt(now, { weekday: "long" })}</span></div>
        ${todo()}
      </div>
    </div>
    <div class="grid two">
      <div class="card">
        <div class="card-head"><h2>Où en sont vos candidatures</h2><span class="muted">${state.applications.length} au total</span></div>
        ${funnel()}
      </div>
      ${weekMini()}
    </div>
  </section>`;
}

function kpi(tone, label, value, foot, key, unit = "") {
  return `<div class="card kpi ${tone}">
    <div class="label">${esc(label)}</div>
    <div class="value">${value == null ? "—" : `<span data-count="${value}" data-key="${key}-${ui.window}">0</span>${unit ? `<small>${unit}</small>` : ""}`}</div>
    <div class="delta">${foot}</div>
  </div>`;
}

function placeThumb() {
  const seg = main.querySelector(".segmented");
  const active = seg?.querySelector("button.active");
  const thumb = seg?.querySelector(".thumb");
  if (!active || !thumb) return;
  const previousLeft = ui.thumb;
  const target = { left: `${active.offsetLeft}px`, width: `${active.offsetWidth}px` };
  if (previousLeft) {
    thumb.style.transition = "none";
    Object.assign(thumb.style, previousLeft);
    thumb.offsetWidth; // Commit the old position before animating to the new one.
    thumb.style.transition = "";
  }
  Object.assign(thumb.style, target);
  ui.thumb = target;
}

function bucketLabel(start, windowId, index, n) {
  const d = new Date(start);
  if (windowId === "24h") return index % 6 === 0 ? `${pad(d.getHours())}h` : "";
  if (windowId === "48h") return index % 3 === 0 ? `${WEEKDAYS[(d.getDay() + 6) % 7]} ${pad(d.getHours())}h` : "";
  if (windowId === "7j") return WEEKDAYS[(d.getDay() + 6) % 7];
  if (windowId === "30j") return index % 5 === 0 || index === n - 1 ? `${d.getDate()}/${d.getMonth() + 1}` : "";
  return index % 2 === 0 && weekNo(isoWeek(d)) >= 1 ? weekShort(isoWeek(d)) : "";
}

function drawChart() {
  const host = main.querySelector("#chart");
  if (!host) return;
  const w = state.windows[ui.window];
  const width = host.clientWidth || 600;
  const height = host.clientHeight || 210;
  const n = w.series.length;
  const max = Math.max(2, ...w.series.map((s) => Math.max(s.applied, s.prepared)));
  const top = 10;
  const bottom = 22;
  const plot = height - top - bottom;
  const slot = width / n;
  const barW = Math.max(3, Math.min(26, slot * 0.36));
  const y = (v) => top + plot - (v / max) * plot;
  const lines = [0, Math.ceil(max / 2), max]
    .map((v) => `<line class="gridline" x1="0" x2="${width}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${width}" y="${y(v) - 4}" text-anchor="end">${v}</text>`)
    .join("");
  const bars = w.series
    .map((s, i) => {
      const x = i * slot + slot / 2;
      const delay = `style="animation-delay:${(i / n) * 0.35}s"`;
      const hp = (s.prepared / max) * plot;
      const ha = (s.applied / max) * plot;
      const label = bucketLabel(s.start, ui.window, i, n);
      return `<g data-i="${i}">
        <rect class="hit" x="${i * slot}" y="${top}" width="${slot}" height="${plot}"/>
        ${s.prepared ? `<rect class="bar prepared" ${delay} x="${x - barW - 1}" y="${top + plot - hp}" width="${barW}" height="${hp}" rx="3"/>` : ""}
        ${s.applied ? `<rect class="bar applied" ${delay} x="${x + 1}" y="${top + plot - ha}" width="${barW}" height="${ha}" rx="3"/>` : ""}
        ${label ? `<text class="axis" x="${x}" y="${height - 6}" text-anchor="middle">${label}</text>` : ""}
      </g>`;
    })
    .join("");
  host.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Candidatures envoyées et CV adaptés sur ${WINDOWS[ui.window][0]}">
    <defs><linearGradient id="bar-g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--accent)"/><stop offset="1" stop-color="var(--accent-2)"/></linearGradient></defs>
    ${lines}${bars}</svg><div class="tooltip"></div>`;
  const tip = host.querySelector(".tooltip");
  host.querySelector("svg").addEventListener("mousemove", (event) => {
    const g = event.target.closest("g[data-i]");
    if (!g) return tip.classList.remove("show");
    const s = w.series[Number(g.dataset.i)];
    const d = new Date(s.start);
    const when = w.bucketMs < DAY ? `${fmt(d, { weekday: "short", day: "numeric" })} ${pad(d.getHours())}h` : w.bucketMs === DAY ? fmt(d, { weekday: "long", day: "numeric", month: "short" }) : `semaine du ${fmt(d, { day: "numeric", month: "short" })}`;
    tip.innerHTML = `<b>${esc(when)}</b><br>${s.applied} envoyée(s) · ${s.prepared} CV adapté(s)`;
    const box = host.getBoundingClientRect();
    tip.style.left = `${event.clientX - box.left}px`;
    tip.style.top = `${event.clientY - box.top}px`;
    tip.classList.add("show");
  });
  host.querySelector("svg").addEventListener("mouseleave", () => tip.classList.remove("show"));
}

function todo() {
  const items = [];
  const progress = state.progress[state.currentWeek];
  const today = progress?.daily.find((d) => d.isToday);
  for (const r of today?.routines ?? [])
    items.push(`<div class="todo-item">
      <button class="check ${r.done ? "on" : ""}" data-routine="${esc(r.key)}" data-day="${today.day}" data-week="${state.currentWeek}" aria-pressed="${r.done}" aria-label="${esc(r.label)}">${CHECK}</button>
      <div class="grow">${esc(r.label)}<span>Routine du jour</span></div></div>`);
  // Ready files first, nearest deadline first; unfinished folders point to their details.
  const waiting = state.applications
    .filter((a) => a.status === "preparee")
    .sort((a, b) => (a.deadline || "9999").localeCompare(b.deadline || "9999") || new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 6);
  for (const a of waiting) {
    const ready = a.quality?.ok && a.pdfReady && a.letterReady;
    const due = deadlineText(a);
    items.push(`<div class="todo-item"><div class="avatar" style="--h:${hue(a.company)};width:30px;height:30px;font-size:12px">${esc(initials(a.company))}</div>
      <div class="grow">${esc(a.company)}<span>${ready ? "CV et lettre prêts" : "Dossier à finir"} — ${esc(a.title)}${due ? ` · ${due}` : ""}</span></div>
      ${offerLink(a, "btn small")}
      ${ready ? `<button class="btn small primary" data-set-status="postulee" data-id="${a.id}">J’ai postulé</button>` : `<button class="btn small" data-open-app="${a.id}">Voir</button>`}</div>`);
  }
  for (const a of state.applications.filter((a) => state.followUpsDue.includes(a.id)).slice(0, 4))
    items.push(`<div class="todo-item"><div class="avatar" style="--h:${hue(a.company)};width:30px;height:30px;font-size:12px">${esc(initials(a.company))}</div>
      <div class="grow">${esc(a.company)}<span>Sans nouvelle ${relative(a.history.at(-1).at)} — relancer ?</span></div>
      <button class="btn small" data-set-status="relancee" data-id="${a.id}">Relancée</button></div>`);
  if (!items.length)
    return `<div class="todo-empty">Rien d’urgent. ${progress ? "Toutes les routines du jour sont faites." : "Planifiez votre semaine avec l’agent pour voir vos routines ici."}</div>`;
  return `<div class="todo">${items.join("")}</div>`;
}

/** "clôture dans 3 j", only for offers that are still open. */
function deadlineText(a) {
  if (!a.deadline) return "";
  const days = Math.ceil((parseDay(a.deadline) - parseDay(state.today)) / DAY);
  if (days < 0) return `<b style="color:var(--danger)">offre close</b>`;
  if (days === 0) return `<b style="color:var(--danger)">clôture aujourd’hui</b>`;
  return days <= 3 ? `<b style="color:var(--warn)">clôture dans ${days} j</b>` : `clôture le ${fmt(a.deadline, { day: "numeric", month: "short" })}`;
}

function funnel() {
  const order = ["preparee", "postulee", "relancee", "entretien", "offre", "refusee"];
  const max = Math.max(1, ...order.map((s) => state.pipeline[s] ?? 0));
  return `<div class="funnel">${order
    .map(
      (s, i) => `<div class="funnel-row s-${s}">
      <span>${esc(statusLabel(s))}</span>
      <div class="track"><div class="fill" style="width:${((state.pipeline[s] ?? 0) / max) * 100}%;animation-delay:${i * 0.06}s"></div></div>
      <span class="n">${state.pipeline[s] ?? 0}</span></div>`,
    )
    .join("")}</div>`;
}

function weekMini() {
  const p = state.progress[state.focusWeek];
  const plan = state.plans[state.focusWeek];
  const title = state.focusWeek === state.currentWeek ? `Cette semaine · ${weekShort(state.focusWeek)}` : "Semaine 1 · à venir";
  if (!p)
    return `<div class="card"><div class="card-head"><h2>${title}</h2></div>
      <div class="empty" style="padding:22px"><span class="big">◫</span>Aucun plan pour la ${weekName(state.focusWeek).toLowerCase()}.
      <button class="btn small" data-goto="week">Voir comment planifier</button></div></div>`;
  return `<div class="card">
    <div class="card-head"><h2>${title}</h2><span class="pace ${p.pace}">${PACE[p.pace]}</span></div>
    <div class="week-summary">
      ${ring(p.score, { size: 112, stroke: 9, expected: p.expected, label: "réalisé" })}
      <div style="display:flex;flex-direction:column;gap:10px;min-width:0">
        ${plan.objective ? `<div style="font-size:13px">${esc(plan.objective)}</div>` : ""}
        ${p.goals
          .slice(0, 3)
          .map(
            (g) => `<div><div class="goal-top" style="font-size:12px"><span>${esc(g.label)}</span><span class="tnum">${g.actual}/${g.target}</span></div>
          <div class="progress" style="margin-top:5px"><i style="width:0" data-width="${g.ratio * 100}%"></i></div></div>`,
          )
          .join("")}
        <button class="btn small" data-goto="week" style="align-self:flex-start">Ouvrir la semaine →</button>
      </div>
    </div></div>`;
}

const CHECKS = {
  compilation: "La compilation a échoué",
  pages: "Trop de pages",
  nommage: "Nom des fichiers incorrect",
  brouillon: "Texte provisoire restant",
  identite: "Coordonnées manquantes",
  modele: "Mise en forme modifiée",
  adaptation: "CV identique au modèle",
  faits: "Chiffres à vérifier avec vous",
  sections: "Sections retirées",
  debordements: "Lignes qui débordent",
  caracteres: "Caractères non affichés",
  "mots-cles": "Score de correspondance sous 100 %",
  accroche: "Accroche différente du CV de base",
  "contenu-actif": "Liens et action d’ouverture",
  projets: "Technologie ajoutée dans un projet",
  "projets-texte": "Texte d’un projet modifié",
  "lettre:lettre": "Lettre de motivation absente",
  "lettre:compilation": "La lettre ne compile pas",
  "lettre:pages": "Lettre trop longue (1 page)",
  "lettre:nommage": "Nom de la lettre incorrect",
  "lettre:brouillon": "Lettre encore à compléter",
  "lettre:entreprise": "Entreprise absente de la lettre",
  "lettre:coordonnees": "Coordonnées absentes de la lettre",
  "lettre:longueur": "Longueur de la lettre à revoir",
  "lettre:naturel": "Formules toutes faites dans la lettre",
  "lettre:posture": "Lettre peu humble pour un stage",
  "lettre:caracteres": "Caractères non affichés dans la lettre",
};
const CHECK = `<svg viewBox="0 0 12 12"><path d="M2 6.5l2.6 2.5L10 3.5"/></svg>`;

/* ── applications ─────────────────────────────────────────────────────── */
function filteredApplications() {
  const q = ui.q.trim().toLowerCase();
  const from = ui.since === "all" ? null : new Date(Date.now() - WINDOWS[ui.since][1]);
  return state.applications
    .filter((a) => !ui.status || a.status === ui.status)
    .filter((a) => !from || new Date(a.appliedAt ?? a.createdAt) >= from)
    .filter((a) => !q || `${a.company} ${a.title} ${a.location} ${a.notes}`.toLowerCase().includes(q))
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

function listHtml(items) {
  return items.length ? items.map(row).join("") : emptyApps();
}

function applications() {
  const items = filteredApplications();
  const chips = [["all", "Tout"], ...Object.entries(WINDOWS).map(([id, [t]]) => [id, t])]
    .map(([id, t]) => `<button class="chip ${ui.since === id ? "active" : ""}" data-since="${id}">${t}</button>`)
    .join("");
  const statuses = Object.entries(state.statuses)
    .map(([id, s]) => `<option value="${id}" ${ui.status === id ? "selected" : ""}>${esc(s.label)}</option>`)
    .join("");
  return `<section class="view">
    <div class="view-head"><div><h1>Candidatures</h1>
      <p><span id="shown">${items.length}</span> affichée(s) sur ${state.applications.length} · CV et lettre en <span class="mono">.tex</span> et <span class="mono">.pdf</span>, offre à un clic</p></div></div>
    <div class="toolbar">
      <input type="search" id="search" placeholder="Rechercher une entreprise, un poste…" value="${esc(ui.q)}" />
      <select id="status-filter"><option value="">Tous les statuts</option>${statuses}</select>
    </div>
    <div class="chips">${chips}</div>
    <div class="apps" id="apps">${listHtml(items)}</div>
  </section>`;
}

function emptyApps() {
  if (state.applications.length) return `<div class="empty"><span class="big">⌕</span>Aucune candidature ne correspond à ces filtres.</div>`;
  return `<div class="empty"><span class="big">✎</span><b>Aucune candidature pour l’instant</b>
    Donnez une offre à l’agent : il adapte votre CV, le compile et l’ajoute ici.
    ${prompt("/find-job https://url-de-l-offre")}</div>`;
}

function row(a) {
  const isOpen = open.has(a.id);
  const options = Object.entries(state.statuses)
    .map(([id, s]) => `<option value="${id}" ${a.status === id ? "selected" : ""}>${esc(s.label)}</option>`)
    .join("");
  const due = a.status === "preparee" ? deadlineText(a) : "";
  const when = a.appliedAt ? `Envoyée ${relative(a.appliedAt)}` : `Préparée ${relative(a.createdAt)}${due ? ` · ${due}` : ""}`;
  const score = a.match?.score;
  return `<div class="app-row ${born.has(a.id) ? "born" : ""} ${isOpen ? "open" : ""}" data-row="${a.id}">
      <div class="avatar" style="--h:${hue(a.company)}">${esc(initials(a.company))}</div>
      <div class="app-main" data-toggle="${a.id}" role="button" tabindex="0" aria-expanded="${isOpen}">
        <b>${esc(a.company)} · ${esc(a.title)}</b>
        <span>${[a.location, a.source, a.contract].filter(Boolean).map(esc).join(" · ") || esc(a.folder)}</span>
      </div>
      <div class="app-meta">${score != null ? `<span class="score" title="Correspondance avec l’offre">${ring(score, { size: 26, stroke: 3.5, small: true })}${score} %</span><br>` : ""}${when}</div>
      <select class="status-select s-${a.status}" data-status-of="${a.id}" aria-label="Statut">${options}</select>
      <div class="actions">
        ${offerLink(a, "btn small offer")}
        ${canEdit() ? `<button class="btn small" data-edit-app="${a.id}" title="Modifier le CV et la lettre, recompiler avec Ctrl+S">✎</button>` : ""}
        ${fileButton(a.pdfReady, a.files.pdf, "CV", "Ouvrir le CV (PDF)")}
        ${fileButton(a.letterReady, a.files.letterPdf, "Lettre", "Ouvrir la lettre de motivation (PDF)")}
      </div>
    </div>
    ${isOpen ? detail(a) : ""}`;
}

/** The offer in one click: its URL, or the copy kept in the folder when there is none. */
function offerLink(a, cls) {
  if (a.url) return `<a class="${cls}" href="${esc(a.url)}" target="_blank" rel="noopener noreferrer" title="${esc(a.url)}">Offre ↗</a>`;
  return a.files.offer ? `<a class="${cls}" href="${fileUrl(a.files.offer)}" target="_blank" rel="noopener" title="Copie de l’offre">Offre ↗</a>` : "";
}

function fileButton(ready, path, label, title) {
  return ready
    ? `<a class="btn small" href="${fileUrl(path)}" target="_blank" rel="noopener" title="${esc(title)}">${label}</a>`
    : `<span class="btn small disabled" title="${esc(label)} pas encore compilé(e) (find-job check)">${label}</span>`;
}

function detail(a) {
  const history = [...a.history]
    .reverse()
    .map((h) => `<li class="s-${h.status}"><b>${esc(statusLabel(h.status))}</b><time>${fmt(h.at, { day: "numeric", month: "short" })} ${fmtTime(h.at)}</time>${h.note ? `<div class="muted small">${esc(h.note)}</div>` : ""}</li>`)
    .join("");
  const q = a.quality;
  const quality = q
    ? `<div class="checks"><div>${q.ok ? "✓" : "✗"} ${esc(q.verdict)}${q.pages ? ` · ${q.pages} page(s)` : ""}</div>${(q.failed ?? []).map((id) => `<div class="bad">• ${esc(CHECKS[id] ?? id)}</div>`).join("")}
       ${q.letter ? `<div>${q.letter.startsWith("prête") ? "✓" : "✗"} Lettre : ${esc(q.letter)}</div>` : ""}
       ${a.match?.missing?.length ? `<div class="muted small" style="margin-top:6px">Mots-clés absents : ${a.match.missing.map(esc).join(", ")}</div>` : ""}
       ${a.match?.additions?.length ? `<div class="small" style="margin-top:6px;color:var(--warn)">Ajoutés, à vérifier : ${a.match.additions.map(esc).join(", ")}</div>` : ""}</div>`
    : `<div class="muted small">Pas encore contrôlé (find-job check).</div>`;
  return `<div class="app-detail">
    <div><h3>Historique</h3><ul class="timeline">${history}</ul></div>
    <div style="display:flex;flex-direction:column;gap:14px">
      <div><h3>Qualité du dossier</h3>${quality}</div>
      <div><h3>Documents</h3><div class="docs">
        ${canEdit() ? `<button class="btn small primary" data-edit-app="${a.id}">✎ Modifier et recompiler</button>` : ""}
        ${offerLink(a, "btn small offer")}
        ${fileButton(a.pdfReady, a.files.pdf, "CV PDF", "CV")}<a class="btn small" href="${fileUrl(a.files.tex, true)}">CV TeX</a>
        ${a.files.letter ? `${fileButton(a.letterReady, a.files.letterPdf, "Lettre PDF", "Lettre")}<a class="btn small" href="${fileUrl(a.files.letter, true)}">Lettre TeX</a>` : ""}
        ${a.plain?.cv ? fileButton(true, a.plain.cv, "CV sans liens", "Pour les sites qui refusent le contenu actif") : ""}
        ${a.plain?.letter ? fileButton(true, a.plain.letter, "Lettre sans liens", "Pour les sites qui refusent le contenu actif") : ""}
      </div>${a.url ? `<div class="muted small mono url">${esc(a.url)}</div>` : ""}</div>
      <div><h3>Notes</h3><textarea data-notes="${a.id}" placeholder="Contact, échange, prochaine étape…">${esc(a.notes)}</textarea></div>
      <div class="muted small mono">${esc(a.folder)}</div>
    </div>
  </div>`;
}

function prompt(text) {
  return `<div class="prompt"><span>${esc(text)}</span><button class="btn small" data-copy="${esc(text)}">Copier</button></div>`;
}

/* ── week ─────────────────────────────────────────────────────────────── */
function week() {
  const id = ui.week;
  const plan = state.plans[id];
  const p = state.progress[id];
  const start = weekStart(id);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const range = `${fmt(start, { day: "numeric", month: "short" })} – ${fmt(end, { day: "numeric", month: "short", year: "numeric" })}`;
  const isCurrent = id === state.currentWeek;
  const head = `<div class="view-head"><div><h1>${weekName(id)}</h1><p>${range}${isCurrent ? " · en cours" : id > state.currentWeek ? " · à venir" : ""}</p></div>
    <div class="week-nav"><button class="btn icon" data-week-shift="-1" aria-label="Semaine précédente">‹</button>
    <button class="btn" data-week-shift="0" ${id === state.focusWeek ? "disabled" : ""}>${state.focusWeek === state.currentWeek ? "Cette semaine" : "Semaine 1"}</button>
    <button class="btn icon" data-week-shift="1" aria-label="Semaine suivante">›</button></div></div>`;

  if (!plan)
    return `<section class="view">${head}
      <div class="empty"><span class="big">◫</span><b>Pas de plan pour cette semaine</b>
      Décrivez à l’agent ce que vous voulez accomplir ; il en fait des objectifs mesurables et des routines à cocher ici.
      ${prompt("/find-job planifie ma semaine : 8 candidatures, 3 relances, veille des offres 30 min chaque matin")}
      ${state.lessons.length ? `<div style="max-width:560px;text-align:left;margin-top:8px"><div class="muted small" style="margin-bottom:6px">L’agent tiendra compte de vos leçons :</div>${lessonList(state.lessons.slice(0, 3))}</div>` : ""}
      </div>${historyCard()}</section>`;

  const goals = p.goals.map(goalCard).join("");
  const days = p.daily.map(dayCard).join("");
  const plannedRoutines = p.routines.reduce((n, r) => n + r.scheduled.length, 0);
  return `<section class="view">${head}
    <div class="card"><div class="week-summary">
      ${ring(p.score, { size: 132, stroke: 11, expected: isCurrent ? p.expected : null, label: "réalisé" })}
      <div style="display:flex;flex-direction:column;gap:10px">
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><span class="pace ${isCurrent ? p.pace : plan.review ? "dans-le-rythme" : "a-venir"}">${isCurrent ? PACE[p.pace] : plan.review ? "Bilan fait" : id < state.currentWeek ? "Semaine passée" : "À venir"}</span>
        ${isCurrent ? `<span class="muted small">Attendu à ce jour ≈ ${p.expected} % (${p.elapsedDays}/7 jours)</span>` : ""}</div>
        <h2 style="font-size:18px">${esc(plan.objective || "Objectif de la semaine")}</h2>
        <p class="muted">Prévu : ${p.goals.length} objectif(s) et ${plannedRoutines} séance(s) de routine. ${p.goals.filter((g) => g.ratio >= 1).length} objectif(s) atteint(s), ${p.routines.reduce((n, r) => n + r.done.length, 0)} séance(s) faite(s).</p>
      </div></div></div>
    ${p.goals.length ? `<div class="card"><div class="card-head"><h2>Objectifs</h2><span class="muted">les candidatures se comptent toutes seules</span></div><div class="goals stagger">${goals}</div></div>` : ""}
    ${p.routines.length ? `<div class="card"><div class="card-head"><h2>Routines</h2><span class="muted">cochez au fil des jours</span></div><div class="days">${days}</div></div>` : ""}
    ${lessonsCard(id)}
    ${reviewCard(plan, p)}
    ${historyCard()}
  </section>`;
}

function goalCard(g) {
  const done = g.ratio >= 1;
  const manual = g.metric === "manual";
  return `<div class="goal ${done ? "done" : ""}">
    <div class="goal-top"><b>${esc(g.label)}</b>${done ? "<span>✓</span>" : ""}</div>
    <div class="num"><span data-count="${g.actual}" data-key="goal-${ui.week}-${g.key}">0</span><span class="of"> / ${g.target}${g.unit ? ` ${esc(g.unit)}` : ""}</span></div>
    <div class="progress"><i style="width:0" data-width="${g.ratio * 100}%"></i></div>
    <div class="goal-foot"><span>${manual ? "suivi manuel" : "mesuré depuis le suivi"}</span>
      ${manual ? `<div class="stepper"><button data-goal="${esc(g.key)}" data-add="-1" aria-label="Moins">−</button><button data-goal="${esc(g.key)}" data-add="1" aria-label="Plus">+</button></div>` : ""}</div>
  </div>`;
}

function dayCard(d) {
  const date = parseDay(d.day);
  return `<div class="day ${d.isToday ? "today" : ""} ${d.isPast ? "past" : ""}">
    <div class="day-head"><b>${WEEKDAYS[d.weekday - 1]}</b><span>${date.getDate()}/${date.getMonth() + 1}</span></div>
    ${d.routines
      .map(
        (r) => `<button class="routine ${r.done ? "done" : ""}" data-routine="${esc(r.key)}" data-day="${d.day}" data-week="${ui.week}" aria-pressed="${r.done}">
        <span class="check ${r.done ? "on" : ""} ${d.isPast && !r.done ? "missed" : ""}">${CHECK}</span><span>${esc(r.label)}</span></button>`,
      )
      .join("") || `<span class="muted small">Repos</span>`}
    <div class="day-apps" title="${d.applications} candidature(s) envoyée(s)">${"<i></i>".repeat(Math.min(d.applications, 12))}</div>
  </div>`;
}

function reviewCard(plan, p) {
  const r = plan.review;
  if (r)
    return `<div class="card"><div class="card-head"><h2>Bilan de la semaine</h2><span class="muted">${fmt(r.at, { day: "numeric", month: "short" })} · ${r.score} %</span></div>
      <div class="review-read">
        <div><h3>Ce qui a marché</h3><p>${esc(r.wins) || "—"}</p></div>
        <div><h3>Ce qui a freiné</h3><p>${esc(r.blockers) || "—"}</p></div>
        <div><h3>Leçons pour la suite</h3>${r.lessons.length ? `<ul>${r.lessons.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>` : "—"}</div>
      </div>${r.nextFocus ? `<p style="margin-top:12px"><b>Priorité suivante :</b> ${esc(r.nextFocus)}</p>` : ""}</div>`;
  const past = ui.week < state.currentWeek;
  const late = p.elapsedDays >= 5 || past;
  return `<div class="card"><div class="card-head"><h2>Bilan de la semaine</h2><span class="muted">${late ? "c’est le moment" : "à faire en fin de semaine"}</span></div>
    <form class="review-grid" id="review">
      <label>Ce qui a marché<textarea name="wins" placeholder="Ex. les candidatures du matin, le réseau…"></textarea></label>
      <label>Ce qui a freiné<textarea name="blockers" placeholder="Ex. trop de temps par CV, offres peu ciblées…"></textarea></label>
      <label class="wide">Leçons pour la semaine prochaine (une par ligne)<textarea name="lessons" placeholder="Ex. Postuler avant 10 h&#10;Cibler les offres de moins de 7 jours"></textarea></label>
      <label class="wide">Priorité de la semaine prochaine<input name="nextFocus" placeholder="Ex. décrocher deux entretiens" /></label>
      <div class="wide" style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
        <span class="muted small">Ou demandez à l’agent : « fais le bilan de ma semaine »</span>
        <button class="btn primary" type="submit">Enregistrer le bilan</button></div>
    </form></div>`;
}

/** Lessons from earlier reviews, kept in sight while the week is lived. */
function lessonsCard(id) {
  const earlier = state.lessons.filter((l) => l.week < id).slice(0, 4);
  if (!earlier.length) return "";
  return `<div class="card"><div class="card-head"><h2>Leçons à appliquer</h2><span class="muted">tirées des bilans précédents</span></div>${lessonList(earlier)}</div>`;
}

function historyCard() {
  const h = state.history.slice(-10);
  if (h.length < 2) return "";
  return `<div class="card"><div class="card-head"><h2>Semaine après semaine</h2><span class="muted">score réalisé / prévu</span></div>
    <div class="spark">${h
      .map(
        (w, i) => `<div class="${w.week === ui.week ? "current" : ""}" title="${esc(w.objective)}"><span>${w.score}</span>
        <i style="height:${Math.max(4, w.score * 0.42)}px;animation-delay:${i * 0.05}s"></i><span>${weekShort(w.week)}</span></div>`,
      )
      .join("")}</div></div>`;
}

/* ── lessons ──────────────────────────────────────────────────────────── */
function lessonList(list) {
  return `<div class="lessons">${list.map((l) => `<div class="lesson"><span class="mono">${weekShort(l.week)}</span><span>${esc(l.text)}</span></div>`).join("")}</div>`;
}

/* ── events ───────────────────────────────────────────────────────────── */
function go(view) {
  if (ui.view === "editor" && view !== "editor" && editor) {
    if (editor.dirty() && !confirm("Des modifications ne sont pas recompilées. Quitter l’éditeur quand même ?")) return;
    editor.destroy();
    editor = null;
  }
  ui.view = view;
  save();
  render();
  main.focus({ preventScroll: true });
  window.scrollTo({ top: 0 });
}

document.querySelector(".nav").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-view]");
  if (button) go(button.dataset.view);
});

main.addEventListener("click", async (event) => {
  const t = event.target.closest("button, [data-toggle]");
  if (!t) return;
  try {
    if (t.dataset.window) {
      ui.window = t.dataset.window;
      save();
      render();
    } else if (t.dataset.goto) go(t.dataset.goto);
    else if (t.dataset.editApp) openEditor(t.dataset.editApp, t.dataset.editDoc);
    else if (t.dataset.editorBack != null) go("applications");
    else if (t.dataset.openApp) {
      open.add(t.dataset.openApp);
      ui.q = "";
      ui.since = "all";
      ui.status = "";
      go("applications");
      main.querySelector(`[data-row="${t.dataset.openApp}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    }
    else if (t.dataset.since) {
      ui.since = t.dataset.since;
      save();
      render();
    } else if (t.dataset.toggle) {
      open.has(t.dataset.toggle) ? open.delete(t.dataset.toggle) : open.add(t.dataset.toggle);
      render();
    } else if (t.dataset.setStatus) {
      const [x, y] = centerOf(t);
      await api(`/api/applications/${t.dataset.id}/status`, { status: t.dataset.setStatus });
      toast(t.dataset.setStatus === "postulee" ? "Candidature envoyée — bravo !" : "Relance notée");
      if (t.dataset.setStatus === "postulee") confetti(x, y);
    } else if (t.dataset.routine) {
      const wasOn = t.getAttribute("aria-pressed") === "true";
      const [x, y] = centerOf(t);
      const box = t.classList.contains("check") ? t : t.querySelector(".check");
      box.classList.toggle("on", !wasOn);
      box.classList.add("pop");
      await api(`/api/plans/${t.dataset.week}/routines/${t.dataset.routine}`, { day: t.dataset.day, done: !wasOn });
      celebrate(t.dataset.week, t.dataset.day, !wasOn, x, y);
    } else if (t.dataset.goal) {
      const [x, y] = centerOf(t);
      const before = state.progress[ui.week].goals.find((g) => g.key === t.dataset.goal);
      await api(`/api/plans/${ui.week}/goals/${t.dataset.goal}`, { value: Number(t.dataset.add), add: true });
      const after = state.progress[ui.week].goals.find((g) => g.key === t.dataset.goal);
      if (before.ratio < 1 && after.ratio >= 1) (confetti(x, y, 40), toast(`Objectif atteint : ${after.label}`));
    } else if (t.dataset.weekShift != null) {
      ui.week = t.dataset.weekShift === "0" ? state.focusWeek : shiftWeek(ui.week, Number(t.dataset.weekShift));
      render();
    } else if (t.dataset.copy) {
      await navigator.clipboard.writeText(t.dataset.copy);
      toast("Copié — collez-le dans Claude Code ou Codex");
    }
  } catch (error) {
    toast(error.message, "error");
    render();
  }
});

function celebrate(weekId, day, done, x, y) {
  if (!done) return;
  const d = state.progress[weekId]?.daily.find((entry) => entry.day === day);
  if (d && d.routines.length && d.routines.every((r) => r.done)) {
    confetti(x, y, 34);
    toast("Toutes les routines du jour sont faites ✨");
  }
}

main.addEventListener("keydown", (event) => {
  const t = event.target.closest("[data-toggle]");
  if (t && (event.key === "Enter" || event.key === " ")) {
    event.preventDefault();
    t.click();
  }
});

main.addEventListener("change", async (event) => {
  const t = event.target;
  try {
    if (t.dataset.statusOf) {
      const [x, y] = centerOf(t);
      await api(`/api/applications/${t.dataset.statusOf}/status`, { status: t.value });
      toast(`Statut : ${statusLabel(t.value)}`);
      if (t.value === "offre" || t.value === "entretien") confetti(x, y, t.value === "offre" ? 60 : 30);
    } else if (t.id === "status-filter") {
      ui.status = t.value;
      save();
      render();
    }
  } catch (error) {
    toast(error.message, "error");
    render();
  }
});

main.addEventListener("input", (event) => {
  if (event.target.id === "search") {
    // Only the list changes, so the field keeps its focus and caret.
    ui.q = event.target.value;
    const items = filteredApplications();
    main.querySelector("#apps").innerHTML = listHtml(items);
    main.querySelector("#shown").textContent = items.length;
    animateRings(main);
  }
});

main.addEventListener(
  "blur",
  async (event) => {
    const t = event.target;
    if (!t.dataset?.notes) return;
    const current = state.applications.find((a) => a.id === t.dataset.notes);
    if (current && current.notes !== t.value) {
      try {
        await api(`/api/applications/${t.dataset.notes}`, { notes: t.value });
        toast("Notes enregistrées");
      } catch (error) {
        toast(error.message, "error");
      }
    }
  },
  true,
);

main.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  const data = Object.fromEntries(new FormData(form));
  try {
    if (form.id === "review") {
      const button = form.querySelector("button[type=submit]");
      const [x, y] = centerOf(button);
      await api(`/api/plans/${ui.week}/review`, data);
      confetti(x, y, 30);
      toast("Bilan enregistré — il guidera votre prochain plan");
    }
  } catch (error) {
    toast(error.message, "error");
  }
});

/* ── theme, live updates ──────────────────────────────────────────────── */
const themes = ["auto", "dark", "light"];
let theme = load("theme", { value: "auto" }).value;
function applyTheme() {
  if (theme === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.dataset.theme = theme;
  document.getElementById("theme").textContent = `◐ Thème : ${{ auto: "auto", dark: "sombre", light: "clair" }[theme]}`;
}
document.getElementById("theme").addEventListener("click", () => {
  theme = themes[(themes.indexOf(theme) + 1) % themes.length];
  try {
    localStorage.setItem("find-job:theme", JSON.stringify({ value: theme }));
  } catch {
    // Not remembered.
  }
  applyTheme();
});
applyTheme();

function live(on, text) {
  document.getElementById("live-dot").className = `live-dot ${on ? "on" : "off"}`;
  document.getElementById("live-text").textContent = text;
}
function connect() {
  const source = new EventSource("/api/events");
  source.onopen = () => live(true, "Synchronisé en direct");
  source.addEventListener("change", () => refresh().catch(() => {}));
  source.onerror = () => live(false, "Reconnexion…");
}

let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => ui.view === "dashboard" && (drawChart(), placeThumb()), 150);
});
document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && refresh().catch(() => {}));

refresh()
  .then(connect)
  .catch((error) => {
    main.innerHTML = `<div class="loading">${esc(error.message)} Le serveur find-job est-il lancé ?</div>`;
    live(false, "Hors ligne");
  });

window.addEventListener("beforeunload", (event) => {
  if (editor?.dirty()) event.preventDefault();
});
