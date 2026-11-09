/**
 * Install the skill where Claude Code and Codex discover it, and put the
 * `find-job` command on the PATH. A folder of the same name that find-job did
 * not install is never replaced or removed.
 */
import { existsSync, lstatSync, readFileSync, readlinkSync } from "node:fs";
import { chmod, cp, mkdir, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const MARKER = ".find-job-skill";

export function packageVersion() {
  try {
    return JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")).version;
  } catch {
    return "0.0.0";
  }
}

export const TOOLS = { claude: "Claude Code", codex: "Codex" };

export function skillDirectory(tool, scope, root) {
  if (scope === "project") return join(root, tool === "claude" ? ".claude/skills" : ".agents/skills");
  return tool === "claude" ? join(homedir(), ".claude/skills") : join(process.env.CODEX_HOME || join(homedir(), ".codex"), "skills");
}

export function detectTools() {
  return Object.keys(TOOLS).filter((tool) => existsSync(join(homedir(), tool === "claude" ? ".claude" : ".codex")));
}

export async function installSkill(tool, { scope = "user", root = process.cwd(), remove = false } = {}) {
  const destination = join(skillDirectory(tool, scope, root), "find-job");
  const owned = existsSync(join(destination, MARKER));
  if (existsSync(destination) && !owned)
    return `  ! ${destination} existe déjà et n’a pas été installé par find-job : laissé intact.`;
  if (remove) {
    if (!owned) return `  · ${TOOLS[tool]} : rien à retirer`;
    await rm(destination, { recursive: true, force: true });
    return `  − skill retiré de ${destination}`;
  }
  await rm(destination, { recursive: true, force: true });
  await mkdir(dirname(destination), { recursive: true });
  await cp(join(PACKAGE_ROOT, "skills", "find-job"), destination, { recursive: true });
  await writeFile(join(destination, MARKER), `${packageVersion()}\n${PACKAGE_ROOT}\n`);
  return `  + ${TOOLS[tool]} → ${destination}`;
}

/** ~/.local/bin/find-job → this package's CLI (no sudo, survives Node switches). */
export async function linkCommand({ remove = false } = {}) {
  const binDir = join(homedir(), ".local/bin");
  const link = join(binDir, "find-job");
  const target = join(PACKAGE_ROOT, "bin/find-job.js");
  let current = null;
  try {
    current = lstatSync(link).isSymbolicLink() ? readlinkSync(link) : "file";
  } catch {
    // No command yet.
  }
  if (current === "file") return `  ! ${link} existe et n’est pas un lien : laissé intact.`;
  if (remove) {
    if (current !== target) return "  · commande : rien à retirer";
    await unlink(link);
    return `  − commande retirée (${link})`;
  }
  await chmod(target, 0o755);
  if (current === target) return `  ✓ commande find-job → ${target}`;
  await mkdir(binDir, { recursive: true });
  if (current) await unlink(link);
  await symlink(target, link);
  const onPath = (process.env.PATH ?? "").split(":").includes(binDir);
  return `  + commande find-job → ${target}${onPath ? "" : `\n  ! ${binDir} n’est pas dans le PATH : ajoutez export PATH="$HOME/.local/bin:$PATH" à ~/.bashrc`}`;
}
