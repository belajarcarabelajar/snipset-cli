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

test("filters user-supplied --db from forwarded args", async () => {
  const fx = await fixture();
  try {
    await run("bash", [script, "snippet", "search", "foo", "--db", "/tmp/evil.db"], { env: fx.env });
    await run("bash", [script, "snippet", "search", "foo", "--db=/tmp/evil2.db"], { env: fx.env });
    await run(
      "bash",
      [script, "snippet", "update", "some-uuid", "--content", "x", "--db", "/tmp/evil.db"],
      { env: fx.env }
    );
    const lines = await loggedLines(fx.log);
    assert.ok(
      lines.some((l) => l.includes(`--db ${fx.snapDb}`) && l.includes("snippet search foo")),
      `expected snapshot --db read in stub argv, got: ${JSON.stringify(lines)}`
    );
    assert.ok(
      lines.some((l) => l.includes(`--db ${fx.liveDb}`) && l.includes("update")),
      `expected live --db write in stub argv, got: ${JSON.stringify(lines)}`
    );
    for (const l of lines) {
      assert.ok(!l.includes("evil.db") && !l.includes("evil2.db"), `user --db leaked: ${l}`);
    }
  } finally {
    await rm(fx.dir, { recursive: true, force: true });
  }
});

test("routes snippet expand as a read to the snapshot", async () => {
  const fx = await fixture();
  try {
    await run("bash", [script, "snippet", "expand", "some-id"], { env: fx.env });
    const lines = await loggedLines(fx.log);
    assert.ok(
      lines.some((l) => l.includes(`--db ${fx.snapDb}`) && l.includes("expand")),
      `expected snapshot --db expand in stub argv, got: ${JSON.stringify(lines)}`
    );
    assert.ok(!lines.some((l) => l.includes("doctor")), "expand must not trigger a doctor gate");
  } finally {
    await rm(fx.dir, { recursive: true, force: true });
  }
});

test("refreshes a stale snapshot when the live database is newer", async () => {
  const fx = await fixture();
  try {
    await run("bash", [script, "snippet", "search", "foo"], { env: fx.env });
    assert.equal(await readFile(fx.snapDb, "utf8"), "live-database-content");
    await writeFile(fx.liveDb, "live-database-v2");
    const now = new Date();
    const old = new Date(now.getTime() - 10000);
    await utimes(fx.snapDb, old, old);
    await utimes(fx.liveDb, now, now);
    await run("bash", [script, "snippet", "search", "foo"], { env: fx.env });
    assert.equal(await readFile(fx.snapDb, "utf8"), "live-database-v2");
  } finally {
    await rm(fx.dir, { recursive: true, force: true });
  }
});

test("--help exits 0", async () => {
  const fx = await fixture();
  try {
    const { stdout } = await run("bash", [script, "--help"], { env: fx.env });
    assert.match(stdout, /Usage/);
  } finally {
    await rm(fx.dir, { recursive: true, force: true });
  }
});

test("rejects = form wrapper flags", async () => {
  const fx = await fixture();
  try {
    for (const args of [
      ["--live-db=/tmp/x", "snippet", "search", "foo"],
      ["--snapshot-dir=/tmp/y", "snippet", "search", "foo"],
    ]) {
      try {
        await run("bash", [script, ...args], { env: fx.env });
        assert.fail(`expected rejection for ${args[0]}`);
      } catch (err) {
        assert.equal(err.code, 2, `expected exit 2 for ${args[0]}, got: ${err.code} ${err.stderr}`);
        assert.match(String(err.stderr), /use a space, not =/);
      }
    }
  } finally {
    await rm(fx.dir, { recursive: true, force: true });
  }
});
