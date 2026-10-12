import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync, appendFileSync, symlinkSync } from "node:fs";
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

test("--no-shell uninstall leaves a user's tab.sh, the block, and the share dir", async () => {
  const { sb, shareDir, bashrc } = setup();
  writeFileSync(bashrc, USER_BEFORE);
  await install(sb);
  writeFileSync(join(shareDir, "tab.sh"), "# my own tab.sh\n");
  const rc = readFileSync(bashrc, "utf8");
  const res = await runInstaller(sb, [...FLAGS, "--uninstall", "--no-shell"]);
  assert.equal(res.code, 0, `${res.stdout}\n${res.stderr}`);
  assert.deepEqual(reportLines(res.stdout, "shell"), ["[SKIP] shell: --no-shell, nothing to remove"]);
  assert.doesNotMatch(res.stdout, /^\[REMOVED\] shell /m);
  assert.equal(readFileSync(join(shareDir, "tab.sh"), "utf8"), "# my own tab.sh\n");
  for (const name of SHARE_FILES) assert.ok(existsSync(join(shareDir, name)), `${name} was removed`);
  assert.equal(readFileSync(bashrc, "utf8"), rc);
});

test("uninstall keeps a symlinked share file and removes the regular ones", async () => {
  const { sb, shareDir } = setup();
  await install(sb);
  const target = join(sb.home, "dotfiles", "tab.sh");
  mkdirSync(join(sb.home, "dotfiles"));
  writeFileSync(target, "# dotfiles tab.sh\n");
  await unlink(join(shareDir, "tab.sh"));
  symlinkSync(target, join(shareDir, "tab.sh"));
  const res = await runInstaller(sb, [...FLAGS, "--uninstall"]);
  assert.equal(res.code, 0, `${res.stdout}\n${res.stderr}`);
  assert.deepEqual(reportLines(res.stdout, "shell tab.sh"), [
    `[KEEP] shell tab.sh: ${join(shareDir, "tab.sh")} symlink left in place`,
  ]);
  assert.ok(lstatSync(join(shareDir, "tab.sh")).isSymbolicLink());
  assert.equal(readFileSync(target, "utf8"), "# dotfiles tab.sh\n");
  for (const name of ["snipset.sh", "completion.bash"]) assert.ok(!existsSync(join(shareDir, name)), `${name} survived`);
});

test("a read-only HOME keeps the shell block byte-identical and fails the uninstall", async () => {
  const { sb, bashrc } = setup();
  writeFileSync(bashrc, USER_BEFORE);
  await install(sb);
  const before = readFileSync(bashrc, "utf8");
  chmodSync(sb.home, 0o555);
  let res;
  try {
    res = await runInstaller(sb, [...FLAGS, "--uninstall"]);
  } finally {
    chmodSync(sb.home, 0o755);
  }
  assert.equal(readFileSync(bashrc, "utf8"), before, res.stdout);
  assert.deepEqual(reportLines(res.stdout, "shell block"), [`[FAIL] shell block: ${bashrc} left unchanged`]);
  assert.equal(res.code, 1, `${res.stdout}\n${res.stderr}`);
  assert.deepEqual(readdirSync(sb.home).filter((name) => /\.snipset-(new|bak)\./.test(name)), []);
});

const INIT_NOTE = "install.sh: database init skipped (already exists or unreachable); run 'snipset doctor' to check";

test("reinstall over an existing database prints only the installer's init note", async () => {
  const { sb } = setup();
  await install(sb);
  const res = await install(sb);
  const lines = res.stderr.split("\n");
  assert.ok(lines.includes(INIT_NOTE), res.stderr);
  assert.deepEqual(lines.filter((line) => line.includes("already exists")), [INIT_NOTE]);
});

test("an init failure other than an existing database is still shown", { skip: process.getuid?.() === 0 && "root ignores directory permissions" }, async () => {
  const { sb } = setup();
  const roDir = join(sb.home, "ro");
  mkdirSync(roDir);
  chmodSync(roDir, 0o555);
  let res;
  try {
    res = await install(sb, ["--db", join(roDir, "snipset.db")]);
  } finally {
    chmodSync(roDir, 0o755);
  }
  const lines = res.stderr.split("\n");
  assert.ok(lines.includes(INIT_NOTE), res.stderr);
  assert.deepEqual(
    lines.filter((line) => line.includes("Permission denied")).map((line) => line.startsWith("install.sh: snipset init: ")),
    [true],
    res.stderr,
  );
  assert.ok(!existsSync(join(roDir, "snipset.db")));
});

const MANIFEST = ".snipset-bundle";
const USER_TAB = "# my tab\n";

function releaseWith(sb, shellStubs) {
  const release = fakeLinuxRelease({ shellStubs });
  cleanups.push(() => rm(release.dir, { recursive: true, force: true }));
  downloaderShims(sb, release);
}

function sandboxOnly() {
  const sb = makeSandbox();
  cleanups.push(() => cleanupSandbox(sb));
  return sb;
}

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

function userTabShare(sb) {
  const share = join(sb.home, "mystuff");
  mkdirSync(share);
  writeFileSync(join(share, "tab.sh"), USER_TAB);
  return share;
}

test("share dir manifest: a user's tab.sh in a custom --share-dir survives install and uninstall", async () => {
  const { sb, bashrc } = setup();
  const share = userTabShare(sb);
  const tab = join(share, "tab.sh");
  const res = await install(sb, ["--share-dir", share]);
  assert.equal(readFileSync(tab, "utf8"), USER_TAB, "install overwrote the user's tab.sh");
  assert.deepEqual(reportLines(res.stdout, "shell tab.sh"), [`[KEEP] shell tab.sh: ${tab} was not written by the installer`]);
  assert.equal(reportLines(res.stdout, "shell block").length, 1, res.stdout);
  assert.match(reportLines(res.stdout, "shell block")[0], /^\[SKIP\] shell block: .*tab\.sh/);
  assert.ok(!existsSync(bashrc) || !readFileSync(bashrc, "utf8").includes(MARKER), "bashrc block written");
  const un = await runInstaller(sb, [...FLAGS, "--share-dir", share, "--uninstall"]);
  assert.equal(un.code, 0, `${un.stdout}\n${un.stderr}`);
  assert.equal(existsSync(tab) && readFileSync(tab, "utf8"), USER_TAB, "uninstall deleted or changed the user's tab.sh");
  assert.equal(reportLines(un.stdout, "shell tab.sh").length, 1, un.stdout);
  assert.match(reportLines(un.stdout, "shell tab.sh")[0], /^\[KEEP\] shell tab\.sh: /);
  assert.deepEqual(readdirSync(share), ["tab.sh"]);
});

test("share dir manifest: release B's shell bytes replace release A's (control)", async () => {
  const sb = sandboxOnly();
  const share = join(sb.home, "mystuff");
  releaseWith(sb, { "snipset.sh": "# snipset A\n", "tab.sh": "# tab A\n" });
  await install(sb, ["--share-dir", share]);
  const b = { "snipset.sh": "# snipset B\n", "completion.bash": "# completion B\n", "tab.sh": "# tab B\n" };
  releaseWith(sb, b);
  const res = await install(sb, ["--share-dir", share]);
  for (const name of SHARE_FILES) assert.equal(readFileSync(join(share, name), "utf8"), b[name], `${name} kept release A's bytes`);
  assert.doesNotMatch(res.stdout, /^\[KEEP\] shell /m);
  assert.ok(readFileSync(join(sb.home, ".bashrc"), "utf8").includes(MARKER), "block missing");
});

test("share dir manifest: a user edit to an installed file is kept on uninstall", async () => {
  const { sb, shareDir } = setup();
  await install(sb);
  const tab = join(shareDir, "tab.sh");
  const edited = "# tab.sh fixture\n# my edit\n";
  writeFileSync(tab, edited);
  const res = await runInstaller(sb, [...FLAGS, "--uninstall"]);
  assert.equal(res.code, 0, `${res.stdout}\n${res.stderr}`);
  assert.equal(existsSync(tab) && readFileSync(tab, "utf8"), edited, "uninstall deleted the edited tab.sh");
  assert.equal(reportLines(res.stdout, "shell tab.sh").length, 1, res.stdout);
  assert.match(reportLines(res.stdout, "shell tab.sh")[0], /^\[KEEP\] shell tab\.sh: /);
  for (const name of ["snipset.sh", "completion.bash"]) assert.ok(!existsSync(join(shareDir, name)), `${name} survived`);
  assert.ok(existsSync(join(shareDir, MANIFEST)), "manifest removed while a listed file remains");
});

test("share dir manifest: the default share dir without a manifest still upgrades", async () => {
  const sb = sandboxOnly();
  const shareDir = join(sb.home, ".local", "share", "snipset");
  releaseWith(sb, { "tab.sh": "# tab A\n" });
  await install(sb);
  await rm(join(shareDir, MANIFEST), { force: true });
  const b = { "snipset.sh": "# snipset B\n", "completion.bash": "# completion B\n", "tab.sh": "# tab B\n" };
  releaseWith(sb, b);
  const res = await install(sb);
  for (const name of SHARE_FILES) assert.equal(readFileSync(join(shareDir, name), "utf8"), b[name], `${name} not upgraded`);
  assert.doesNotMatch(res.stdout, /^\[KEEP\] shell /m);
  const want = SHARE_FILES.map((name) => `${sha256(b[name])}  ${name}\n`).join("");
  assert.equal(existsSync(join(shareDir, MANIFEST)) && readFileSync(join(shareDir, MANIFEST), "utf8"), want);
});

test("share dir manifest: --check names a kept file", async () => {
  const { sb } = setup();
  const share = userTabShare(sb);
  await install(sb, ["--share-dir", share]);
  const res = await runInstaller(sb, [...FLAGS, "--share-dir", share, "--check"]);
  assert.equal(res.code, 1, `${res.stdout}\n${res.stderr}`);
  const tab = join(share, "tab.sh");
  assert.deepEqual(reportLines(res.stdout, "shell tab.sh"), [`[DRIFT] shell tab.sh: ${tab}: not written by the installer`]);
  assert.deepEqual(reportLines(res.stdout, "shell snipset.sh"), [`[OK] shell snipset.sh: ${join(share, "snipset.sh")}`]);
});

test("share dir manifest: a kept edit survives a reinstall, an uninstall, and another install", async () => {
  const { sb, shareDir } = setup();
  await install(sb);
  const tab = join(shareDir, "tab.sh");
  const edited = "# tab.sh fixture\n# my edit\n";
  writeFileSync(tab, edited);
  await install(sb);
  const un = await runInstaller(sb, [...FLAGS, "--uninstall"]);
  assert.equal(un.code, 0, `${un.stdout}\n${un.stderr}`);
  const res = await install(sb);
  assert.equal(readFileSync(tab, "utf8"), edited, "the default share dir fell back to overwriting the edit");
  assert.deepEqual(reportLines(res.stdout, "shell tab.sh"), [`[KEEP] shell tab.sh: ${tab} was not written by the installer`]);
});

test("share dir manifest: a custom share dir without a manifest is adopted when its files match the release", async () => {
  const { sb } = setup();
  const share = join(sb.home, "mystuff");
  mkdirSync(share);
  for (const name of SHARE_FILES) writeFileSync(join(share, name), `# ${name} fixture\n`);
  const res = await install(sb, ["--share-dir", share]);
  assert.doesNotMatch(res.stdout, /^\[KEEP\] shell /m);
  assert.ok(existsSync(join(share, MANIFEST)), "manifest not written");
  assert.ok(readFileSync(join(sb.home, ".bashrc"), "utf8").includes(MARKER), "block missing");
});
