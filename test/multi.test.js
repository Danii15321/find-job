import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { existsSync, writeFileSync } from "node:fs";
import { searchWeekNumber, resolveWeek, defaultStartWeek } from "../src/core/dates.js";
import { initWorkspace } from "../src/core/workspace.js";
import { cleanUrl, listApplications, prepareApplication } from "../src/core/applications.js";
import { ROOT, cli, tempWorkspace } from "./helpers.js";

const posting = (title, company) => `<html><head><script type="application/ld+json">${JSON.stringify({
  "@type": "JobPosting",
  title,
  hiringOrganization: { name: company },
  validThrough: "2026-12-01",
  description: `<p>${"Missions détaillées du poste. ".repeat(20)}</p>`,
})}</script></head><body></body></html>`;

test("search weeks start at week 1 on startWeek", () => {
  assert.equal(searchWeekNumber("2026-W44", "2026-W44"), 1);
  assert.equal(searchWeekNumber("2026-W43", "2026-W44"), 0);
  assert.equal(searchWeekNumber("2027-W01", "2026-W53"), 2);
  assert.equal(resolveWeek("S3", "2026-W44"), "2026-W46");
  assert.equal(resolveWeek("2026-W50", "2026-W44"), "2026-W50");
  assert.equal(defaultStartWeek(new Date(2026, 9, 24)), "2026-W44", "Saturday → next Monday");
  assert.equal(defaultStartWeek(new Date(2026, 9, 21)), "2026-W43");
});

test("plans before the start target week 1; S-numbers are accepted", () => {
  const dir = tempWorkspace();
  cli(["init"], dir);
  assert.equal(cli(["config", "startWeek", "2030-01-07"], dir).json.startWeek, "2030-W02");
  const file = join(dir, "plan.json");
  require_write(file, { goals: [{ label: "5 candidatures", metric: "applications", target: 5 }] });
  assert.equal(cli(["plan", "set", "--file", file], dir).json.week, "2030-W02");
  require_write(file, { week: "S2", routines: [{ label: "Veille" }] });
  assert.equal(cli(["plan", "set", "--file", file], dir).json.week, "2030-W03");
  assert.equal(cli(["plan", "show", "--week", "S2"], dir).json.label, "S2");
});

function require_write(file, data) {
  writeFileSync(file, JSON.stringify(data));
}

test("tracking parameters are removed and a tracked offer is not prepared twice", () => {
  assert.equal(cleanUrl("https://jobs.lever.co/acme/1?lever-origin=applied&lever-source%5B%5D=linkedin"), "https://jobs.lever.co/acme/1");
  assert.equal(cleanUrl("https://fr.indeed.com/viewjob?jk=42&utm_source=x"), "https://fr.indeed.com/viewjob?jk=42");
  const ws = initWorkspace(tempWorkspace());
  const a = prepareApplication(ws, { company: "Acme", title: "Dev", url: "https://jobs.lever.co/acme/1?lever-origin=applied", deadline: "2026-12-01T00:00:00Z" });
  assert.equal(a.url, "https://jobs.lever.co/acme/1");
  assert.equal(a.deadline, "2026-12-01");
  assert.throws(() => prepareApplication(ws, { company: "Acme", title: "Dev", url: "https://www.jobs.lever.co/acme/1/" }), (e) => e.code === "ALREADY_TRACKED" && e.details.id === a.id);
  assert.equal(prepareApplication(ws, { company: "Acme", title: "Dev", url: "https://jobs.lever.co/acme/1", force: true }).company, "Acme");
});

test("several offers prepared at the same time get distinct folders", async () => {
  const dir = tempWorkspace();
  cli(["init"], dir);
  const run = (n) =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, [join(ROOT, "bin/find-job.js"), "prepare", "--company", "Acme", "--title", "Data Engineer", "--url", `https://jobs.example.com/${n}`], { cwd: dir });
      let out = "";
      child.stdout.on("data", (d) => (out += d));
      child.on("close", (code) => resolve({ code, json: JSON.parse(out || "{}") }));
    });
  const results = await Promise.all([1, 2, 3, 4, 5].map(run));
  assert.ok(results.every((r) => r.code === 0));
  const folders = new Set(results.map((r) => r.json.folder));
  assert.equal(folders.size, 5);
  for (const folder of folders) assert.ok(existsSync(join(folder, "cv_acme.tex")) && existsSync(join(folder, "lettre_acme.tex")));
  const { openWorkspace } = await import("../src/core/workspace.js");
  assert.equal(listApplications(openWorkspace(dir)).length, 5, "no write lost under concurrency");
});

test("offer reads several URLs in parallel and reports each one", async () => {
  const server = createServer((req, res) => {
    const path = new URL(req.url, "http://x").pathname;
    if (path === "/a") return res.end(posting("Data Engineer", "Acme"));
    if (path === "/b") return res.end(posting("Développeur IA", "Beta"));
    res.writeHead(404).end("introuvable");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const dir = tempWorkspace();
    cli(["init"], dir);
    const result = await new Promise((resolve) => {
      const child = spawn(process.execPath, [join(ROOT, "bin/find-job.js"), "offer", `${base}/a?utm_source=x`, `${base}/b`, `${base}/c`], { cwd: dir });
      let out = "";
      child.stdout.on("data", (d) => (out += d));
      child.on("close", () => resolve(JSON.parse(out)));
    });
    assert.equal(result.count, 3);
    const [a, b, c] = result.offers;
    assert.equal(a.company, "Acme");
    assert.equal(a.url, `${base}/a`);
    assert.equal(b.title, "Développeur IA");
    assert.notEqual(a.file, b.file);
    assert.equal(c.quality, "blocked");
    const prepared = cli(["prepare", "--offer", a.file], dir);
    assert.equal(prepared.json.application.deadline, "2026-12-01");
    const again = await new Promise((resolve) => {
      const child = spawn(process.execPath, [join(ROOT, "bin/find-job.js"), "offer", `${base}/a`, `${base}/b`], { cwd: dir });
      let out = "";
      child.stdout.on("data", (d) => (out += d));
      child.on("close", () => resolve(JSON.parse(out)));
    });
    assert.equal(again.offers[0].alreadyTracked.id, prepared.json.application.id);
    assert.equal(again.offers[1].alreadyTracked, undefined);
  } finally {
    server.close();
  }
});
