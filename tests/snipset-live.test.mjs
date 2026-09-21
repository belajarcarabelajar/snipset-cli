import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, chmod, readFile, appendFile, rm, stat } from "node:fs/promises";
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

async function fixture({ doctorFail = false } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "snipset-live-fixture-"));
  const binDir = join(dir, "bin");
  await mkdir(binDir);
  const liveDb = join(dir, "live-snipset.db");
  await writeFile(liveDb, "live-database-content");
  const snapDir = join(dir, "snap");
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
case " $* " in
  *" doctor "*)
    if [ "${doctorFail ? "1" : "0"}" = "1" ]; then echo "stub: doctor failed" >&2; exit 1; fi
    exit 0 ;;
esac
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
  return { dir, liveDb, snapDir, snapDb: join(snapDir, "snipset.db"), log, env };
}

async function loggedLines(log) {
  if (!existsSync(log)) return [];
  return (await readFile(log, "utf8")).split("\n").filter(Boolean);
}

test("creates a snapshot on first read and reuses it on second run", async () => {
  const fx = await fixture();
  try {
    await run("bash", [script, "snippet", "search", "foo"], { env: fx.env });
    assert.equal(await readFile(fx.snapDb, "utf8"), "live-database-content");
    await writeFile(fx.snapDb, "marker");
    await run("bash", [script, "snippet", "search", "foo"], { env: fx.env });
    assert.equal(await readFile(fx.snapDb, "utf8"), "marker");
  } finally {
    await rm(fx.dir, { recursive: true, force: true });
  }
});

test("--refresh forces a fresh snapshot", async () => {
  const fx = await fixture();
  try {
    await run("bash", [script, "snippet", "search", "foo"], { env: fx.env });
    await writeFile(fx.snapDb, "marker");
    await run("bash", [script, "--refresh", "snippet", "search", "foo"], { env: fx.env });
    assert.equal(await readFile(fx.snapDb, "utf8"), "live-database-content");
  } finally {
    await rm(fx.dir, { recursive: true, force: true });
  }
});

test("forwards reads with the snapshot --db", async () => {
  const fx = await fixture();
  try {
    await run("bash", [script, "--json", "snippet", "search", "foo"], { env: fx.env });
    const lines = await loggedLines(fx.log);
    assert.ok(
      lines.some((l) => l.includes(`--db ${fx.snapDb}`) && l.includes("snippet search foo")),
      `expected snapshot --db in stub argv, got: ${JSON.stringify(lines)}`
    );
  } finally {
    await rm(fx.dir, { recursive: true, force: true });
  }
});

test("refuses writes when the live doctor fails", async () => {
  const fx = await fixture({ doctorFail: true });
  try {
    await assert.rejects(run("bash", [script, "snippet", "update", "some-uuid", "--content", "x"], { env: fx.env }));
    const lines = await loggedLines(fx.log);
    assert.ok(!lines.some((l) => l.includes("update")), "write must not reach snipset");
  } finally {
    await rm(fx.dir, { recursive: true, force: true });
  }
});

test("routes writes to the live db when the doctor passes", async () => {
  const fx = await fixture();
  try {
    await run("bash", [script, "snippet", "update", "some-uuid", "--content", "x"], { env: fx.env });
    const lines = await loggedLines(fx.log);
    assert.ok(
      lines.some((l) => l.includes(`--db ${fx.liveDb}`) && l.includes("update")),
      `expected live --db write in stub argv, got: ${JSON.stringify(lines)}`
    );
  } finally {
    await rm(fx.dir, { recursive: true, force: true });
  }
});

test("errors clearly when the live db is missing", async () => {
  const fx = await fixture();
  try {
    const env = { ...fx.env, SNIPSET_LIVE_DB: join(fx.dir, "no-such.db") };
    await assert.rejects(run("bash", [script, "snippet", "search", "foo"], { env }));
  } finally {
    await rm(fx.dir, { recursive: true, force: true });
  }
});

test("snapshot companions travel with the main file when present", async () => {
  const fx = await fixture();
  try {
    await writeFile(`${fx.liveDb}-wal`, "wal-bytes");
    await run("bash", [script, "snippet", "search", "foo"], { env: fx.env });
    assert.equal(await readFile(`${fx.snapDb}-wal`, "utf8"), "wal-bytes");
  } finally {
    await rm(fx.dir, { recursive: true, force: true });
  }
});
