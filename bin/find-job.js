#!/usr/bin/env node
// Checked before loading the CLI: older Node versions lack the global fetch
// and node:test used by find-job and would fail with an obscure error.
const major = Number(process.versions.node.split(".")[0]);
if (major < 20) {
  process.stderr.write(
    `find-job demande Node.js 20 ou plus (version actuelle : ${process.versions.node}).\n`,
  );
  process.exit(1);
}
const { main } = await import("../src/cli/main.js");
process.exitCode = await main(process.argv.slice(2));
