/**
 * Compile a CV to PDF next to its .tex. Auxiliary files go to a hidden
 * `.build/` folder so the application folder only shows the .tex, the .pdf
 * and the offer. Resources of the base CV (photo, class, fonts) resolve via
 * TEXINPUTS, so the adapted copy compiles without duplicating them.
 */
import { spawnSync } from "node:child_process";
import { inflateSync } from "node:zlib";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { FindJobError } from "../core/store.js";

const ENGINES = ["pdflatex", "lualatex", "xelatex"];

/** Suffix of the variant without links nor open action, for portals that refuse "active content". */
export const PLAIN_SUFFIX = "_sans_liens";

/**
 * What upload filters of some job portals call active content: an action run
 * at opening, clickable links, scripts, attachments, forms. Compressed object
 * streams are inflated so nothing hides from the count.
 */
export function activeContent(pdfPath) {
  const data = readFileSync(pdfPath);
  const raw = data.toString("latin1");
  const parts = [raw];
  for (const match of raw.matchAll(/stream\r?\n/g)) {
    const start = match.index + match[0].length;
    const end = raw.indexOf("endstream", start);
    if (end < 0) continue;
    try {
      parts.push(inflateSync(data.subarray(start, end)).toString("latin1"));
    } catch {
      // Not a deflated stream (images, fonts): nothing to read there.
    }
  }
  const text = parts.join("\n");
  const count = (key) => (text.match(new RegExp(`/${key}(?![A-Za-z])`, "g")) ?? []).length;
  const found = {
    openAction: count("OpenAction"),
    links: (text.match(/\/URI\s*[(<]/g) ?? []).length,
    javascript: count("JavaScript") + count("JS"),
    launch: count("Launch"),
    attachments: count("EmbeddedFile"),
    forms: count("AcroForm") + count("XFA") + count("SubmitForm"),
    automaticActions: count("AA"),
  };
  return { ...found, total: Object.values(found).reduce((a, b) => a + b, 0) };
}

function available(command) {
  return spawnSync(command, ["--version"], { stdio: "ignore", timeout: 10_000 }).status === 0;
}

export function detectEngine(source, configured = "auto") {
  if (configured && configured !== "auto") return configured;
  const magic = /^%\s*!TEX\s+(?:TS-)?program\s*=\s*(\w+)/im.exec(source)?.[1]?.toLowerCase();
  if (magic && ENGINES.includes(magic)) return magic;
  if (/\\usepackage(\[[^\]]*\])?\{(fontspec|unicode-math)\}|\\setmainfont/.test(source))
    return available("xelatex") ? "xelatex" : "lualatex";
  if (/\\documentclass(\[[^\]]*\])?\{(awesome-cv|altacv)\}/.test(source)) return available("xelatex") ? "xelatex" : "lualatex";
  return "pdflatex";
}

export function parseLog(log) {
  const lines = log.split("\n");
  const errors = [];
  lines.forEach((line, index) => {
    const match = /^(?:[^\s:]+\.(?:tex|sty|cls):(\d+): |! )(.*)$/.exec(line);
    if (!match) return;
    const context = lines.slice(index + 1, index + 4).find((next) => /^l\.\d+/.test(next));
    errors.push({ line: Number(match[1] ?? /^l\.(\d+)/.exec(context ?? "")?.[1]) || null, message: match[2].trim(), context: context?.trim() ?? "" });
  });
  const overfull = [...log.matchAll(/Overfull \\hbox \(([\d.]+)pt too wide\)[^\n]*?lines? (\d+)/g)].map(([, pt, line]) => ({
    pt: Number(pt),
    line: Number(line),
  }));
  const missing = [...new Set([...log.matchAll(/Missing character: There is no (\S+)/g)].map(([, char]) => char))];
  const undefinedRefs = /There were undefined references/.test(log);
  const pages = Number(/Output written on .*?\((\d+) pages?/.exec(log)?.[1] ?? 0);
  // The closing "Fatal error occurred" / "Emergency stop" lines repeat the real error: keep the cause only.
  const causes = errors.filter((error) => !/^==> Fatal error|^Emergency stop/.test(error.message));
  return { errors: dedupe(causes.length ? causes : errors), overfull, missing, undefinedRefs, pages };
}

function dedupe(errors) {
  const seen = new Set();
  return errors.filter((error) => {
    const id = `${error.line}:${error.message}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/**
 * What the last compilation of `texPath` reported, read back from its log:
 * lets a review reuse a fresh PDF without compiling it again.
 */
export function lastBuild(texPath) {
  const log = join(dirname(texPath), ".build", `${basename(texPath, ".tex")}.log`);
  if (!existsSync(log)) return null;
  const parsed = parseLog(readFileSync(log, "utf8"));
  return { pages: parsed.pages, overfull: parsed.overfull, missingCharacters: parsed.missing, errors: parsed.errors };
}

/**
 * `plain: true` compiles <name>_sans_liens.pdf from the same source with
 * hyperref in draft mode: same layout, no clickable links, no open action.
 */
export function buildPdf(texPath, { resourceDirs = [], engine = "auto", timeoutMs = 180_000, plain = false } = {}) {
  if (!existsSync(texPath)) throw new FindJobError("NOT_FOUND", `Fichier introuvable : ${texPath}`);
  const folder = dirname(texPath);
  const sourceName = basename(texPath, ".tex");
  const name = plain ? `${sourceName}${PLAIN_SUFFIX}` : sourceName;
  const buildDir = join(folder, ".build");
  mkdirSync(buildDir, { recursive: true });
  const source = readFileSync(texPath, "utf8");
  const chosen = detectEngine(source, engine);
  if (!available(chosen))
    throw new FindJobError("LATEX_MISSING", `${chosen} est introuvable. Installez TeX Live (ex. sudo apt install texlive-latex-extra texlive-fonts-extra latexmk).`);

  const env = {
    ...process.env,
    TEXINPUTS: [folder, ...resourceDirs, ""].join(":"),
    max_print_line: "10000",
    error_line: "254",
    half_error_line: "238",
  };
  const common = ["-interaction=nonstopmode", "-halt-on-error", "-file-line-error"];
  const started = Date.now();
  let status;
  let output = "";
  if (plain) {
    // The source stays untouched: hyperref receives "draft" before the document loads it.
    for (let pass = 0; pass < 3; pass++) {
      const result = spawnSync(
        chosen,
        [...common, `-jobname=${name}`, `-output-directory=${buildDir}`, `\\PassOptionsToPackage{draft}{hyperref}\\input{${sourceName}.tex}`],
        { cwd: folder, env, encoding: "utf8", timeout: timeoutMs },
      );
      status = result.status === 0 ? 0 : 1;
      output = result.stdout ?? "";
      if (status !== 0 || !/Rerun to get|Label\(s\) may have changed/.test(output)) break;
    }
  } else if (available("latexmk")) {
    const flag = { pdflatex: "-pdf", lualatex: "-lualatex", xelatex: "-xelatex" }[chosen];
    const result = spawnSync("latexmk", [flag, ...common, `-outdir=${buildDir}`, `${name}.tex`], {
      cwd: folder,
      env,
      encoding: "utf8",
      timeout: timeoutMs,
    });
    status = result.status;
    output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  } else {
    for (let pass = 0; pass < 2 && status !== 1; pass++) {
      const result = spawnSync(chosen, [...common, `-output-directory=${buildDir}`, `${name}.tex`], {
        cwd: folder,
        env,
        encoding: "utf8",
        timeout: timeoutMs,
      });
      status = result.status === 0 ? 0 : 1;
      output = result.stdout ?? "";
    }
  }
  // mktexpk drops missfont.log next to the source when a font is missing.
  if (existsSync(join(folder, "missfont.log"))) renameSync(join(folder, "missfont.log"), join(buildDir, "missfont.log"));
  const logFile = join(buildDir, `${name}.log`);
  const log = existsSync(logFile) ? readFileSync(logFile, "utf8") : output;
  const parsed = parseLog(log);
  const built = join(buildDir, `${name}.pdf`);
  const pdf = join(folder, `${name}.pdf`);
  // latexmk exits 0 without rebuilding when the PDF is already up to date; any failure exits non-zero.
  const ok = status === 0 && existsSync(built) && parsed.errors.length === 0;
  if (ok) copyFileSync(built, pdf);
  return {
    ok,
    engine: chosen,
    tex: texPath,
    pdf: ok ? pdf : null,
    ...(ok ? { active: activeContent(pdf) } : {}),
    pages: parsed.pages,
    errors: parsed.errors,
    overfull: parsed.overfull,
    missingCharacters: parsed.missing,
    undefinedReferences: parsed.undefinedRefs,
    log: logFile,
    durationMs: Date.now() - started,
    ...(ok || parsed.errors.length ? {} : { tail: output.split("\n").slice(-25).join("\n") }),
  };
}
