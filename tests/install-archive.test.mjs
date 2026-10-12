import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_TOOLS,
  cleanupSandbox,
  downloaderShims,
  fakeLinuxRelease,
  installerPath,
  makeSandbox,
  readDownloads,
  runInstaller,
  snapshotTree,
  stubCommand,
} from "./helpers/install-sandbox.mjs";

const TARGET = "x86_64-unknown-linux-gnu";
const ASSET = `snipset-cli-v0.1.0-${TARGET}.tar.gz`;
const HOST_ENV = { PATH: "/usr/bin:/bin", LANG: "C" };
const TAR = ["/usr/bin/tar", "/bin/tar"].find((path) => existsSync(path));
const FAKEROOT = ["/usr/bin/fakeroot", "/bin/fakeroot"].find((path) => existsSync(path));
const STUB_SNIPSET = "#!/bin/sh\nprintf 'snipset 0.1.0\\n'\n";

const cleanups = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()();
});

function sandbox(opts) {
  const sb = makeSandbox(opts);
  cleanups.push(() => cleanupSandbox(sb));
  return sb;
}

function scratch(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

// prepare(stage) adds files beside the snipset stub and returns extra tar arguments
// (members and options), so each test builds exactly the archive it attacks with.
function packArchive(archive, prepare = () => []) {
  // The stage sits one level down so a ../ member stays inside this scratch dir.
  const parent = mkdtempSync(join(tmpdir(), "snipset-arc-stage-"));
  const stage = join(parent, "stage");
  try {
    mkdirSync(stage);
    writeFileSync(join(stage, "snipset"), STUB_SNIPSET, { mode: 0o755 });
    const extra = prepare(stage);
    execFileSync(TAR, ["-czf", archive, "-C", stage, "snipset", ...extra], { env: HOST_ENV, stdio: "pipe" });
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
}

function customRelease(prepare) {
  const dir = scratch("snipset-arc-rel-");
  const archive = join(dir, ASSET);
  packArchive(archive, prepare);
  writeFileSync(join(dir, "SHA256SUMS"), `${sha256(archive)}  ${ASSET}\n`);
  return { dir, archive };
}

function listMembers(archive) {
  return execFileSync(TAR, ["-tzf", archive], { env: HOST_ENV, encoding: "utf8" }).split("\n").filter(Boolean);
}

function installDirOf(sb) {
  return join(sb.home, "bin");
}

function fromArgs(sb, dir, extra = []) {
  return ["--version", "0.1.0", "--from", dir, "--install-dir", installDirOf(sb), "--no-shell", "--no-init", "--no-shims", ...extra];
}

function seedExisting(sb) {
  mkdirSync(installDirOf(sb), { recursive: true });
  writeFileSync(join(installDirOf(sb), "snipset"), "existing\n", { mode: 0o755 });
}

function assertRefusedUnchanged(sb, before, result, pattern) {
  assert.equal(result.code, 1, `expected exit 1; stdout: ${result.stdout} stderr: ${result.stderr}`);
  assert.match(result.stderr, pattern);
  assert.deepEqual(snapshotTree(sb.home), before, "a refused install changed HOME");
  assert.equal(readFileSync(join(installDirOf(sb), "snipset"), "utf8"), "existing\n");
}

const UNSAFE_MEMBERS = [
  {
    name: "a member named -x",
    prepare: (stage) => {
      writeFileSync(join(stage, "-x"), "option-shaped member\n");
      return ["--add-file=-x"];
    },
    member: "-x",
    pattern: /unsafe archive entry/,
  },
  {
    name: "a ../escape member",
    prepare: (stage) => {
      writeFileSync(join(stage, "..", "escape"), "escaped\n");
      return ["-P", "../escape"];
    },
    member: "../escape",
    pattern: /unsafe archive entry/,
  },
  {
    name: "a symlink member",
    prepare: (stage) => {
      symlinkSync("snipset", join(stage, "link"));
      return ["link"];
    },
    member: "link",
    pattern: /symlinks are not allowed/,
  },
];

for (const { name, prepare, member, pattern } of UNSAFE_MEMBERS) {
  test(`an archive with ${name} exits 1 and leaves the install dir unchanged`, async () => {
    const rel = customRelease(prepare);
    assert.ok(listMembers(rel.archive).includes(member), `fixture lacks ${member}`);
    const sb = sandbox();
    seedExisting(sb);
    const before = snapshotTree(sb.home);
    const result = await runInstaller(sb, fromArgs(sb, rel.dir));
    assertRefusedUnchanged(sb, before, result, pattern);
  });
}

// GNU tar is the only supported tar; a tar that cannot produce a listing must stop the
// install instead of reading as an empty, safe archive.
const FAILING_LISTINGS = [
  {
    name: "rejects --quoting-style",
    body: 'for a in "$@"; do case "$a" in --quoting-style*) echo "tar: unrecognized option" >&2; exit 2 ;; esac; done\n',
    prepare: (stage) => {
      writeFileSync(join(stage, "-x"), "option-shaped member\n");
      return ["--add-file=-x"];
    },
  },
  {
    name: "fails a verbose listing",
    body: 'for a in "$@"; do case "$a" in --*) ;; -*t*v*|-*v*t*) echo "tar: listing failed" >&2; exit 2 ;; esac; done\n',
    prepare: (stage) => {
      symlinkSync("snipset", join(stage, "link"));
      return ["link"];
    },
  },
];

for (const { name, body, prepare } of FAILING_LISTINGS) {
  test(`a tar that ${name} stops the install before extraction`, async () => {
    const rel = customRelease(prepare);
    const sb = sandbox({ tools: DEFAULT_TOOLS.filter((tool) => tool !== "tar") });
    stubCommand(sb, "tar", `${body}exec ${TAR} "$@"\n`);
    seedExisting(sb);
    const before = snapshotTree(sb.home);
    const result = await runInstaller(sb, fromArgs(sb, rel.dir));
    assertRefusedUnchanged(sb, before, result, /cannot list the archive/);
  });
}

test("a --from SHA256SUMS whose archive name holds /../ exits 1 with invalid version", async () => {
  const root = scratch("snipset-arc-from-");
  const from = join(root, "from");
  mkdirSync(join(from, "snipset-cli-v1"), { recursive: true });
  mkdirSync(join(root, "outside"));
  const outside = join(root, "outside", `x-${TARGET}.tar.gz`);
  packArchive(outside);
  writeFileSync(join(from, "SHA256SUMS"), `${sha256(outside)}  snipset-cli-v1/../../outside/x-${TARGET}.tar.gz\n`);
  const sb = sandbox();
  const result = await runInstaller(sb, ["--from", from, "--install-dir", installDirOf(sb), "--no-shell", "--no-init", "--no-shims"]);
  assert.equal(result.code, 1, `expected exit 1; stderr: ${result.stderr}`);
  assert.match(result.stderr, /invalid version/);
  assert.ok(!existsSync(join(installDirOf(sb), "snipset")), "an archive outside --from was installed");
});

function runUnderFakeroot(sb, args) {
  // fakeroot's own script needs host tools; the installer still sees only the sandbox PATH.
  const driver = 'bash "$0" "$@"; rc=$?; printf "owner=%s self=%s:%s\\n" "$(stat -c %u:%g "$SNIPSET_TEST_BIN")" "$(id -u)" "$(id -g)"; exit "$rc"';
  return new Promise((resolve, reject) => {
    const child = spawn(
      FAKEROOT,
      ["--", "/usr/bin/env", `PATH=${sb.bin}`, join(sb.bin, "bash"), "-c", driver, installerPath("sh"), ...args],
      {
        env: { ...sb.env({ SNIPSET_TEST_BIN: join(installDirOf(sb), "snipset") }), PATH: HOST_ENV.PATH },
        cwd: sb.root,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test(
  "a root-style install leaves the binary owned by the running uid, not the packer's",
  { skip: FAKEROOT ? false : "fakeroot is not installed" },
  async () => {
    const dir = scratch("snipset-arc-owner-");
    const archive = join(dir, ASSET);
    packArchive(archive, () => ["--owner=4242", "--group=4242"]);
    writeFileSync(join(dir, "SHA256SUMS"), `${sha256(archive)}  ${ASSET}\n`);
    assert.match(execFileSync(TAR, ["-tvzf", archive], { env: HOST_ENV, encoding: "utf8" }), /4242\/4242/);
    const sb = sandbox();
    sb.assertSandbox();
    const result = await runUnderFakeroot(sb, fromArgs(sb, dir));
    assert.equal(result.code, 0, `install failed: ${result.stderr}`);
    const match = result.stdout.match(/owner=(\S+) self=(\S+)/);
    assert.ok(match, `no ownership line: ${result.stdout}`);
    assert.equal(match[1], match[2], "the binary kept the archive's owner");
  },
);

function assertFlagPair(call, flag, value) {
  const args = call.split(" ");
  assert.ok(args.some((arg, i) => arg === flag && args[i + 1] === value), `curl call lacks ${flag} ${value}: ${call}`);
}

test("curl calls carry --proto =https and --proto-redir =https", async () => {
  const sb = sandbox();
  const rel = fakeLinuxRelease();
  cleanups.push(() => rm(rel.dir, { recursive: true, force: true }));
  downloaderShims(sb, rel);
  const result = await runInstaller(sb, ["--install-dir", installDirOf(sb), "--no-shell", "--no-init", "--no-shims"], {
    env: { SNIPSET_RELEASE_BASE_URL: "https://fixture.invalid" },
  });
  assert.equal(result.code, 0, `install failed: ${result.stderr}`);
  const calls = readDownloads(sb).filter((line) => line.startsWith("curl "));
  assert.equal(calls.length, 3, calls.join("\n"));
  for (const call of calls) {
    assertFlagPair(call, "--proto", "=https");
    assertFlagPair(call, "--proto-redir", "=https");
  }
});

test("a release base URL that is not https is refused before any download", async () => {
  const sb = sandbox();
  const rel = fakeLinuxRelease();
  cleanups.push(() => rm(rel.dir, { recursive: true, force: true }));
  downloaderShims(sb, rel, { wget: true });
  const result = await runInstaller(sb, ["--version", "0.1.0", "--install-dir", installDirOf(sb), "--no-shell", "--no-init", "--no-shims"], {
    env: { SNIPSET_RELEASE_BASE_URL: "http://fixture.invalid" },
  });
  assert.equal(result.code, 1, `expected exit 1; stderr: ${result.stderr}`);
  assert.match(result.stderr, /https:\/\//);
  assert.deepEqual(readDownloads(sb), []);
  assert.ok(!existsSync(join(installDirOf(sb), "snipset")), "an http release was installed");
});

test("--from installs even when the release base URL is not https", async () => {
  const sb = sandbox();
  const rel = fakeLinuxRelease();
  cleanups.push(() => rm(rel.dir, { recursive: true, force: true }));
  const result = await runInstaller(sb, fromArgs(sb, rel.dir), { env: { SNIPSET_RELEASE_BASE_URL: "http://fixture.invalid" } });
  assert.equal(result.code, 0, `install failed: ${result.stderr}`);
  assert.ok(existsSync(join(installDirOf(sb), "snipset")));
});

// No bash older than 4.4 is installed here, so the guard is lifted out of the bundle
// and run against stand-in version variables.
function bashGuard() {
  const lines = readFileSync(installerPath("sh"), "utf8").split("\n");
  const setIndex = lines.indexOf("set -euo pipefail");
  assert.ok(setIndex >= 0, "the bundle has no set -euo pipefail line");
  const start = lines.findIndex((line, i) => i > setIndex && line.trim() && !line.trim().startsWith("#"));
  assert.match(lines[start] ?? "", /^if \(\(BASH_VERSINFO/, "the first statement after set -euo pipefail is not the bash version guard");
  const end = lines.indexOf("fi", start);
  assert.ok(end > start, "the bash version guard has no closing fi");
  return lines.slice(start, end + 1).join("\n").replaceAll("BASH_VERSINFO", "FAKE_VERSINFO").replaceAll("BASH_VERSION", "FAKE_VERSION");
}

test("the installer refuses bash older than 4.4 and names the found version", () => {
  const guard = bashGuard();
  const cases = [
    { version: "3.2.57(1)-release", parts: "3 2 57", ok: false },
    { version: "4.3.48(1)-release", parts: "4 3 48", ok: false },
    { version: "4.4.0(1)-release", parts: "4 4 0", ok: true },
    { version: "5.3.20(1)-release", parts: "5 3 20", ok: true },
  ];
  for (const { version, parts, ok } of cases) {
    const script = `set -euo pipefail\nFAKE_VERSINFO=(${parts} 1 release x86_64-pc-linux-gnu)\nFAKE_VERSION='${version}'\n${guard}\necho guard-passed\n`;
    const result = spawnSync("/bin/bash", ["-c", script], { env: HOST_ENV, encoding: "utf8" });
    if (ok) {
      assert.equal(result.status, 0, `${version}: ${result.stderr}`);
      assert.match(result.stdout, /guard-passed/);
    } else {
      assert.equal(result.status, 1, `${version} was accepted`);
      assert.ok(result.stderr.includes(version), `${version} not named: ${result.stderr}`);
      assert.match(result.stderr, /4\.4/);
    }
  }
});
