import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { diffSnapshots, fakeWindowsRelease, installerPath, snapshotTree } from "./helpers/install-sandbox.mjs";

const pwshPath = Bun.which("pwsh");
const pwshSkip = pwshPath ? false : "pwsh not on PATH";
const zipSkip = pwshSkip || (Bun.which("bsdtar") ? false : "bsdtar not on PATH");
// bun test prints a skipped test's name but not its reason, so say it once here.
if (zipSkip) console.warn(`skipping install.ps1 lifecycle tests: ${zipSkip}`);

const bundle = installerPath("ps1");
const part = (name) => fileURLToPath(new URL(`../scripts/installer/ps1/${name}`, import.meta.url));
const MODE_PARTS = ["lib.ps1", "platform.ps1", "fetch.ps1", "binary.ps1", "path.ps1", "mcp.ps1", "modes.ps1"];
const dotSource = (names) => names.map((name) => `. '${part(name).replaceAll("'", "''")}'`).join("\n");
const DRY_UNINSTALL = "-DryRun cannot preview -Uninstall; run -Check to see what is installed";

// pwsh 7.6 colours error records even when stderr is a pipe.
const stripAnsi = (text) => text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
const lines = (text) => text.split(/\r?\n/).filter((line) => line.trim() !== "");
// ConciseView wraps long error messages at the console width behind a `|` gutter, even inside a word.
const squash = (text) => text.replace(/[\s|]+/g, "");
const stderrHas = (r, needle) => squash(r.stderr).includes(squash(needle));

function pwsh(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(pwshPath, ["-NoProfile", "-NonInteractive", ...args], { env, stdio: ["ignore", "pipe", "pipe"] });
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
  const root = await mkdtemp(join(tmpdir(), "snipset-ps1-lifecycle-test-"));
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
    const stubs = join(root, "stubs");
    for (const dir of [home, tmp, stubs]) await mkdir(dir);
    const cliLog = join(root, "cli.log");
    // A harness CLI on PATH that only logs, so a stray MCP probe shows up instead of reaching a real CLI.
    for (const name of ["claude", "codex", "gemini", "code"]) {
      await writeFile(join(stubs, name), `#!/bin/sh\necho "${name} $*" >> '${cliLog}'\nexit 1\n`);
      await chmod(join(stubs, name), 0o755);
    }
    const env = { ...process.env };
    for (const name of ["LOCALAPPDATA", "OS"]) delete env[name];
    Object.assign(env, {
      HOME: home,
      TMPDIR: tmp,
      PATH: stubs,
      // pwsh sends startup telemetry unless this is set before the process starts.
      POWERSHELL_TELEMETRY_OPTOUT: "1",
      NO_COLOR: "1",
      SNIPSET_INSTALL_ALLOW_NON_WINDOWS: "1",
      SNIPSET_RELEASE_BASE_URL: `http://127.0.0.1:${server.port}`,
    });
    const release = (opts) => {
      const rel = fakeWindowsRelease(opts);
      releases.push(rel.dir);
      return rel;
    };
    const installDir = join(root, "bin");
    const run = (args) => pwsh(["-File", bundle, ...args, "-InstallDir", installDir], env);
    const cliCalls = async () => (existsSync(cliLog) ? lines(await readFile(cliLog, "utf8")) : []);
    return await fn({ root, home, tmp, installDir, env, release, run, cliCalls, requests: () => requests });
  } finally {
    server.stop(true);
    for (const dir of releases) await rm(dir, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
}

// pwsh writes its own startup cache under HOME; that is not the installer's doing.
const PWSH_STATE = /^home\/(\.cache|\.local\/share|\.config)\/powershell(\/|$)/;
const snapshot = (dir) => snapshotTree(dir).filter((entry) => !PWSH_STATE.test(entry.path));
const filesOnly = (snap) => snap.filter((entry) => entry.type !== "dir");

const PATH_CASES = [
  { name: "add to an empty value", op: "add", raw: "", dir: "C:\\Snipset\\bin", want: "C:\\Snipset\\bin" },
  { name: "add to a value holding exactly one entry", op: "add", raw: "C:\\a", dir: "C:\\b", want: "C:\\a;C:\\b" },
  { name: "add a duplicate differing in case", op: "add", raw: "C:\\Tools;c:\\snipset\\BIN", dir: "C:\\Snipset\\bin", want: "C:\\Tools;c:\\snipset\\BIN" },
  { name: "add a duplicate differing by a trailing backslash", op: "add", raw: "C:\\Snipset\\bin\\;C:\\Tools", dir: "C:\\Snipset\\bin", want: "C:\\Snipset\\bin\\;C:\\Tools" },
  { name: "add keeps %USERPROFILE%\\bin verbatim", op: "add", raw: "%USERPROFILE%\\bin;C:\\x", dir: "C:\\Snipset\\bin", want: "%USERPROFILE%\\bin;C:\\x;C:\\Snipset\\bin" },
  { name: "remove keeps %USERPROFILE%\\bin verbatim", op: "remove", raw: "%USERPROFILE%\\bin;C:\\Snipset\\bin", dir: "C:\\Snipset\\bin", want: "%USERPROFILE%\\bin" },
  {
    name: "remove only the exact entry",
    op: "remove",
    raw: "C:\\Snipset\\bin2;C:\\Snipset\\bin\\sub;C:\\SNIPSET\\bin\\;C:\\Snipset\\bin;D:\\Snipset\\bin",
    dir: "C:\\Snipset\\bin",
    want: "C:\\Snipset\\bin2;C:\\Snipset\\bin\\sub;D:\\Snipset\\bin",
  },
  { name: "remove from a value with empty segments", op: "remove", raw: ";C:\\a;;C:\\Snipset\\bin;;C:\\b;", dir: "C:\\Snipset\\bin", want: "C:\\a;C:\\b" },
  { name: "remove the only entry", op: "remove", raw: "C:\\Snipset\\bin", dir: "C:\\Snipset\\bin", want: "" },
  { name: "remove an absent entry", op: "remove", raw: "C:\\a;C:\\b", dir: "C:\\Snipset\\bin", want: "C:\\a;C:\\b" },
];

let pathRun;
function pathResults() {
  pathRun ??= withWorkspace(async ({ env }) => {
    const code = [
      dotSource(["lib.ps1", "platform.ps1", "path.ps1"]),
      "$cases = $env:CASES | ConvertFrom-Json",
      "ConvertTo-Json -Compress -InputObject @($cases | ForEach-Object {",
      "  if ($_.op -eq 'add') { [string](Add-SnipsetPathEntry -Raw $_.raw -Dir $_.dir) } else { [string](Remove-SnipsetPathEntry -Raw $_.raw -Dir $_.dir) }",
      "})",
    ].join("\n");
    const r = await pwsh(["-Command", code], { ...env, CASES: JSON.stringify(PATH_CASES) });
    assert.equal(r.code, 0, r.stderr);
    return JSON.parse(r.stdout);
  });
  return pathRun;
}

PATH_CASES.forEach((c, i) => {
  test(`path entry: ${c.name}`, { skip: pwshSkip, timeout: 60000 }, async () => {
    assert.equal((await pathResults())[i], c.want);
  });
});

test("path entry: off Windows the registry helpers report a skip and touch nothing", { skip: pwshSkip, timeout: 60000 }, async () => {
  await withWorkspace(async ({ env }) => {
    const code = [
      dotSource(["lib.ps1", "platform.ps1", "path.ps1"]),
      "$got = Get-SnipsetUserPath",
      "\"got: [$got]\"",
      "Set-SnipsetUserPath -Raw 'C:\\x'",
      "Install-SnipsetPathEnv -Dir 'C:\\Snipset\\bin'",
    ].join("\n");
    const r = await pwsh(["-Command", code], env);
    assert.equal(r.code, 0, r.stderr);
    const out = lines(r.stdout);
    assert.ok(out.includes("got: []"), r.stdout);
    assert.equal(out.filter((line) => line === "[SKIP] path: not a Windows host").length, 3, r.stdout);
  });
});

test("path entry: on Windows add, check, and remove go through the user PATH value once each", { skip: pwshSkip, timeout: 60000 }, async () => {
  await withWorkspace(async ({ env }) => {
    const code = [
      dotSource(["lib.ps1", "platform.ps1", "path.ps1"]),
      "$fake = @{ raw = '%USERPROFILE%\\bin;C:\\Tools'; sets = 0 }",
      "function Test-SnipsetWindowsHost { $true }",
      "function Get-SnipsetUserPath { $fake.raw }",
      "function Set-SnipsetUserPath { param([string]$Raw) $fake.raw = $Raw; $fake.sets++ }",
      "function Invoke-Probe { param([scriptblock]$Step) $run = @{ drift = 0; kept = 0; removed = 0; fail = 0 }; & $Step; \"after: $($fake.raw) sets=$($fake.sets) drift=$($run.drift) removed=$($run.removed)\" }",
      "Invoke-Probe { Test-SnipsetPathEnv -Dir 'C:\\Snipset\\bin' }",
      "Invoke-Probe { Install-SnipsetPathEnv -Dir 'C:\\Snipset\\bin' }",
      "Invoke-Probe { Install-SnipsetPathEnv -Dir 'C:\\Snipset\\bin\\' }",
      "Invoke-Probe { Test-SnipsetPathEnv -Dir 'C:\\Snipset\\bin' }",
      "Invoke-Probe { Remove-SnipsetPathEnv -Dir 'c:\\snipset\\bin' }",
      "Invoke-Probe { Remove-SnipsetPathEnv -Dir 'C:\\Snipset\\bin' }",
    ].join("\n");
    const r = await pwsh(["-Command", code], env);
    assert.equal(r.code, 0, r.stderr);
    const after = lines(r.stdout).filter((line) => line.startsWith("after: "));
    assert.deepEqual(after, [
      "after: %USERPROFILE%\\bin;C:\\Tools sets=0 drift=1 removed=0",
      "after: %USERPROFILE%\\bin;C:\\Tools;C:\\Snipset\\bin sets=1 drift=0 removed=0",
      "after: %USERPROFILE%\\bin;C:\\Tools;C:\\Snipset\\bin sets=1 drift=0 removed=0",
      "after: %USERPROFILE%\\bin;C:\\Tools;C:\\Snipset\\bin sets=1 drift=0 removed=0",
      "after: %USERPROFILE%\\bin;C:\\Tools sets=2 drift=0 removed=1",
      "after: %USERPROFILE%\\bin;C:\\Tools sets=2 drift=0 removed=0",
    ], r.stdout);
  });
});

test("lifecycle: install, check, uninstall, check, uninstall again with no MCP probe", { skip: zipSkip, timeout: 120000 }, async () => {
  await withWorkspace(async ({ installDir, release, run, cliCalls, requests }) => {
    const rel = release({ version: "0.1.0" });
    const exe = join(installDir, "snipset.exe");

    const install = await run(["-From", rel.dir]);
    assert.equal(install.code, 0, install.stdout + install.stderr);
    assert.ok(existsSync(exe));

    const check = await run(["-Check"]);
    assert.equal(check.code, 0, check.stdout + check.stderr);
    const checkOut = lines(check.stdout);
    assert.equal(checkOut.at(-1), "check: CURRENT");
    assert.ok(checkOut.some((line) => line.startsWith("[OK] binary: ") && line.includes(exe)), check.stdout);
    assert.ok(checkOut.includes("[SKIP] mcp: no -WithMcp list"), check.stdout);

    const uninstall = await run(["-Uninstall"]);
    assert.equal(uninstall.code, 0, uninstall.stdout + uninstall.stderr);
    const unOut = lines(uninstall.stdout);
    assert.equal(unOut.at(-1), "uninstall: removed 1, kept 0");
    assert.ok(unOut.includes("[SKIP] mcp: no -WithMcp list"), uninstall.stdout);
    assert.equal(existsSync(exe), false);

    const recheck = await run(["-Check"]);
    assert.equal(recheck.code, 1, recheck.stdout + recheck.stderr);
    assert.ok(lines(recheck.stdout).some((line) => line.startsWith("[MISSING] binary: ")), recheck.stdout);
    assert.ok(stderrHas(recheck, "check: DRIFT (1 items)"), recheck.stderr);

    const again = await run(["-Uninstall"]);
    assert.equal(again.code, 0, again.stdout + again.stderr);
    assert.equal(lines(again.stdout).at(-1), "uninstall: removed 0, kept 0");

    assert.deepEqual(await cliCalls(), []);
    assert.equal(requests(), 0);
  });
});

test("lifecycle: -AddPath and -WithMcp opencode,cursor install, check, and uninstall back to the seeded files", { skip: zipSkip, timeout: 120000 }, async () => {
  await withWorkspace(async ({ root, home, installDir, release, run, cliCalls, requests }) => {
    const rel = release({ version: "0.1.0" });
    await mkdir(join(home, ".config"), { recursive: true });
    await writeFile(join(home, ".profile"), "# user profile\n");
    await writeFile(join(home, ".config", "user.json"), "{\"mine\":true}\n");
    const before = filesOnly(snapshot(root));
    const flags = ["-AddPath", "-WithMcp", "opencode,cursor"];

    const install = await run(["-From", rel.dir, ...flags]);
    assert.equal(install.code, 0, install.stdout + install.stderr);
    const installOut = lines(install.stdout);
    assert.ok(installOut.includes("[SKIP] path: not a Windows host"), install.stdout);
    assert.ok(existsSync(join(home, ".config", "opencode", "opencode.json")), install.stdout);
    assert.ok(existsSync(join(home, ".cursor", "mcp.json")), install.stdout);

    const check = await run(["-Check", ...flags]);
    assert.equal(check.code, 0, check.stdout + check.stderr);
    const checkOut = lines(check.stdout);
    assert.ok(checkOut.some((line) => line.startsWith("[OK] opencode: ")), check.stdout);
    assert.ok(checkOut.some((line) => line.startsWith("[OK] cursor: ")), check.stdout);
    assert.ok(checkOut.includes("[SKIP] path: not a Windows host"), check.stdout);

    const uninstall = await run(["-Uninstall", ...flags]);
    assert.equal(uninstall.code, 0, uninstall.stdout + uninstall.stderr);
    assert.equal(lines(uninstall.stdout).at(-1), "uninstall: removed 3, kept 0");
    assert.deepEqual(diffSnapshots(before, filesOnly(snapshot(root))), []);

    const recheck = await run(["-Check", ...flags]);
    assert.equal(recheck.code, 1, recheck.stdout + recheck.stderr);
    assert.ok(stderrHas(recheck, "check: DRIFT (3 items)"), recheck.stderr);

    assert.deepEqual(await cliCalls(), []);
    assert.equal(requests(), 0);
  });
});

test("lifecycle: -DryRun in every mode leaves the install dir and HOME identical", { skip: zipSkip, timeout: 180000 }, async () => {
  await withWorkspace(async ({ root, installDir, release, run, cliCalls, requests }) => {
    const rel = release({ version: "0.1.0" });
    const install = await run(["-From", rel.dir, "-WithMcp", "opencode,cursor"]);
    assert.equal(install.code, 0, install.stdout + install.stderr);
    const exe = join(installDir, "snipset.exe");
    const before = snapshot(root);

    const combos = [
      { args: ["-DryRun", "-From", rel.dir], code: 0 },
      { args: ["-DryRun", "-From", rel.dir, "-Version", "0.1.0", "-AddPath", "-WithMcp", "all"], code: 0 },
      { args: ["-DryRun", "-Version", "v0.1.0", "-AddPath"], code: 0 },
      { args: ["-DryRun", "-Check", "-AddPath", "-WithMcp", "opencode,cursor"], code: 0 },
      { args: ["-DryRun", "-Update", "-From", rel.dir, "-WithMcp", "all"], code: 0 },
      { args: ["-DryRun", "-Uninstall", "-WithMcp", "opencode,cursor"], code: 1 },
    ];
    for (const combo of combos) {
      const r = await run(combo.args);
      const label = combo.args.join(" ");
      assert.equal(r.code, combo.code, `${label}\n${r.stdout}${r.stderr}`);
      assert.deepEqual(diffSnapshots(before, snapshot(root)), [], label);
      if (combo.args.includes("-Uninstall")) {
        assert.ok(stderrHas(r, DRY_UNINSTALL), r.stderr);
        assert.doesNotMatch(r.stdout, /\[REMOVED\]/);
      }
      if (combo.args.includes("-From") && !combo.args.includes("-Check")) {
        const dry = lines(r.stdout).filter((line) => line.startsWith("[DRY] "));
        assert.ok(dry.some((line) => line.includes(`copy SHA256SUMS and ${rel.assetName} from ${rel.dir}`)), `${label}\n${r.stdout}`);
        assert.doesNotMatch(r.stdout, /download SHA256SUMS/);
      }
    }
    assert.ok(existsSync(exe));
    assert.deepEqual(await cliCalls(), []);
    assert.equal(requests(), 0);
  });
});

test("update: an installed version equal to the resolved one skips the install", { skip: pwshSkip, timeout: 60000 }, async () => {
  await withWorkspace(async ({ env, installDir }) => {
    const code = [
      dotSource(MODE_PARTS),
      "$Version = 'v0.1.0'; $InstallDir = $env:IDIR; $From = ''; $DryRun = $false; $AddPath = $false",
      "function Invoke-SnipsetInstall { param([string[]]$McpIds) \"install $Version\" }",
      "function Get-SnipsetInstalledVersion { param([string]$InstallDir) $env:HAVE }",
      "Invoke-SnipsetUpdate",
    ].join("\n");
    const same = await pwsh(["-Command", code], { ...env, IDIR: installDir, HAVE: "0.1.0" });
    assert.equal(same.code, 0, same.stderr);
    assert.deepEqual(lines(same.stdout), ["[OK] update: snipset 0.1.0 is current"]);
    const older = await pwsh(["-Command", code], { ...env, IDIR: installDir, HAVE: "0.0.9" });
    assert.equal(older.code, 0, older.stderr);
    assert.deepEqual(lines(older.stdout), ["install v0.1.0"]);
  });
});

test("uninstall on Windows removes snipset.exe only when --version names snipset", { skip: pwshSkip, timeout: 60000 }, async () => {
  await withWorkspace(async ({ env, installDir }) => {
    await mkdir(installDir);
    await writeFile(join(installDir, "snipset.exe"), "someone else's exe\n");
    const code = [
      dotSource(MODE_PARTS),
      "$Version = ''; $InstallDir = $env:IDIR; $From = ''; $DryRun = $false; $AddPath = $false",
      "$fake = @{ raw = 'C:\\Tools' }",
      "function Test-SnipsetWindowsHost { $true }",
      "function Get-SnipsetUserPath { $fake.raw }",
      "function Set-SnipsetUserPath { param([string]$Raw) $fake.raw = $Raw }",
      "function Test-SnipsetBinary { param([string]$Path) $env:IS_SNIPSET -eq '1' }",
      "Invoke-SnipsetUninstall",
    ].join("\n");
    const foreign = await pwsh(["-Command", code], { ...env, IDIR: installDir, IS_SNIPSET: "0" });
    assert.equal(foreign.code, 0, foreign.stderr);
    assert.ok(lines(foreign.stdout).some((line) => line.startsWith("[KEEP] binary: ")), foreign.stdout);
    assert.equal(lines(foreign.stdout).at(-1), "uninstall: removed 0, kept 1");
    assert.ok(existsSync(join(installDir, "snipset.exe")));

    const ours = await pwsh(["-Command", code], { ...env, IDIR: installDir, IS_SNIPSET: "1" });
    assert.equal(ours.code, 0, ours.stderr);
    assert.equal(lines(ours.stdout).at(-1), "uninstall: removed 1, kept 0");
    assert.equal(existsSync(join(installDir, "snipset.exe")), false);
  });
});
