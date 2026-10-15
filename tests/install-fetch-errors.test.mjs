import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import {
  cleanupSandbox,
  downloaderShims,
  fakeLinuxRelease,
  makeSandbox,
  runInstaller,
  stubCommand,
} from "./helpers/install-sandbox.mjs";

const cleanups = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()();
});

const RELEASES = "https://github.com/belajarcarabelajar/snipset-cli/releases/download";

function sandbox() {
  const sb = makeSandbox();
  cleanups.push(() => cleanupSandbox(sb));
  return sb;
}

// Mirrors the real tools on an HTTP error: `curl -fsS` prints its (22) line and exits 22,
// `wget -q` prints nothing and exits 8.
function failingCurl(sb, status) {
  stubCommand(sb, "curl", `printf 'curl: (22) The requested URL returned error: ${status}\\n' >&2\nexit 22\n`);
}

function failingWget(sb) {
  stubCommand(sb, "wget", "exit 8\n");
}

function installArgs(sb, extra = []) {
  return ["--install-dir", join(sb.home, "bin"), "--no-shell", "--no-init", "--no-shims", ...extra];
}

function assertFailed(sb, result, pattern) {
  assert.equal(result.code, 1, `expected exit 1; stdout: ${result.stdout} stderr: ${result.stderr}`);
  assert.match(result.stderr, pattern);
  assert.ok(!existsSync(join(sb.home, "bin", "snipset")), "a failed install placed the binary");
  assert.deepEqual(readdirSync(sb.tmp), [], "the installer left files in TMPDIR");
}

test("fetch errors: curl 404 on the latest lookup exits 1 with the message", async () => {
  const sb = sandbox();
  failingCurl(sb, 404);
  const result = await runInstaller(sb, installArgs(sb));
  assertFailed(sb, result, /^install\.sh: release version was not found$/m);
  assert.match(result.stderr, /error: 404/);
});

test("fetch errors: curl 403 on the latest lookup exits 1 with the message", async () => {
  const sb = sandbox();
  failingCurl(sb, 403);
  const result = await runInstaller(sb, installArgs(sb));
  assertFailed(sb, result, /^install\.sh: release version was not found$/m);
  assert.match(result.stderr, /error: 403/);
});

test("fetch errors: wget-only 404 on the latest lookup exits 1 with the message", async () => {
  const sb = sandbox();
  failingWget(sb);
  const result = await runInstaller(sb, installArgs(sb));
  assertFailed(sb, result, /^install\.sh: release version was not found$/m);
});

test("fetch errors: SHA256SUMS 404 for --version v0.2.1 exits 1 naming the URL", async () => {
  const sb = sandbox();
  failingCurl(sb, 404);
  const result = await runInstaller(sb, installArgs(sb, ["--version", "v0.2.1"]));
  assertFailed(sb, result, new RegExp(`^install\\.sh: download failed: ${RELEASES}/v0\\.2\\.1/SHA256SUMS$`, "m"));
});

test("fetch errors: archive 404 for --version v0.2.1 exits 1 naming the URL", async () => {
  const sb = sandbox();
  // SHA256SUMS is served for any tag; only the v0.2.0 archive exists, so the v0.2.1 archive fails.
  const rel = fakeLinuxRelease({ version: "0.2.0" });
  cleanups.push(() => rm(rel.dir, { recursive: true, force: true }));
  downloaderShims(sb, rel);
  const result = await runInstaller(sb, installArgs(sb, ["--version", "v0.2.1"]));
  const archive = "snipset-cli-v0\\.2\\.1-x86_64-unknown-linux-gnu\\.tar\\.gz";
  assertFailed(sb, result, new RegExp(`^install\\.sh: download failed: ${RELEASES}/v0\\.2\\.1/${archive}$`, "m"));
});
