import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, chmod, readFile, rm, utimes } from "node:fs/promises";
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
// chmod 000 does not stop root from reading, so the locked-file model needs a normal user.
const rootSkip = process.getuid?.() === 0 ? "chmod 000 does not block root" : false;

// The live file is unreadable (chmod 000) and older than a ready snapshot, so
// no refresh happens and any command routed to the live file fails like a
// locked database would. The stub fails whenever its --db is unreadable.
async function lockedLive() {
  const dir = await mkdtemp(join(tmpdir(), "snipset-live-reads-"));
  const binDir = join(dir, "bin");
  await mkdir(binDir);
  const liveDb = join(dir, "live-snipset.db");
  await writeFile(liveDb, "live-database-content");
  const past = new Date(Date.now() - 3_600_000);
  await utimes(liveDb, past, past);
  const snapDir = join(dir, "snap");
  await mkdir(snapDir, { mode: 0o700 });
  const snapDb = join(snapDir, "snipset.db");
  await writeFile(snapDb, "snapshot-content");
  await chmod(liveDb, 0o000);
  const log = join(dir, "stub-argv.log");
  const stub = join(binDir, "snipset");
  await writeFile(
    stub,
    `#!/bin/sh
printf '%s\\n' "$*" >> "${log}"
db=""
prev=""
for a in "$@"; do
  if [ "$prev" = "--db" ]; then db="$a"; fi
  prev="$a"
done
if [ -z "$db" ] || [ ! -r "$db" ]; then echo "stub: unable to open database file: $db" >&2; exit 1; fi
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
  return { dir, liveDb, snapDb, log, env };
}

async function loggedLines(log) {
  if (!existsSync(log)) return [];
  return (await readFile(log, "utf8")).split("\n").filter(Boolean);
}

async function cleanup(fx) {
  await chmod(fx.liveDb, 0o600);
  await rm(fx.dir, { recursive: true, force: true });
}

async function runWrapper(fx, args) {
  try {
    await run("bash", [script, "--", ...args], { env: fx.env });
    return 0;
  } catch (err) {
    return err.code;
  }
}

// Database-only reads of the snipset 0.2.0 groups added after the first allowlist.
const reads = [
  ["journal", "list"],
  ["journal", "get", "--id", "j1"],
  ["journal", "get", "--date", "2026-10-15"],
  ["journal", "export"],
  ["task", "list", "--include-completed"],
  ["task", "get", "t1"],
  ["task", "subtasks", "t1"],
  ["task", "stats"],
  ["task", "project", "list"],
  ["task", "folder", "list"],
  ["note", "list"],
  ["note", "get", "n1"],
  ["note", "search", "hello"],
  ["note", "count"],
  ["note", "stats"],
  ["settings", "list"],
  ["settings", "get", "theme"],
  ["settings", "export"],
  ["support", "categories"],
  ["export"],
  ["export", "--format", "csv"],
  ["--json", "note", "list"],
];

// None of these open the database, so the doctor gate only gets in the way.
const infos = [
  ["--version"],
  ["-V"],
  ["help"],
  ["help", "note"],
  ["note", "--help"],
  ["note", "-h"],
  ["task", "project", "--help"],
  ["--json", "settings", "--help"],
];

const gated = [
  ["note", "add"],
  ["note", "create", "--title", "t", "--content", "c"],
  ["frobnicate"],
  ["note"],
  ["doctor"],
  ["pomodoro", "status"],
  ["settings", "set", "theme", "light"],
  // After `--`, clap takes `--help` as the setting value and writes it.
  ["settings", "set", "k", "--", "--help"],
  ["note", "create", "--title", "x", "--", "-V"],
];

for (const args of reads) {
  test(`live reads: ${args.join(" ")} exits 0 from the snapshot while the live file is unreachable`, { skip: rootSkip }, async () => {
    const fx = await lockedLive();
    try {
      assert.equal(await runWrapper(fx, args), 0);
      assert.deepEqual(await loggedLines(fx.log), [`--db ${fx.snapDb} ${args.join(" ")}`]);
    } finally {
      await cleanup(fx);
    }
  });
}

for (const args of infos) {
  test(`live reads: ${args.join(" ")} exits 0 without the doctor gate`, { skip: rootSkip }, async () => {
    const fx = await lockedLive();
    try {
      assert.equal(await runWrapper(fx, args), 0);
      const lines = await loggedLines(fx.log);
      assert.equal(lines.length, 1, `expected one snipset call, got: ${lines.join(" | ")}`);
      assert.ok(!lines[0].includes(fx.liveDb), `must not touch the live file: ${lines[0]}`);
    } finally {
      await cleanup(fx);
    }
  });
}

for (const args of gated) {
  test(`live reads: ${args.join(" ")} still exits 3 behind the doctor gate`, { skip: rootSkip }, async () => {
    const fx = await lockedLive();
    try {
      assert.equal(await runWrapper(fx, args), 3);
      assert.deepEqual(await loggedLines(fx.log), [`--db ${fx.liveDb} doctor`]);
    } finally {
      await cleanup(fx);
    }
  });
}
