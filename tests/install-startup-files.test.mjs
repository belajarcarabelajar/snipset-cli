import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import {
  DEFAULT_TOOLS,
  cleanupSandbox,
  downloaderShims,
  fakeLinuxRelease,
  makeSandbox,
  runInstaller,
  snapshotTree,
} from "./helpers/install-sandbox.mjs";

// getconf lets platform_require read the glibc version, so stderr carries only real errors.
const TOOLS = [...DEFAULT_TOOLS, "getconf"];
const FLAGS = ["--add-path", "--no-init", "--no-shims"];
const SHELL_ERROR = /Permission denied|Read-only|line \d+:|No such file|command not found|unbound variable/;

const cleanups = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()();
});

function sandbox({ seed = true } = {}) {
  const sb = makeSandbox({ tools: TOOLS });
  cleanups.push(() => cleanupSandbox(sb));
  const rel = fakeLinuxRelease();
  cleanups.push(() => rm(rel.dir, { recursive: true, force: true }));
  downloaderShims(sb, rel);
  sb.at = (...parts) => join(sb.home, ...parts);
  sb.record = sb.at(".local", "bin", ".snipset-files");
  if (seed) {
    writeFileSync(sb.at(".bashrc"), "# user bashrc\n");
    writeFileSync(sb.at(".profile"), "# user profile\n");
  }
  return sb;
}

function dirs(sb) {
  return snapshotTree(sb.home)
    .filter((entry) => entry.type === "dir")
    .map((entry) => entry.path);
}

function recordLines(sb) {
  return readFileSync(sb.record, "utf8").split("\n").filter((line) => line.length > 0);
}

async function ok(sb, args, env) {
  const result = await runInstaller(sb, args, { env });
  assert.equal(result.code, 0, `${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
  assert.doesNotMatch(result.stderr, SHELL_ERROR, `${args.join(" ")}\n${result.stderr}`);
  return result;
}

const removedFiles = (stdout) =>
  stdout
    .split("\n")
    .filter((line) => line.startsWith("[REMOVED] startup file: "))
    .map((line) => line.slice("[REMOVED] startup file: ".length));

test("startup files: a custom --bashrc the installer created is removed with its directory", async () => {
  const sb = sandbox();
  const rc = sb.at("rc", "bashrc");
  const flags = [...FLAGS, "--bashrc", rc];
  const before = dirs(sb);
  await ok(sb, flags);
  assert.ok(existsSync(rc), "install did not create the --bashrc file");

  const un = await ok(sb, ["--uninstall", ...flags]);
  assert.ok(!existsSync(rc), `the emptied --bashrc file stayed:\n${un.stdout}`);
  assert.ok(!existsSync(sb.at("rc")), `the --bashrc directory stayed:\n${un.stdout}`);
  assert.deepEqual(dirs(sb), before, un.stdout);
  assert.deepEqual(removedFiles(un.stdout), [rc], un.stdout);
  const removed = un.stdout.split("\n").filter((line) => line.startsWith("[REMOVED] ")).length;
  assert.match(un.stdout, new RegExp(`^uninstall: removed ${removed}, kept \\d+$`, "m"), un.stdout);
  assert.ok(!existsSync(sb.record), "the record outlived uninstall");
});

test("startup files: an empty HOME is empty again after install and uninstall", async () => {
  const sb = sandbox({ seed: false });
  await ok(sb, FLAGS);
  assert.ok(existsSync(sb.at(".profile")) && existsSync(sb.at(".bashrc")), "install did not create .profile and .bashrc");
  const un = await ok(sb, ["--uninstall", ...FLAGS]);
  assert.deepEqual(snapshotTree(sb.home), [], un.stdout);
  assert.deepEqual(removedFiles(un.stdout).sort(), [sb.at(".bashrc"), sb.at(".profile")].sort(), un.stdout);
});

test("startup files: a $ZDOTDIR/.zshenv the installer created is removed with ZDOTDIR", async () => {
  const sb = sandbox();
  const env = { SHELL: "/usr/bin/zsh", ZDOTDIR: sb.at("zdot") };
  const zshenv = sb.at("zdot", ".zshenv");
  const before = dirs(sb);
  await ok(sb, FLAGS, env);
  assert.ok(existsSync(zshenv), "install did not create .zshenv");
  const un = await ok(sb, ["--uninstall", ...FLAGS], env);
  assert.ok(!existsSync(zshenv), `the emptied .zshenv stayed:\n${un.stdout}`);
  assert.deepEqual(dirs(sb), before, un.stdout);
  assert.deepEqual(removedFiles(un.stdout), [zshenv], un.stdout);
});

test("startup files: a .bashrc and .profile that existed before install, even empty, are kept", async () => {
  const sb = sandbox();
  writeFileSync(sb.at(".bashrc"), "");
  writeFileSync(sb.at(".profile"), "");
  await ok(sb, FLAGS);
  assert.ok(!existsSync(sb.record), `install recorded a file the user had:\n${existsSync(sb.record) ? recordLines(sb).join("\n") : ""}`);
  const un = await ok(sb, ["--uninstall", ...FLAGS]);
  for (const name of [".bashrc", ".profile"]) {
    assert.equal(readFileSync(sb.at(name), "utf8"), "", `${name}:\n${un.stdout}`);
  }
  assert.deepEqual(removedFiles(un.stdout), [], un.stdout);
});

test("startup files: a line the user added to a created file keeps the file and that line", async () => {
  const sb = sandbox();
  const rc = sb.at("rc", "bashrc");
  const flags = [...FLAGS, "--bashrc", rc];
  await ok(sb, flags);
  appendFileSync(rc, "alias ll='ls -l'\n");
  const un = await ok(sb, ["--uninstall", ...flags]);
  assert.equal(readFileSync(rc, "utf8"), "alias ll='ls -l'\n", un.stdout);
  assert.deepEqual(removedFiles(un.stdout), [], un.stdout);
});

test("startup files: recorded paths outside the startup set are left, even when empty", async () => {
  const sb = sandbox();
  const rc = sb.at("rc", "bashrc");
  const flags = [...FLAGS, "--bashrc", rc];
  const notes = sb.at("notes.txt");
  const outside = join(sb.root, "outside.txt");
  writeFileSync(notes, "");
  writeFileSync(outside, "\n");
  await ok(sb, flags);
  appendFileSync(sb.record, `${notes}\n${outside}\n${sb.home}\n`);
  const un = await ok(sb, ["--uninstall", ...flags]);
  assert.equal(readFileSync(notes, "utf8"), "", un.stdout);
  assert.equal(readFileSync(outside, "utf8"), "\n", un.stdout);
  assert.ok(existsSync(sb.home), "HOME was removed");
  assert.deepEqual(removedFiles(un.stdout), [rc], un.stdout);
});

test("startup files: a .snipset-files linked to a directory is replaced, not written into", async () => {
  const sb = sandbox();
  const rc = sb.at("rc", "bashrc");
  const userDir = sb.at("userdir");
  mkdirSync(userDir);
  mkdirSync(sb.at(".local", "bin"), { recursive: true });
  symlinkSync(userDir, sb.record);
  await ok(sb, [...FLAGS, "--bashrc", rc]);
  assert.deepEqual(readdirSync(userDir), [], "the record went into the linked directory");
  assert.ok(lstatSync(sb.record).isFile(), "the record is not a regular file");
  assert.deepEqual(recordLines(sb), [rc]);
});

// Root reads a mode 000 file anyway, so the record would not be unreadable.
test("startup files: an unreadable .snipset-files is reported and neither rewritten nor acted on", { skip: process.getuid?.() === 0 }, async () => {
  const sb = sandbox();
  const rc = sb.at("rc", "bashrc");
  const flags = [...FLAGS, "--bashrc", rc];
  await ok(sb, flags);
  const text = readFileSync(sb.record, "utf8");
  chmodSync(sb.record, 0o000);
  // The rerun creates ~/.profile again, so it would rewrite a record it read as empty.
  await rm(sb.at(".profile"));
  const again = await runInstaller(sb, flags);
  assert.equal(again.code, 1, `${again.stdout}\n${again.stderr}`);
  assert.match(again.stdout, /^\[FAIL\] files record: .*could not be read$/m, again.stdout);
  const un = await runInstaller(sb, ["--uninstall", ...flags]);
  assert.equal(un.code, 1, `${un.stdout}\n${un.stderr}`);
  assert.match(un.stdout, /^\[FAIL\] files record: .*could not be read$/m, un.stdout);
  for (const path of [rc, sb.at(".profile")]) {
    assert.ok(existsSync(path), `${path} was removed through an unreadable record:\n${un.stdout}`);
  }
  assert.equal(statSync(sb.record).mode & 0o777, 0, "the record was replaced");
  chmodSync(sb.record, 0o600);
  assert.equal(readFileSync(sb.record, "utf8"), text);
});
