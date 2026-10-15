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

const refusalLines = [
  "snipset-live: refusing write: live database is locked or unreachable.",
  "snipset-live: close Snipset Desktop, then retry. Reads remain available from the snapshot.",
];

async function fixture({ doctorFail }) {
  const dir = await mkdtemp(join(tmpdir(), "fu2-doctor-"));
  const binDir = join(dir, "bin");
  await mkdir(binDir);
  const liveDb = join(dir, "live-snipset.db");
  await writeFile(liveDb, "live-database-content");
  const log = join(dir, "doctor-calls.log");
  const stub = join(binDir, "snipset");
  await writeFile(
    stub,
    `#!/bin/sh
case " $* " in
  *" doctor "*)
    echo doctor >> "${log}"
    if [ "${doctorFail ? "1" : "0"}" = "1" ]; then
      echo "doctor-stdout-noise"
      echo "snipset: database is locked" >&2
      exit 1
    fi
    echo "doctor-stdout-ok"
    echo "doctor-stderr-ok" >&2
    exit 0 ;;
esac
echo "write-done"
exit 0
`
  );
  await chmod(stub, 0o755);
  const env = {
    ...process.env,
    PATH: `${binDir}:${process.env.PATH}`,
    SNIPSET_LIVE_DB: liveDb,
    SNIPSET_LIVE_SNAPSHOT_DIR: join(dir, "snap"),
  };
  return { dir, log, env };
}

async function doctorCalls(log) {
  if (!existsSync(log)) return 0;
  return (await readFile(log, "utf8")).split("\n").filter(Boolean).length;
}

test("refused write prints doctor's own stderr after the two refusal lines and exits 3", async () => {
  const fx = await fixture({ doctorFail: true });
  try {
    let err;
    try {
      await run("bash", [script, "snippet", "update", "some-uuid", "--content", "x"], { env: fx.env });
    } catch (e) {
      err = e;
    }
    assert.ok(err, "expected the wrapper to refuse the write");
    assert.equal(err.code, 3);
    const lines = String(err.stderr).split("\n").filter(Boolean);
    assert.deepEqual(lines.slice(0, 2), refusalLines);
    assert.ok(
      lines.includes("snipset: database is locked"),
      `expected doctor's reason in stderr, got: ${JSON.stringify(lines)}`
    );
    assert.equal(String(err.stdout), "");
    assert.equal(await doctorCalls(fx.log), 1);
  } finally {
    await rm(fx.dir, { recursive: true, force: true });
  }
});

test("passing doctor prints nothing extra before the write runs", async () => {
  const fx = await fixture({ doctorFail: false });
  try {
    const { stdout, stderr } = await run(
      "bash",
      [script, "snippet", "update", "some-uuid", "--content", "x"],
      { env: fx.env }
    );
    assert.equal(stdout, "write-done\n");
    assert.equal(stderr, "");
    assert.equal(await doctorCalls(fx.log), 1);
  } finally {
    await rm(fx.dir, { recursive: true, force: true });
  }
});
