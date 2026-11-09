/**
 * Local dashboard server. It listens on the loopback only, serves the
 * interface and a small JSON API over the same memory as the CLI, and pushes
 * a "change" event whenever `.find-job/` is written so a CV registered by the
 * agent appears in an open tab without reloading.
 *
 * Writes require the session token embedded in the page, so another website
 * open in the browser cannot change the memory through this server.
 */
import { createServer } from "node:http";
import { createReadStream, existsSync, readFileSync, statSync, watch } from "node:fs";
import { extname, join, normalize, relative, resolve, sep } from "node:path";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { FindJobError } from "../core/store.js";
import { editApplication, removeApplication, setStatus } from "../core/applications.js";
import { saveReview, setGoalProgress, setPlan, toggleRoutine } from "../core/plans.js";
import { snapshot } from "../core/stats.js";
import { readSource, saveAndCompile } from "../cv/source.js";

const UI_DIR = fileURLToPath(new URL("../../ui/", import.meta.url));
// The interface is read from disk on each request; a server started before an
// update announces what it supports so a newer page can tell it is stale.
const FEATURES = ["editor", "sans-liens"];
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".pdf": "application/pdf",
  ".tex": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".png": "image/png",
};

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store", "x-content-type-options": "nosniff" });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) throw new FindJobError("INVALID_INPUT", "Requête trop volumineuse.");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new FindJobError("INVALID_INPUT", "JSON invalide.");
  }
}

/** Only files inside the applications folder or the base CV may be opened. */
function workspaceFile(ws, path) {
  const absolute = resolve(ws.root, normalize(String(path ?? "")));
  const allowed = [ws.outputDir + sep, ws.baseCvPath];
  if (!allowed.some((prefix) => absolute === prefix || absolute.startsWith(prefix))) return null;
  if (relative(ws.root, absolute).split(sep).some((part) => part.startsWith("."))) return null;
  return existsSync(absolute) && statSync(absolute).isFile() ? absolute : null;
}

function routes(ws) {
  return [
    ["POST", /^\/api\/applications\/([\w-]+)\/status$/, (b, [id]) => setStatus(ws, id, b.status, { note: b.note })],
    ["POST", /^\/api\/applications\/([\w-]+)$/, (b, [id]) => editApplication(ws, id, b)],
    ["DELETE", /^\/api\/applications\/([\w-]+)$/, (_, [id]) => removeApplication(ws, id)],
    ["POST", /^\/api\/plans$/, (b) => setPlan(ws, b)],
    ["POST", /^\/api\/plans\/([\w-]+)\/routines\/([\w-]+)$/, (b, [week, key]) => toggleRoutine(ws, week, key, b.day, b.done)],
    ["POST", /^\/api\/plans\/([\w-]+)\/goals\/([\w-]+)$/, (b, [week, key]) => setGoalProgress(ws, week, key, b.value, { add: !!b.add })],
    ["POST", /^\/api\/plans\/([\w-]+)\/review$/, (b, [week]) => saveReview(ws, week, b)],
    ["POST", /^\/api\/applications\/([\w-]+)\/source$/, (b, [id]) => saveAndCompile(ws, id, b.doc ?? "cv", b.content, { mtimeMs: b.mtimeMs, force: !!b.force })],
    ["POST", /^\/api\/journal$/, (b) => ws.store.log(b.type || "note", String(b.summary ?? "").trim() || "(vide)")],
  ];
}

export function createApp(ws) {
  const token = randomBytes(18).toString("base64url");
  const clients = new Set();
  const table = routes(ws);
  let pending = null;
  const notify = () => {
    clearTimeout(pending);
    pending = setTimeout(() => {
      for (const client of clients) client.write(`event: change\ndata: ${Date.now()}\n\n`);
    }, 120);
  };
  let watcher = null;
  try {
    watcher = watch(ws.store.dir, (_, file) => {
      if (file && !String(file).endsWith(".tmp") && file !== ".lock") notify();
    });
  } catch {
    // Without fs.watch the interface still refreshes on focus.
  }

  const handler = async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    try {
      if (req.method === "GET" && url.pathname === "/") {
        const html = readFileSync(join(UI_DIR, "index.html"), "utf8").replace("__FIND_JOB_TOKEN__", token);
        return send(res, 200, html, TYPES[".html"]);
      }
      if (req.method === "GET" && url.pathname.startsWith("/ui/")) {
        const file = resolve(UI_DIR, `.${url.pathname.slice(3)}`);
        if (!file.startsWith(UI_DIR) || !existsSync(file)) return send(res, 404, { error: "introuvable" });
        return send(res, 200, readFileSync(file), TYPES[extname(file)] ?? "application/octet-stream");
      }
      if (req.method === "GET" && url.pathname === "/api/state") return send(res, 200, { ...snapshot(ws), server: { features: FEATURES } });
      const source = req.method === "GET" && /^\/api\/applications\/([\w-]+)\/source$/.exec(url.pathname);
      if (source) return send(res, 200, readSource(ws, source[1], url.searchParams.get("doc") ?? "cv"));
      if (req.method === "GET" && url.pathname === "/api/events") {
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
        res.write("retry: 2000\n\n");
        clients.add(res);
        const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
        req.on("close", () => {
          clearInterval(ping);
          clients.delete(res);
        });
        return;
      }
      if (req.method === "GET" && url.pathname === "/files") {
        const file = workspaceFile(ws, url.searchParams.get("path"));
        if (!file) return send(res, 404, { error: "Fichier introuvable ou hors des candidatures." });
        res.writeHead(200, {
          "content-type": TYPES[extname(file)] ?? "application/octet-stream",
          "content-disposition": `${url.searchParams.has("download") ? "attachment" : "inline"}; filename="${encodeURIComponent(relative(ws.outputDir, file).split(sep).pop())}"`,
          "cache-control": "no-store",
        });
        return createReadStream(file).pipe(res);
      }
      for (const [method, pattern, action] of table) {
        const match = req.method === method && pattern.exec(url.pathname);
        if (!match) continue;
        if (req.headers["x-find-job-token"] !== token) return send(res, 403, { error: { code: "FORBIDDEN", message: "Session invalide : rechargez la page." } });
        const body = await readBody(req);
        return send(res, 200, { ok: true, result: action(body, match.slice(1)) });
      }
      return send(res, 404, { error: { code: "NOT_FOUND", message: "Route inconnue." } });
    } catch (error) {
      const known = error instanceof FindJobError;
      return send(res, known ? (error.code === "SOURCE_CHANGED" ? 409 : error.code === "NOT_FOUND" ? 404 : 400) : 500, { error: { code: known ? error.code : "INTERNAL", message: error.message, ...(error.details ? { details: error.details } : {}) } });
    }
  };
  return { handler, token, close: () => watcher?.close() };
}

function listen(server, port, host) {
  return new Promise((resolvePromise, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolvePromise();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

/** Port 4321 by default; the next free ports are tried when it is taken. */
export async function startServer(ws, { port, host = "127.0.0.1", open = true } = {}) {
  if (!["127.0.0.1", "localhost", "::1"].includes(host))
    throw new FindJobError("INVALID_INPUT", "Le tableau de bord n’écoute que sur la boucle locale (127.0.0.1).");
  const app = createApp(ws);
  const server = createServer(app.handler);
  const first = port ?? Number(process.env.FIND_JOB_PORT ?? 4321);
  const explicit = port != null;
  let chosen = first;
  for (;;) {
    try {
      await listen(server, chosen, host);
      break;
    } catch (error) {
      if (error.code !== "EADDRINUSE" || explicit || chosen > first + 20) {
        app.close();
        throw new FindJobError("PORT_UNAVAILABLE", `Port ${chosen} indisponible (${error.code}).`);
      }
      chosen += 1;
    }
  }
  const url = `http://${host === "::1" ? "[::1]" : host}:${server.address().port}`;
  const stop = () => {
    app.close();
    server.close();
    server.closeAllConnections?.();
  };
  process.once("SIGINT", () => (stop(), process.exit(0)));
  process.once("SIGTERM", () => (stop(), process.exit(0)));
  if (open) openBrowser(url);
  return { server, url, stop, token: app.token };
}

function isWsl() {
  try {
    return process.platform === "linux" && /microsoft/i.test(readFileSync("/proc/version", "utf8"));
  } catch {
    return false;
  }
}

/** Best effort: the address is printed as well. */
function openBrowser(url) {
  const [command, args, cwd] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32" || isWsl()
        ? ["cmd.exe", ["/c", "start", '""', url], existsSync("/mnt/c") ? "/mnt/c" : undefined]
        : ["xdg-open", [url]];
  try {
    const child = spawn(command, args, { detached: true, stdio: "ignore", ...(cwd ? { cwd } : {}) });
    child.on("error", () => {});
    child.unref();
  } catch {
    // The printed address remains.
  }
}
