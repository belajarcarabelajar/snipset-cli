import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { installerPath } from "./helpers/install-sandbox.mjs";

const run = promisify(execFile);

const pwshSkip = Bun.which("pwsh") ? false : "pwsh not on PATH";
// bun test prints a skipped test's name but not its reason, so say it once here.
if (pwshSkip) console.warn(`skipping install.ps1 Linux run: ${pwshSkip}`);

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const installScript = installerPath("ps1");
const version = "v0.1.0";
const archiveName = `snipset-cli-${version}-x86_64-pc-windows-msvc.zip`;
// pwsh sends startup telemetry unless this is set before the process starts.
const pwshEnv = { ...process.env, POWERSHELL_TELEMETRY_OPTOUT: "1", SNIPSET_INSTALL_ALLOW_NON_WINDOWS: "1" };

async function withWorkspace(fn) {
  const root = await mkdtemp(join(tmpdir(), "snipset-install-ps1-test-"));
  try {
    const tmp = join(root, "tmp");
    const bin = join(root, "bin");
    await mkdir(tmp);
    const payload = join(root, "payload");
    await mkdir(payload);
    await writeFile(join(payload, "snipset.exe"), "fake snipset binary\n");
    const zip = join(root, archiveName);
    await run("pwsh", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Compress-Archive -LiteralPath $env:ZIP_SOURCE -DestinationPath $env:ZIP_DEST",
    ], { env: { ...pwshEnv, ZIP_SOURCE: join(payload, "snipset.exe"), ZIP_DEST: zip } });
    await fn({ root, tmp, bin, zip: await readFile(zip) });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function withReleaseServer(sums, zip, fn) {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req) {
      const { pathname } = new URL(req.url);
      if (pathname === `/${version}/SHA256SUMS`) return new Response(sums);
      if (pathname === `/${version}/${archiveName}`) return new Response(zip);
      return new Response("not found", { status: 404 });
    },
  });
  try {
    await fn(`http://127.0.0.1:${server.port}`);
  } finally {
    server.stop(true);
  }
}

function runInstaller(baseUrl, tmp, bin) {
  return run("pwsh", [
    "-NoProfile",
    "-NonInteractive",
    "-File", installScript,
    "-Version", version,
    "-InstallDir", bin,
  ], { env: { ...pwshEnv, SNIPSET_RELEASE_BASE_URL: baseUrl, TMPDIR: tmp } });
}

async function entriesWithPrefix(dir, prefix) {
  const names = await readdir(dir).catch((err) => (err.code === "ENOENT" ? [] : Promise.reject(err)));
  return names.filter((name) => name.startsWith(prefix));
}

test("install.ps1 installs snipset.exe from a verified release and leaves no temp or stage dirs", { skip: pwshSkip, timeout: 60000 }, async () => {
  await withWorkspace(async ({ tmp, bin, zip }) => {
    const hex = createHash("sha256").update(zip).digest("hex");
    await withReleaseServer(`${hex}  ${archiveName}\n`, zip, async (baseUrl) => {
      const { stdout } = await runInstaller(baseUrl, tmp, bin);
      assert.match(stdout, /Installed snipset v0\.1\.0/);
    });
    assert.ok((await stat(join(bin, "snipset.exe"))).isFile(), "expected snipset.exe in the install dir");
    assert.deepEqual(await entriesWithPrefix(tmp, "snipset-install-"), [], "expected no snipset-install-* left in TMPDIR");
    assert.deepEqual(await entriesWithPrefix(bin, ".snipset-stage-"), [], "expected no .snipset-stage-* left in the install dir");
  });
});

test("install.ps1 rejects an archive whose checksum does not match SHA256SUMS", { skip: pwshSkip, timeout: 60000 }, async () => {
  await withWorkspace(async ({ tmp, bin, zip }) => {
    await withReleaseServer(`${"0".repeat(64)}  ${archiveName}\n`, zip, async (baseUrl) => {
      const err = await runInstaller(baseUrl, tmp, bin).then(
        () => assert.fail("expected install.ps1 to exit non-zero on a checksum mismatch"),
        (error) => error,
      );
      assert.notEqual(err.code, 0);
      assert.ok(err.stderr.includes("checksum mismatch"), `expected checksum mismatch in stderr, got: ${err.stderr}`);
    });
    assert.deepEqual(await entriesWithPrefix(tmp, "snipset-install-"), [], "expected no snipset-install-* left in TMPDIR");
    assert.deepEqual(await entriesWithPrefix(bin, "snipset.exe"), [], "expected nothing installed after a checksum mismatch");
  });
});

test("install.Tests.ps1 contract checks pass against install.ps1", { skip: pwshSkip, timeout: 60000 }, async () => {
  const { stdout } = await run("pwsh", [
    "-NoProfile",
    "-NonInteractive",
    "-File", "tests/install.Tests.ps1",
  ], { cwd: repoRoot, env: pwshEnv });
  assert.match(stdout, /^PowerShell installer contract passed$/m);
});
