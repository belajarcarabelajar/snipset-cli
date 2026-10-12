import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdtempSync, openSync, readSync, closeSync, symlinkSync, writeFileSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_TOOLS,
  cleanupSandbox,
  downloaderShims,
  fakeLinuxRelease,
  makeSandbox,
  readDownloads,
  runInstaller,
} from "./helpers/install-sandbox.mjs";

const cleanups = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()();
});

const NO_HASH_TOOLS = DEFAULT_TOOLS.filter((tool) => tool !== "sha256sum");

function sandbox(opts) {
  const sb = makeSandbox(opts);
  cleanups.push(() => cleanupSandbox(sb));
  return sb;
}

function release(opts) {
  const rel = fakeLinuxRelease(opts);
  cleanups.push(() => rm(rel.dir, { recursive: true, force: true }));
  return rel;
}

function scratchDir() {
  const dir = mkdtempSync(join(tmpdir(), "snipset-from-"));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

function findTool(name, dirs) {
  return dirs.map((dir) => join(dir, name)).find((path) => existsSync(path)) ?? null;
}

// The sandbox PATH holds only symlinks, so a `#!/usr/bin/env perl` tool would fail
// there for a reason unrelated to the installer.
function assertAbsoluteInterpreter(path) {
  const head = Buffer.alloc(256);
  const fd = openSync(path, "r");
  const size = readSync(fd, head, 0, head.length, 0);
  closeSync(fd);
  const text = head.subarray(0, size).toString("latin1");
  if (!text.startsWith("#!")) return;
  const interpreter = text.slice(2).split("\n")[0].trim().split(/\s+/)[0];
  assert.ok(interpreter.startsWith("/"), `${path} names a relative interpreter: ${interpreter}`);
  assert.ok(!interpreter.endsWith("/env"), `${path} resolves its interpreter through PATH: ${text.split("\n")[0]}`);
  assert.ok(existsSync(interpreter), `${path} interpreter ${interpreter} is missing`);
}

function addTool(sb, name, path) {
  assertAbsoluteInterpreter(path);
  symlinkSync(path, join(sb.bin, name));
}

function installArgs(sb, extra = []) {
  return ["--install-dir", join(sb.home, "bin"), "--no-shell", "--no-init", "--no-shims", ...extra];
}

function assertInstalled(sb, result) {
  assert.equal(result.code, 0, `install failed: ${result.stderr}`);
  assert.ok(existsSync(join(sb.home, "bin", "snipset")), "snipset binary was not placed");
}

function assertRefused(sb, result, pattern) {
  assert.equal(result.code, 1, `expected exit 1; stdout: ${result.stdout} stderr: ${result.stderr}`);
  assert.match(result.stderr, pattern);
  assert.ok(!existsSync(join(sb.home, "bin", "snipset")), "a refused install placed the binary");
}

test("wget alone downloads with retry and timeout limits", async () => {
  const sb = sandbox();
  downloaderShims(sb, release(), { curl: false, wget: true });
  const result = await runInstaller(sb, installArgs(sb));
  assertInstalled(sb, result);
  const calls = readDownloads(sb);
  assert.equal(calls.length, 3, calls.join("\n"));
  for (const call of calls) {
    assert.match(call, /^wget /);
    assert.ok(call.split(" ").includes("--tries=3"), `wget call lacks --tries=3: ${call}`);
    assert.ok(call.split(" ").includes("--timeout=15"), `wget call lacks --timeout=15: ${call}`);
  }
});

test("no curl and no wget exits 1 naming both", async () => {
  const sb = sandbox();
  const result = await runInstaller(sb, installArgs(sb));
  assertRefused(sb, result, /install\.sh: curl or wget is required/);
});

test("shasum alone verifies the archive", async () => {
  const shasum = findTool("shasum", ["/usr/bin", "/bin", "/usr/bin/core_perl", "/usr/local/bin"]);
  assert.ok(shasum, "shasum is not installed on this host");
  const sb = sandbox({ tools: NO_HASH_TOOLS });
  addTool(sb, "shasum", shasum);
  downloaderShims(sb, release());
  assertInstalled(sb, await runInstaller(sb, installArgs(sb)));
});

test("openssl alone verifies the archive", async () => {
  const openssl = findTool("openssl", ["/usr/bin", "/bin", "/usr/local/bin"]);
  assert.ok(openssl, "openssl is not installed on this host");
  const sb = sandbox({ tools: NO_HASH_TOOLS });
  addTool(sb, "openssl", openssl);
  downloaderShims(sb, release());
  assertInstalled(sb, await runInstaller(sb, installArgs(sb)));
});

test("shasum and openssl still reject a checksum mismatch", async () => {
  for (const [name, dirs] of [
    ["shasum", ["/usr/bin", "/bin", "/usr/bin/core_perl", "/usr/local/bin"]],
    ["openssl", ["/usr/bin", "/bin", "/usr/local/bin"]],
  ]) {
    const sb = sandbox({ tools: NO_HASH_TOOLS });
    addTool(sb, name, findTool(name, dirs));
    downloaderShims(sb, release({ badHash: true }));
    assertRefused(sb, await runInstaller(sb, installArgs(sb)), /checksum mismatch/);
  }
});

test("no hash tool exits 1 naming all three", async () => {
  const sb = sandbox({ tools: NO_HASH_TOOLS });
  downloaderShims(sb, release());
  const result = await runInstaller(sb, installArgs(sb));
  assertRefused(sb, result, /install\.sh: sha256sum, shasum, or openssl is required/);
  assert.deepEqual(readDownloads(sb), [], "downloaded before the tool check");
});

test("--from installs with no downloader on PATH", async () => {
  const sb = sandbox();
  const rel = release({ version: "0.3.1" });
  const result = await runInstaller(sb, installArgs(sb, ["--from", rel.dir]));
  assertInstalled(sb, result);
  assert.match(result.stdout, /Installed snipset v0\.3\.1 /);
  assert.deepEqual(readDownloads(sb), []);
});

test("--from accepts the SHA256SUMS binary-mode marker", async () => {
  const sb = sandbox();
  const rel = release({ starMarker: true });
  assert.match(readFileSync(rel.sums, "utf8"), / \*snipset-cli-/);
  assertInstalled(sb, await runInstaller(sb, installArgs(sb, ["--from", rel.dir])));
});

test("--from without SHA256SUMS exits 1 naming it", async () => {
  const sb = sandbox();
  const rel = release();
  const dir = scratchDir();
  copyFileSync(rel.archive, join(dir, rel.assetName));
  for (const extra of [[], ["--version", rel.version]]) {
    const result = await runInstaller(sb, installArgs(sb, ["--from", dir, ...extra]));
    assertRefused(sb, result, /SHA256SUMS/);
  }
});

test("--from without the archive exits 1 naming it", async () => {
  const sb = sandbox();
  const rel = release();
  const dir = scratchDir();
  copyFileSync(rel.sums, join(dir, "SHA256SUMS"));
  const result = await runInstaller(sb, installArgs(sb, ["--from", dir]));
  assertRefused(sb, result, new RegExp(rel.assetName.replace(/[.]/g, "\\.")));
});

test("--from with two versions needs --version", async () => {
  const sb = sandbox();
  const older = release({ version: "0.1.0" });
  const newer = release({ version: "0.2.0" });
  const dir = scratchDir();
  copyFileSync(older.archive, join(dir, older.assetName));
  copyFileSync(newer.archive, join(dir, newer.assetName));
  writeFileSync(join(dir, "SHA256SUMS"), readFileSync(older.sums, "utf8") + readFileSync(newer.sums, "utf8"));
  const result = await runInstaller(sb, installArgs(sb, ["--from", dir]));
  assertRefused(sb, result, /found 2\b/);
  const pinned = await runInstaller(sb, installArgs(sb, ["--from", dir, "--version", "0.2.0"]));
  assertInstalled(sb, pinned);
  assert.match(pinned.stdout, /Installed snipset v0\.2\.0 /);
});

test("--from with no Linux archive listed exits 1 naming the count", async () => {
  const sb = sandbox();
  const dir = scratchDir();
  writeFileSync(join(dir, "SHA256SUMS"), `${"0".repeat(64)}  snipset-cli-v0.1.0-x86_64-pc-windows-msvc.zip\n`);
  const result = await runInstaller(sb, installArgs(sb, ["--from", dir]));
  assertRefused(sb, result, /found 0\b/);
});
