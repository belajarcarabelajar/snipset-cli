import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
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
  stubCommand,
} from "./helpers/install-sandbox.mjs";

// getconf lets platform_require read the glibc version, so stderr carries only real errors.
const TOOLS = [...DEFAULT_TOOLS, "getconf"];
const FLAGS = ["--add-path", "--with-mcp=opencode,cursor", "--no-init"];
const SHELL_ERROR = /Permission denied|Read-only|line \d+:|No such file|command not found|unbound variable/;

const cleanups = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()();
});

function sandbox() {
  const sb = makeSandbox({ tools: TOOLS });
  cleanups.push(() => cleanupSandbox(sb));
  const rel = fakeLinuxRelease();
  cleanups.push(() => rm(rel.dir, { recursive: true, force: true }));
  downloaderShims(sb, rel);
  // A fish on PATH makes pathenv_add write the fish conf.d file.
  stubCommand(sb, "fish", "exit 0\n");
  sb.at = (...parts) => join(sb.home, ...parts);
  sb.record = sb.at(".local", "bin", ".snipset-dirs");
  writeFileSync(sb.at(".bashrc"), "# user bashrc\n");
  writeFileSync(sb.at(".profile"), "# user profile\n");
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

const removedDirs = (stdout) =>
  stdout
    .split("\n")
    .filter((line) => line.startsWith("[REMOVED] dir: "))
    .map((line) => line.slice("[REMOVED] dir: ".length));

test("dirs record: install then uninstall leaves the HOME directory list as it was", async () => {
  const sb = sandbox();
  const before = dirs(sb);
  await ok(sb, FLAGS);
  const installed = dirs(sb);
  assert.ok(installed.includes(".config/fish/conf.d"), `the fish stub did not take effect: ${installed.join(", ")}`);
  assert.ok(existsSync(sb.record), "install wrote no .snipset-dirs record");

  const un = await ok(sb, ["--uninstall", ...FLAGS]);
  assert.deepEqual(dirs(sb), before, `directories left after uninstall:\n${un.stdout}`);
  const created = installed.filter((path) => !before.includes(path)).map((path) => sb.at(...path.split("/")));
  assert.deepEqual(removedDirs(un.stdout).sort(), created.sort(), un.stdout);
  const removed = un.stdout.split("\n").filter((line) => line.startsWith("[REMOVED] ")).length;
  assert.match(un.stdout, new RegExp(`^uninstall: removed ${removed}, kept \\d+$`, "m"), un.stdout);

  const again = await ok(sb, ["--uninstall", ...FLAGS]);
  assert.match(again.stdout, /^uninstall: removed 0, kept \d+$/m, again.stdout);
  assert.deepEqual(removedDirs(again.stdout), [], again.stdout);
});

test("dirs record: an empty ~/.cursor seeded before install survives uninstall", async () => {
  const sb = sandbox();
  mkdirSync(sb.at(".cursor"));
  const before = dirs(sb);
  await ok(sb, FLAGS);
  assert.ok(!recordLines(sb).includes(sb.at(".cursor")), "a pre-existing directory was recorded");
  const un = await ok(sb, ["--uninstall", ...FLAGS]);
  assert.deepEqual(dirs(sb), before, un.stdout);
});

test("dirs record: a user file added to ~/.config/opencode keeps that directory and its parents", async () => {
  const sb = sandbox();
  const before = dirs(sb);
  await ok(sb, FLAGS);
  writeFileSync(sb.at(".config", "opencode", "user.json"), "{}\n");
  const un = await ok(sb, ["--uninstall", ...FLAGS]);
  assert.deepEqual(dirs(sb), [...before, ".config", ".config/opencode"].sort(), un.stdout);
  assert.equal(readFileSync(sb.at(".config", "opencode", "user.json"), "utf8"), "{}\n");
});

test("dirs record: recorded paths outside the candidate set, and $HOME itself, are left", async () => {
  const sb = sandbox();
  const outside = join(sb.root, "outside");
  mkdirSync(outside);
  mkdirSync(sb.at("stray"));
  const before = dirs(sb);
  await ok(sb, FLAGS);
  appendFileSync(sb.record, `${outside}\n${sb.at("stray")}\n${sb.home}\n`);
  const un = await ok(sb, ["--uninstall", ...FLAGS]);
  assert.ok(existsSync(outside), "a directory outside HOME was removed");
  assert.ok(existsSync(sb.home), "HOME was removed");
  assert.deepEqual(dirs(sb), before, un.stdout);
  for (const path of [outside, sb.at("stray"), sb.home]) {
    assert.ok(!removedDirs(un.stdout).includes(path), `${path} reported as removed`);
  }
});

test("dirs record: a share dir that existed before install, empty, survives uninstall", async () => {
  const sb = sandbox();
  mkdirSync(sb.at(".local", "share", "snipset"), { recursive: true });
  const before = dirs(sb);
  await ok(sb, FLAGS);
  const un = await ok(sb, ["--uninstall", ...FLAGS]);
  assert.deepEqual(dirs(sb), before, un.stdout);
});

test("dirs record: when every target directory already exists, uninstall keeps them all", async () => {
  const sb = sandbox();
  for (const dir of [[".local", "bin"], [".local", "share", "snipset"], [".config", "opencode"], [".config", "fish", "conf.d"], [".cursor"]]) {
    mkdirSync(sb.at(...dir), { recursive: true });
  }
  const before = dirs(sb);
  await ok(sb, FLAGS);
  assert.ok(existsSync(sb.record), "install wrote no .snipset-dirs record");
  assert.deepEqual(recordLines(sb), []);
  const un = await ok(sb, ["--uninstall", ...FLAGS]);
  assert.deepEqual(dirs(sb), before, un.stdout);
});

test("dirs record: a second uninstall keeps a pre-existing empty share dir", async () => {
  const sb = sandbox();
  mkdirSync(sb.at(".local", "share", "snipset"), { recursive: true });
  await ok(sb, FLAGS);
  await ok(sb, ["--uninstall", ...FLAGS]);
  assert.ok(existsSync(sb.at(".local", "share", "snipset")), "the first uninstall removed the share dir");
  const again = await ok(sb, ["--uninstall", ...FLAGS]);
  assert.ok(existsSync(sb.at(".local", "share", "snipset")), `the second uninstall removed the share dir:\n${again.stdout}`);
});

test("dirs record: an older install without a record still has its emptied share dir removed", async () => {
  const sb = sandbox();
  await ok(sb, FLAGS);
  // Installs older than the record and the manifest left neither file behind.
  await rm(sb.record);
  await rm(sb.at(".local", "share", "snipset", ".snipset-bundle"));
  const un = await ok(sb, ["--uninstall", ...FLAGS]);
  assert.match(un.stdout, /^\[REMOVED\] shell snipset\.sh: /m, un.stdout);
  assert.ok(!existsSync(sb.at(".local", "share", "snipset")), `the emptied share dir stayed:\n${un.stdout}`);
});

test("dirs record: a reinstall over an older install adopts the default share dir it took over", async () => {
  const sb = sandbox();
  await ok(sb, FLAGS);
  // An older installer left its files in the default share dir with neither the record nor the manifest.
  await rm(sb.record);
  await rm(sb.at(".local", "share", "snipset", ".snipset-bundle"));
  await ok(sb, FLAGS);
  assert.ok(recordLines(sb).includes(sb.at(".local", "share", "snipset")), recordLines(sb).join("\n"));
  const un = await ok(sb, ["--uninstall", ...FLAGS]);
  assert.ok(!existsSync(sb.at(".local", "share", "snipset")), `the adopted share dir stayed:\n${un.stdout}`);
});

test("dirs record: a share dir holding only a user's own file is not adopted", async () => {
  const sb = sandbox();
  mkdirSync(sb.at(".local", "share", "snipset"), { recursive: true });
  writeFileSync(sb.at(".local", "share", "snipset", "notes.txt"), "mine\n");
  await ok(sb, FLAGS);
  assert.ok(!recordLines(sb).includes(sb.at(".local", "share", "snipset")), recordLines(sb).join("\n"));
});

test("dirs record: ZDOTDIR and a custom --bashrc parent are recorded and removed once empty", async () => {
  const sb = sandbox();
  const env = { SHELL: "/usr/bin/zsh", ZDOTDIR: sb.at("zdot") };
  const flags = [...FLAGS, "--bashrc", sb.at("rc", "sub", "bashrc")];
  const before = dirs(sb);
  await ok(sb, flags, env);
  const lines = recordLines(sb);
  for (const path of [sb.at("zdot"), sb.at("rc"), sb.at("rc", "sub")]) {
    assert.ok(lines.includes(path), `${path} is not in the record:\n${lines.join("\n")}`);
  }
  const un = await ok(sb, ["--uninstall", ...flags], env);
  assert.deepEqual(dirs(sb), before, un.stdout);
});

test("dirs record: a second install appends new directories without duplicates", async () => {
  const sb = sandbox();
  await ok(sb, ["--add-path", "--with-mcp=opencode", "--no-init"]);
  const first = recordLines(sb);
  assert.ok(first.includes(sb.at(".local", "bin")), first.join("\n"));
  await ok(sb, FLAGS);
  const second = recordLines(sb);
  assert.deepEqual(second, [...first, sb.at(".cursor")]);
});

test("dirs record: a symlink at the record path is replaced, not written through", async () => {
  const sb = sandbox();
  mkdirSync(sb.at(".local", "bin"), { recursive: true });
  const victim = join(sb.root, "victim");
  writeFileSync(victim, "victim\n");
  symlinkSync(victim, sb.record);
  await ok(sb, FLAGS);
  assert.equal(readFileSync(victim, "utf8"), "victim\n");
  assert.ok(lstatSync(sb.record).isFile(), "the record is still a symlink");
  assert.ok(recordLines(sb).includes(sb.at(".local", "share", "snipset")), recordLines(sb).join("\n"));
});

test("dirs record: a directory whose path holds a newline is created but not recorded", async () => {
  const sb = sandbox();
  const xdg = sb.at("x\ny");
  await ok(sb, ["--add-path", "--no-init", "--no-shims"], { XDG_CONFIG_HOME: xdg });
  assert.ok(existsSync(join(xdg, "fish", "conf.d", "snipset.fish")), "the fish conf was not written");
  const lines = recordLines(sb);
  assert.ok(lines.includes(sb.at(".local", "bin")), lines.join("\n"));
  assert.ok(!lines.some((line) => line === sb.at("x") || line.startsWith("y")), lines.join("\n"));
});

test("dirs record: a .snipset-dirs linked to a directory is replaced, not written into", async () => {
  const sb = sandbox();
  const userDir = sb.at("userdir");
  mkdirSync(userDir);
  mkdirSync(sb.at(".local", "bin"), { recursive: true });
  symlinkSync(userDir, sb.record);
  await ok(sb, FLAGS);
  assert.deepEqual(readdirSync(userDir), [], "the record went into the linked directory");
  assert.ok(lstatSync(sb.record).isFile(), "the record is not a regular file");
});
