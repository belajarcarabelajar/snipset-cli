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

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "snipset-live-snapshot-"));
  const binDir = join(dir, "bin");
  await mkdir(binDir);
  const liveDb = join(dir, "live-snipset.db");
  await writeFile(liveDb, "live-database-content");
  const snapDir = join(dir, "snap");
  const stub = join(binDir, "snipset");
  await writeFile(stub, "#!/bin/sh\nexit 0\n");
  await chmod(stub, 0o755);
  const env = {
    ...process.env,
    PATH: `${binDir}:${process.env.PATH}`,
    SNIPSET_LIVE_DB: liveDb,
    SNIPSET_LIVE_SNAPSHOT_DIR: snapDir,
  };
  return { dir, liveDb, snapDb: join(snapDir, "snipset.db"), env };
}

// Times stay in the past so a refresh copy (mtime = now) is never older than them.
const snapTime = Math.floor(Date.now() / 1000) - 1000;
const olderTime = snapTime - 100;
const newerTime = snapTime + 100;

async function primeStaleSnapshot(fx) {
  await run("bash", [script, "snippet", "list"], { env: fx.env });
  await writeFile(fx.snapDb, "marker");
  await utimes(fx.snapDb, snapTime, snapTime);
  await utimes(fx.liveDb, olderTime, olderTime);
}

test("refreshes when the live -wal is newer than the snapshot", async () => {
  const fx = await fixture();
  try {
    await primeStaleSnapshot(fx);
    await writeFile(`${fx.liveDb}-wal`, "new-wal-bytes");
    await utimes(`${fx.liveDb}-wal`, newerTime, newerTime);
    await run("bash", [script, "snippet", "list"], { env: fx.env });
    assert.equal(await readFile(fx.snapDb, "utf8"), "live-database-content");
    assert.equal(await readFile(`${fx.snapDb}-wal`, "utf8"), "new-wal-bytes");
  } finally {
    await rm(fx.dir, { recursive: true, force: true });
  }
});

test("keeps the snapshot when there is no -wal and live is older", async () => {
  const fx = await fixture();
  try {
    await primeStaleSnapshot(fx);
    await run("bash", [script, "snippet", "list"], { env: fx.env });
    assert.equal(await readFile(fx.snapDb, "utf8"), "marker");
  } finally {
    await rm(fx.dir, { recursive: true, force: true });
  }
});

test("keeps the snapshot when the live -wal is older than the snapshot", async () => {
  const fx = await fixture();
  try {
    await primeStaleSnapshot(fx);
    await writeFile(`${fx.liveDb}-wal`, "old-wal-bytes");
    await utimes(`${fx.liveDb}-wal`, olderTime, olderTime);
    await run("bash", [script, "snippet", "list"], { env: fx.env });
    assert.equal(await readFile(fx.snapDb, "utf8"), "marker");
  } finally {
    await rm(fx.dir, { recursive: true, force: true });
  }
});
