// install.ps1 MCP file probes (plan T10, the sibling of T08 in mcp.sh): only the "snipset"
// entry's own command makes a cursor, opencode, or vscode file count as registered, and on
// non-Windows the opencode and vscode files honour XDG_CONFIG_HOME.
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { cleanupSandbox, fakeWindowsRelease, installerPath, makeSandbox, stubCommand } from "./helpers/install-sandbox.mjs";
import { IDS, STUBS, mcpPaths, writeFile } from "./helpers/mcp-stubs.mjs";

const pwshPath = Bun.which("pwsh");
const pwshSkip = pwshPath ? false : "pwsh not on PATH";
const zipSkip = pwshSkip || (Bun.which("bsdtar") ? false : "bsdtar not on PATH");
// bun test prints a skipped test's name but not its reason, so say it once here.
if (zipSkip) console.warn(`skipping install.ps1 MCP probe tests: ${zipSkip}`);

const OPTS = { skip: zipSkip, timeout: 120000 };
const bundle = installerPath("ps1");
const cleanups = [];

afterEach(async () => {
  for (const fn of cleanups.splice(0)) await fn();
});

// pwsh 7.6 colours error records even when stderr is a pipe.
const stripAnsi = (text) => text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");

function results(stdout) {
  const re = new RegExp(`^\\[[A-Z]+\\] (${IDS.join("|")}): `);
  return stdout.split(/\r?\n/).filter((line) => re.test(line));
}

function setup() {
  const sb = makeSandbox();
  cleanups.push(() => cleanupSandbox(sb));
  const rel = fakeWindowsRelease({ version: "0.1.0" });
  cleanups.push(() => rmSync(rel.dir, { recursive: true, force: true }));
  stubCommand(sb, "code", STUBS.code({}));
  const installDir = join(sb.root, "install");
  const exe = join(installDir, "snipset.exe");
  // Arguments travel as an array through the environment, so no value needs PowerShell quoting.
  const run = (args, extraEnv = {}) => {
    const script = [
      "$ErrorActionPreference = 'Stop'",
      "$a = @(ConvertFrom-Json -InputObject $env:ARGS_JSON)",
      "$named = @{}; $i = 0",
      "while ($i -lt $a.Count) { $k = $a[$i].TrimStart('-'); if ($i + 1 -lt $a.Count -and -not $a[$i + 1].StartsWith('-')) { $named[$k] = $a[$i + 1]; $i += 2 } else { $named[$k] = $true; $i += 1 } }",
      "& $env:BUNDLE @named",
    ].join("\n");
    const env = sb.env({
      NO_COLOR: "1",
      SNIPSET_INSTALL_ALLOW_NON_WINDOWS: "1",
      SNIPSET_RELEASE_BASE_URL: "http://127.0.0.1:9",
      BUNDLE: bundle,
      ARGS_JSON: JSON.stringify([...args, "-InstallDir", installDir]),
      ...extraEnv,
    });
    return new Promise((resolve, reject) => {
      const child = spawn(pwshPath, ["-NoProfile", "-NonInteractive", "-Command", script], { env, cwd: sb.root, stdio: ["ignore", "pipe", "pipe"] });
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
  return { sb, rel, exe, paths: mcpPaths(sb), run };
}

const FILE_IDS = ["opencode", "cursor", "vscode"];

const siblingOnly = (bin) => ({
  opencode: `${JSON.stringify({ mcp: { "snipset-dev": { type: "local", command: [bin, "mcp", "--db", "/tmp/dev.db"] } } })}\n`,
  cursor: `${JSON.stringify({ mcpServers: { "snipset-dev": { command: bin, args: ["mcp", "--db", "/tmp/dev.db"] } } })}\n`,
  vscode: `${JSON.stringify({ servers: { "snipset-dev": { command: bin, args: ["mcp", "--db", "/tmp/dev.db"] } } })}\n`,
});

test("ps1 mcp probe: a file holding only snipset-dev with the installed binary is not registered", OPTS, async () => {
  const { exe, paths, rel, run } = setup();
  const files = siblingOnly(exe);
  for (const id of FILE_IDS) writeFile(paths[id], files[id]);
  const install = await run(["-From", rel.dir, "-WithMcp", "opencode,cursor"]);
  assert.equal(install.code, 0, install.stdout + install.stderr);
  assert.deepEqual(results(install.stdout), [
    `[KEEP] opencode: ${paths.opencode} exists; left untouched`,
    `[KEEP] cursor: ${paths.cursor} exists; left untouched`,
  ]);
  const check = await run(["-Check", "-WithMcp", FILE_IDS.join(",")]);
  assert.deepEqual(results(check.stdout), [
    `[KEEP] opencode: ${paths.opencode} exists without snipset; not managed by the installer`,
    `[KEEP] cursor: ${paths.cursor} exists without snipset; not managed by the installer`,
    "[MISSING] vscode: snipset is not registered",
  ]);
  const uninstall = await run(["-Uninstall", "-WithMcp", FILE_IDS.join(",")]);
  assert.equal(uninstall.code, 0, uninstall.stdout + uninstall.stderr);
  assert.deepEqual(
    results(uninstall.stdout),
    FILE_IDS.map((id) => `[SKIP] ${id}: snipset is not registered`),
  );
  for (const id of FILE_IDS) assert.equal(readFileSync(paths[id], "utf8"), files[id], id);
});

test("ps1 mcp probe: a snipset entry for another binary is foreign though a sibling runs the installed binary", OPTS, async () => {
  const { exe, paths, run } = setup();
  const files = {
    opencode: `${JSON.stringify({
      mcp: {
        snipset: { type: "local", command: ["/elsewhere/snipset", "mcp"] },
        "snipset-dev": { type: "local", command: [exe, "mcp"] },
      },
    })}\n`,
    cursor: `${JSON.stringify({
      mcpServers: {
        snipset: { command: "/elsewhere/snipset", args: ["mcp"] },
        "snipset-dev": { command: exe, args: ["mcp"] },
      },
    })}\n`,
    vscode: `${JSON.stringify({
      servers: {
        snipset: { command: "/elsewhere/snipset", args: ["mcp"] },
        "snipset-dev": { command: exe, args: ["mcp"] },
      },
    })}\n`,
  };
  for (const id of FILE_IDS) writeFile(paths[id], files[id]);
  const check = await run(["-Check", "-WithMcp", FILE_IDS.join(",")]);
  assert.deepEqual(
    results(check.stdout),
    FILE_IDS.map((id) => `[KEEP] ${id}: snipset points elsewhere`),
  );
  const uninstall = await run(["-Uninstall", "-WithMcp", FILE_IDS.join(",")]);
  assert.equal(uninstall.code, 0, uninstall.stdout + uninstall.stderr);
  assert.deepEqual(
    results(uninstall.stdout),
    FILE_IDS.map((id) => `[KEEP] ${id}: snipset points elsewhere`),
  );
  for (const id of FILE_IDS) assert.equal(readFileSync(paths[id], "utf8"), files[id], id);
});

test("ps1 mcp probe: a file that is not valid JSON is never registered and never rewritten", OPTS, async () => {
  const { exe, paths, run } = setup();
  const broken = `{"mcpServers":{"snipset":{"type":"stdio","command":${JSON.stringify(exe)},"args":["mcp"]}}\n`;
  writeFile(paths.cursor, broken);
  const check = await run(["-Check", "-WithMcp", "cursor"]);
  assert.deepEqual(results(check.stdout), ["[KEEP] cursor: snipset points elsewhere"]);
  const uninstall = await run(["-Uninstall", "-WithMcp", "cursor"]);
  assert.equal(uninstall.code, 0, uninstall.stdout + uninstall.stderr);
  assert.deepEqual(results(uninstall.stdout), ["[KEEP] cursor: snipset points elsewhere"]);
  assert.equal(readFileSync(paths.cursor, "utf8"), broken);
});

test("ps1 mcp probe: a pretty-printed snipset entry for the installed binary is still registered", OPTS, async () => {
  const { exe, paths, run } = setup();
  writeFile(paths.opencode, `${JSON.stringify({ mcp: { snipset: { type: "local", command: [exe, "mcp"] } } }, null, 2)}\n`);
  writeFile(paths.cursor, `${JSON.stringify({ mcpServers: { snipset: { command: exe, args: ["mcp"] } } }, null, 2)}\n`);
  writeFile(paths.vscode, `${JSON.stringify({ servers: { snipset: { command: exe, args: ["mcp"] } } }, null, 2)}\n`);
  const check = await run(["-Check", "-WithMcp", FILE_IDS.join(",")]);
  assert.deepEqual(
    results(check.stdout),
    FILE_IDS.map((id) => `[OK] ${id}: snipset points at ${exe}`),
  );
});

test("ps1 mcp probe: with XDG_CONFIG_HOME set on Linux, opencode is written under it and uninstall removes it", OPTS, async () => {
  const { sb, exe, rel, run } = setup();
  const xdg = join(sb.root, "xdg-config");
  const file = join(xdg, "opencode", "opencode.json");
  const env = { XDG_CONFIG_HOME: xdg };
  const install = await run(["-From", rel.dir, "-WithMcp", "opencode"], env);
  assert.equal(install.code, 0, install.stdout + install.stderr);
  assert.deepEqual(results(install.stdout), [`[ADD] opencode: wrote ${file}`]);
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")).mcp.snipset.command, [exe, "mcp"]);
  assert.ok(!existsSync(join(sb.home, ".config", "opencode")), "nothing is written under ~/.config");
  const check = await run(["-Check", "-WithMcp", "opencode"], env);
  assert.deepEqual(results(check.stdout), [`[OK] opencode: snipset points at ${exe}`]);
  const uninstall = await run(["-Uninstall", "-WithMcp", "opencode"], env);
  assert.equal(uninstall.code, 0, uninstall.stdout + uninstall.stderr);
  assert.deepEqual(results(uninstall.stdout), [`[REMOVED] opencode: ${file}`]);
  assert.ok(!existsSync(file));
});

test("ps1 mcp probe: an older opencode file under ~/.config is still found when XDG_CONFIG_HOME is set", OPTS, async () => {
  const { sb, exe, paths, rel, run } = setup();
  const xdg = join(sb.root, "xdg-config");
  const env = { XDG_CONFIG_HOME: xdg };
  assert.equal((await run(["-From", rel.dir])).code, 0);
  // The exact bytes the HEAD install.ps1 wrote with XDG_CONFIG_HOME unset (captured from a HEAD-only bundle).
  const legacy = `${JSON.stringify({ $schema: "https://opencode.ai/config.json", mcp: { snipset: { type: "local", command: [exe, "mcp"], enabled: true } } })}\n`;
  writeFile(paths.opencode, legacy);
  const install = await run(["-From", rel.dir, "-WithMcp", "opencode"], env);
  assert.equal(install.code, 0, install.stdout + install.stderr);
  assert.deepEqual(results(install.stdout), ["[KEEP] opencode: snipset is already registered"]);
  assert.ok(!existsSync(join(xdg, "opencode", "opencode.json")), "no second opencode file is written");
  assert.equal(readFileSync(paths.opencode, "utf8"), legacy);
  const check = await run(["-Check", "-WithMcp", "opencode"], env);
  assert.equal(check.code, 0, check.stdout + check.stderr);
  assert.deepEqual(results(check.stdout), [`[OK] opencode: snipset points at ${exe}`]);
  assert.ok(check.stdout.includes("check: CURRENT"), check.stdout);
  const uninstall = await run(["-Uninstall", "-WithMcp", "opencode"], env);
  assert.equal(uninstall.code, 0, uninstall.stdout + uninstall.stderr);
  assert.deepEqual(results(uninstall.stdout), [`[REMOVED] opencode: ${paths.opencode}`]);
  assert.ok(!existsSync(paths.opencode));
});

test("ps1 mcp probe: with XDG_CONFIG_HOME set on Linux, the vscode file is read from under it", OPTS, async () => {
  const { sb, exe, run } = setup();
  const xdg = join(sb.root, "xdg-config");
  writeFile(join(xdg, "Code", "User", "mcp.json"), `${JSON.stringify({ servers: { snipset: { command: exe, args: ["mcp"] } } })}\n`);
  const check = await run(["-Check", "-WithMcp", "vscode"], { XDG_CONFIG_HOME: xdg });
  assert.deepEqual(results(check.stdout), [`[OK] vscode: snipset points at ${exe}`]);
});
