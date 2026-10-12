import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import {
  cleanupSandbox,
  diffSnapshots,
  downloaderShims,
  fakeLinuxRelease,
  makeSandbox,
  readDownloads,
  runInstaller,
  snapshotTree,
} from "./helpers/install-sandbox.mjs";

const MCP_IDS = ["claude", "codex", "gemini", "opencode", "cursor", "vscode"];
const OLD_FLAGS = [
  "--version",
  "--install-dir",
  "--add-path",
  "--share-dir",
  "--db",
  "--bashrc",
  "--no-init",
  "--no-shell",
  "--no-shims",
  "--with-mcp",
];
const NEW_FLAGS = ["--with-mcp=LIST", "--from", "--dry-run", "--check", "--update", "--uninstall"];

const cleanups = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()();
});

function sandbox() {
  const sb = makeSandbox();
  cleanups.push(() => cleanupSandbox(sb));
  return sb;
}

// A sandbox whose downloader logs every call, so a dry run can prove it fetched nothing.
function sandboxWithRelease() {
  const sb = sandbox();
  const release = fakeLinuxRelease();
  cleanups.push(() => rm(release.dir, { recursive: true, force: true }));
  downloaderShims(sb, release, { curl: true, wget: true });
  return sb;
}

function lines(text) {
  return text.split("\n").filter((line) => line.length > 0);
}

function mcpIdsNamed(stdout) {
  return lines(stdout)
    .map((line) => /^\[DRY\] mcp (\S+):/.exec(line))
    .filter(Boolean)
    .map((match) => match[1])
    .sort();
}

function assertUsageError(result, args) {
  assert.equal(result.code, 2, `${args.join(" ")} should exit 2; stderr: ${result.stderr}`);
  assert.match(result.stderr, /Usage: install\.sh/, `${args.join(" ")} should print usage on stderr`);
  assert.equal(result.stdout, "", `${args.join(" ")} should print nothing on stdout`);
}

function assertAccepted(result, args) {
  assert.notEqual(result.code, 2, `${args.join(" ")} should not be a usage error; stderr: ${result.stderr}`);
  assert.doesNotMatch(result.stderr, /Usage: install\.sh/, `${args.join(" ")} printed usage`);
}

test("--help and -h list every old and new flag and exit 0", async () => {
  const sb = sandbox();
  for (const flag of ["--help", "-h"]) {
    const result = await runInstaller(sb, [flag]);
    assert.equal(result.code, 0, result.stderr);
    const printed = lines(result.stdout);
    for (const name of [...OLD_FLAGS, ...NEW_FLAGS]) {
      assert.ok(
        printed.some((line) => line.startsWith(`  ${name} `)),
        `${flag}: no option line for ${name}`,
      );
    }
    assert.ok(result.stdout.includes("--help, -h"), `${flag}: no line for --help, -h`);
  }
});

test("an unknown flag exits 2 with usage on stderr", async () => {
  const sb = sandbox();
  const args = ["--bogus"];
  assertUsageError(await runInstaller(sb, args), args);
});

test("two lifecycle modes are a usage error while one mode is accepted", async () => {
  const sb = sandbox();
  for (const args of [
    ["--check", "--uninstall"],
    ["--uninstall", "--check"],
    ["--update", "--check"],
    ["--check", "--check"],
  ]) {
    assertUsageError(await runInstaller(sb, args), args);
  }
  for (const args of [["--check"], ["--uninstall"]]) {
    assertAccepted(await runInstaller(sb, args), args);
  }
});

test("an unknown --with-mcp id exits 2 while a known id is accepted", async () => {
  const sb = sandboxWithRelease();
  for (const args of [["--with-mcp=bogus"], ["--with-mcp=claude,bogus"], ["--with-mcp=claude,"]]) {
    assertUsageError(await runInstaller(sb, args), args);
  }
  const args = ["--dry-run", "--version", "0.1.0", "--with-mcp=claude"];
  assertAccepted(await runInstaller(sb, args), args);
});

test("--from without a value exits 2 while --from DIR is accepted", async () => {
  const sb = sandboxWithRelease();
  assertUsageError(await runInstaller(sb, ["--from"]), ["--from"]);
  const args = ["--dry-run", "--version", "0.1.0", "--from", sb.tmp];
  assertAccepted(await runInstaller(sb, args), args);
});

test("--dry-run reports every step, downloads nothing, and leaves HOME unchanged", async () => {
  const sb = sandboxWithRelease();
  writeFileSync(join(sb.home, ".bashrc"), "# user bashrc\n");
  mkdirSync(join(sb.home, ".config"));
  const before = snapshotTree(sb.home);
  const installDir = join(sb.home, "custom-bin");
  const shareDir = join(sb.home, "custom-share");
  const bashrc = join(sb.home, ".bashrc");
  const result = await runInstaller(sb, [
    "--dry-run",
    "--version",
    "0.1.0",
    "--install-dir",
    installDir,
    "--share-dir",
    shareDir,
    "--bashrc",
    bashrc,
  ]);
  assert.equal(result.code, 0, result.stderr);
  const printed = lines(result.stdout);
  const dry = printed.filter((line) => line.startsWith("[DRY] "));
  assert.ok(dry.length >= 14, `expected one [DRY] line per install step, got ${dry.length}:\n${result.stdout}`);
  assert.equal(printed.at(-1), "dry run: nothing was written");
  for (const path of [installDir, shareDir, bashrc, join(sb.home, ".profile")]) {
    assert.ok(dry.some((line) => line.includes(path)), `no [DRY] line names ${path}:\n${result.stdout}`);
  }
  assert.doesNotMatch(result.stdout, /^Installed snipset/m);
  assert.deepEqual(readDownloads(sb), []);
  assert.deepEqual(diffSnapshots(before, snapshotTree(sb.home)), []);
});

test("--dry-run without --with-mcp names no MCP harness", async () => {
  const sb = sandboxWithRelease();
  const result = await runInstaller(sb, ["--dry-run", "--version", "0.1.0"]);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(mcpIdsNamed(result.stdout), []);
});

test("--dry-run --with-mcp and --with-mcp= name opencode only", async () => {
  const sb = sandboxWithRelease();
  for (const flag of ["--with-mcp", "--with-mcp="]) {
    const result = await runInstaller(sb, ["--dry-run", "--version", "0.1.0", flag]);
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(mcpIdsNamed(result.stdout), ["opencode"], `${flag}:\n${result.stdout}`);
  }
  assert.deepEqual(readDownloads(sb), []);
});

test("--dry-run --with-mcp=claude,codex names both", async () => {
  const sb = sandboxWithRelease();
  const result = await runInstaller(sb, ["--dry-run", "--version", "0.1.0", "--with-mcp=claude,codex"]);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(mcpIdsNamed(result.stdout), ["claude", "codex"]);
  assert.deepEqual(readDownloads(sb), []);
});

test("--dry-run --with-mcp=all names all six harnesses", async () => {
  const sb = sandboxWithRelease();
  const result = await runInstaller(sb, ["--dry-run", "--version", "0.1.0", "--with-mcp=all"]);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(mcpIdsNamed(result.stdout), [...MCP_IDS].sort());
  assert.deepEqual(readDownloads(sb), []);
});
