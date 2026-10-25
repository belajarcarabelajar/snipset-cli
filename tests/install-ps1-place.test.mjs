import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { fakeWindowsRelease, installerPath } from "./helpers/install-sandbox.mjs";

const pwshSkip = Bun.which("pwsh") ? false : "pwsh not on PATH";
const zipSkip = pwshSkip || (Bun.which("bsdtar") ? false : "bsdtar not on PATH");
// bun test prints a skipped test's name but not its reason, so say it once here.
if (zipSkip) console.warn(`skipping install.ps1 placement tests: ${zipSkip}`);

const part = (name) => fileURLToPath(new URL(`../scripts/installer/ps1/${name}`, import.meta.url));
const DOT_SOURCE = ". $env:LIB_PART; . $env:PLATFORM_PART; . $env:BINARY_PART";
const refusal = (exe) => `install.ps1: ${exe} exists and is not a snipset install; move it aside or pass -InstallDir`;

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
  const root = await mkdtemp(join(tmpdir(), "snipset-ps1-place-test-"));
  const releases = [];
  try {
    const home = join(root, "home");
    const tmp = join(root, "tmp");
    await mkdir(home);
    await mkdir(tmp);
    const env = { ...process.env };
    for (const name of ["LOCALAPPDATA", "OS", "XDG_CONFIG_HOME", "SNIPSET_INSTALL_ALLOW_NON_WINDOWS", "SNIPSET_RELEASE_BASE_URL"]) delete env[name];
    Object.assign(env, {
      HOME: home,
      TMPDIR: tmp,
      // pwsh sends startup telemetry unless this is set before the process starts.
      POWERSHELL_TELEMETRY_OPTOUT: "1",
      NO_COLOR: "1",
      // Unroutable, so a test that wrongly goes to the network fails instead of downloading.
      SNIPSET_RELEASE_BASE_URL: "http://127.0.0.1:9",
      LIB_PART: part("lib.ps1"),
      PLATFORM_PART: part("platform.ps1"),
      BINARY_PART: part("binary.ps1"),
    });
    const release = (opts) => {
      const rel = fakeWindowsRelease(opts);
      if (rel) releases.push(rel.dir);
      return rel;
    };
    return await fn({ root, installDir: join(root, "bin"), env, release });
  } finally {
    for (const dir of releases) await rm(dir, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
}

// Install-SnipsetBinary on a mocked Windows host. The staged exe always passes the smoke;
// IS_SNIPSET decides whether the exe already in the install dir answers --version as snipset.
function windowsInstall() {
  return [
    DOT_SOURCE,
    "$run = @{ drift = 0; kept = 0; removed = 0; fail = 0 }",
    "function Test-SnipsetWindowsHost { $true }",
    "function Test-SnipsetBinary { param([string]$Path) \"probe $Path\" | Out-Host; if ($Path -eq $env:EXE) { $env:IS_SNIPSET -eq '1' } else { $true } }",
    "function Unblock-File { param([string]$LiteralPath) \"unblocked $LiteralPath\" }",
    "try { Install-SnipsetBinary -Zip $env:ZIP -Stage $env:STAGE -InstallDir $env:IDIR; 'installed' }",
    "catch { \"threw: $($_.Exception.Message)\" }",
  ].join("\n");
}

test("off Windows the bundle refuses a symlinked snipset.exe and leaves the link and its target alone", { skip: zipSkip, timeout: 60000 }, async () => {
  await withWorkspace(async ({ env, root, installDir, release }) => {
    const rel = release({ version: "0.1.0" });
    const target = join(root, "someone-elses.exe");
    await writeFile(target, "someone else's exe\n");
    await mkdir(installDir);
    const exe = join(installDir, "snipset.exe");
    await symlink(target, exe);
    const r = await pwsh(["-File", installerPath("ps1"), "-From", rel.dir, "-InstallDir", installDir], { ...env, SNIPSET_INSTALL_ALLOW_NON_WINDOWS: "1" });
    assert.equal(r.code, 1, r.stdout + r.stderr);
    assert.ok(stderrHas(r, refusal(exe)), r.stderr);
    assert.ok(!lines(r.stdout).some((line) => line.startsWith("Installed snipset")), r.stdout);
    assert.ok((await lstat(exe)).isSymbolicLink());
    assert.equal(await readlink(exe), target);
    assert.equal(await readFile(target, "utf8"), "someone else's exe\n");
  });
});

test("off Windows a dangling snipset.exe link is refused too", { skip: zipSkip, timeout: 60000 }, async () => {
  await withWorkspace(async ({ env, root, installDir, release }) => {
    const rel = release({ version: "0.1.0" });
    await mkdir(installDir);
    const exe = join(installDir, "snipset.exe");
    const target = join(root, "gone.exe");
    await symlink(target, exe);
    const code = [DOT_SOURCE, "$run = @{ drift = 0; kept = 0; removed = 0; fail = 0 }", "try { Install-SnipsetBinary -Zip $env:ZIP -Stage $env:STAGE -InstallDir $env:IDIR; 'installed' }", "catch { \"threw: $($_.Exception.Message)\" }"].join("\n");
    const r = await pwsh(["-Command", code], { ...env, ZIP: rel.archive, STAGE: join(root, "stage"), IDIR: installDir });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(lines(r.stdout).at(-1), `threw: ${refusal(exe)}`);
    assert.equal(await readlink(exe), target);
  });
});

test("off Windows a regular snipset.exe is still replaced (it cannot be run to check)", { skip: zipSkip, timeout: 60000 }, async () => {
  await withWorkspace(async ({ env, root, installDir, release }) => {
    const rel = release({ version: "0.1.0" });
    await mkdir(installDir);
    await writeFile(join(installDir, "snipset.exe"), "older exe\n");
    const code = [DOT_SOURCE, "$run = @{ drift = 0; kept = 0; removed = 0; fail = 0 }", "try { Install-SnipsetBinary -Zip $env:ZIP -Stage $env:STAGE -InstallDir $env:IDIR; 'installed' }", "catch { \"threw: $($_.Exception.Message)\" }"].join("\n");
    const r = await pwsh(["-Command", code], { ...env, ZIP: rel.archive, STAGE: join(root, "stage"), IDIR: installDir });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(lines(r.stdout).at(-1), "installed", r.stdout);
    assert.equal(await readFile(join(installDir, "snipset.exe"), "utf8"), "snipset.exe fixture 0.1.0\n");
  });
});

test("on a Windows host a foreign snipset.exe is refused and left untouched", { skip: zipSkip, timeout: 60000 }, async () => {
  await withWorkspace(async ({ env, root, installDir, release }) => {
    const rel = release({ version: "0.1.0" });
    await mkdir(installDir);
    const exe = join(installDir, "snipset.exe");
    await writeFile(exe, "someone else's exe\n");
    const r = await pwsh(["-Command", windowsInstall()], { ...env, ZIP: rel.archive, STAGE: join(root, "stage"), IDIR: installDir, EXE: exe, IS_SNIPSET: "0" });
    assert.equal(r.code, 0, r.stderr);
    const out = lines(r.stdout);
    assert.ok(out.includes(`probe ${exe}`), r.stdout);
    assert.equal(out.at(-1), `threw: ${refusal(exe)}`);
    assert.ok(!out.some((line) => line.startsWith("unblocked ")), r.stdout);
    assert.equal(await readFile(exe, "utf8"), "someone else's exe\n");
  });
});

test("on a Windows host a genuine older snipset.exe is replaced", { skip: zipSkip, timeout: 60000 }, async () => {
  await withWorkspace(async ({ env, root, installDir, release }) => {
    const rel = release({ version: "0.1.0" });
    await mkdir(installDir);
    const exe = join(installDir, "snipset.exe");
    await writeFile(exe, "snipset 0.0.9 exe\n");
    const r = await pwsh(["-Command", windowsInstall()], { ...env, ZIP: rel.archive, STAGE: join(root, "stage"), IDIR: installDir, EXE: exe, IS_SNIPSET: "1" });
    assert.equal(r.code, 0, r.stderr);
    const out = lines(r.stdout);
    assert.ok(out.includes(`unblocked ${exe}`), r.stdout);
    assert.equal(out.at(-1), "installed", r.stdout);
    assert.equal(await readFile(exe, "utf8"), "snipset.exe fixture 0.1.0\n");
  });
});

test("on a Windows host a symlinked snipset.exe is refused even when it answers as snipset", { skip: zipSkip, timeout: 60000 }, async () => {
  await withWorkspace(async ({ env, root, installDir, release }) => {
    const rel = release({ version: "0.1.0" });
    const target = join(root, "elsewhere.exe");
    await writeFile(target, "snipset 0.0.9 exe\n");
    await mkdir(installDir);
    const exe = join(installDir, "snipset.exe");
    await symlink(target, exe);
    const r = await pwsh(["-Command", windowsInstall()], { ...env, ZIP: rel.archive, STAGE: join(root, "stage"), IDIR: installDir, EXE: exe, IS_SNIPSET: "1" });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(lines(r.stdout).at(-1), `threw: ${refusal(exe)}`);
    assert.equal(await readlink(exe), target);
    assert.equal(await readFile(target, "utf8"), "snipset 0.0.9 exe\n");
  });
});
