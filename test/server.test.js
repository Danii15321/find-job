import { test } from "node:test";
import assert from "node:assert/strict";
import { initWorkspace } from "../src/core/workspace.js";
import { listApplications, prepareApplication } from "../src/core/applications.js";
import { startServer } from "../src/server/server.js";
import { latexAvailable, tempWorkspace } from "./helpers.js";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

test("the dashboard API reads, writes with the session token and guards files", async () => {
  const ws = initWorkspace(tempWorkspace());
  const a = prepareApplication(ws, { company: "Acme", title: "Dev" });
  const { url, stop } = await startServer(ws, { port: 0, open: false });
  try {
    const html = await (await fetch(url)).text();
    const token = /name="find-job-token" content="([^"]+)"/.exec(html)[1];
    assert.ok(token.length > 10);

    const state = await (await fetch(`${url}/api/state`)).json();
    assert.equal(state.applications.length, 1);
    assert.ok(state.windows["90j"]);
    assert.ok(state.server.features.includes("editor"), "the page can tell a stale server from a current one");

    const forbidden = await fetch(`${url}/api/applications/${a.id}/status`, { method: "POST", body: '{"status":"postulee"}' });
    assert.equal(forbidden.status, 403);

    const ok = await fetch(`${url}/api/applications/${a.id}/status`, {
      method: "POST",
      headers: { "x-find-job-token": token },
      body: JSON.stringify({ status: "postulee" }),
    });
    assert.equal((await ok.json()).result.status, "postulee");

    const bad = await fetch(`${url}/api/applications/${a.id}/status`, { method: "POST", headers: { "x-find-job-token": token }, body: '{"status":"x"}' });
    assert.equal(bad.status, 400);

    assert.equal((await fetch(`${url}/files?path=${encodeURIComponent(a.files.tex)}`)).status, 200);
    assert.equal((await fetch(`${url}/files?path=../../etc/passwd`)).status, 404);
    assert.equal((await fetch(`${url}/files?path=.find-job/config.json`)).status, 404);
  } finally {
    stop();
  }
});

test("the editor reads, saves, recompiles and refuses to overwrite a change made elsewhere", { skip: !latexAvailable && "pdflatex absent" }, async () => {
  const ws = initWorkspace(tempWorkspace());
  const a = prepareApplication(ws, { company: "Edit", title: "Dev" });
  const { url, stop } = await startServer(ws, { port: 0, open: false });
  try {
    const token = /name="find-job-token" content="([^"]+)"/.exec(await (await fetch(url)).text())[1];
    const post = (body, auth = token) =>
      fetch(`${url}/api/applications/${a.id}/source`, { method: "POST", headers: { "x-find-job-token": auth }, body: JSON.stringify(body) });

    const source = await (await fetch(`${url}/api/applications/${a.id}/source?doc=cv`)).json();
    assert.match(source.content, /\\documentclass/);
    assert.match(source.path, /cv_edit\.tex$/);
    const letter = await (await fetch(`${url}/api/applications/${a.id}/source?doc=letter`)).json();
    assert.match(letter.path, /lettre_edit\.tex$/);

    assert.equal((await post({ doc: "cv", content: source.content }, "wrong")).status, 403);

    const edited = source.content.replace("Ingénieure données}", "Data Engineer}");
    const saved = await post({ doc: "cv", content: edited, mtimeMs: source.mtimeMs });
    assert.equal(saved.status, 200);
    const { result } = await saved.json();
    assert.equal(result.build.ok, true);
    assert.equal(result.build.pages, 1);
    assert.match(result.build.pdf, /cv_edit\.pdf$/);
    assert.ok(result.review, "the application is reviewed after each compile");
    assert.equal(readFileSync(join(ws.root, a.files.tex), "utf8"), edited);
    assert.equal(listApplications(ws)[0].quality.pages, 1, "the dashboard verdict follows the editor");

    // VS Code or the agent changed the file meanwhile: the stale editor must not overwrite it.
    writeFileSync(join(ws.root, a.files.tex), `${edited}\n% changé ailleurs\n`);
    const stale = await post({ doc: "cv", content: edited, mtimeMs: result.mtimeMs - 5000 });
    assert.equal(stale.status, 409);
    assert.match((await stale.json()).error.details.content, /changé ailleurs/);
    assert.equal((await post({ doc: "cv", content: edited, mtimeMs: result.mtimeMs - 5000, force: true })).status, 200);

    const broken = await (await post({ doc: "cv", content: edited.replace("\\section{Profil}", "\\section{Profil}\\nimportequoi") })).json();
    assert.equal(broken.result.build.ok, false);
    assert.match(broken.result.build.errors[0].message, /Undefined control sequence/);

    assert.equal((await post({ doc: "cv", content: "pas de documentclass" })).status, 400);
    assert.equal((await post({ doc: "autre", content: edited })).status, 400);
  } finally {
    stop();
  }
});
