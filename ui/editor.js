/*
 * In-browser LaTeX editor, after Overleaf: source on the left, PDF on the
 * right, Ctrl+S saves, recompiles and refreshes the preview. A transparent
 * textarea sits over a highlighted copy of the text, so typing stays native
 * (undo, selection, IME) while the code is coloured.
 */

const DOCS = { cv: "CV", letter: "Lettre" };
let live = null; // one editor at a time: a new mount retires the previous one

export function mountEditor(root, ctx) {
  live?.destroy();
  const { application, token, esc, fileUrl, toast, onCompiled } = ctx;
  const docs = { cv: null, letter: null }; // { content, saved, mtimeMs, path, pdf }
  let current = ctx.doc && DOCS[ctx.doc] ? ctx.doc : "cv";
  let busy = false;
  let queued = false;
  let lastResult = { cv: null, letter: null };
  let conflict = null;

  root.innerHTML = `<section class="view editor-view">
    <div class="editor-bar">
      <button class="btn icon" data-editor-back aria-label="Retour aux candidatures">‹</button>
      <div class="editor-title"><b>${esc(application.company)}</b><span>${esc(application.title)}</span></div>
      <div class="doc-tabs" role="tablist">${Object.entries(DOCS)
        .map(([key, label]) => `<button role="tab" data-doc="${key}">${label}<i class="dot" hidden></i></button>`)
        .join("")}</div>
      <div class="editor-status" id="editor-status" aria-live="polite"></div>
      <button class="btn primary" data-compile title="Enregistrer et recompiler">Recompiler <kbd>Ctrl S</kbd></button>
    </div>
    <div class="conflict" id="editor-conflict" hidden>
      <span>Ce fichier a été modifié ailleurs (VS Code, l’agent) depuis son ouverture.</span>
      <button class="btn small" data-conflict="reload">Recharger sa version</button>
      <button class="btn small" data-conflict="force">Garder la mienne</button>
    </div>
    <div class="editor-panes">
      <div class="code-pane">
        <div class="code">
          <div class="gutter" id="gutter" aria-hidden="true"></div>
          <div class="code-area">
            <pre class="highlight" id="highlight" aria-hidden="true"></pre>
            <textarea id="source" spellcheck="false" autocapitalize="off" autocomplete="off" wrap="off" aria-label="Source LaTeX"></textarea>
          </div>
        </div>
        <div class="problems" id="problems"></div>
      </div>
      <div class="pdf-pane">
        <iframe id="pdf" title="Aperçu PDF"></iframe>
        <div class="pdf-empty" id="pdf-empty" hidden>Pas encore de PDF : appuyez sur Recompiler.</div>
      </div>
    </div>
  </section>`;

  const section = root.querySelector(".editor-view");
  // Only the mounted, visible editor reacts; a retired one keeps to its detached DOM.
  const alive = () => live === controller && section.isConnected;
  const $ = (id) => section.querySelector(`#${id}`);
  const source = $("source");
  const highlight = $("highlight");
  const gutter = $("gutter");

  /* ── highlighting, gutter, scrolling ─────────────────────────────────── */
  function paint() {
    const text = source.value;
    // `\%` is consumed as a command before `%` can start a comment.
    highlight.innerHTML = `${text.replace(/(%.*$)|(\\[a-zA-Z@]+\*?|\\.)|([{}[\]])|([^%\\{}[\]]+)|([\s\S])/gm, (m, comment, command, brace, plain, other) => {
      if (comment) return `<span class="tk-c">${esc(comment)}</span>`;
      if (command) return `<span class="tk-k">${esc(command)}</span>`;
      if (brace) return `<span class="tk-b">${esc(brace)}</span>`;
      return esc(plain ?? other);
    })}\n`;
    const lines = text.split("\n").length;
    const errors = new Set((lastResult[current]?.build?.errors ?? []).map((e) => e.line));
    gutter.innerHTML = Array.from({ length: lines }, (_, i) => `<span${errors.has(i + 1) ? ' class="err"' : ""}>${i + 1}</span>`).join("");
    syncScroll();
  }
  function syncScroll() {
    highlight.scrollTop = source.scrollTop;
    highlight.scrollLeft = source.scrollLeft;
    gutter.scrollTop = source.scrollTop;
  }
  source.addEventListener("scroll", syncScroll);
  source.addEventListener("input", () => {
    docs[current].content = source.value;
    paint();
    chrome();
  });
  source.addEventListener("keydown", (event) => {
    if (event.key === "Tab" && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      document.execCommand("insertText", false, "  ");
    }
  });

  function jumpTo(line) {
    const lines = source.value.split("\n");
    const start = lines.slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0);
    source.focus();
    source.setSelectionRange(start, start + (lines[line - 1]?.length ?? 0));
    const lineHeight = parseFloat(getComputedStyle(source).lineHeight) || 20;
    source.scrollTop = Math.max(0, (line - 1) * lineHeight - source.clientHeight / 3);
    syncScroll();
  }

  /* ── status, problems, preview ───────────────────────────────────────── */
  const dirty = (key) => docs[key] && docs[key].content !== docs[key].saved;

  function chrome() {
    for (const button of section.querySelectorAll("[data-doc]")) {
      const key = button.dataset.doc;
      button.classList.toggle("active", key === current);
      button.disabled = !docs[key];
      button.querySelector(".dot").hidden = !dirty(key);
    }
    const result = lastResult[current];
    const status = $("editor-status");
    if (busy) status.innerHTML = `<span class="spinner"></span>Compilation…`;
    else if (dirty(current)) status.innerHTML = `<span class="state warn">Modifié</span> Ctrl+S pour recompiler`;
    else if (!result) status.innerHTML = `<span class="state">Ouvert</span>`;
    else if (!result.build.ok) status.innerHTML = `<span class="state bad">Erreur de compilation</span>`;
    else {
      const review = result.review;
      const verdict = review ? `<span class="state ${review.ok ? "ok" : "warn"}">${esc(review.ok ? review.verdict : "à corriger")}</span>` : "";
      status.innerHTML = `${verdict} ${result.build.pages} page(s) · ${(result.build.durationMs / 1000).toFixed(1)} s${review?.score != null ? ` · ${review.score} %` : ""}`;
    }
    problems(result);
  }

  function problems(result) {
    const box = $("problems");
    if (!result) return (box.innerHTML = "");
    const rows = [];
    for (const error of result.build.errors) rows.push(row("bad", error.line, error.message));
    if (!result.build.ok && !result.build.errors.length && result.build.tail) rows.push(`<pre class="tail">${esc(result.build.tail)}</pre>`);
    for (const box of result.build.overfull) rows.push(row("warn", box.line, `Ligne trop longue de ${box.pt.toFixed(1)} pt`));
    for (const char of result.build.missingCharacters) rows.push(row("bad", null, `Caractère absent de la police : ${char}`));
    for (const check of result.review?.problems ?? [])
      rows.push(row(check.level === "bloquant" ? "bad" : "warn", null, `${check.label} : ${check.detail}${check.items?.length ? ` (${check.items.slice(0, 6).join(", ")})` : ""}`));
    if (result.review && !result.review.otherDocOk) rows.push(row("warn", null, `${current === "cv" ? "La lettre" : "Le CV"} a aussi des points à corriger.`));
    box.innerHTML = rows.length ? rows.join("") : `<div class="problem ok">Aucun problème : le document est prêt.</div>`;
  }
  function row(kind, line, message) {
    return `<button class="problem ${kind}" ${line ? `data-line="${line}"` : "disabled"}>${line ? `<b>l.${line}</b>` : ""}<span>${esc(message)}</span></button>`;
  }

  function preview(force = false) {
    const pdf = docs[current]?.pdf;
    const frame = $("pdf");
    $("pdf-empty").hidden = !!pdf;
    frame.hidden = !pdf;
    if (!pdf) return;
    const next = `${fileUrl(pdf)}&v=${docs[current].version ?? 0}#view=FitH`;
    if (force || frame.dataset.src !== next) {
      frame.dataset.src = next;
      frame.src = next;
    }
  }

  function show(key) {
    current = key;
    source.value = docs[key]?.content ?? "";
    source.scrollTop = 0;
    paint();
    chrome();
    preview();
  }

  /* ── load, save & compile ────────────────────────────────────────────── */
  let loadError = null;
  async function load(key) {
    const response = await fetch(`/api/applications/${application.id}/source?doc=${key}`, { cache: "no-store" }).catch(() => null);
    if (!response?.ok) {
      const data = await response?.json().catch(() => ({}));
      if (key === "cv") loadError = data?.error?.message ?? "le serveur ne répond pas";
      return null;
    }
    const data = await response.json();
    const pdf = key === "cv" ? application.files.pdf : application.files.letterPdf;
    const ready = key === "cv" ? application.pdfReady : application.letterReady;
    return { content: data.content, saved: data.content, mtimeMs: data.mtimeMs, path: data.path, pdf: ready ? pdf : null, version: Date.now() };
  }

  async function compile({ force = false } = {}) {
    if (!alive() || !docs[current]) return;
    if (busy) {
      queued = true;
      return;
    }
    busy = true;
    const key = current;
    const sent = docs[key].content;
    chrome();
    try {
      const response = await fetch(`/api/applications/${application.id}/source`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-find-job-token": token },
        body: JSON.stringify({ doc: key, content: sent, mtimeMs: docs[key].mtimeMs, force }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.status === 409) {
        conflict = { key, ...data.error.details };
        $("editor-conflict").hidden = false;
        return;
      }
      if (!response.ok) throw new Error(data.error?.message ?? `Erreur ${response.status}`);
      const result = data.result;
      docs[key].saved = sent;
      docs[key].mtimeMs = result.mtimeMs;
      lastResult[key] = result;
      if (result.build.ok) {
        docs[key].pdf = result.build.pdf;
        docs[key].version = Date.now();
      }
      if (result.plain) toast("Version sans liens mise à jour aussi");
      onCompiled?.(result);
    } catch (error) {
      toast(error.message, "error");
    } finally {
      busy = false;
      if (key === current) {
        paint();
        chrome();
        preview();
      } else chrome();
      if (queued) {
        queued = false;
        compile();
      }
    }
  }

  async function resolveConflict(choice) {
    $("editor-conflict").hidden = true;
    const pending = conflict;
    conflict = null;
    if (!pending) return;
    if (choice === "reload") {
      docs[pending.key] = { ...docs[pending.key], content: pending.content, saved: pending.content, mtimeMs: pending.mtimeMs };
      if (pending.key === current) show(current);
      toast("Version du disque rechargée");
    } else {
      current = pending.key;
      compile({ force: true });
    }
  }

  /* ── events ──────────────────────────────────────────────────────────── */
  // Bound to the editor's own section: it goes away with it, nothing accumulates on remount.
  section.addEventListener("click", (event) => {
    const t = event.target.closest("button");
    if (!t) return;
    if (t.dataset.doc && docs[t.dataset.doc]) show(t.dataset.doc);
    else if (t.dataset.compile != null) compile();
    else if (t.dataset.line) jumpTo(Number(t.dataset.line));
    else if (t.dataset.conflict) resolveConflict(t.dataset.conflict);
  });
  const onKey = (event) => {
    if (!alive()) return;
    if ((event.ctrlKey || event.metaKey) && (event.key === "s" || event.key === "Enter")) {
      event.preventDefault();
      compile();
    }
  };
  document.addEventListener("keydown", onKey);

  (async () => {
    [docs.cv, docs.letter] = await Promise.all([load("cv"), load("letter")]);
    if (!docs.cv && !docs.letter) {
      // Never leave an empty editor: say what failed and how to fix it.
      section.querySelector(".editor-panes").innerHTML = `<div class="empty"><span class="big">⚠</span><b>Impossible d’ouvrir les fichiers de ce dossier</b>${esc(loadError ?? "")}<span>Si le tableau de bord a été lancé avant une mise à jour de find-job, arrêtez-le puis relancez <code>find-job ui</code>.</span></div>`;
      chrome();
      return;
    }
    if (!docs[current]) current = docs.cv ? "cv" : "letter";
    show(current);
    // Open at the top of the file, caret on the first line.
    source.setSelectionRange(0, 0);
    source.focus({ preventScroll: true });
    source.scrollTop = 0;
    syncScroll();
  })();

  const controller = {
    id: application.id,
    get doc() {
      return current;
    },
    dirty: () => dirty("cv") || dirty("letter"),
    /** The dashboard refreshed: keep the editor, just follow new PDF availability. */
    update(app) {
      Object.assign(application, app);
      chrome();
    },
    destroy() {
      document.removeEventListener("keydown", onKey);
      if (live === controller) live = null;
    },
  };
  live = controller;
  return controller;
}
