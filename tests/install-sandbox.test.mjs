import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_TOOLS,
  cleanupSandbox,
  diffSnapshots,
  downloaderShims,
  fakeLinuxRelease,
  fakeWindowsRelease,
  installerPath,
  linkTools,
  makeSandbox,
  readDownloads,
  runInstaller,
  runInstallerPiped,
  snapshotTree,
  stubCommand,
} from "./helpers/install-sandbox.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const committedInstallSh = join(repoRoot, "install.sh");

const sandboxes = [];
const releases = [];

function sandbox(opts) {
  const sb = makeSandbox(opts);
  sandboxes.push(sb);
  return sb;
}

function linuxRelease(opts) {
  const rel = fakeLinuxRelease(opts);
  releases.push(rel);
  return rel;
}

afterEach(async () => {
  while (sandboxes.length) await cleanupSandbox(sandboxes.pop());
  while (releases.length) {
    const rel = releases.pop();
    if (rel) await rm(rel.dir, { recursive: true, force: true });
  }
});

function sh(sb, script, { env = {}, cwd } = {}) {
  const r = spawnSync(join(sb.bin, "bash"), ["-c", script], {
    env: sb.env(env),
    cwd: cwd ?? sb.root,
    encoding: "utf8",
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

function extract(sb, release) {
  const out = join(sb.tmp, "extract");
  mkdirSync(out, { recursive: true });
  const r = sh(sb, `tar -xzf '${release.archive}' -C '${out}'`);
  assert.equal(r.code, 0, r.stderr);
  return out;
}

test("refuses a HOME outside the temp dir", () => {
  const sb = sandbox();
  assert.doesNotThrow(() => sb.assertSandbox());
  const original = sb.home;
  sb.home = homedir();
  try {
    assert.throws(() => sb.assertSandbox());
  } finally {
    sb.home = original;
  }
});

test("sandbox dirs live under the temp dir", () => {
  const sb = sandbox();
  const tmpReal = realpathSync(tmpdir());
  for (const dir of [sb.root, sb.home, sb.bin, sb.tmp]) {
    assert.ok(realpathSync(dir).startsWith(tmpReal + "/"), dir);
  }
  assert.ok(basename(sb.root).startsWith("snipset-sbx-"));
});

test("env() carries only the sandbox variables", () => {
  const sb = sandbox();
  assert.deepEqual(sb.env({ EXTRA: "1" }), {
    HOME: sb.home,
    PATH: sb.bin,
    TMPDIR: sb.tmp,
    LANG: "C",
    POWERSHELL_TELEMETRY_OPTOUT: "1",
    EXTRA: "1",
  });
});

test("tools resolve from /usr/bin or /bin, never ~/.local/bin", () => {
  const sb = sandbox();
  for (const tool of DEFAULT_TOOLS) {
    const target = readlinkSync(join(sb.bin, tool));
    assert.match(target, /^\/(usr\/)?bin\//, `${tool} -> ${target}`);
  }
});

test("a PATH built without curl really lacks it", () => {
  const sb = sandbox();
  assert.ok(!DEFAULT_TOOLS.includes("curl"));
  assert.equal(sh(sb, "command -v curl").code, 1);
});

test("adding curl to tools makes it present", () => {
  const sb = sandbox({ tools: [...DEFAULT_TOOLS, "curl"] });
  const r = sh(sb, "command -v curl");
  assert.equal(r.code, 0);
  assert.equal(r.stdout.trim(), join(sb.bin, "curl"));
});

test("identical trees produce an empty snapshot diff", () => {
  const sb = sandbox();
  writeFileSync(join(sb.home, "a.txt"), "hello");
  assert.deepEqual(diffSnapshots(snapshotTree(sb.home), snapshotTree(sb.home)), []);
});

test("the snapshot detects a one-byte change", () => {
  const sb = sandbox();
  mkdirSync(join(sb.home, "d"));
  writeFileSync(join(sb.home, "d", "a.txt"), "hello");
  writeFileSync(join(sb.home, "b.txt"), "same");
  const before = snapshotTree(sb.home);
  writeFileSync(join(sb.home, "d", "a.txt"), "hellp");
  assert.deepEqual(diffSnapshots(before, snapshotTree(sb.home)), ["d/a.txt"]);
});

test("the snapshot detects a mode change", () => {
  const sb = sandbox();
  writeFileSync(join(sb.home, "a.sh"), "x", { mode: 0o644 });
  const before = snapshotTree(sb.home);
  chmodSync(join(sb.home, "a.sh"), 0o755);
  assert.deepEqual(diffSnapshots(before, snapshotTree(sb.home)), ["a.sh"]);
});

test("the snapshot records symlink targets without following them", () => {
  const sb = sandbox();
  symlinkSync("/nonexistent/target", join(sb.home, "link"));
  const [entry] = snapshotTree(sb.home);
  assert.equal(entry.path, "link");
  assert.equal(entry.type, "symlink");
  assert.equal(entry.target, "/nonexistent/target");
  writeFileSync(join(sb.home, "new.txt"), "n");
  assert.deepEqual(diffSnapshots([entry], snapshotTree(sb.home)), ["new.txt"]);
});

test("fakeLinuxRelease archive passes sha256sum -c against its SHA256SUMS", () => {
  const sb = sandbox();
  const rel = linuxRelease();
  assert.equal(rel.version, "0.1.0");
  assert.equal(rel.tag, "v0.1.0");
  assert.equal(rel.assetName, "snipset-cli-v0.1.0-x86_64-unknown-linux-gnu.tar.gz");
  assert.equal(basename(rel.archive), rel.assetName);
  assert.match(readFileSync(rel.sums, "utf8"), /^[0-9a-f]{64}  snipset-cli-v0\.1\.0-/);
  assert.equal(sh(sb, "sha256sum -c SHA256SUMS", { cwd: rel.dir }).code, 0);
});

test("fakeLinuxRelease badHash fails sha256sum -c", () => {
  const sb = sandbox();
  const rel = linuxRelease({ badHash: true });
  assert.notEqual(sh(sb, "sha256sum -c SHA256SUMS", { cwd: rel.dir }).code, 0);
});

test("fakeLinuxRelease starMarker writes a binary-mode entry that still verifies", () => {
  const sb = sandbox();
  const rel = linuxRelease({ starMarker: true });
  assert.match(readFileSync(rel.sums, "utf8"), /^[0-9a-f]{64} \*snipset-cli-v0\.1\.0-/);
  assert.equal(sh(sb, "sha256sum -c SHA256SUMS", { cwd: rel.dir }).code, 0);
});

test("fakeLinuxRelease archive holds snipset, LICENSE and the shell bundle", () => {
  const sb = sandbox();
  const list = (rel) =>
    sh(sb, `tar -tzf '${rel.archive}'`).stdout.trim().split("\n").filter((l) => !l.endsWith("/")).sort();
  assert.deepEqual(list(linuxRelease()), [
    "LICENSE",
    "shell/completion.bash",
    "shell/snipset-shims.sh",
    "shell/snipset.sh",
    "shell/tab.sh",
    "snipset",
  ]);
  assert.deepEqual(list(linuxRelease({ withShell: false })), ["LICENSE", "snipset"]);
});

test("fake snipset prints the release version", () => {
  const sb = sandbox();
  const out = extract(sb, linuxRelease({ version: "0.3.1" }));
  const r = sh(sb, `'${out}/snipset' --version`);
  assert.equal(r.code, 0);
  assert.equal(r.stdout, "snipset 0.3.1\n");
});

test("fake snipset with failingVersion exits 127 with a loader error", () => {
  const sb = sandbox();
  const out = extract(sb, linuxRelease({ failingVersion: true }));
  const r = sh(sb, `'${out}/snipset' --version`);
  assert.equal(r.code, 127);
  assert.equal(r.stdout, "");
  assert.match(r.stderr, /error while loading shared libraries: libcrypto\.so\.3/);
});

test("fake shim generator writes the managed header and the keyword manifest", () => {
  const sb = sandbox();
  const out = extract(sb, linuxRelease());
  const shimDir = join(sb.home, "shims");
  mkdirSync(shimDir);
  const r = sh(sb, `PATH='${out}':"$PATH" sh '${out}/shell/snipset-shims.sh' --dir '${shimDir}'`);
  assert.equal(r.code, 0, r.stderr);
  for (const kw of [",k1", ";k2"]) {
    const line2 = readFileSync(join(shimDir, kw), "utf8").split("\n")[1];
    assert.equal(line2, `# snipset-shim for '${kw}' (exec mode, managed by snipset-shims; do not edit).`);
    assert.equal(lstatSync(join(shimDir, kw)).mode & 0o777, 0o755);
  }
  assert.equal(readFileSync(join(shimDir, ".snipset-shims"), "utf8"), ",k1\n;k2\n");
});

test("fakeWindowsRelease zip holds snipset.exe and LICENSE and verifies", (t) => {
  const sb = sandbox();
  const rel = fakeWindowsRelease();
  if (rel === null) {
    t.skip("bsdtar is not installed");
    return;
  }
  releases.push(rel);
  assert.equal(rel.assetName, "snipset-cli-v0.1.0-x86_64-pc-windows-msvc.zip");
  assert.equal(basename(rel.archive), rel.assetName);
  const listing = spawnSync("/usr/bin/bsdtar", ["-tf", rel.archive], { encoding: "utf8" }).stdout;
  assert.deepEqual(listing.trim().split("\n").sort(), ["LICENSE", "snipset.exe"]);
  assert.equal(sh(sb, "sha256sum -c SHA256SUMS", { cwd: rel.dir }).code, 0);
  const bad = fakeWindowsRelease({ badHash: true });
  releases.push(bad);
  assert.notEqual(sh(sb, "sha256sum -c SHA256SUMS", { cwd: bad.dir }).code, 0);
});

test("curl shim serves the latest tag and the archive and logs both calls", () => {
  const sb = sandbox();
  const rel = linuxRelease();
  downloaderShims(sb, rel, { latestTag: "v9.9.9" });
  const base = "https://github.com/belajarcarabelajar/snipset-cli/releases/download/v0.1.0";
  const latest = sh(sb, "curl -fsSL --retry 3 https://api.github.com/repos/o/r/releases/latest");
  assert.equal(latest.code, 0);
  assert.match(latest.stdout, /"tag_name":"v9\.9\.9"/);
  const dest = join(sb.tmp, "a.tgz");
  const got = sh(sb, `curl -fsSL --retry 3 --connect-timeout 15 '${base}/${rel.assetName}' -o '${dest}'`);
  assert.equal(got.code, 0, got.stderr);
  assert.deepEqual(readFileSync(dest), readFileSync(rel.archive));
  const lines = readDownloads(sb);
  assert.equal(lines.length, 2);
  assert.match(lines[0], /releases\/latest/);
  assert.match(lines[1], new RegExp(rel.assetName.replace(/\./g, "\\.")));
});

test("wget shim serves the latest tag and the archive and logs both calls", () => {
  const sb = sandbox();
  const rel = linuxRelease();
  downloaderShims(sb, rel, { curl: false, wget: true });
  assert.equal(sh(sb, "command -v curl").code, 1);
  const latest = sh(sb, "wget -qO- https://api.github.com/repos/o/r/releases/latest");
  assert.equal(latest.code, 0);
  assert.match(latest.stdout, /"tag_name":"v0\.1\.0"/);
  const dest = join(sb.tmp, "sums");
  const got = sh(sb, `wget -q -O '${dest}' https://example.invalid/v0.1.0/SHA256SUMS`);
  assert.equal(got.code, 0, got.stderr);
  assert.equal(readFileSync(dest, "utf8"), readFileSync(rel.sums, "utf8"));
  const arch = join(sb.tmp, "a.tgz");
  assert.equal(sh(sb, `wget -q -O '${arch}' https://example.invalid/v0.1.0/${rel.assetName}`).code, 0);
  assert.deepEqual(readFileSync(arch), readFileSync(rel.archive));
  assert.equal(readDownloads(sb).length, 3);
});

test("downloader shims fail unknown URLs with the real exit codes", () => {
  const sb = sandbox();
  const rel = linuxRelease();
  downloaderShims(sb, rel, { curl: true, wget: true });
  assert.equal(sh(sb, "curl -fsSL https://example.invalid/nope -o x").code, 22);
  assert.equal(sh(sb, "wget -q -O x https://example.invalid/nope").code, 8);
  assert.equal(readDownloads(sb).length, 2);
});

test("stubCommand replaces a tool link without touching the real tool", () => {
  const sb = sandbox();
  const realUname = realpathSync(join(sb.bin, "uname"));
  const before = readFileSync(realUname);
  stubCommand(sb, "uname", 'echo "Darwin"');
  assert.equal(lstatSync(join(sb.bin, "uname")).isSymbolicLink(), false);
  assert.equal(lstatSync(join(sb.bin, "uname")).mode & 0o777, 0o755);
  assert.equal(readFileSync(join(sb.bin, "uname"), "utf8"), '#!/bin/sh\necho "Darwin"');
  assert.equal(sh(sb, "uname").stdout, "Darwin\n");
  assert.deepEqual(readFileSync(realUname), before);
});

test("installerPath honours the override variables", () => {
  const saved = { sh: process.env.SNIPSET_INSTALL_SCRIPT, ps1: process.env.SNIPSET_INSTALL_PS1 };
  try {
    process.env.SNIPSET_INSTALL_SCRIPT = "/x/custom.sh";
    process.env.SNIPSET_INSTALL_PS1 = "/x/custom.ps1";
    assert.equal(installerPath("sh"), "/x/custom.sh");
    assert.equal(installerPath(), "/x/custom.sh");
    assert.equal(installerPath("ps1"), "/x/custom.ps1");
  } finally {
    for (const [k, v] of [["SNIPSET_INSTALL_SCRIPT", saved.sh], ["SNIPSET_INSTALL_PS1", saved.ps1]]) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test("installerPath falls back to an existing installer file", () => {
  if (process.env.SNIPSET_INSTALL_SCRIPT || process.env.SNIPSET_INSTALL_PS1) return;
  const shPath = installerPath("sh");
  assert.equal(basename(shPath), "install.sh");
  assert.ok(existsSync(shPath));
  const ps1Path = installerPath("ps1");
  assert.equal(basename(ps1Path), "install.ps1");
  assert.ok(existsSync(ps1Path));
});

test("integration control: the committed install.sh installs a pinned fake release", async () => {
  const sb = sandbox();
  const rel = linuxRelease();
  downloaderShims(sb, rel);
  const binDir = join(sb.home, "bin");
  const r = await runInstaller(
    sb,
    ["--version", "0.1.0", "--install-dir", binDir, "--no-init", "--no-shell", "--no-shims"],
    { script: committedInstallSh },
  );
  assert.equal(r.code, 0, r.stderr);
  const v = sh(sb, `'${binDir}/snipset' --version`);
  assert.equal(v.code, 0);
  assert.equal(v.stdout, "snipset 0.1.0\n");
  assert.equal(readDownloads(sb).length, 2);
});

test("integration control: the committed install.sh rejects a bad hash", async () => {
  const sb = sandbox();
  const rel = linuxRelease({ badHash: true });
  downloaderShims(sb, rel);
  const binDir = join(sb.home, "bin");
  const r = await runInstaller(
    sb,
    ["--version", "0.1.0", "--install-dir", binDir, "--no-init", "--no-shell", "--no-shims"],
    { script: committedInstallSh },
  );
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /checksum mismatch/);
  assert.equal(existsSync(join(binDir, "snipset")), false);
});

test("runInstaller refuses a sandbox whose HOME is the real HOME", async () => {
  const sb = sandbox();
  sb.home = homedir();
  await assert.rejects(() => runInstaller(sb, ["--help"], { script: committedInstallSh }));
});

test("helper v2: fakeLinuxRelease shellStubs replaces only the named shell files", () => {
  const sb = sandbox();
  const out = extract(sb, linuxRelease({ shellStubs: { "snipset.sh": "# custom snipset.sh\n" } }));
  assert.equal(readFileSync(join(out, "shell", "snipset.sh"), "utf8"), "# custom snipset.sh\n");
  assert.equal(readFileSync(join(out, "shell", "completion.bash"), "utf8"), "# completion.bash fixture\n");
  assert.equal(readFileSync(join(out, "shell", "tab.sh"), "utf8"), "# tab.sh fixture\n");
  assert.throws(() => linuxRelease({ shellStubs: { "snipset-shims.sh": "x" } }), /unknown shell stub/);
});

test("helper v2: runInstallerPiped feeds the script and the trailer to bash -s", async () => {
  const sb = sandbox();
  const script = join(sb.tmp, "tiny.sh");
  // Bun backs a "pipe" stdin with a socketpair, so `[ -p /dev/stdin ]` is false here; a real
  // `curl | bash` gives a FIFO. Both are neither a terminal nor a regular file.
  writeFileSync(script, 'echo "args:$*"\necho "home:$HOME"\n[ -t 0 ] || [ -f /dev/stdin ] || echo STDIN-STREAM\n');
  const r = await runInstallerPiped(sb, ["--a", "b c"], { script, trailer: "echo TRAILER-OK\n" });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.signal, null);
  assert.equal(r.stdout, `args:--a b c\nhome:${sb.home}\nSTDIN-STREAM\nTRAILER-OK\n`);
  assert.equal(r.stderr, "");
});

test("helper v2: runInstallerPiped refuses a sandbox whose HOME is the real HOME", async () => {
  const sb = sandbox();
  sb.home = homedir();
  await assert.rejects(() => runInstallerPiped(sb, ["--help"], { script: committedInstallSh }));
});

test("helper v2: linkTools links DEFAULT_TOOLS as symlinks into /usr/bin or /bin", async () => {
  const dir = mkdtempSync(join(tmpdir(), "snipset-link-"));
  try {
    linkTools(dir);
    assert.deepEqual(readdirSync(dir).sort(), [...DEFAULT_TOOLS].sort());
    for (const tool of DEFAULT_TOOLS) {
      assert.ok(lstatSync(join(dir, tool)).isSymbolicLink(), tool);
      assert.match(readlinkSync(join(dir, tool)), /^\/(usr\/)?bin\//, tool);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("helper v2: linkTools keeps a stub file written before it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "snipset-link-"));
  try {
    writeFileSync(join(dir, "uname"), "#!/bin/sh\necho Darwin\n");
    linkTools(dir, ["uname", "cat", "cat"]);
    assert.deepEqual(readdirSync(dir).sort(), ["cat", "uname"]);
    assert.equal(lstatSync(join(dir, "uname")).isSymbolicLink(), false);
    assert.equal(readFileSync(join(dir, "uname"), "utf8"), "#!/bin/sh\necho Darwin\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("helper v2: fakeWindowsRelease starMarker writes a binary-mode entry that still verifies", (t) => {
  const sb = sandbox();
  const rel = fakeWindowsRelease({ starMarker: true });
  if (rel === null) {
    t.skip("bsdtar is not installed");
    return;
  }
  releases.push(rel);
  assert.match(readFileSync(rel.sums, "utf8"), /^[0-9a-f]{64} \*snipset-cli-v0\.1\.0-x86_64-pc-windows-msvc\.zip\n$/);
  assert.equal(sh(sb, "sha256sum -c SHA256SUMS", { cwd: rel.dir }).code, 0);
  const bad = fakeWindowsRelease({ badHash: true, starMarker: true });
  releases.push(bad);
  assert.equal(readFileSync(bad.sums, "utf8"), `${"0".repeat(64)} *${bad.assetName}\n`);
});

test("helper v2: sumsName overrides the Linux SHA256SUMS entry name", () => {
  const rel = linuxRelease({ starMarker: true, sumsName: (name) => `old-${name}` });
  const hex = createHash("sha256").update(readFileSync(rel.archive)).digest("hex");
  assert.equal(readFileSync(rel.sums, "utf8"), `${hex} *old-${rel.assetName}\n`);
  const plain = linuxRelease({ sumsName: "other.tar.gz" });
  assert.match(readFileSync(plain.sums, "utf8"), /^[0-9a-f]{64}  other\.tar\.gz\n$/);
});

test("helper v2: sumsName overrides the Windows SHA256SUMS entry name", (t) => {
  const rel = fakeWindowsRelease({ starMarker: true, sumsName: (name) => `old-${name}` });
  if (rel === null) {
    t.skip("bsdtar is not installed");
    return;
  }
  releases.push(rel);
  const hex = createHash("sha256").update(readFileSync(rel.archive)).digest("hex");
  assert.equal(readFileSync(rel.sums, "utf8"), `${hex} *old-${rel.assetName}\n`);
});

test("the sandbox root is gone after cleanupSandbox", async () => {
  const sb = makeSandbox();
  assert.ok(existsSync(sb.root));
  await cleanupSandbox(sb);
  assert.equal(existsSync(sb.root), false);
});
