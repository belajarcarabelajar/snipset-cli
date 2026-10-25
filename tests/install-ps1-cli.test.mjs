import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { installerPath } from "./helpers/install-sandbox.mjs";

const pwshSkip = Bun.which("pwsh") ? false : "pwsh not on PATH";
// bun test prints a skipped test's name but not its reason, so say it once here.
if (pwshSkip) console.warn(`skipping install.ps1 CLI tests: ${pwshSkip}`);

const bundle = installerPath("ps1");
const libPart = process.env.SNIPSET_PS1_LIB ?? fileURLToPath(new URL("../scripts/installer/ps1/lib.ps1", import.meta.url));
const ALL_MCP = ["claude", "codex", "gemini", "opencode", "cursor", "vscode"];
const PARAMS = ["Version", "InstallDir", "AddPath", "WithMcp", "From", "DryRun", "Check", "Update", "Uninstall", "Database"];
const USAGE = "use only one of -Check, -Update, -Uninstall";
const DRY_END = "dry run: nothing was written";

async function withWorkspace(fn) {
  const root = await mkdtemp(join(tmpdir(), "snipset-ps1-cli-test-"));
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
    delete env.LOCALAPPDATA;
    delete env.XDG_CONFIG_HOME;
    Object.assign(env, {
      HOME: home,
      TMPDIR: tmp,
      // pwsh sends startup telemetry unless this is set before the process starts.
      POWERSHELL_TELEMETRY_OPTOUT: "1",
      NO_COLOR: "1",
      SNIPSET_INSTALL_ALLOW_NON_WINDOWS: "1",
      SNIPSET_RELEASE_BASE_URL: `http://127.0.0.1:${server.port}`,
    });
    await fn({ root, home, tmp, installDir: join(root, "bin"), env, requests: () => requests });
  } finally {
    server.stop(true);
    await rm(root, { recursive: true, force: true });
  }
}

// pwsh 7.6 colours error records even when stderr is a pipe.
const stripAnsi = (text) => text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");

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

const runFile = (args, env) => pwsh(["-File", bundle, ...args], env);
const lines = (text) => text.split(/\r?\n/).filter((line) => line.trim() !== "");
const mcpDryLines = (stdout) => lines(stdout).filter((line) => line.startsWith("[DRY]") && /\bMCP\b/.test(line));

async function stagedLeftovers(tmp) {
  return (await readdir(tmp)).filter((name) => name.startsWith("snipset-install-"));
}

test("Get-Help -Full lists every parameter with a description and two examples", { skip: pwshSkip, timeout: 60000 }, async () => {
  await withWorkspace(async ({ env }) => {
    const script = [
      "$h = Get-Help -Full -Name $env:BUNDLE",
      "[pscustomobject]@{",
      "  synopsis = [string]$h.Synopsis",
      "  params = @($h.parameters.parameter | ForEach-Object { [pscustomobject]@{ name = [string]$_.name; desc = ($_.description | Out-String).Trim() } })",
      "  examples = @($h.examples.example).Count",
      "} | ConvertTo-Json -Depth 4 -Compress",
    ].join("\n");
    const r = await pwsh(["-Command", script], { ...env, BUNDLE: bundle });
    assert.equal(r.code, 0, r.stderr);
    const help = JSON.parse(r.stdout);
    assert.match(help.synopsis, /snipset/i);
    assert.doesNotMatch(help.synopsis, /\[-Version\]/, "expected a written .SYNOPSIS, not the generated syntax line");
    assert.deepEqual(help.params.map((p) => p.name).sort(), [...PARAMS].sort());
    for (const p of help.params) assert.ok(p.desc.length > 0, `expected a .PARAMETER description for -${p.name}`);
    assert.equal(help.examples, 2);
  });
});

for (const pair of [["-Check", "-Update"], ["-Update", "-Uninstall"], ["-Check", "-Uninstall"]]) {
  test(`${pair.join(" ")} fails with the usage message and writes nothing`, { skip: pwshSkip, timeout: 60000 }, async () => {
    await withWorkspace(async ({ env, installDir, requests }) => {
      const r = await runFile([...pair, "-Version", "v0.1.0", "-InstallDir", installDir], env);
      assert.equal(r.code, 1, r.stdout + r.stderr);
      assert.ok(r.stderr.includes(USAGE), `expected the usage message, got: ${r.stderr}`);
      assert.equal(existsSync(installDir), false);
      assert.equal(requests(), 0);
    });
  });
}

test("-WithMcp bogus fails and names the unknown id", { skip: pwshSkip, timeout: 60000 }, async () => {
  await withWorkspace(async ({ env, installDir, requests }) => {
    const r = await runFile(["-DryRun", "-Version", "v0.1.0", "-InstallDir", installDir, "-WithMcp", "claude,bogus"], env);
    assert.equal(r.code, 1, r.stdout + r.stderr);
    assert.ok(r.stderr.includes("unknown MCP id bogus"), `expected the unknown id in stderr, got: ${r.stderr}`);
    assert.equal(requests(), 0);
  });
});

test("-DryRun -Version v0.1.0 prints [DRY] steps, writes nothing, and makes no request", { skip: pwshSkip, timeout: 60000 }, async () => {
  await withWorkspace(async ({ env, tmp, installDir, requests }) => {
    const r = await runFile(["-DryRun", "-Version", "v0.1.0", "-InstallDir", installDir, "-AddPath"], env);
    assert.equal(r.code, 0, r.stderr);
    const out = lines(r.stdout);
    const dry = out.filter((line) => line.startsWith("[DRY] "));
    assert.ok(dry.length >= 3, `expected one [DRY] line per step, got:\n${r.stdout}`);
    assert.ok(dry.some((line) => line.includes("snipset-cli-v0.1.0-x86_64-pc-windows-msvc.zip")), r.stdout);
    assert.ok(dry.some((line) => line.includes("PATH")), `expected a [DRY] PATH step for -AddPath:\n${r.stdout}`);
    assert.equal(out.at(-1), DRY_END);
    assert.doesNotMatch(r.stdout, /Installed snipset/);
    assert.equal(existsSync(installDir), false, "expected the install dir to stay absent");
    assert.deepEqual(await stagedLeftovers(tmp), []);
    assert.equal(requests(), 0);
  });
});

test("-DryRun -WithMcp claude,codex names both ids", { skip: pwshSkip, timeout: 60000 }, async () => {
  await withWorkspace(async ({ env, installDir }) => {
    const r = await runFile(["-DryRun", "-Version", "v0.1.0", "-InstallDir", installDir, "-WithMcp", "claude,codex"], env);
    assert.equal(r.code, 0, r.stderr);
    const mcp = mcpDryLines(r.stdout);
    assert.equal(mcp.length, 2, r.stdout);
    assert.match(mcp[0], /\bclaude\b/);
    assert.match(mcp[1], /\bcodex\b/);
  });
});

test("-WithMcp accepts several strings in a PowerShell call", { skip: pwshSkip, timeout: 60000 }, async () => {
  await withWorkspace(async ({ env, installDir }) => {
    const script = "& $env:BUNDLE -DryRun -Version v0.1.0 -InstallDir $env:IDIR -WithMcp 'claude', 'codex,gemini'";
    const r = await pwsh(["-Command", script], { ...env, BUNDLE: bundle, IDIR: installDir });
    assert.equal(r.code, 0, r.stderr);
    const mcp = mcpDryLines(r.stdout);
    assert.deepEqual(mcp.map((line) => ALL_MCP.find((id) => new RegExp(`\\b${id}\\b`).test(line))), ["claude", "codex", "gemini"]);
  });
});

test("-WithMcp all names the six ids", { skip: pwshSkip, timeout: 60000 }, async () => {
  await withWorkspace(async ({ env, installDir, requests }) => {
    const r = await runFile(["-DryRun", "-Version", "v0.1.0", "-InstallDir", installDir, "-WithMcp", "all"], env);
    assert.equal(r.code, 0, r.stderr);
    const mcp = mcpDryLines(r.stdout);
    assert.deepEqual(mcp.map((line) => ALL_MCP.find((id) => new RegExp(`\\b${id}\\b`).test(line))), ALL_MCP);
    assert.equal(requests(), 0);
  });
});

test("the README scriptblock one-liner leaves the caller's $target and $Version unchanged", { skip: pwshSkip, timeout: 60000 }, async () => {
  await withWorkspace(async ({ env, installDir }) => {
    const script = [
      "$target = 'caller-target'",
      "$Version = 'caller-version'",
      "& ([scriptblock]::Create((Get-Content -Raw $env:BUNDLE))) -DryRun -Version v0.1.0 -InstallDir $env:IDIR -WithMcp all",
      "& ([scriptblock]::Create((Get-Content -Raw $env:BUNDLE))) -DryRun -Version v0.1.0 -InstallDir $env:IDIR",
      "\"after: $target|$Version|$([bool](Get-Variable -Name run -ErrorAction SilentlyContinue))\"",
    ].join("\n");
    const r = await pwsh(["-Command", script], { ...env, BUNDLE: bundle, IDIR: installDir });
    assert.equal(r.code, 0, r.stderr);
    const out = lines(r.stdout);
    assert.equal(out.at(-1), "after: caller-target|caller-version|False");
    assert.equal(out.filter((line) => line === DRY_END).length, 2, r.stdout);
    assert.equal(mcpDryLines(r.stdout).length, 6, "expected the second run to name no MCP id");
    assert.equal(existsSync(installDir), false);
  });
});

test("without -InstallDir a missing LOCALAPPDATA fails with a clear message", { skip: pwshSkip, timeout: 60000 }, async () => {
  await withWorkspace(async ({ env }) => {
    const r = await runFile(["-DryRun", "-Version", "v0.1.0"], env);
    assert.equal(r.code, 1, r.stdout + r.stderr);
    assert.ok(r.stderr.includes("LOCALAPPDATA is not set"), `expected the LOCALAPPDATA message, got: ${r.stderr}`);
  });
});

test("without -InstallDir the dry run targets LOCALAPPDATA\\Snipset\\bin", { skip: pwshSkip, timeout: 60000 }, async () => {
  await withWorkspace(async ({ env, root }) => {
    const local = join(root, "localappdata");
    const r = await runFile(["-DryRun", "-Version", "v0.1.0"], { ...env, LOCALAPPDATA: local });
    assert.equal(r.code, 0, r.stderr);
    assert.ok(lines(r.stdout).some((line) => line.startsWith("[DRY] ") && line.includes(join(local, "Snipset"))), r.stdout);
    assert.equal(existsSync(local), false);
  });
});

test("lib.ps1 dot-sources without LOCALAPPDATA and Write-SnipsetReport counts into the caller's $run", { skip: pwshSkip, timeout: 60000 }, async () => {
  await withWorkspace(async ({ env }) => {
    const script = [
      ". $env:LIB_PART",
      "function Invoke-Probe {",
      "  $run = @{ drift = 0; kept = 0; removed = 0; fail = 0 }",
      "  foreach ($s in 'MISSING', 'DRIFT', 'KEEP', 'REMOVED', 'FAIL', 'OK', 'SKIP') { Write-SnipsetReport -Status $s -Item 'probe' -Detail $s.ToLowerInvariant() }",
      "  \"counts: $($run.drift) $($run.kept) $($run.removed) $($run.fail)\"",
      "}",
      "Invoke-Probe",
      "Write-SnipsetReport -Status KEEP -Item 'loose' -Detail 'no run table'",
    ].join("\n");
    const r = await pwsh(["-Command", script], { ...env, LIB_PART: libPart });
    assert.equal(r.code, 0, r.stderr);
    const out = lines(r.stdout);
    assert.equal(out[0], "[MISSING] probe: missing");
    assert.ok(out.includes("counts: 2 1 1 1"), r.stdout);
    assert.equal(out.at(-1), "[KEEP] loose: no run table");
  });
});
