import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, symlinkSync } from "node:fs";
import { rm, unlink } from "node:fs/promises";
import { join } from "node:path";
import {
  cleanupSandbox,
  downloaderShims,
  fakeLinuxRelease,
  makeSandbox,
  runInstaller,
} from "./helpers/install-sandbox.mjs";

const SHARE_FILES = ["snipset.sh", "completion.bash", "tab.sh"];
const MARKER = "# snipset-terminal-integration (managed by snipset installer; safe to remove)";
const USER_BEFORE = "# user line before\nalias ll='ls -l'\n";
const USER_AFTER = "export EDITOR=vi\n# user line after\n";

const cleanups = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()();
});

function setup() {
  const sb = makeSandbox();
  cleanups.push(() => cleanupSandbox(sb));
  const release = fakeLinuxRelease();
  cleanups.push(() => rm(release.dir, { recursive: true, force: true }));
  downloaderShims(sb, release);
  const shareDir = join(sb.home, ".local", "share", "snipset");
  const bashrc = join(sb.home, ".bashrc");
  return { sb, shareDir, bashrc };
}

const FLAGS = ["--version", "0.1.0"];

async function install(sb, extra = []) {
  const res = await runInstaller(sb, [...FLAGS, ...extra]);
  assert.equal(res.code, 0, `install failed:\n${res.stdout}\n${res.stderr}`);
  return res;
}

function reportLines(stdout, item) {
  return stdout.split("\n").filter((line) => line.includes(`] ${item}:`));
}

test("check after a full install reports every shell item OK", async () => {
  const { sb, shareDir, bashrc } = setup();
  await install(sb);
  const res = await runInstaller(sb, [...FLAGS, "--check"]);
  assert.equal(res.code, 0, `${res.stdout}\n${res.stderr}`);
  for (const name of SHARE_FILES) {
    assert.deepEqual(reportLines(res.stdout, `shell ${name}`), [`[OK] shell ${name}: ${join(shareDir, name)}`]);
  }
  assert.deepEqual(reportLines(res.stdout, "shell block"), [`[OK] shell block: ${bashrc}`]);
  assert.doesNotMatch(res.stderr, /line \d+:/);
});

test("check reports a deleted tab.sh as MISSING", async () => {
  const { sb, shareDir } = setup();
  await install(sb);
  await unlink(join(shareDir, "tab.sh"));
  const res = await runInstaller(sb, [...FLAGS, "--check"]);
  assert.equal(res.code, 1);
  assert.deepEqual(reportLines(res.stdout, "shell tab.sh"), [`[MISSING] shell tab.sh: ${join(shareDir, "tab.sh")}`]);
  assert.match(res.stdout, /^\[OK\] shell snipset\.sh: /m);
});

test("check reports an edited block as DRIFT", async () => {
  const { sb, bashrc } = setup();
  await install(sb);
  writeFileSync(bashrc, readFileSync(bashrc, "utf8").replace("tab.sh\"\n", "tab.sh\" # mine\n"));
  const res = await runInstaller(sb, [...FLAGS, "--check"]);
  assert.equal(res.code, 1);
  assert.equal(reportLines(res.stdout, "shell block").length, 1);
  assert.match(reportLines(res.stdout, "shell block")[0], /^\[DRIFT\] shell block: /);
});

test("check reports an absent block as MISSING", async () => {
  const { sb, bashrc } = setup();
  await install(sb);
  writeFileSync(bashrc, USER_BEFORE);
  const res = await runInstaller(sb, [...FLAGS, "--check"]);
  assert.equal(res.code, 1);
  assert.equal(reportLines(res.stdout, "shell block").length, 1);
  assert.match(reportLines(res.stdout, "shell block")[0], /^\[MISSING\] shell block: /);
});

test("check reports a block written for other dirs as DRIFT", async () => {
  const { sb } = setup();
  await install(sb);
  const res = await runInstaller(sb, [...FLAGS, "--check", "--share-dir", join(sb.home, "elsewhere")]);
  assert.equal(res.code, 1);
  assert.match(reportLines(res.stdout, "shell block")[0], /^\[DRIFT\] shell block: /);
});

test("uninstall removes the block and files and keeps every other bashrc line", async () => {
  const { sb, shareDir, bashrc } = setup();
  writeFileSync(bashrc, USER_BEFORE);
  await install(sb);
  assert.ok(readFileSync(bashrc, "utf8").includes(MARKER));
  appendFileSync(bashrc, USER_AFTER);
  const res = await runInstaller(sb, [...FLAGS, "--uninstall"]);
  assert.equal(res.code, 0, `${res.stdout}\n${res.stderr}`);
  assert.equal(readFileSync(bashrc, "utf8"), USER_BEFORE + USER_AFTER);
  for (const name of SHARE_FILES) {
    assert.ok(!existsSync(join(shareDir, name)), `${name} survived`);
    assert.deepEqual(reportLines(res.stdout, `shell ${name}`), [`[REMOVED] shell ${name}: ${join(shareDir, name)}`]);
  }
  assert.deepEqual(reportLines(res.stdout, "shell block"), [`[REMOVED] shell block: ${bashrc}`]);
  assert.ok(!existsSync(shareDir), "empty share dir survived");
});

test("uninstall keeps a last user line that has no final newline", async () => {
  const { sb, bashrc } = setup();
  writeFileSync(bashrc, USER_BEFORE);
  await install(sb);
  appendFileSync(bashrc, "export TAIL=1");
  const res = await runInstaller(sb, [...FLAGS, "--uninstall"]);
  assert.equal(res.code, 0, `${res.stdout}\n${res.stderr}`);
  assert.equal(readFileSync(bashrc, "utf8"), `${USER_BEFORE}export TAIL=1`);
});

test("uninstall of a bashrc holding only the block leaves it empty", async () => {
  const { sb, bashrc } = setup();
  await install(sb);
  const res = await runInstaller(sb, [...FLAGS, "--uninstall"]);
  assert.equal(res.code, 0, `${res.stdout}\n${res.stderr}`);
  assert.equal(readFileSync(bashrc, "utf8"), "");
});

test("uninstall keeps an edited block byte-identical", async () => {
  const { sb, shareDir, bashrc } = setup();
  writeFileSync(bashrc, USER_BEFORE);
  await install(sb);
  const edited = readFileSync(bashrc, "utf8").replace("tab.sh\"\n", "tab.sh\" # mine\n") + USER_AFTER;
  writeFileSync(bashrc, edited);
  const res = await runInstaller(sb, [...FLAGS, "--uninstall"]);
  assert.equal(res.code, 0, `${res.stdout}\n${res.stderr}`);
  assert.equal(readFileSync(bashrc, "utf8"), edited);
  assert.deepEqual(reportLines(res.stdout, "shell block"), ["[KEEP] shell block: edited; remove it by hand"]);
  for (const name of SHARE_FILES) assert.ok(!existsSync(join(shareDir, name)), `${name} survived`);
});

test("uninstall edits the target of a symlinked bashrc and keeps the link", async () => {
  const { sb, bashrc } = setup();
  const dotfiles = join(sb.home, "dotfiles");
  mkdirSync(dotfiles);
  const target = join(dotfiles, "bashrc");
  writeFileSync(target, USER_BEFORE);
  symlinkSync(target, bashrc);
  await install(sb);
  assert.ok(lstatSync(bashrc).isSymbolicLink());
  assert.ok(readFileSync(target, "utf8").includes(MARKER));
  const res = await runInstaller(sb, [...FLAGS, "--uninstall"]);
  assert.equal(res.code, 0, `${res.stdout}\n${res.stderr}`);
  assert.ok(lstatSync(bashrc).isSymbolicLink(), "bashrc is no longer a symlink");
  assert.equal(readFileSync(target, "utf8"), USER_BEFORE);
});

test("check reports the database from --db as OK, then MISSING once deleted", async () => {
  const { sb } = setup();
  const db = join(sb.home, "data", "snipset.db");
  await install(sb, ["--db", db]);
  const ok = await runInstaller(sb, [...FLAGS, "--db", db, "--check"]);
  assert.deepEqual(reportLines(ok.stdout, "database"), [`[OK] database: ${db}`]);
  assert.equal(ok.code, 0, `${ok.stdout}\n${ok.stderr}`);
  await unlink(db);
  const gone = await runInstaller(sb, [...FLAGS, "--db", db, "--check"]);
  assert.deepEqual(reportLines(gone.stdout, "database"), [`[MISSING] database: ${db}`]);
  assert.equal(gone.code, 1);
});

test("check without --db skips the default database location", async () => {
  const { sb } = setup();
  await install(sb);
  const res = await runInstaller(sb, [...FLAGS, "--check"]);
  assert.deepEqual(reportLines(res.stdout, "database"), ["[SKIP] database: default location (run snipset doctor)"]);
});

test("uninstall never touches the database", async () => {
  const { sb } = setup();
  const db = join(sb.home, "data", "snipset.db");
  const defaultDb = join(sb.home, ".local", "share", "Snipset", "snipset.db");
  mkdirSync(join(sb.home, "data"));
  mkdirSync(join(sb.home, ".local", "share", "Snipset"), { recursive: true });
  writeFileSync(db, "precious custom");
  writeFileSync(defaultDb, "precious default");
  await install(sb, ["--db", db]);
  const before = [db, defaultDb].map((path) => [readFileSync(path, "utf8"), lstatSync(path).mtimeMs]);
  const res = await runInstaller(sb, [...FLAGS, "--db", db, "--uninstall"]);
  assert.equal(res.code, 0, `${res.stdout}\n${res.stderr}`);
  const after = [db, defaultDb].map((path) => [readFileSync(path, "utf8"), lstatSync(path).mtimeMs]);
  assert.deepEqual(after, before);
  assert.deepEqual(before.map(([content]) => content), ["precious custom", "precious default"]);
});
