import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, chmod, readFile, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const testDir = dirname(fileURLToPath(import.meta.url));
const root = existsSync(join(testDir, "..", "scripts", "snipset-live.sh"))
  ? join(testDir, "..")
  : process.cwd();
const script = join(root, "scripts", "snipset-live.sh");

const fallbackWarning =
  "snipset-live: this snipset has no backup command; copying files instead, which can be inconsistent while Snipset Desktop writes";

// backup "works" models snipset 0.3.0, which prints a report on stdout like the
// real command; "none" models 0.2.0, where clap rejects the unknown subcommand
// with exit 2; "failing" has the command, but the copy itself fails.
async function fixture({ backup }) {
  const dir = await mkdtemp(join(tmpdir(), "snipset-live-backup-"));
  const binDir = join(dir, "bin");
  await mkdir(binDir);
  const liveDb = join(dir, "live-snipset.db");
  await writeFile(liveDb, "live-database-content");
  await writeFile(`${liveDb}-wal`, "live-wal-bytes");
  const snapDir = join(dir, "snap");
  const log = join(dir, "stub-argv.log");
  const stub = join(binDir, "snipset");
  // The wrapper calls `backup --help`, then `--db LIVE backup --to SNAP --force`.
  await writeFile(
    stub,
    `#!/bin/sh
printf '%s\\n' "$*" >> "${log}"
if [ "$1" != backup ] && [ "$3" != backup ]; then
  echo "read-output"
  exit 0
fi
if [ "${backup}" = none ]; then
  echo "error: unrecognized subcommand 'backup'" >&2
  exit 2
fi
if [ "$2" = --help ]; then
  echo "Usage: snipset backup [OPTIONS] --to <PATH>"
  exit 0
fi
if [ "${backup}" = failing ]; then
  echo "snipset: the source database stayed busy; try again" >&2
  exit 7
fi
{ printf 'backup-of:'; cat "$2"; } > "$5"
echo "backed up $2 to $5"
exit 0
`
  );
  await chmod(stub, 0o755);
  const env = {
    ...process.env,
    PATH: `${binDir}:${process.env.PATH}`,
    SNIPSET_LIVE_DB: liveDb,
    SNIPSET_LIVE_SNAPSHOT_DIR: snapDir,
  };
  return { dir, liveDb, snapDb: join(snapDir, "snipset.db"), log, env };
}

async function loggedLines(log) {
  if (!existsSync(log)) return [];
  return (await readFile(log, "utf8")).split("\n").filter(Boolean);
}

test("refreshes the snapshot through snipset backup when the CLI has it", async () => {
  const fx = await fixture({ backup: "works" });
  try {
    await run("bash", [script, "snippet", "list"], { env: fx.env });
    assert.deepEqual(await loggedLines(fx.log), [
      "backup --help",
      `--db ${fx.liveDb} backup --to ${fx.snapDb} --force`,
      `--db ${fx.snapDb} snippet list`,
    ]);
    assert.equal(await readFile(fx.snapDb, "utf8"), "backup-of:live-database-content");
    assert.equal(existsSync(`${fx.snapDb}-wal`), false, "a file copy would have brought the live -wal along");
  } finally {
    await rm(fx.dir, { recursive: true, force: true });
  }
});

test("a backup refresh leaves stdout and stderr to the wrapped command", async () => {
  const fx = await fixture({ backup: "works" });
  try {
    const { stdout, stderr } = await run("bash", [script, "--json", "snippet", "list"], { env: fx.env });
    const lines = await loggedLines(fx.log);
    assert.ok(lines.some((l) => l.includes(" backup --to ")), `expected a backup refresh, got: ${JSON.stringify(lines)}`);
    assert.equal(stdout, "read-output\n");
    assert.equal(stderr, "");
  } finally {
    await rm(fx.dir, { recursive: true, force: true });
  }
});

test("without a backup command, prints the one warning line and copies the files", async () => {
  const fx = await fixture({ backup: "none" });
  try {
    const { stderr } = await run("bash", [script, "snippet", "list"], { env: fx.env });
    assert.equal(stderr, `${fallbackWarning}\n`);
    assert.deepEqual(await loggedLines(fx.log), ["backup --help", `--db ${fx.snapDb} snippet list`]);
    assert.equal(await readFile(fx.snapDb, "utf8"), "live-database-content");
    assert.equal(await readFile(`${fx.snapDb}-wal`, "utf8"), "live-wal-bytes");
  } finally {
    await rm(fx.dir, { recursive: true, force: true });
  }
});

test("a failing backup stops the wrapper with its exit code, like a failed copy, without copying or reading", async () => {
  const fx = await fixture({ backup: "failing" });
  try {
    await assert.rejects(run("bash", [script, "snippet", "list"], { env: fx.env }), (err) => {
      assert.equal(err.code, 7);
      assert.equal(String(err.stderr), "snipset: the source database stayed busy; try again\n");
      return true;
    });
    assert.deepEqual(await loggedLines(fx.log), [
      "backup --help",
      `--db ${fx.liveDb} backup --to ${fx.snapDb} --force`,
    ]);
    assert.equal(existsSync(fx.snapDb), false, "a failed backup must not fall back to a file copy");
  } finally {
    await rm(fx.dir, { recursive: true, force: true });
  }
});
