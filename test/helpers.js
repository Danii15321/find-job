import { copyFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

export const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const SAMPLE_CV = join(ROOT, "exemple/cv.tex");

/** A fresh folder holding a copy of the demo CV. */
export function tempWorkspace() {
  const dir = mkdtempSync(join(tmpdir(), "find-job-test-"));
  copyFileSync(SAMPLE_CV, join(dir, "cv.tex"));
  return dir;
}

export function cli(args, cwd) {
  const result = spawnSync(process.execPath, [join(ROOT, "bin/find-job.js"), ...args], { cwd, encoding: "utf8" });
  let json = null;
  try {
    json = JSON.parse(result.stdout);
  } catch {
    // Text output.
  }
  let error = null;
  try {
    error = JSON.parse(result.stderr).error;
  } catch {
    // No structured error.
  }
  return { code: result.status, stdout: result.stdout, stderr: result.stderr, json, error };
}

export const latexAvailable = spawnSync("pdflatex", ["--version"], { stdio: "ignore" }).status === 0;
