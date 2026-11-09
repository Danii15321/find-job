/**
 * Durable memory of a workspace. Every file lives in `.find-job/` and is
 * rewritten atomically (temporary file + rename) under a lock shared by the
 * CLI and the local server, so neither can lose the other's write.
 */
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { nowIso } from "./dates.js";

export const MEMORY_DIR = ".find-job";
const LOCK_STALE_MS = 30_000;
const LOCK_WAIT_MS = 8_000;

export class FindJobError extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function newId(prefix) {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

export class Store {
  constructor(root) {
    this.root = root;
    this.dir = join(root, MEMORY_DIR);
  }

  path(name) {
    return join(this.dir, name);
  }

  exists() {
    return existsSync(this.path("config.json"));
  }

  read(name, fallback) {
    const file = this.path(name);
    if (!existsSync(file)) return structuredClone(fallback);
    try {
      return JSON.parse(readFileSync(file, "utf8"));
    } catch (error) {
      throw new FindJobError(
        "MEMORY_UNREADABLE",
        `${MEMORY_DIR}/${name} est illisible (${error.message}). Le fichier est conservé tel quel : corrigez-le ou restaurez-le depuis Git.`,
      );
    }
  }

  write(name, data) {
    mkdirSync(this.dir, { recursive: true });
    const file = this.path(name);
    const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`);
    renameSync(temporary, file);
  }

  withLock(fn) {
    mkdirSync(this.dir, { recursive: true });
    const lock = this.path(".lock");
    const deadline = Date.now() + LOCK_WAIT_MS;
    let handle;
    for (;;) {
      try {
        handle = openSync(lock, "wx");
        break;
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        try {
          if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) unlinkSync(lock);
        } catch {
          // Removed by its owner in the meantime.
        }
        if (Date.now() > deadline)
          throw new FindJobError("MEMORY_LOCKED", `La mémoire est verrouillée (${lock}). Réessayez dans un instant.`);
        sleep(25);
      }
    }
    try {
      writeFileSync(handle, String(process.pid));
      return fn();
    } finally {
      closeSync(handle);
      try {
        unlinkSync(lock);
      } catch {
        // Already gone.
      }
    }
  }

  /** Read-modify-write of one file under the lock; `fn` may mutate or return. */
  update(name, fallback, fn) {
    return this.withLock(() => {
      const data = this.read(name, fallback);
      const result = fn(data);
      this.write(name, data);
      return result === undefined ? data : result;
    });
  }

  /** Append-only action journal: the memory of what was done, and when. */
  log(type, summary, data = {}) {
    mkdirSync(this.dir, { recursive: true });
    const event = { at: nowIso(), type, summary, ...(Object.keys(data).length ? { data } : {}) };
    appendFileSync(this.path("journal.jsonl"), `${JSON.stringify(event)}\n`);
    return event;
  }

  journal(limit = 100) {
    const file = this.path("journal.jsonl");
    if (!existsSync(file)) return [];
    const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
    const events = [];
    for (const line of lines.slice(-limit)) {
      try {
        events.push(JSON.parse(line));
      } catch {
        // A torn last line after a crash is skipped, not fatal.
      }
    }
    return events.reverse();
  }
}
