import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, chmod, readFile, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { snipsetSkip } from "./snipset-bin.mjs";

const run = promisify(execFile);
const testDir = dirname(fileURLToPath(import.meta.url));
const root = existsSync(join(testDir, "..", "scripts", "snipset-live.sh"))
  ? join(testDir, "..")
  : process.cwd();
const script = join(root, "scripts", "snipset-live.sh");

// SNIPSET_DRIFT_BIN pins a specific build, such as a downloaded release, instead of the one on PATH.
const bin = process.env.SNIPSET_DRIFT_BIN || Bun.which("snipset");
const skip = process.env.SNIPSET_DRIFT_BIN ? false : snipsetSkip;

// Every leaf of snipset 0.2.0, classified from its --help and a before/after
// dump of a scratch database. Reads run against the snapshot; everything else
// goes through the doctor gate. pomodoro reads its data from the running app,
// not the file, so it stays gated with the controls.
const reads = [
  "snippet list", "snippet get", "snippet search", "snippet expand",
  "group list",
  "clipboard list", "clipboard get", "clipboard search", "clipboard export",
  "clipboard tag list",
  "audio history list", "audio history get", "audio dictionary list", "audio tts list", "audio stats",
  "journal list", "journal get", "journal export",
  "task list", "task get", "task subtasks", "task stats", "task project list", "task folder list",
  "note list", "note get", "note search", "note count", "note stats",
  "stats overview", "stats snippets", "stats clipboard", "stats ai", "stats tracker",
  "stats tasks", "stats notes", "stats audio", "stats all",
  "reference list",
  "support categories",
  "settings list", "settings get", "settings export",
  "export",
];
const writes = [
  "doctor", "init", "import", "mcp",
  "snippet add", "snippet update", "snippet delete",
  "group add",
  "clipboard delete", "clipboard favorite", "clipboard update", "clipboard clear",
  "clipboard tag add", "clipboard tag remove", "clipboard tag set-color",
  "audio history delete", "audio history clear", "audio history save",
  "audio dictionary add", "audio dictionary remove", "audio dictionary approve",
  "journal generate", "journal update", "journal delete",
  "task create", "task update", "task complete", "task delete", "task reorder", "task parse",
  "task project create", "task project update", "task project archive",
  "task folder create",
  "note create", "note update", "note pin", "note archive", "note delete", "note title", "note labels",
  "pomodoro status", "pomodoro config", "pomodoro start", "pomodoro pause", "pomodoro resume",
  "pomodoro stop", "pomodoro skip", "pomodoro sessions",
  "support submit",
  "settings set", "settings unset",
];
const classified = new Set([...reads, ...writes]);

function listedSubcommands(helpText) {
  const lines = helpText.split("\n");
  const start = lines.findIndex((line) => line.trim() === "Commands:");
  if (start === -1) return [];
  const names = [];
  for (const line of lines.slice(start + 1)) {
    const match = /^\s+(\S+)/.exec(line);
    if (!match) break;
    if (match[1] !== "help") names.push(match[1]);
  }
  return names;
}

function helpOf(path) {
  const result = Bun.spawnSync([bin, ...path, "--help"], { timeout: 10_000 });
  assert.equal(result.exitCode, 0, `\`snipset ${path.join(" ")} --help\` exited ${result.exitCode}`);
  return result.stdout.toString();
}

function leavesUnder(path) {
  const subs = listedSubcommands(helpOf(path));
  if (subs.length === 0) return [path.join(" ")];
  return subs.flatMap((name) => leavesUnder([...path, name]));
}

const topLevel = skip ? [] : listedSubcommands(helpOf([]));
const releaseLeaves = topLevel.flatMap((name) => leavesUnder([name]));

async function routingFixture() {
  const dir = await mkdtemp(join(tmpdir(), "snipset-live-drift-"));
  const binDir = join(dir, "bin");
  await mkdir(binDir);
  const liveDb = join(dir, "live-snipset.db");
  await writeFile(liveDb, "live-database-content");
  const snapDir = join(dir, "snap");
  const log = join(dir, "stub-argv.log");
  const stub = join(binDir, "snipset");
  await writeFile(stub, `#!/bin/sh\nprintf '%s\\n' "$*" >> "${log}"\nexit 0\n`);
  await chmod(stub, 0o755);
  const env = {
    ...process.env,
    PATH: `${binDir}:${process.env.PATH}`,
    SNIPSET_LIVE_DB: liveDb,
    SNIPSET_LIVE_SNAPSHOT_DIR: snapDir,
  };
  return { dir, liveDb, snapDb: join(snapDir, "snipset.db"), log, env };
}

async function routeOf(fx, leaf) {
  await rm(fx.log, { force: true });
  await run("bash", [script, "--", ...leaf.split(" ")], { env: fx.env });
  const lines = (await readFile(fx.log, "utf8")).split("\n").filter(Boolean);
  if (lines.length === 1 && lines[0] === `--db ${fx.snapDb} ${leaf}`) return "read";
  if (lines.length === 2 && lines[0] === `--db ${fx.liveDb} doctor` && lines[1] === `--db ${fx.liveDb} ${leaf}`) {
    return "write";
  }
  return `unexpected: ${lines.join(" | ")}`;
}

test("snipset --help lists top-level commands", { skip }, () => {
  assert.ok(topLevel.length > 0, "no Commands: section parsed from `snipset --help`");
});

test("the classification table names no leaf the release lacks", { skip }, () => {
  const present = new Set(releaseLeaves);
  const stale = [...classified].filter((leaf) => !present.has(leaf));
  assert.deepEqual(stale, [], `table lists leaves snipset no longer has: ${stale.join(", ")}`);
});

for (const group of topLevel) {
  test(`snipset ${group} lists no leaf the wrapper does not classify`, { skip }, () => {
    const unknown = leavesUnder([group]).filter((leaf) => !classified.has(leaf));
    assert.deepEqual(
      unknown,
      [],
      `unclassified leaf or group: ${unknown.join(", ")}. Classify each as read or write in ` +
        `scripts/snipset-live.sh and in the table in tests/snipset-live-cli-drift.test.mjs.`
    );
  });

  test(`snipset-live routes every ${group} leaf as the table classifies it`, { skip }, async () => {
    const fx = await routingFixture();
    try {
      const wrong = [];
      for (const leaf of leavesUnder([group]).filter((l) => classified.has(l))) {
        const expected = reads.includes(leaf) ? "read" : "write";
        const actual = await routeOf(fx, leaf);
        if (actual !== expected) wrong.push(`${leaf}: expected ${expected}, got ${actual}`);
      }
      assert.deepEqual(wrong, []);
    } finally {
      await rm(fx.dir, { recursive: true, force: true });
    }
  });
}
