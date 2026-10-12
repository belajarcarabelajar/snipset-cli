import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { fakeWindowsRelease, installerPath } from "./helpers/install-sandbox.mjs";

const pwshSkip = Bun.which("pwsh") ? false : "pwsh not on PATH";
const zipSkip = pwshSkip || (Bun.which("bsdtar") ? false : "bsdtar not on PATH");
// bun test prints a skipped test's name but not its reason, so say it once here.
if (zipSkip) console.warn(`skipping install.ps1 hardening tests: ${zipSkip}`);

const bundle = installerPath("ps1");
const part = (name) => fileURLToPath(new URL(`../scripts/installer/ps1/${name}`, import.meta.url));
const ONE_LINER = "[scriptblock]::Create((Get-Content -Raw $env:BUNDLE))";
const IN_USE = "[FAIL] binary: in use (close the program using it)";
const FIXTURE_EXE = "snipset.exe fixture 0.1.0\n";

// pwsh 7.6 colours error records even when stderr is a pipe.
const stripAnsi = (text) => text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
const lines = (text) => text.split(/\r?\n/).filter((line) => line.trim() !== "");
// ConciseView wraps long error messages at the console width behind a `|` gutter, even inside a word.
const squash = (text) => text.replace(/[\s|]+/g, "");
const stderrHas = (r, needle) => squash(r.stderr).includes(squash(needle));

function pwsh(args, env, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn("pwsh", ["-NoProfile", "-NonInteractive", ...args], { env, cwd, stdio: ["ignore", "pipe", "pipe"] });
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

async function withWorkspace(fn, { tmpName = "tmp" } = {}) {
  const root = await mkdtemp(join(tmpdir(), "snipset-ps1-hardening-test-"));
  const releases = [];
  let requests = 0;
  let served = null;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req) {
      requests += 1;
      const { pathname } = new URL(req.url);
      for (const name of served ? ["SHA256SUMS", served.assetName] : []) {
        if (pathname === `/${served.tag}/${name}`) return new Response(readFileSync(join(served.dir, name)));
      }
      return new Response("not found", { status: 404 });
    },
  });
  try {
    const home = join(root, "home");
    const tmp = join(root, tmpName);
    await mkdir(home);
    await mkdir(tmp);
    const env = { ...process.env };
    for (const name of ["LOCALAPPDATA", "OS"]) delete env[name];
    Object.assign(env, {
      HOME: home,
      TMPDIR: tmp,
      // pwsh sends startup telemetry unless this is set before the process starts.
      POWERSHELL_TELEMETRY_OPTOUT: "1",
      NO_COLOR: "1",
      SNIPSET_INSTALL_ALLOW_NON_WINDOWS: "1",
      SNIPSET_RELEASE_BASE_URL: `http://127.0.0.1:${server.port}`,
      BUNDLE: bundle,
      LIB_PART: part("lib.ps1"),
      PLATFORM_PART: part("platform.ps1"),
      BINARY_PART: part("binary.ps1"),
    });
    const release = () => {
      const rel = fakeWindowsRelease();
      releases.push(rel.dir);
      return rel;
    };
    const serve = (rel) => {
      served = rel;
    };
    return await fn({ root, home, tmp, installDir: join(root, "bin"), env, release, serve, requests: () => requests });
  } finally {
    server.stop(true);
    for (const dir of releases) await rm(dir, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
}

const leftovers = (dir, prefix) => (existsSync(dir) ? readdirSync(dir).filter((name) => name.startsWith(prefix)) : []);

test("a caller with Set-StrictMode -Version Latest can install, check, and uninstall through the README one-liner", { skip: zipSkip, timeout: 120000 }, async () => {
  await withWorkspace(async ({ env, installDir, release }) => {
    const rel = release();
    const script = [
      "Set-StrictMode -Version Latest",
      `& (${ONE_LINER}) -From $env:REL -InstallDir $env:IDIR`,
      `& (${ONE_LINER}) -Check -InstallDir $env:IDIR`,
      `& (${ONE_LINER}) -Uninstall -InstallDir $env:IDIR`,
      "try { $null = $setNowhere; 'caller strict: off' } catch { 'caller strict: on' }",
    ].join("\n");
    const r = await pwsh(["-Command", script], { ...env, REL: rel.dir, IDIR: installDir });
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^Installed snipset v0\.1\.0 to /m);
    assert.match(r.stdout, /^check: CURRENT$/m);
    assert.match(r.stdout, /^uninstall: removed [1-9]\d*, kept \d+$/m);
    assert.equal(lines(r.stdout).at(-1), "caller strict: on");
    assert.equal(existsSync(join(installDir, "snipset.exe")), false);
  });
});

test("the caller's SecurityProtocol is unchanged after a run and after a failing run", { skip: zipSkip, timeout: 60000 }, async () => {
  await withWorkspace(async ({ env, root, installDir, release }) => {
    const rel = release();
    const script = [
      "\"before: $([Net.ServicePointManager]::SecurityProtocol)\"",
      `& (${ONE_LINER}) -From $env:REL -InstallDir $env:IDIR | Out-Null`,
      "\"after install: $([Net.ServicePointManager]::SecurityProtocol)\"",
      `try { & (${ONE_LINER}) -From $env:MISSING -InstallDir $env:IDIR | Out-Null } catch { 'failed as expected' }`,
      "\"after failure: $([Net.ServicePointManager]::SecurityProtocol)\"",
    ].join("\n");
    const r = await pwsh(["-Command", script], { ...env, REL: rel.dir, IDIR: installDir, MISSING: join(root, "no-such-release") });
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const out = lines(r.stdout);
    const before = out[0].slice("before: ".length);
    assert.deepEqual(out, [`before: ${before}`, `after install: ${before}`, "failed as expected", `after failure: ${before}`]);
  });
});

test("Enable-SnipsetTls12 adds TLS 1.2 only when missing on Windows PowerShell, and Restore-SnipsetTls puts the value back", { skip: pwshSkip, timeout: 60000 }, async () => {
  await withWorkspace(async ({ env }) => {
    const script = [
      ". $env:LIB_PART",
      "foreach ($start in 'SystemDefault', 'Tls13', 'Tls12, Tls13') {",
      "  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]$start",
      "  $previous = Enable-SnipsetTls12 -Edition Desktop",
      "  $during = [Net.ServicePointManager]::SecurityProtocol",
      "  Restore-SnipsetTls -Previous $previous",
      "  \"$start => $during => $([Net.ServicePointManager]::SecurityProtocol)\"",
      "}",
      "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::SystemDefault",
      "$previous = Enable-SnipsetTls12 -Edition Core",
      "\"Core => $([Net.ServicePointManager]::SecurityProtocol) => restore $($null -eq $previous)\"",
    ].join("\n");
    const r = await pwsh(["-Command", script], env);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.deepEqual(lines(r.stdout), [
      "SystemDefault => Tls12 => SystemDefault",
      "Tls13 => Tls12, Tls13 => Tls13",
      "Tls12, Tls13 => Tls12, Tls13 => Tls12, Tls13",
      "Core => SystemDefault => restore True",
    ]);
  });
});

test("brackets in TMPDIR, -From, and -InstallDir install and check and leave no temp or stage dir", { skip: zipSkip, timeout: 60000 }, async () => {
  await withWorkspace(async ({ env, root, tmp, release }) => {
    const rel = release();
    const from = join(root, "rel[2]");
    await mkdir(from);
    for (const name of ["SHA256SUMS", rel.assetName]) copyFileSync(join(rel.dir, name), join(from, name));
    const installDir = join(root, "bin[3]");
    const install = await pwsh(["-File", bundle, "-From", from, "-InstallDir", installDir], env);
    assert.equal(install.code, 0, install.stdout + install.stderr);
    assert.equal(readFileSync(join(installDir, "snipset.exe"), "utf8"), FIXTURE_EXE);
    assert.deepEqual(leftovers(tmp, "snipset-install-"), []);
    assert.deepEqual(leftovers(installDir, ".snipset-stage-"), []);
    const check = await pwsh(["-File", bundle, "-Check", "-InstallDir", installDir], env);
    assert.equal(check.code, 0, check.stdout + check.stderr);
    assert.match(check.stdout, /^check: CURRENT$/m);
  }, { tmpName: "tmp[1]" });
});

test("a relative -InstallDir is resolved against the caller's current location", { skip: zipSkip, timeout: 60000 }, async () => {
  await withWorkspace(async ({ env, root, home, release }) => {
    const rel = release();
    const work = join(root, "work");
    await mkdir(work);
    // Set-Location moves the PowerShell location but not the process directory that [IO.Path] uses.
    const script = ["Set-Location -LiteralPath $env:WORK", `& (${ONE_LINER}) -From $env:REL -InstallDir rel-bin`].join("\n");
    const r = await pwsh(["-Command", script], { ...env, REL: rel.dir, WORK: work }, home);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const exe = join(work, "rel-bin", "snipset.exe");
    assert.ok(lines(r.stdout).includes(`Installed snipset v0.1.0 to ${exe}`), r.stdout);
    assert.equal(readFileSync(exe, "utf8"), FIXTURE_EXE);
    assert.equal(existsSync(join(home, "rel-bin")), false);
  });
});

for (const [label, name] of [["a semicolon", "a;b"], ["a double quote", 'a"b']]) {
  test(`an -InstallDir with ${label} is refused before anything is written`, { skip: zipSkip, timeout: 60000 }, async () => {
    await withWorkspace(async ({ env, root, release }) => {
      const rel = release();
      const bad = join(root, name);
      const r = await pwsh(["-File", bundle, "-From", rel.dir, "-InstallDir", bad], env);
      assert.equal(r.code, 1, r.stdout + r.stderr);
      assert.ok(stderrHas(r, "must not contain ; or"), `expected the refusal, got: ${r.stderr}`);
      assert.equal(existsSync(bad), false);
    });
  });
}

for (const base of ["http://example.invalid", "http://127.0.0.1.example.invalid"]) {
  test(`a non-loopback http SNIPSET_RELEASE_BASE_URL (${base}) is refused without -From`, { skip: zipSkip, timeout: 60000 }, async () => {
    await withWorkspace(async ({ env, installDir }) => {
      const r = await pwsh(["-File", bundle, "-Version", "v0.1.0", "-InstallDir", installDir], { ...env, SNIPSET_RELEASE_BASE_URL: base });
      assert.equal(r.code, 1, r.stdout + r.stderr);
      assert.ok(stderrHas(r, "SNIPSET_RELEASE_BASE_URL must start with https://"), `expected the https refusal, got: ${r.stderr}`);
      assert.equal(existsSync(join(installDir, "snipset.exe")), false);
    });
  });
}

test("a loopback http SNIPSET_RELEASE_BASE_URL still downloads and installs", { skip: zipSkip, timeout: 60000 }, async () => {
  await withWorkspace(async ({ env, installDir, release, serve, requests }) => {
    serve(release());
    const r = await pwsh(["-File", bundle, "-Version", "v0.1.0", "-InstallDir", installDir], env);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.equal(readFileSync(join(installDir, "snipset.exe"), "utf8"), FIXTURE_EXE);
    assert.equal(requests(), 2);
  });
});

test("-From with an http SNIPSET_RELEASE_BASE_URL still installs without a request", { skip: zipSkip, timeout: 60000 }, async () => {
  await withWorkspace(async ({ env, installDir, release, requests }) => {
    const rel = release();
    const r = await pwsh(["-File", bundle, "-From", rel.dir, "-InstallDir", installDir], env);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.equal(readFileSync(join(installDir, "snipset.exe"), "utf8"), FIXTURE_EXE);
    assert.equal(requests(), 0);
  });
});

test("https downloads run with the progress bar off and the caller's $ProgressPreference is unchanged", { skip: zipSkip, timeout: 60000 }, async () => {
  await withWorkspace(async ({ env, installDir, release }) => {
    const rel = release();
    // A caller function shadows the cmdlet, so the download is served from the fixture dir without a network.
    const script = [
      "function Invoke-WebRequest { param([switch]$UseBasicParsing, [string]$Uri, [string]$OutFile)",
      "  Write-Host \"progress inside: $ProgressPreference\"",
      "  Copy-Item -LiteralPath (Join-Path $env:REL ($Uri -split '/')[-1]) -Destination $OutFile",
      "}",
      "$ProgressPreference = 'Continue'",
      `& (${ONE_LINER}) -Version v0.1.0 -InstallDir $env:IDIR`,
      "\"caller progress: $ProgressPreference\"",
    ].join("\n");
    const r = await pwsh(["-Command", script], { ...env, REL: rel.dir, IDIR: installDir, SNIPSET_RELEASE_BASE_URL: "https://releases.invalid" });
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const out = lines(r.stdout);
    assert.deepEqual(out.filter((line) => line.startsWith("progress inside: ")), ["progress inside: SilentlyContinue", "progress inside: SilentlyContinue"]);
    assert.equal(out.at(-1), "caller progress: Continue");
    assert.equal(readFileSync(join(installDir, "snipset.exe"), "utf8"), FIXTURE_EXE);
  });
});

// Windows will not overwrite a running exe but lets it be renamed; this Move-Item stand-in behaves the same way.
const IN_USE_SCRIPT = [
  ". $env:LIB_PART; . $env:PLATFORM_PART; . $env:BINARY_PART",
  "function Test-SnipsetWindowsHost { $true }",
  "function Test-SnipsetBinary { param([string]$Path) $true }",
  "function Unblock-File { param([string]$LiteralPath) }",
  "function Move-Item { param([string]$LiteralPath, [string]$Destination, [switch]$Force)",
  "  $locked = $env:LOCKED_EXE",
  "  if ((Test-Path -LiteralPath $locked) -and ($Destination -eq $locked -or ($env:LOCK_ASIDE -eq '1' -and $LiteralPath -eq $locked))) {",
  "    throw [UnauthorizedAccessException]::new(\"Access to the path '$locked' is denied.\")",
  "  }",
  "  Microsoft.PowerShell.Management\\Move-Item -LiteralPath $LiteralPath -Destination $Destination -Force:$Force",
  "}",
  // A running exe cannot be deleted either; LOCKED_OLD names the one aside that is still running.
  "function Remove-Item { [CmdletBinding(SupportsShouldProcess)] param([string]$LiteralPath, [switch]$Force, [switch]$Recurse)",
  "  if ($env:LOCKED_OLD -and [IO.Path]::GetFileName($LiteralPath) -ceq $env:LOCKED_OLD) {",
  "    throw [IO.IOException]::new('The process cannot access the file because it is being used by another process.')",
  "  }",
  "  Microsoft.PowerShell.Management\\Remove-Item @PSBoundParameters",
  "}",
  "$run = @{ drift = 0; kept = 0; removed = 0; fail = 0 }",
  "Install-SnipsetBinary -Zip $env:ZIP -Stage $env:STAGE -InstallDir $env:IDIR",
  "\"fail count: $($run.fail)\"",
].join("\n");

async function inUseRun({ env, installDir, release }, lockAside, extraEnv = {}) {
  const rel = release();
  await mkdir(installDir, { recursive: true });
  const exe = join(installDir, "snipset.exe");
  if (!existsSync(exe)) writeFileSync(exe, "old exe\n");
  const r = await pwsh(["-Command", IN_USE_SCRIPT], {
    ...env,
    ZIP: join(rel.dir, rel.assetName),
    STAGE: join(installDir, ".snipset-stage-test"),
    IDIR: installDir,
    LOCKED_EXE: exe,
    LOCK_ASIDE: lockAside ? "1" : "0",
    ...extraEnv,
  });
  return { r, exe, aside: leftovers(installDir, "snipset.exe.old-") };
}

const NEW_ASIDE = /^snipset\.exe\.old-\d+-[0-9a-f]{8}$/;

test("old-exe cleanup: on Windows an exe in use is moved aside to snipset.exe.old-<pid>-<8 hex> and the new one takes its place", { skip: zipSkip, timeout: 60000 }, async () => {
  await withWorkspace(async (ws) => {
    const { r, exe, aside } = await inUseRun(ws, false);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.equal(readFileSync(exe, "utf8"), FIXTURE_EXE);
    assert.equal(aside.length, 1, `expected one moved-aside exe, got ${aside}`);
    assert.match(aside[0], NEW_ASIDE);
    assert.equal(readFileSync(join(ws.installDir, aside[0]), "utf8"), "old exe\n");
    const out = lines(r.stdout);
    assert.ok(out.some((line) => line.startsWith("[NOTE] binary: ") && line.includes(aside[0])), r.stdout);
    assert.equal(out.at(-1), "fail count: 0");
  });
});

test("on Windows an exe in use that cannot be moved aside reports [FAIL] binary: in use and stays unchanged", { skip: zipSkip, timeout: 60000 }, async () => {
  await withWorkspace(async (ws) => {
    const { r, exe, aside } = await inUseRun(ws, true);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const out = lines(r.stdout);
    assert.ok(out.includes(IN_USE), r.stdout);
    assert.equal(out.at(-1), "fail count: 1");
    assert.equal(readFileSync(exe, "utf8"), "old exe\n");
    assert.deepEqual(aside, []);
  });
});

const LOCKED_OLD = "snipset.exe.old-222-0123abcd";
// Near misses of the aside name; a trailing newline and a non-ASCII digit catch a loose $ or \d.
const OLD_DECOYS = ["snipset.exe.old-abc", "snipset.exe.old-111.txt", "snipset.exe.older", "other.exe.old-1", "SNIPSET.EXE.OLD-7", "snipset.exe.old-6\n", "snipset.exe.old-١"];

// Each file holds its own name, so a changed or swapped file shows up as different bytes.
function seedOldExe(root, installDir) {
  const outside = join(root, "outside.txt");
  for (const dir of ["sub", "snipset.exe.old-333"]) mkdirSync(join(installDir, dir), { recursive: true });
  for (const name of ["snipset.exe.old-111", LOCKED_OLD, ...OLD_DECOYS, "snipset.exe.old-333/inner", "sub/snipset.exe.old-5"]) {
    writeFileSync(join(installDir, name), `${name}\n`);
  }
  writeFileSync(outside, "outside\n");
  symlinkSync(outside, join(installDir, "snipset.exe.old-444"));
  return outside;
}

function assertDecoysUntouched(installDir, outside) {
  for (const name of [...OLD_DECOYS, "snipset.exe.old-333/inner", "sub/snipset.exe.old-5"]) {
    assert.equal(readFileSync(join(installDir, name), "utf8"), `${name}\n`, `${JSON.stringify(name)} changed`);
  }
  assert.ok(lstatSync(join(installDir, "snipset.exe.old-333")).isDirectory());
  assert.ok(lstatSync(join(installDir, "snipset.exe.old-444")).isSymbolicLink());
  assert.equal(readlinkSync(join(installDir, "snipset.exe.old-444")), outside);
  assert.equal(readFileSync(outside, "utf8"), "outside\n");
}

test("old-exe cleanup: an in-use install deletes only exact asides, keeps a locked one with a NOTE, and leaves decoys alone", { skip: zipSkip, timeout: 60000 }, async () => {
  await withWorkspace(async (ws) => {
    const outside = seedOldExe(ws.root, ws.installDir);
    const { r, exe } = await inUseRun(ws, false, { LOCKED_OLD });
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const out = lines(r.stdout);
    assert.equal(out.at(-1), "fail count: 0");
    assert.equal(readFileSync(exe, "utf8"), FIXTURE_EXE);
    assert.equal(existsSync(join(ws.installDir, "snipset.exe.old-111")), false, r.stdout);
    assert.equal(readFileSync(join(ws.installDir, LOCKED_OLD), "utf8"), `${LOCKED_OLD}\n`);
    assert.equal(out.filter((line) => line.startsWith("[NOTE] ") && line.includes(LOCKED_OLD)).length, 1, r.stdout);
    assert.ok(out.some((line) => line.startsWith("[NOTE] ") && line.includes("snipset.exe.old-111")), r.stdout);
    assert.deepEqual(out.filter((line) => line.startsWith("[REMOVED]")), [], r.stdout);
    assertDecoysUntouched(ws.installDir, outside);
    const fresh = readdirSync(ws.installDir).filter((name) => NEW_ASIDE.test(name) && name !== LOCKED_OLD);
    assert.equal(fresh.length, 1, `expected one new aside, got ${fresh}`);
    assert.equal(readFileSync(join(ws.installDir, fresh[0]), "utf8"), "old exe\n");
  });
});

test("old-exe cleanup: two in-use installs in a row leave at most one aside", { skip: zipSkip, timeout: 120000 }, async () => {
  await withWorkspace(async (ws) => {
    const first = await inUseRun(ws, false);
    assert.equal(first.r.code, 0, first.r.stdout + first.r.stderr);
    const second = await inUseRun(ws, false);
    assert.equal(second.r.code, 0, second.r.stdout + second.r.stderr);
    assert.equal(lines(second.r.stdout).at(-1), "fail count: 0");
    assert.ok(second.aside.length <= 1, `expected at most one aside, got ${second.aside}`);
    assert.equal(readFileSync(second.exe, "utf8"), FIXTURE_EXE);
  });
});

test("old-exe cleanup: uninstall removes a leftover aside with [REMOVED] and then the install dir", { skip: zipSkip, timeout: 60000 }, async () => {
  await withWorkspace(async ({ env, installDir }) => {
    await mkdir(installDir);
    for (const name of ["snipset.exe", "snipset.exe.old-111", LOCKED_OLD]) writeFileSync(join(installDir, name), `${name}\n`);
    const r = await pwsh(["-File", bundle, "-Uninstall", "-InstallDir", installDir], env);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const out = lines(r.stdout);
    for (const name of ["snipset.exe.old-111", LOCKED_OLD]) assert.ok(out.includes(`[REMOVED] binary: ${join(installDir, name)}`), r.stdout);
    assert.equal(out.at(-1), "uninstall: removed 3, kept 0");
    assert.equal(existsSync(installDir), false);
  });
});

// The smoke probe is replaced, so PROBE_CODE stands for the exit code Windows gives the staged exe.
const PROBE_SCRIPT = [
  ". $env:LIB_PART; . $env:PLATFORM_PART; . $env:BINARY_PART",
  "function Test-SnipsetWindowsHost { $true }",
  "function Unblock-File { param([string]$LiteralPath) }",
  "function Invoke-SnipsetVersionProbe { param([string]$Exe) \"probe $Exe\" | Out-Host; @{ ExitCode = [int]$env:PROBE_CODE; Output = '' } }",
  "$run = @{ drift = 0; kept = 0; removed = 0; fail = 0 }",
  "try { Install-SnipsetBinary -Zip $env:ZIP -Stage $env:STAGE -InstallDir $env:IDIR; 'installed' } catch { \"error: $($_.Exception.Message)\" }",
].join("\n");

async function probeRun({ env, installDir, release }, code) {
  const rel = release();
  await mkdir(installDir);
  const exe = join(installDir, "snipset.exe");
  writeFileSync(exe, "old exe\n");
  const stage = join(installDir, ".snipset-stage-test");
  const r = await pwsh(["-Command", PROBE_SCRIPT], { ...env, ZIP: join(rel.dir, rel.assetName), STAGE: stage, IDIR: installDir, PROBE_CODE: String(code) });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const out = lines(r.stdout);
  assert.ok(out.includes(`probe ${join(stage, "snipset.exe")}`), `the smoke run did not go through the probe: ${r.stdout}`);
  // A failing exe is started once: a second start costs a slow loader timeout and runs untrusted code again.
  assert.equal(out.filter((line) => line.startsWith("probe ")).length, 1, r.stdout);
  assert.equal(readFileSync(exe, "utf8"), "old exe\n");
  assert.deepEqual(leftovers(installDir, "snipset.exe.old-"), []);
  return out.at(-1);
}

test("missing DLL: a smoke exit code of -1073741515 names the two DLLs and leaves the old exe in place", { skip: zipSkip, timeout: 60000 }, async () => {
  await withWorkspace(async (ws) => {
    const last = await probeRun(ws, -1073741515);
    assert.equal(last, "error: install.ps1: snipset.exe could not start: it needs libcrypto-3-x64.dll and VCRUNTIME140.dll, which this release does not ship; see the README Windows notes");
  });
});

test("missing DLL: any other failing smoke exit code keeps the generic message", { skip: zipSkip, timeout: 60000 }, async () => {
  await withWorkspace(async (ws) => {
    const last = await probeRun(ws, 1);
    assert.equal(last, 'error: install.ps1: the downloaded snipset.exe failed "snipset.exe --version"; the installed snipset.exe was not changed');
  });
});
