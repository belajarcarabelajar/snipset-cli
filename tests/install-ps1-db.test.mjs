// install.ps1 -Database (plan T06, L7; -Db is the -Debug alias in PowerShell): forwarded to MCP install and uninstall, reported by -Check.
// No "snipset init" step exists on Windows, so the database file is only reported, never created.
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  cleanupSandbox,
  diffSnapshots,
  fakeWindowsRelease,
  installerPath,
  makeSandbox,
  snapshotTree,
  stubCommand,
} from "./helpers/install-sandbox.mjs";
import { STUBS, adds } from "./helpers/mcp-stubs.mjs";

const pwshPath = Bun.which("pwsh");
const pwshSkip = pwshPath ? false : "pwsh not on PATH";
const zipSkip = pwshSkip || (Bun.which("bsdtar") ? false : "bsdtar not on PATH");
// bun test prints a skipped test's name but not its reason, so say it once here.
if (zipSkip) console.warn(`skipping install.ps1 -Database tests: ${zipSkip}`);

const OPTS = { skip: zipSkip, timeout: 120000 };
const bundle = installerPath("ps1");
const cleanups = [];

afterEach(async () => {
  for (const fn of cleanups.splice(0)) await fn();
});

// pwsh 7.6 colours error records even when stderr is a pipe.
const stripAnsi = (text) => text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
const lines = (text) => text.split(/\r?\n/).filter((line) => line.trim() !== "");
// ConciseView wraps long error messages at the console width behind a `|` gutter, even inside a word.
const squash = (text) => text.replace(/[\s|]+/g, "");
const stderrHas = (r, needle) => squash(r.stderr).includes(squash(needle));
// pwsh writes its own startup cache under HOME; that is not the installer's doing.
// The parents count too: pwsh creates them on its first start in a fresh HOME.
const PWSH_STATE = /^home\/((\.cache|\.local\/share|\.config)\/powershell(\/|$)|(\.cache|\.local|\.local\/share|\.config)$)/;
const snapshot = (dir) => snapshotTree(dir).filter((entry) => !PWSH_STATE.test(entry.path) && !entry.path.startsWith("tmp/"));

function setup({ stubs = [] } = {}) {
  const sb = makeSandbox();
  cleanups.push(() => cleanupSandbox(sb));
  const rel = fakeWindowsRelease({ version: "0.1.0" });
  cleanups.push(() => rmSync(rel.dir, { recursive: true, force: true }));
  for (const name of stubs) stubCommand(sb, name, STUBS[name]({}));
  const installDir = join(sb.root, "install");
  const exe = join(installDir, "snipset.exe");
  const cursorFile = join(sb.home, ".cursor", "mcp.json");
  const env = (extra = {}) =>
    sb.env({
      NO_COLOR: "1",
      SNIPSET_INSTALL_ALLOW_NON_WINDOWS: "1",
      SNIPSET_RELEASE_BASE_URL: "http://127.0.0.1:9",
      BUNDLE: bundle,
      REL: rel.dir,
      IDIR: installDir,
      ...extra,
    });
  // Arguments travel as an array through the environment, so no value needs PowerShell quoting.
  const run = (args) => {
    const script = [
      "$ErrorActionPreference = 'Stop'",
      "$a = @(ConvertFrom-Json -InputObject $env:ARGS_JSON)",
      "$named = @{}; $i = 0",
      "while ($i -lt $a.Count) { $k = $a[$i].TrimStart('-'); if ($i + 1 -lt $a.Count -and -not $a[$i + 1].StartsWith('-')) { $named[$k] = $a[$i + 1]; $i += 2 } else { $named[$k] = $true; $i += 1 } }",
      "& $env:BUNDLE @named",
    ].join("\n");
    return pwsh(["-Command", script], env({ ARGS_JSON: JSON.stringify([...args, "-InstallDir", installDir]) }));
  };
  // The forms a user types: "pwsh -File install.ps1 ..." and a call inside a PowerShell session.
  const runFile = (args) => pwsh(["-File", bundle, ...args, "-InstallDir", installDir], env());
  const runCommand = (script) => pwsh(["-Command", script], env());
  const pwsh = (args, childEnv) => {
    return new Promise((resolve, reject) => {
      const child = spawn(pwshPath, ["-NoProfile", "-NonInteractive", ...args], { env: childEnv, cwd: sb.root, stdio: ["ignore", "pipe", "pipe"] });
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
  };
  return { sb, rel, installDir, exe, cursorFile, run, runFile, runCommand };
}

const BINDING_X = "A positional parameter cannot be found that accepts argument 'x'.";

const cursorJson = (bin, args) => `${JSON.stringify({ mcpServers: { snipset: { type: "stdio", command: bin, args } } })}\n`;

test("db: -Database X -WithMcp cursor writes mcp --db X into the cursor entry", OPTS, async () => {
  const { sb, rel, exe, cursorFile, run } = setup();
  const db = join(sb.root, "data", "snipset.db");
  const r = await run(["-From", rel.dir, "-WithMcp", "cursor", "-Database", db]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const text = readFileSync(cursorFile, "utf8");
  assert.ok(text.includes(`"args":["mcp","--db",${JSON.stringify(db)}]`), text);
  assert.equal(text, cursorJson(exe, ["mcp", "--db", db]));
  // No init step: the database file is reported later, never created by the installer.
  assert.equal(existsSync(db), false);
});

test("db: -Database X reaches the claude CLI through its stub as mcp --db X", OPTS, async () => {
  const { sb, rel, exe, run } = setup({ stubs: ["claude"] });
  const db = join(sb.root, "data", "snipset.db");
  const r = await run(["-From", rel.dir, "-WithMcp", "claude", "-Database", db]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.ok(lines(r.stdout).includes("[ADD] claude: snipset registered"), r.stdout);
  assert.deepEqual(adds(sb), [["claude", "mcp", "add", "--scope", "user", "snipset", "--", exe, "mcp", "--db", db]]);
});

test("db: the dry run names the database in the MCP plan line", OPTS, async () => {
  const { sb, rel, run } = setup();
  const db = join(sb.root, "data", "snipset.db");
  const before = snapshot(sb.root);
  const r = await run(["-DryRun", "-From", rel.dir, "-WithMcp", "cursor", "-Database", db]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const mcp = lines(r.stdout).filter((line) => line.startsWith("[DRY]") && /\bMCP\b/.test(line));
  assert.deepEqual(mcp, [`[DRY] register the snipset MCP server for cursor with --db ${db}`]);
  assert.deepEqual(diffSnapshots(before, snapshot(sb.root)), []);
});

test("db: check without -Database reports the CLI default as SKIP", OPTS, async () => {
  const { rel, run } = setup();
  assert.equal((await run(["-From", rel.dir])).code, 0);
  const r = await run(["-Check"]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.ok(lines(r.stdout).includes("[SKIP] database: the CLI default"), r.stdout);
});

test("db: check with -Database reports OK for an existing file and MISSING otherwise", OPTS, async () => {
  const { sb, rel, run } = setup();
  assert.equal((await run(["-From", rel.dir])).code, 0);
  const present = join(sb.root, "data", "snipset.db");
  mkdirSync(join(sb.root, "data"), { recursive: true });
  writeFileSync(present, "");
  const ok = await run(["-Check", "-Database", present]);
  assert.equal(ok.code, 0, ok.stdout + ok.stderr);
  assert.ok(lines(ok.stdout).includes(`[OK] database: ${present}`), ok.stdout);

  const absent = join(sb.root, "data", "absent.db");
  const missing = await run(["-Check", "-Database", absent]);
  assert.equal(missing.code, 1, missing.stdout + missing.stderr);
  assert.ok(lines(missing.stdout).includes(`[MISSING] database: ${absent}`), missing.stdout);
  assert.ok(stderrHas(missing, "check: DRIFT (1 items)"), missing.stderr);
  assert.equal(existsSync(absent), false);
});

test("db: uninstall with the same -Database removes the cursor entry it wrote", OPTS, async () => {
  const { sb, rel, cursorFile, run } = setup();
  const db = join(sb.root, "data", "snipset.db");
  assert.equal((await run(["-From", rel.dir, "-WithMcp", "cursor", "-Database", db])).code, 0);
  const r = await run(["-Uninstall", "-WithMcp", "cursor", "-Database", db]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.ok(lines(r.stdout).includes(`[REMOVED] cursor: ${cursorFile}`), r.stdout);
  assert.equal(existsSync(cursorFile), false);
});

test("db: uninstall with another -Database keeps the differing cursor entry", OPTS, async () => {
  const { sb, rel, exe, cursorFile, run } = setup();
  const db = join(sb.root, "data", "snipset.db");
  assert.equal((await run(["-From", rel.dir, "-WithMcp", "cursor", "-Database", db])).code, 0);
  const r = await run(["-Uninstall", "-WithMcp", "cursor", "-Database", join(sb.root, "data", "other.db")]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.ok(lines(r.stdout).includes(`[KEEP] cursor: ${cursorFile} differs from what the installer writes; remove snipset by hand`), r.stdout);
  assert.equal(readFileSync(cursorFile, "utf8"), cursorJson(exe, ["mcp", "--db", db]));
});

test("db: a -Database value holding a double quote throws before any write in every mode", OPTS, async () => {
  const { rel, sb, exe, cursorFile, run } = setup();
  const bad = 'a"b';
  const refusal = 'install.ps1: the database path must not contain " (got a"b)';
  const empty = snapshot(sb.root);
  for (const args of [["-From", rel.dir, "-WithMcp", "cursor"], ["-Update", "-From", rel.dir, "-WithMcp", "cursor"]]) {
    const r = await run([...args, "-Database", bad]);
    assert.equal(r.code, 1, `${args.join(" ")}: ${r.stdout}${r.stderr}`);
    assert.ok(stderrHas(r, refusal), r.stderr);
    assert.deepEqual(diffSnapshots(empty, snapshot(sb.root)), [], args.join(" "));
  }

  assert.equal((await run(["-From", rel.dir, "-WithMcp", "cursor"])).code, 0);
  const installed = snapshot(sb.root);
  for (const args of [["-Uninstall", "-WithMcp", "cursor"], ["-Check", "-WithMcp", "cursor"]]) {
    const r = await run([...args, "-Database", bad]);
    assert.equal(r.code, 1, `${args.join(" ")}: ${r.stdout}${r.stderr}`);
    assert.ok(stderrHas(r, refusal), r.stderr);
    assert.deepEqual(diffSnapshots(installed, snapshot(sb.root)), [], args.join(" "));
  }
  assert.ok(existsSync(exe));
  assert.ok(existsSync(cursorFile));
});

test("db: -Db x is the -Debug alias plus a stray value and fails binding before any write", OPTS, async () => {
  const { sb, rel, exe, cursorFile, runFile, runCommand } = setup();
  const before = snapshot(sb.root);
  const results = [
    ["-File", await runFile(["-From", rel.dir, "-WithMcp", "cursor", "-Db", "x"])],
    ["-Command", await runCommand("& $env:BUNDLE -From $env:REL -WithMcp cursor -InstallDir $env:IDIR -Db x")],
  ];
  for (const [form, r] of results) {
    assert.notEqual(r.code, 0, `${form}: ${r.stdout}${r.stderr}`);
    assert.ok(stderrHas(r, BINDING_X), `${form}: ${r.stderr}`);
    assert.equal(r.stdout.trim(), "", `${form}: ${r.stdout}`);
  }
  assert.equal(existsSync(exe), false);
  assert.equal(existsSync(cursorFile), false);
  assert.deepEqual(diffSnapshots(before, snapshot(sb.root)), []);
});

test("db: a positional value fails binding before any write", OPTS, async () => {
  const { sb, exe, cursorFile, runCommand } = setup();
  const before = snapshot(sb.root);
  const r = await runCommand("& $env:BUNDLE x -From $env:REL -WithMcp cursor -InstallDir $env:IDIR");
  assert.notEqual(r.code, 0, r.stdout + r.stderr);
  assert.ok(stderrHas(r, BINDING_X), r.stderr);
  assert.equal(r.stdout.trim(), "", r.stdout);
  assert.equal(existsSync(exe), false);
  assert.equal(existsSync(cursorFile), false);
  assert.deepEqual(diffSnapshots(before, snapshot(sb.root)), []);
});

test("db: Get-Help -Full lists -Database with a description",{ skip: pwshSkip, timeout: 60000 }, async () => {
  const sb = makeSandbox();
  cleanups.push(() => cleanupSandbox(sb));
  const script = "$h = Get-Help -Full -Name $env:BUNDLE; @($h.parameters.parameter | Where-Object { $_.name -eq 'Database' } | ForEach-Object { ($_.description | Out-String).Trim() }) | ConvertTo-Json -Compress";
  const r = await new Promise((resolve, reject) => {
    const child = spawn(pwshPath, ["-NoProfile", "-NonInteractive", "-Command", script], { env: sb.env({ NO_COLOR: "1", BUNDLE: bundle }), stdio: ["ignore", "pipe", "pipe"] });
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
    child.on("close", (code) => resolve({ code, stdout, stderr: stripAnsi(stderr) }));
  });
  assert.equal(r.code, 0, r.stderr);
  const desc = [JSON.parse(r.stdout || "[]")].flat();
  assert.equal(desc.length, 1, `expected one -Database parameter in the help, got ${r.stdout}`);
  assert.match(desc[0], /--db/);
});
