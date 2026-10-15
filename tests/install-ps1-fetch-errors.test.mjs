import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { installerPath } from "./helpers/install-sandbox.mjs";

const pwshSkip = Bun.which("pwsh") ? false : "pwsh not on PATH";
// bun test prints a skipped test's name but not its reason, so say it once here.
if (pwshSkip) console.warn(`skipping install.ps1 fetch error tests: ${pwshSkip}`);

const installScript = installerPath("ps1");
const target = "x86_64-pc-windows-msvc";
// The body api.github.com returns for a repository with no published release.
const githubNotFound = JSON.stringify({
  message: "Not Found",
  documentation_url: "https://docs.github.com/rest/releases/releases#get-the-latest-release",
  status: "404",
});

async function withWorkspace(fn) {
  const root = await mkdtemp(join(tmpdir(), "snipset-ps1-fetch-errors-"));
  try {
    const dirs = {};
    for (const name of ["home", "appdata", "localappdata", "config", "data", "cache", "state", "tmp", "assets"]) {
      dirs[name] = join(root, name);
      await mkdir(dirs[name]);
    }
    const env = {
      PATH: process.env.PATH,
      HOME: dirs.home,
      USERPROFILE: dirs.home,
      APPDATA: dirs.appdata,
      LOCALAPPDATA: dirs.localappdata,
      XDG_CONFIG_HOME: dirs.config,
      XDG_DATA_HOME: dirs.data,
      XDG_CACHE_HOME: dirs.cache,
      XDG_STATE_HOME: dirs.state,
      TMPDIR: dirs.tmp,
      // pwsh sends startup telemetry unless this is set before the process starts.
      POWERSHELL_TELEMETRY_OPTOUT: "1",
      SNIPSET_INSTALL_ALLOW_NON_WINDOWS: "1",
    };
    await fn({ root, dirs, env, bin: join(root, "bin") });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function runPwsh(args, env) {
  const proc = Bun.spawn(["pwsh", "-NoProfile", "-NonInteractive", ...args], { env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, out: stdout + stderr };
}

test("ps1 fetch errors: -Version V0.2.0 is refused as an invalid version", { skip: pwshSkip, timeout: 90000 }, async () => {
  await withWorkspace(async ({ dirs, env, bin }) => {
    const archive = `snipset-cli-v0.2.0-${target}.zip`;
    await writeFile(join(dirs.assets, archive), "zip fixture\n");
    await writeFile(join(dirs.assets, "SHA256SUMS"), `${"0".repeat(64)}  ${archive}\n`);
    const { code, out } = await runPwsh(
      ["-File", installScript, "-DryRun", "-Version", "V0.2.0", "-From", dirs.assets, "-InstallDir", bin],
      env,
    );
    assert.notEqual(code, 0, `expected a non-zero exit, got 0: ${out}`);
    assert.match(out, /install\.ps1: invalid version/, `expected the invalid version message, got: ${out}`);
  });
});

test("ps1 fetch errors: a 404 latest lookup reports the installer message with the HTTP status", { skip: pwshSkip, timeout: 90000 }, async () => {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response(githubNotFound, { status: 404, headers: { "content-type": "application/json" } }),
  });
  try {
    await withWorkspace(async ({ env, bin }) => {
      // The lookup URL is fixed to api.github.com, so a caller-scope function redirects it to the loopback server.
      const script = [
        `function Invoke-RestMethod { param($Uri) Microsoft.PowerShell.Utility\\Invoke-RestMethod -Uri ('http://127.0.0.1:${server.port}' + ([uri]$Uri).AbsolutePath) }`,
        `try { & $env:SNIPSET_TEST_PS1 -DryRun -InstallDir $env:SNIPSET_TEST_BIN; exit 0 }`,
        // ToString() prefers ErrorDetails, which is where pwsh keeps the raw response body a user would see.
        `catch { [Console]::Error.WriteLine($_.ToString()); exit 1 }`,
      ].join("\n");
      const { code, out } = await runPwsh(
        ["-Command", script],
        { ...env, SNIPSET_TEST_PS1: installScript, SNIPSET_TEST_BIN: bin },
      );
      assert.notEqual(code, 0, `expected a non-zero exit, got 0: ${out}`);
      assert.match(out, /install\.ps1: release version was not found/, `expected the installer message, got: ${out}`);
      assert.match(out, /404/, `expected the HTTP status in the message, got: ${out}`);
      assert.doesNotMatch(out, /documentation_url/, `expected no raw GitHub JSON, got: ${out}`);
    });
  } finally {
    server.stop(true);
  }
});
