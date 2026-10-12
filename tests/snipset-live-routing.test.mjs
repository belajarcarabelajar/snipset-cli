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

async function fixture({ doctorFail = false } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "snipset-live-routing-"));
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
  return { dir, liveDb, snapDb: join(snapDir, "snipset.db"), log, env };
}

async function loggedLines(log) {
  if (!existsSync(log)) return [];
  return (await readFile(log, "utf8")).split("\n").filter(Boolean);
}

function stripDb(args) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--db") {
      i++;
      continue;
    }
    if (args[i].startsWith("--db=")) continue;
    out.push(args[i]);
  }
  return out;
}

const reads = [
  ["snippet", "list"],
  ["snippet", "get", "some-uuid"],
  ["snippet", "search", "foo"],
  ["snippet", "expand", "foo"],
  ["group", "list"],
  ["stats"],
  ["stats", "clipboard"],
  ["reference", "list"],
  ["clipboard", "list"],
  ["clipboard", "get", "1"],
  ["clipboard", "search", "foo"],
  ["clipboard", "export"],
  ["clipboard", "tag", "list"],
  ["audio", "history", "list"],
  ["audio", "history", "get", "1"],
  ["audio", "dictionary", "list"],
  ["audio", "tts", "list"],
  ["audio", "stats"],
  ["--json", "clipboard", "list"],
  ["clipboard", "--db", "/elsewhere.db", "tag", "list"],
  ["--db=/elsewhere.db", "audio", "history", "list"],
];

const writes = [
  ["clipboard", "delete", "1"],
  ["clipboard", "favorite", "1"],
  ["clipboard", "update", "1", "--content", "x"],
  ["clipboard", "clear"],
  ["clipboard", "tag", "add", "1", "work"],
  ["clipboard", "tag", "remove", "1", "work"],
  ["clipboard", "tag", "set-color", "work", "red"],
  ["audio", "history", "delete", "1"],
  ["audio", "history", "clear"],
  ["audio", "history", "save", "hello"],
  ["audio", "dictionary", "add", "foo"],
  ["audio", "dictionary", "remove", "foo"],
  ["audio", "dictionary", "approve", "foo"],
  ["clipboard"],
  ["reference"],
  ["--json", "clipboard", "delete", "1"],
  ["clipboard", "--db", "/elsewhere.db", "tag", "add", "1", "work"],
];

for (const args of reads) {
  test(`read: ${args.join(" ")} runs once against the snapshot`, async () => {
    const fx = await fixture();
    try {
      await run("bash", [script, "--", ...args], { env: fx.env });
      const lines = await loggedLines(fx.log);
      assert.deepEqual(lines, [`--db ${fx.snapDb} ${stripDb(args).join(" ")}`]);
    } finally {
      await rm(fx.dir, { recursive: true, force: true });
    }
  });
}

for (const args of writes) {
  test(`write: ${args.join(" ")} runs doctor then the command on the live db`, async () => {
    const fx = await fixture();
    try {
      await run("bash", [script, "--", ...args], { env: fx.env });
      const lines = await loggedLines(fx.log);
      assert.deepEqual(lines, [
        `--db ${fx.liveDb} doctor`,
        `--db ${fx.liveDb} ${stripDb(args).join(" ")}`,
      ]);
    } finally {
      await rm(fx.dir, { recursive: true, force: true });
    }
  });

  test(`write: ${args.join(" ")} exits 3 and never runs when doctor fails`, async () => {
    const fx = await fixture({ doctorFail: true });
    try {
      await assert.rejects(run("bash", [script, "--", ...args], { env: fx.env }), (err) => {
        assert.equal(err.code, 3);
        return true;
      });
      const lines = await loggedLines(fx.log);
      assert.deepEqual(lines, [`--db ${fx.liveDb} doctor`]);
    } finally {
      await rm(fx.dir, { recursive: true, force: true });
    }
  });
}
