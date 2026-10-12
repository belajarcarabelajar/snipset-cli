import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanupSandbox, DEFAULT_TOOLS, installerPath, makeSandbox, runInstaller } from "./helpers/install-sandbox.mjs";

// Runs only against real release assets: SNIPSET_REAL_ASSETS names a `gh release download` directory.
const assets = process.env.SNIPSET_REAL_ASSETS || "";
const repo = join(import.meta.dir, "..");
const version = readFileSync(join(repo, "packaging", "VERSION"), "utf8").trim();
const linuxAsset = `snipset-cli-v${version}-x86_64-unknown-linux-gnu.tar.gz`;
const windowsAsset = `snipset-cli-v${version}-x86_64-pc-windows-msvc.zip`;
if (!assets) console.log("install-real-assets: skipped, set SNIPSET_REAL_ASSETS to a gh release download directory");

const temps = [];
afterEach(async () => {
  while (temps.length > 0) await rm(temps.pop(), { recursive: true, force: true });
});

function tempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

describe.skipIf(!assets)("real release assets", () => {
  test("the asset directory holds SHA256SUMS and both archives with matching digests", () => {
    for (const name of ["SHA256SUMS", linuxAsset, windowsAsset]) expect(existsSync(join(assets, name))).toBe(true);
    const sums = readFileSync(join(assets, "SHA256SUMS"), "utf8");
    expect(sums).toBe(readFileSync(join(repo, "packaging", "SHA256SUMS"), "utf8"));
    for (const name of [linuxAsset, windowsAsset]) expect(sums).toContain(`${sha256(join(assets, name))}  ${name}`);
  });

  test("install.sh --from installs, checks, and uninstalls the real binary in a sandbox HOME", async () => {
    const sb = makeSandbox({ tools: [...DEFAULT_TOOLS, "getconf", "ldd"] });
    try {
      const bin = join(sb.home, ".local", "bin");
      const flags = ["--install-dir", bin, "--add-path"];
      const install = await runInstaller(sb, ["--from", assets, ...flags]);
      expect(install.code).toBe(0);
      expect(install.stdout).toContain(`Installed snipset v${version}`);
      const run = spawnSync(join(bin, "snipset"), ["--version"], { encoding: "utf8", env: sb.env() });
      expect(run.stdout.trim()).toBe(`snipset ${version}`);
      const check = await runInstaller(sb, ["--check", ...flags]);
      expect(check.code).toBe(0);
      expect(check.stdout).toContain("check: CURRENT");
      const uninstall = await runInstaller(sb, ["--uninstall", ...flags]);
      expect(uninstall.code).toBe(0);
      expect(existsSync(join(bin, "snipset"))).toBe(false);
      const after = await runInstaller(sb, ["--check", ...flags]);
      expect(after.code).toBe(1);
    } finally {
      await cleanupSandbox(sb);
    }
  });

  const pwsh = Bun.which("pwsh");
  test.skipIf(!pwsh)("install.ps1 -From places the real snipset.exe byte for byte", () => {
    const root = tempDir("snipset-real-ps1-");
    const home = join(root, "home");
    const dest = join(root, "bin");
    const unpacked = join(root, "unpacked");
    for (const dir of [home, unpacked]) mkdirSync(dir);
    const env = { PATH: process.env.PATH, HOME: home, TMPDIR: root, NO_COLOR: "1", POWERSHELL_TELEMETRY_OPTOUT: "1", SNIPSET_INSTALL_ALLOW_NON_WINDOWS: "1" };
    const result = spawnSync(pwsh, ["-NoProfile", "-NonInteractive", "-File", installerPath("ps1"), "-From", assets, "-InstallDir", dest], { encoding: "utf8", env });
    expect(result.status, result.stderr).toBe(0);
    expect(spawnSync("bsdtar", ["-xf", join(assets, windowsAsset), "-C", unpacked]).status).toBe(0);
    expect(sha256(join(dest, "snipset.exe"))).toBe(sha256(join(unpacked, "snipset.exe")));
  });

  const makepkg = ["/usr/bin/makepkg", "/usr/bin/fakeroot", "/usr/bin/bsdtar"].every((path) => existsSync(path));
  test.skipIf(!makepkg)("makepkg builds the AUR package from the real tarball and its binary runs", () => {
    const root = tempDir("snipset-real-aur-");
    const env = { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C", TMPDIR: join(root, "tmp") };
    mkdirSync(env.TMPDIR);
    for (const key of ["HOME", "PKGDEST", "SRCDEST", "SRCPKGDEST", "LOGDEST", "BUILDDIR"]) {
      env[key] = join(root, key.toLowerCase());
      mkdirSync(env[key]);
    }
    const work = join(root, "work");
    mkdirSync(work);
    const pkgbuild = readFileSync(join(repo, "packaging", "aur", "snipset-cli", "PKGBUILD"), "utf8");
    const local = pkgbuild.replace(/::https:\/\/[^"]+/, `::file://${join(assets, linuxAsset)}`);
    expect(local).not.toBe(pkgbuild);
    writeFileSync(join(work, "PKGBUILD"), local);
    const build = spawnSync("/usr/bin/makepkg", ["--nodeps", "--noconfirm", "--noprogressbar", "-f"], { cwd: work, env, encoding: "utf8" });
    expect(build.status, build.stderr).toBe(0);
    const pkg = readdirSync(env.PKGDEST).find((name) => name.endsWith(".pkg.tar.zst"));
    expect(pkg).toBeDefined();
    const extracted = join(root, "pkg");
    mkdirSync(extracted);
    expect(spawnSync("/usr/bin/bsdtar", ["-xf", join(env.PKGDEST, pkg), "-C", extracted]).status).toBe(0);
    for (const path of ["usr/bin/snipset", "usr/bin/snipset-shims", "usr/share/bash-completion/completions/snipset.bash", "usr/share/licenses/snipset-cli/LICENSE"]) {
      expect(existsSync(join(extracted, path))).toBe(true);
    }
    const run = spawnSync(join(extracted, "usr", "bin", "snipset"), ["--version"], { encoding: "utf8", env: { PATH: "/usr/bin:/bin", HOME: env.HOME } });
    expect(run.stdout.trim()).toBe(`snipset ${version}`);
  });
});
