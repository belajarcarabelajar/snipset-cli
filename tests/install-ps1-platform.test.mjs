import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { appendFileSync, copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { fakeWindowsRelease, installerPath } from "./helpers/install-sandbox.mjs";

const pwshSkip = Bun.which("pwsh") ? false : "pwsh not on PATH";
const zipSkip = pwshSkip || (Bun.which("bsdtar") ? false : "bsdtar not on PATH");
// bun test prints a skipped test's name but not its reason, so say it once here.
if (zipSkip) console.warn(`skipping install.ps1 platform tests: ${zipSkip}`);

const bundle = installerPath("ps1");
const part = (name) => fileURLToPath(new URL(`../scripts/installer/ps1/${name}`, import.meta.url));
const DOT_SOURCE = ". $env:LIB_PART; . $env:PLATFORM_PART; . $env:BINARY_PART";
const LINUX_REFUSAL = "install.ps1 installs the Windows build; on Linux use install.sh";
const ARM_REFUSAL = "Windows 10 on Arm cannot run the x64 build; use Windows 11";

// pwsh 7.6 colours error records even when stderr is a pipe.
const stripAnsi = (text) => text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
const lines = (text) => text.split(/\r?\n/).filter((line) => line.trim() !== "");
// ConciseView wraps long error messages at the console width behind a `|` gutter, even inside a word.
const squash = (text) => text.replace(/[\s|]+/g, "");
const stderrHas = (r, needle) => squash(r.stderr).includes(squash(needle));

function pwsh(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn("pwsh", ["-NoProfile", "-NonInteractive", ...args], { env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout: stripAnsi(stdout), stderr: stripAnsi(stderr) }));
  });
}

async function withWorkspace(fn) {
  const root = await mkdtemp(join(tmpdir(), "snipset-ps1-platform-test-"));
  const releases = [];
  let requests = 0;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch() {
      requests += 1;
      return new Response("not found", { status: 404 });
    },
  });
  try {
    const home = join(root, "home");
    const tmp = join(root, "tmp");
    await mkdir(home);
    await mkdir(tmp);
    const env = { ...process.env };
    for (const name of ["LOCALAPPDATA", "OS", "SNIPSET_INSTALL_ALLOW_NON_WINDOWS"]) delete env[name];
    Object.assign(env, {
      HOME: home,
      TMPDIR: tmp,
      // pwsh sends startup telemetry unless this is set before the process starts.
      POWERSHELL_TELEMETRY_OPTOUT: "1",
      NO_COLOR: "1",
      SNIPSET_RELEASE_BASE_URL: `http://127.0.0.1:${server.port}`,
      LIB_PART: part("lib.ps1"),
      PLATFORM_PART: part("platform.ps1"),
      BINARY_PART: part("binary.ps1"),
    });
    const release = (opts) => {
      const rel = fakeWindowsRelease(opts);
      releases.push(rel.dir);
      return rel;
    };
    return await fn({ root, home, tmp, installDir: join(root, "bin"), env, release, requests: () => requests });
  } finally {
    server.stop(true);
    for (const dir of releases) await rm(dir, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
}

async function script(path, body) {
  await writeFile(path, `#!/bin/sh\n${body}\n`);
  await chmod(path, 0o755);
  return path;
}

const DECISIONS = [
  { arch: "AMD64", wow: "", build: 22631, want: "ok" },
  { arch: "x86", wow: "AMD64", build: 19045, want: "ok" },
  { arch: "ARM64", wow: "", build: 22631, want: "ok-emulated" },
  { arch: "x86", wow: "ARM64", build: 22000, want: "ok-emulated" },
  { arch: "ARM64", wow: "", build: 19045, want: `refuse:${ARM_REFUSAL}` },
  { arch: "x86", wow: "", build: 19045, want: "refuse:unsupported CPU x86" },
  { arch: "IA64", wow: "", build: 22631, want: "refuse:unsupported CPU IA64" },
];

let decisionRun;
function decisions() {
  decisionRun ??= withWorkspace(async ({ env }) => {
    const code = [
      DOT_SOURCE,
      "$cases = $env:CASES | ConvertFrom-Json",
      "ConvertTo-Json -Compress -InputObject @($cases | ForEach-Object { Get-SnipsetArchDecision -Arch $_.arch -Wow $_.wow -Build $_.build })",
    ].join("\n");
    const r = await pwsh(["-Command", code], { ...env, CASES: JSON.stringify(DECISIONS) });
    assert.equal(r.code, 0, r.stderr);
    return JSON.parse(r.stdout);
  });
  return decisionRun;
}

for (const [i, row] of DECISIONS.entries()) {
  test(`Get-SnipsetArchDecision (${row.arch}, '${row.wow}', ${row.build}) gives ${row.want.split(":")[0]}`, { skip: pwshSkip, timeout: 60000 }, async () => {
    assert.equal((await decisions())[i], row.want);
  });
}

test("Assert-SnipsetPlatform on a Windows host reports ok and emulated and throws on a refusal", { skip: pwshSkip, timeout: 60000 }, async () => {
  await withWorkspace(async ({ env }) => {
    const code = [
      DOT_SOURCE,
      "function Test-SnipsetWindowsHost { $true }",
      "foreach ($c in @(@('AMD64', '', 22631), @('ARM64', '', 22631), @('ARM64', '', 19045))) {",
      "  try { $out = @(Assert-SnipsetPlatform -Arch $c[0] -Wow $c[1] -Build $c[2]); \"returned: $($out -join ' | ')\" }",
      "  catch { \"threw: $($_.Exception.Message)\" }",
      "}",
    ].join("\n");
    const r = await pwsh(["-Command", code], env);
    assert.equal(r.code, 0, r.stderr);
    const out = lines(r.stdout);
    assert.equal(out.length, 3, r.stdout);
    assert.match(out[0], /^returned: \[OK\] platform: [^|]*AMD64[^|]*$/);
    assert.match(out[1], /^returned: \[NOTE\] platform: [^|]*emulat[^|]*$/);
    assert.equal(out[2], `threw: install.ps1: ${ARM_REFUSAL}`);
  });
});

test("the bundle without the test switch refuses a Linux host before any write or request", { skip: pwshSkip, timeout: 60000 }, async () => {
  await withWorkspace(async ({ env, installDir, requests }) => {
    const r = await pwsh(["-File", bundle, "-DryRun", "-Version", "v0.1.0", "-InstallDir", installDir], env);
    assert.equal(r.code, 1, r.stdout + r.stderr);
    assert.ok(stderrHas(r, LINUX_REFUSAL), `expected the Linux refusal, got: ${r.stderr}`);
    assert.doesNotMatch(r.stdout, /\[DRY\]/);
    assert.equal(existsSync(installDir), false);
    assert.equal(requests(), 0);
  });
});

test("OS=Windows_NT does not make a pwsh 7 Linux host count as Windows", { skip: pwshSkip, timeout: 60000 }, async () => {
  await withWorkspace(async ({ env, installDir }) => {
    const r = await pwsh(["-File", bundle, "-DryRun", "-Version", "v0.1.0", "-InstallDir", installDir], { ...env, OS: "Windows_NT" });
    assert.equal(r.code, 1, r.stdout + r.stderr);
    assert.ok(stderrHas(r, LINUX_REFUSAL), `expected the Linux refusal, got: ${r.stderr}`);
  });
});

test("the bundle with the test switch reports the platform as skipped", { skip: pwshSkip, timeout: 60000 }, async () => {
  await withWorkspace(async ({ env, installDir }) => {
    const r = await pwsh(["-File", bundle, "-DryRun", "-Version", "v0.1.0", "-InstallDir", installDir], { ...env, SNIPSET_INSTALL_ALLOW_NON_WINDOWS: "1" });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(lines(r.stdout)[0], "[SKIP] platform: non-Windows host (test switch)");
  });
});

test("-From a fakeWindowsRelease dir without -Version installs snipset.exe with no request", { skip: zipSkip, timeout: 60000 }, async () => {
  await withWorkspace(async ({ env, installDir, release, requests }) => {
    const rel = release({ version: "0.1.0" });
    const r = await pwsh(["-File", bundle, "-From", rel.dir, "-InstallDir", installDir], { ...env, SNIPSET_INSTALL_ALLOW_NON_WINDOWS: "1" });
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const out = lines(r.stdout);
    assert.match(out.at(-1), /^Installed snipset v0\.1\.0 to /);
    assert.ok(out.includes("[SKIP] smoke: not a Windows host"), r.stdout);
    assert.ok(out.includes("[SKIP] unblock: not a Windows host"), r.stdout);
    assert.equal(await readFile(join(installDir, "snipset.exe"), "utf8"), "snipset.exe fixture 0.1.0\n");
    assert.equal(requests(), 0);
  });
});

async function twoVersionDir(release) {
  const first = release({ version: "0.1.0" });
  const second = release({ version: "0.2.0" });
  copyFileSync(second.archive, join(first.dir, second.assetName));
  appendFileSync(first.sums, readFileSync(second.sums));
  return first.dir;
}

test("-From a dir holding two release zips and no -Version fails naming the count", { skip: zipSkip, timeout: 60000 }, async () => {
  await withWorkspace(async ({ env, installDir, release }) => {
    const dir = await twoVersionDir(release);
    const r = await pwsh(["-File", bundle, "-From", dir, "-InstallDir", installDir], { ...env, SNIPSET_INSTALL_ALLOW_NON_WINDOWS: "1" });
    assert.equal(r.code, 1, r.stdout + r.stderr);
    assert.ok(stderrHas(r, "found 2; pass -Version"), r.stderr);
    assert.equal(existsSync(join(installDir, "snipset.exe")), false);
  });
});

test("-From a dir holding two release zips installs the one -Version names", { skip: zipSkip, timeout: 60000 }, async () => {
  await withWorkspace(async ({ env, installDir, release }) => {
    const dir = await twoVersionDir(release);
    const r = await pwsh(["-File", bundle, "-From", dir, "-Version", "0.2.0", "-InstallDir", installDir], { ...env, SNIPSET_INSTALL_ALLOW_NON_WINDOWS: "1" });
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.equal(await readFile(join(installDir, "snipset.exe"), "utf8"), "snipset.exe fixture 0.2.0\n");
  });
});

test("-From a dir without the named zip fails naming the missing file", { skip: zipSkip, timeout: 60000 }, async () => {
  await withWorkspace(async ({ env, installDir, release }) => {
    const rel = release({ version: "0.1.0" });
    const r = await pwsh(["-File", bundle, "-From", rel.dir, "-Version", "0.3.0", "-InstallDir", installDir], { ...env, SNIPSET_INSTALL_ALLOW_NON_WINDOWS: "1" });
    assert.equal(r.code, 1, r.stdout + r.stderr);
    assert.ok(stderrHas(r, "snipset-cli-v0.3.0-x86_64-pc-windows-msvc.zip is missing"), r.stderr);
  });
});

// fakeWindowsRelease writes `<hex>  <name>`; `sha256sum -b` writes `<hex> *<name>`.
function useStarMarker(rel, name = rel.assetName) {
  const hex = readFileSync(rel.sums, "utf8").slice(0, 64);
  writeFileSync(rel.sums, `${hex} *${name}\n`);
}

test("-From a SHA256SUMS entry with the binary-mode marker installs without -Version", { skip: zipSkip, timeout: 60000 }, async () => {
  await withWorkspace(async ({ env, installDir, release, requests }) => {
    const rel = release({ version: "0.1.0" });
    useStarMarker(rel);
    const r = await pwsh(["-File", bundle, "-From", rel.dir, "-InstallDir", installDir], { ...env, SNIPSET_INSTALL_ALLOW_NON_WINDOWS: "1" });
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(lines(r.stdout).at(-1), /^Installed snipset v0\.1\.0 to /);
    assert.equal(await readFile(join(installDir, "snipset.exe"), "utf8"), "snipset.exe fixture 0.1.0\n");
    assert.equal(requests(), 0);
  });
});

test("-From a binary-mode marker entry with a wrong hash fails with checksum mismatch", { skip: zipSkip, timeout: 60000 }, async () => {
  await withWorkspace(async ({ env, installDir, release }) => {
    const rel = release({ version: "0.1.0", badHash: true });
    useStarMarker(rel);
    const r = await pwsh(["-File", bundle, "-From", rel.dir, "-InstallDir", installDir], { ...env, SNIPSET_INSTALL_ALLOW_NON_WINDOWS: "1" });
    assert.equal(r.code, 1, r.stdout + r.stderr);
    assert.ok(stderrHas(r, "install.ps1: checksum mismatch"), r.stderr);
    assert.equal(existsSync(join(installDir, "snipset.exe")), false);
  });
});

test("-From a binary-mode marker entry for a longer file name is not the archive's checksum", { skip: zipSkip, timeout: 60000 }, async () => {
  await withWorkspace(async ({ env, installDir, release }) => {
    const rel = release({ version: "0.1.0" });
    useStarMarker(rel, `old-${rel.assetName}`);
    const r = await pwsh(["-File", bundle, "-From", rel.dir, "-Version", "0.1.0", "-InstallDir", installDir], { ...env, SNIPSET_INSTALL_ALLOW_NON_WINDOWS: "1" });
    assert.equal(r.code, 1, r.stdout + r.stderr);
    assert.ok(stderrHas(r, "install.ps1: checksum entry missing"), r.stderr);
    assert.equal(existsSync(join(installDir, "snipset.exe")), false);
  });
});

test("a downloaded SHA256SUMS entry with the binary-mode marker is accepted", { skip: zipSkip, timeout: 60000 }, async () => {
  await withWorkspace(async ({ env, installDir, release }) => {
    const rel = release({ version: "0.1.0" });
    useStarMarker(rel);
    const served = new Map(["SHA256SUMS", rel.assetName].map((name) => [`/${rel.tag}/${name}`, join(rel.dir, name)]));
    const mirror = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(req) {
        const file = served.get(new URL(req.url).pathname);
        return file ? new Response(Bun.file(file)) : new Response("not found", { status: 404 });
      },
    });
    try {
      const r = await pwsh(["-File", bundle, "-Version", "0.1.0", "-InstallDir", installDir], {
        ...env,
        SNIPSET_INSTALL_ALLOW_NON_WINDOWS: "1",
        SNIPSET_RELEASE_BASE_URL: `http://127.0.0.1:${mirror.port}`,
      });
      assert.equal(r.code, 0, r.stdout + r.stderr);
      assert.equal(await readFile(join(installDir, "snipset.exe"), "utf8"), "snipset.exe fixture 0.1.0\n");
    } finally {
      mirror.stop(true);
    }
  });
});

test("Test-SnipsetBinary is true only for exit 0 with output starting 'snipset '", { skip: pwshSkip, timeout: 60000 }, async () => {
  await withWorkspace(async ({ env, root }) => {
    const paths = {
      OK_BIN: await script(join(root, "ok"), "echo 'snipset 1.2.3'"),
      FAIL_BIN: await script(join(root, "fail"), "echo 'snipset 1.2.3'\nexit 1"),
      OTHER_BIN: await script(join(root, "other"), "echo 'other 1.2.3'"),
      MISSING_BIN: join(root, "missing"),
    };
    const code = [
      DOT_SOURCE,
      "[pscustomobject]@{",
      "  ok = Test-SnipsetBinary -Path $env:OK_BIN",
      "  fail = Test-SnipsetBinary -Path $env:FAIL_BIN",
      "  other = Test-SnipsetBinary -Path $env:OTHER_BIN",
      "  missing = Test-SnipsetBinary -Path $env:MISSING_BIN",
      "} | ConvertTo-Json -Compress",
    ].join("\n");
    const r = await pwsh(["-Command", code], { ...env, ...paths });
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), { ok: true, fail: false, other: false, missing: false });
  });
});

test("Get-SnipsetInstalledVersion is null off Windows and X.Y.Z on a Windows host", { skip: pwshSkip, timeout: 60000 }, async () => {
  await withWorkspace(async ({ env, root }) => {
    const dir = join(root, "installed");
    await mkdir(dir);
    await script(join(dir, "snipset.exe"), "echo 'snipset 1.2.3'");
    const code = [
      DOT_SOURCE,
      "$off = Get-SnipsetInstalledVersion -InstallDir $env:IDIR",
      "function Test-SnipsetWindowsHost { $true }",
      "$on = Get-SnipsetInstalledVersion -InstallDir $env:IDIR",
      "$absent = Get-SnipsetInstalledVersion -InstallDir $env:EMPTY_DIR",
      "ConvertTo-Json -Compress -InputObject ([ordered]@{ off = $off; on = $on; absent = $absent })",
    ].join("\n");
    const r = await pwsh(["-Command", code], { ...env, IDIR: dir, EMPTY_DIR: join(root, "nowhere") });
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), { off: null, on: "1.2.3", absent: null });
  });
});

test("on a Windows host a staged exe failing --version throws and the old exe stays", { skip: zipSkip, timeout: 60000 }, async () => {
  await withWorkspace(async ({ env, root, installDir, release }) => {
    const rel = release({ version: "0.1.0" });
    await mkdir(installDir);
    await writeFile(join(installDir, "snipset.exe"), "old exe\n");
    const code = [
      DOT_SOURCE,
      "function Test-SnipsetWindowsHost { $true }",
      "function Test-SnipsetBinary { param([string]$Path) \"smoke $Path\" | Out-Host; $false }",
      "try { Install-SnipsetBinary -Zip $env:ZIP -Stage $env:STAGE -InstallDir $env:IDIR; 'installed' }",
      "catch { \"threw: $($_.Exception.Message)\" }",
    ].join("\n");
    const stage = join(root, "stage");
    const r = await pwsh(["-Command", code], { ...env, ZIP: rel.archive, STAGE: stage, IDIR: installDir });
    assert.equal(r.code, 0, r.stderr);
    const out = lines(r.stdout);
    assert.ok(out.includes(`smoke ${join(stage, "snipset.exe")}`), r.stdout);
    assert.match(out.at(-1), /^threw: install\.ps1: .*--version/);
    assert.equal(await readFile(join(installDir, "snipset.exe"), "utf8"), "old exe\n");
  });
});

test("on a Windows host a passing staged exe is placed and then unblocked", { skip: zipSkip, timeout: 60000 }, async () => {
  await withWorkspace(async ({ env, root, installDir, release }) => {
    const rel = release({ version: "0.1.0" });
    const code = [
      DOT_SOURCE,
      "function Test-SnipsetWindowsHost { $true }",
      "function Test-SnipsetBinary { param([string]$Path) $true }",
      "function Unblock-File { param([string]$LiteralPath) \"unblocked $LiteralPath $([IO.File]::ReadAllText($LiteralPath).Trim())\" }",
      "Install-SnipsetBinary -Zip $env:ZIP -Stage $env:STAGE -InstallDir $env:IDIR",
    ].join("\n");
    const r = await pwsh(["-Command", code], { ...env, ZIP: rel.archive, STAGE: join(root, "stage"), IDIR: installDir });
    assert.equal(r.code, 0, r.stderr);
    assert.ok(lines(r.stdout).includes(`unblocked ${join(installDir, "snipset.exe")} snipset.exe fixture 0.1.0`), r.stdout);
  });
});
