import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  cleanupSandbox,
  diffSnapshots,
  downloaderShims,
  fakeLinuxRelease,
  makeSandbox,
  runInstaller,
  snapshotTree,
  stubCommand,
} from "./helpers/install-sandbox.mjs";

const OLD_BINARY = "#!/bin/sh\nprintf 'snipset 0.0.9\\n'\n";
const FOREIGN_BINARY = "#!/bin/sh\nprintf 'other\\n'\n";

const cleanups = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()();
});

function sandbox() {
  const sb = makeSandbox();
  cleanups.push(() => cleanupSandbox(sb));
  return sb;
}

function release(options) {
  const rel = fakeLinuxRelease(options);
  cleanups.push(() => rm(rel.dir, { recursive: true, force: true }));
  return rel;
}

function binDir(sb) {
  return join(sb.home, ".local", "bin");
}

function writeExecutable(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  chmodSync(path, 0o755);
}

function lines(text) {
  return text.split("\n").filter((line) => line.length > 0);
}

function lineStarting(stdout, prefix) {
  return lines(stdout).find((line) => line.startsWith(prefix));
}

// The helper's fake generator has no "# snipset-shims:" line 2, so the managed case needs its own archive.
function headerRelease(version = "0.3.0") {
  const tag = `v${version}`;
  const assetName = `snipset-cli-${tag}-x86_64-unknown-linux-gnu.tar.gz`;
  const dir = mkdtempSync(join(tmpdir(), "snipset-rel-"));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  const stage = join(dir, ".stage");
  const files = {
    snipset: `#!/bin/sh\nprintf 'snipset ${version}\\n'\n`,
    LICENSE: "MIT License (snipset-cli test fixture)\n",
    "shell/snipset.sh": "# snipset.sh fixture\n",
    "shell/completion.bash": "# completion.bash fixture\n",
    "shell/tab.sh": "# tab.sh fixture\n",
    "shell/snipset-shims.sh": "#!/bin/sh\n# snipset-shims: generate trigger shims (test fixture)\necho 'generated 0 shims'\n",
  };
  for (const [name, content] of Object.entries(files)) writeExecutable(join(stage, name), content);
  const archive = join(dir, assetName);
  execFileSync("/usr/bin/tar", ["-czf", archive, "-C", stage, ...Object.keys(files)], {
    env: { PATH: "/usr/bin:/bin", LANG: "C" },
  });
  const digest = createHash("sha256").update(readFileSync(archive)).digest("hex");
  const sums = join(dir, "SHA256SUMS");
  writeFileSync(sums, `${digest}  ${assetName}\n`);
  return { dir, archive, sums, version, tag, assetName };
}

async function installed(sb, rel = release(), args = []) {
  downloaderShims(sb, rel);
  const result = await runInstaller(sb, ["--version", rel.version, ...args]);
  assert.equal(result.code, 0, result.stderr);
  return result;
}

test("a staged binary that cannot start exits 1 and leaves the old binary untouched", async () => {
  const sb = sandbox();
  downloaderShims(sb, release({ failingVersion: true }));
  const old = join(binDir(sb), "snipset");
  writeExecutable(old, OLD_BINARY);
  const before = snapshotTree(binDir(sb));
  const result = await runInstaller(sb, ["--version", "0.1.0"]);
  assert.equal(result.code, 1, result.stdout);
  assert.match(result.stderr, /libcrypto\.so\.3/);
  assert.equal(readFileSync(old, "utf8"), OLD_BINARY);
  assert.deepEqual(diffSnapshots(before, snapshotTree(binDir(sb))), []);
  assert.deepEqual(readdirSync(binDir(sb)).filter((name) => name.startsWith(".snipset-stage.")), []);
  assert.doesNotMatch(result.stdout, /Installed snipset/);
});

test("a failed smoke test notes each library ldd cannot find", async () => {
  const sb = sandbox();
  downloaderShims(sb, release({ failingVersion: true }));
  stubCommand(
    sb,
    "ldd",
    "printf '\\tlinux-vdso.so.1 (0x00007ffd)\\n\\tlibssl.so.3 => not found\\n\\tlibc.so.6 => /usr/lib/libc.so.6 (0x0000)\\n'\n",
  );
  const result = await runInstaller(sb, ["--version", "0.1.0"]);
  assert.equal(result.code, 1, result.stdout);
  assert.match(result.stderr, /libssl\.so\.3 => not found/);
  assert.doesNotMatch(result.stderr, /libc\.so\.6/);
});

test("the smoke test runs the staged binary under timeout 30 when timeout exists", async () => {
  const sb = sandbox();
  const log = join(sb.root, "timeout.log");
  stubCommand(sb, "timeout", `printf '%s\\n' "$*" >> '${log}'\nshift\nexec "$@"\n`);
  await installed(sb);
  const calls = lines(readFileSync(log, "utf8"));
  assert.ok(
    calls.some((call) => /^30 \S+\/\.snipset-stage\.[^/]+\/snipset --version$/.test(call)),
    calls.join("\n"),
  );
});

test("check after install exits 0 and reports the binary as OK", async () => {
  const sb = sandbox();
  await installed(sb);
  const result = await runInstaller(sb, ["--check"]);
  assert.equal(result.code, 0, result.stdout);
  assert.ok(lines(result.stdout).includes(`[OK] binary: ${join(binDir(sb), "snipset")} 0.1.0`), result.stdout);
});

test("check after deleting the binary exits 1 with MISSING binary", async () => {
  const sb = sandbox();
  await installed(sb);
  unlinkSync(join(binDir(sb), "snipset"));
  const result = await runInstaller(sb, ["--check"]);
  assert.equal(result.code, 1, result.stdout);
  assert.ok(lineStarting(result.stdout, "[MISSING] binary:"), result.stdout);
});

test("check with a different pinned version exits 1 with DRIFT binary", async () => {
  const sb = sandbox();
  await installed(sb);
  const result = await runInstaller(sb, ["--check", "--version", "0.2.0"]);
  assert.equal(result.code, 1, result.stdout);
  assert.ok(lineStarting(result.stdout, "[DRIFT] binary:"), result.stdout);
});

test("check with the installed version pinned reports the binary as OK", async () => {
  const sb = sandbox();
  await installed(sb);
  const result = await runInstaller(sb, ["--check", "--version", "v0.1.0"]);
  assert.ok(lineStarting(result.stdout, "[OK] binary:"), result.stdout);
});

test("check reports DRIFT binary when the binary is not executable", async () => {
  const sb = sandbox();
  await installed(sb);
  chmodSync(join(binDir(sb), "snipset"), 0o644);
  const result = await runInstaller(sb, ["--check"]);
  assert.equal(result.code, 1, result.stdout);
  assert.ok(lineStarting(result.stdout, "[DRIFT] binary:"), result.stdout);
});

test("check reports DRIFT binary when --version fails", async () => {
  const sb = sandbox();
  await installed(sb);
  writeExecutable(join(binDir(sb), "snipset"), "#!/bin/sh\nexit 3\n");
  const result = await runInstaller(sb, ["--check"]);
  assert.equal(result.code, 1, result.stdout);
  assert.ok(lineStarting(result.stdout, "[DRIFT] binary:"), result.stdout);
});

test("check reports OK snipset-shims for a generator with the managed header", async () => {
  const sb = sandbox();
  await installed(sb, headerRelease(), ["--no-init", "--no-shims"]);
  const result = await runInstaller(sb, ["--check", "--no-init", "--no-shims"]);
  assert.ok(lineStarting(result.stdout, "[OK] snipset-shims:"), result.stdout);
});

test("check reports MISSING snipset-shims when the generator is gone but the share dir exists", async () => {
  const sb = sandbox();
  await installed(sb);
  unlinkSync(join(binDir(sb), "snipset-shims"));
  const result = await runInstaller(sb, ["--check"]);
  assert.equal(result.code, 1, result.stdout);
  assert.ok(lineStarting(result.stdout, "[MISSING] snipset-shims:"), result.stdout);
});

test("check reports SKIP snipset-shims when nothing was installed", async () => {
  const sb = sandbox();
  const result = await runInstaller(sb, ["--check"]);
  assert.ok(lineStarting(result.stdout, "[SKIP] snipset-shims:"), result.stdout);
});

test("uninstall removes the installed binary", async () => {
  const sb = sandbox();
  await installed(sb);
  const result = await runInstaller(sb, ["--uninstall"]);
  assert.equal(result.code, 0, result.stderr);
  assert.ok(lineStarting(result.stdout, "[REMOVED] binary:"), result.stdout);
  assert.equal(existsSync(join(binDir(sb), "snipset")), false);
});

test("uninstall removes a generator with the managed header", async () => {
  const sb = sandbox();
  await installed(sb, headerRelease(), ["--no-init", "--no-shims"]);
  const result = await runInstaller(sb, ["--uninstall", "--no-init", "--no-shims"]);
  assert.equal(result.code, 0, result.stderr);
  assert.ok(lineStarting(result.stdout, "[REMOVED] snipset-shims:"), result.stdout);
  assert.equal(existsSync(join(binDir(sb), "snipset-shims")), false);
});

test("uninstall keeps a snipset-shims file without the managed header", async () => {
  const sb = sandbox();
  await installed(sb);
  const generator = join(binDir(sb), "snipset-shims");
  const content = readFileSync(generator, "utf8");
  const result = await runInstaller(sb, ["--uninstall"]);
  assert.ok(lineStarting(result.stdout, "[KEEP] snipset-shims:"), result.stdout);
  assert.equal(readFileSync(generator, "utf8"), content);
});

test("uninstall keeps a foreign snipset that does not report a snipset version", async () => {
  const sb = sandbox();
  const foreign = join(binDir(sb), "snipset");
  writeExecutable(foreign, FOREIGN_BINARY);
  const result = await runInstaller(sb, ["--uninstall"]);
  assert.equal(result.code, 0, result.stderr);
  assert.ok(lineStarting(result.stdout, "[KEEP] binary:"), result.stdout);
  assert.equal(readFileSync(foreign, "utf8"), FOREIGN_BINARY);
});

test("uninstall skips a binary and generator that are absent", async () => {
  const sb = sandbox();
  const result = await runInstaller(sb, ["--uninstall"]);
  assert.equal(result.code, 0, result.stderr);
  assert.ok(lineStarting(result.stdout, "[SKIP] binary:"), result.stdout);
  assert.ok(lineStarting(result.stdout, "[SKIP] snipset-shims:"), result.stdout);
});
