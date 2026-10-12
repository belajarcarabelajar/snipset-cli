import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, sep } from "node:path";
import { fakeLinuxRelease } from "./helpers/install-sandbox.mjs";

const repo = join(import.meta.dir, "..");
const RENDER = join(repo, "scripts", "packaging", "render.mjs");
const PKG_DIR = join(repo, "packaging", "aur", "snipset-cli");
const PKGBUILD = join(PKG_DIR, "PKGBUILD");
const SRCINFO = join(PKG_DIR, ".SRCINFO");

const VERSION = readFileSync(join(repo, "packaging", "VERSION"), "utf8").trim();
const LINUX_ASSET = `snipset-cli-v${VERSION}-x86_64-unknown-linux-gnu.tar.gz`;
const SOURCE_URL =
  "https://github.com/belajarcarabelajar/snipset-cli/releases/download/v$pkgver/snipset-cli-v$pkgver-x86_64-unknown-linux-gnu.tar.gz";
const SOURCE_NAME = `snipset-cli-${VERSION}-x86_64.tar.gz`;

const INSTALLED = {
  "usr/bin/snipset": "-rwxr-xr-x",
  "usr/bin/snipset-shims": "-rwxr-xr-x",
  "usr/share/bash-completion/completions/snipset.bash": "-rw-r--r--",
  "usr/share/snipset-cli/snipset.sh": "-rw-r--r--",
  "usr/share/snipset-cli/tab.sh": "-rw-r--r--",
  "usr/share/licenses/snipset-cli/LICENSE": "-rw-r--r--",
};

const HOST_DIRS = ["/usr/bin", "/bin"];
const HOST_PATH = HOST_DIRS.join(":");
const MAKEPKG_DIRS = ["HOME", "PKGDEST", "SRCDEST", "SRCPKGDEST", "LOGDEST", "BUILDDIR"];

function tool(name) {
  for (const dir of HOST_DIRS) {
    const path = join(dir, name);
    if (existsSync(path)) return path;
  }
  return null;
}

const makepkgMissing = ["makepkg", "fakeroot"].filter((name) => !tool(name));
const buildMissing = [...makepkgMissing, ...(tool("bsdtar") ? [] : ["bsdtar"])];
if (makepkgMissing.length > 0) {
  console.log(`packaging-aur: skipping makepkg cases, not found in ${HOST_PATH}: ${makepkgMissing.join(", ")}`);
}
if (!tool("shellcheck")) console.log(`packaging-aur: skipping the shellcheck case, shellcheck not found in ${HOST_PATH}`);

const temps = [];
afterEach(async () => {
  while (temps.length > 0) await rm(temps.pop(), { recursive: true, force: true });
});

function tempRoot(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

function linuxDigest() {
  for (const line of readFileSync(join(repo, "packaging", "SHA256SUMS"), "utf8").split("\n")) {
    const match = /^([0-9a-fA-F]{64}) [ *](.+)$/.exec(line);
    if (match && match[2] === LINUX_ASSET) return match[1].toLowerCase();
  }
  throw new Error(`packaging/SHA256SUMS has no line for ${LINUX_ASSET}`);
}

// A fresh env, not process.env: an inherited XDG_CONFIG_HOME or PKGDEST would point makepkg at the real HOME.
function makepkgEnv(root) {
  const env = { PATH: HOST_PATH, LANG: "C", LC_ALL: "C", TMPDIR: join(root, "tmp") };
  mkdirSync(env.TMPDIR);
  for (const key of MAKEPKG_DIRS) {
    env[key] = join(root, key.toLowerCase());
    mkdirSync(env[key]);
  }
  return env;
}

function run(command, args, options = {}) {
  return spawnSync(command, args, { encoding: "utf8", ...options });
}

function cacheNames() {
  const cache = join(homedir(), ".cache");
  if (!existsSync(cache)) return new Set();
  return new Set(readdirSync(cache).filter((name) => /snipset|makepkg|pkgbuild/i.test(name)));
}

describe("AUR package", () => {
  test("PKGBUILD names the package snipset-cli without the -bin suffix", () => {
    const text = readFileSync(PKGBUILD, "utf8");
    expect(text).toMatch(/^pkgname=snipset-cli$/m);
    expect(text).not.toContain("-bin");
    const srcinfo = readFileSync(SRCINFO, "utf8");
    expect(srcinfo).toMatch(/^pkgbase = snipset-cli$/m);
    expect(srcinfo).toMatch(/^pkgname = snipset-cli$/m);
    expect(srcinfo).not.toContain("-bin");
  });

  test("PKGBUILD declares the contract fields", () => {
    const text = readFileSync(PKGBUILD, "utf8");
    expect(text).toMatch(/^# Maintainer: .+ <.+@.+>$/m);
    expect(text).toContain(`pkgver=${VERSION}\n`);
    expect(text).toContain("pkgrel=1\n");
    expect(text).toMatch(/^pkgdesc='.+'$/m);
    expect(text).toContain("arch=('x86_64')\n");
    expect(text).toMatch(/^url='https:\/\/.+'$/m);
    expect(text).toContain("license=('LicenseRef-Snipset-EULA')\n");
    // readelf -d NEEDED of the release binary: libcrypto.so.3 (openssl), libgcc_s.so.1 (libgcc), libm and libc (glibc).
    expect(text).toContain("depends=('glibc' 'libgcc' 'openssl')\n");
    expect(readFileSync(SRCINFO, "utf8")).toContain("\tdepends = glibc\n\tdepends = libgcc\n\tdepends = openssl\n\toptions = !strip\n");
    expect(text).toContain("options=('!strip' '!debug')\n");
    expect(text).toContain(`source_x86_64=("snipset-cli-$pkgver-x86_64.tar.gz::${SOURCE_URL}")\n`);
  });

  test("PKGBUILD and .SRCINFO checksums equal packaging/SHA256SUMS", () => {
    const digest = linuxDigest();
    expect(readFileSync(PKGBUILD, "utf8")).toContain(`sha256sums_x86_64=('${digest}')\n`);
    expect(readFileSync(SRCINFO, "utf8")).toContain(`\tsha256sums_x86_64 = ${digest}\n`);
  });

  test("render.mjs --check --channel aur exits 0", () => {
    const result = run(process.execPath, [RENDER, "--check", "--channel", "aur"], { cwd: repo });
    expect(`${result.stdout}${result.stderr}`).toBe("");
    expect(result.status).toBe(0);
  });

  test.skipIf(!tool("shellcheck"))("shellcheck accepts the PKGBUILD", () => {
    const result = run(tool("shellcheck"), ["--shell=bash", "--exclude=SC2034,SC2154,SC2164", PKGBUILD]);
    expect(result.stdout).toBe("");
    expect(result.status).toBe(0);
  });

  test.skipIf(makepkgMissing.length > 0)("SRCINFO equals makepkg --printsrcinfo", () => {
    const root = tempRoot("snipset-aur-srcinfo-");
    const work = join(root, "work");
    mkdirSync(work);
    copyFileSync(PKGBUILD, join(work, "PKGBUILD"));
    const result = run(tool("makepkg"), ["--printsrcinfo"], { cwd: work, env: makepkgEnv(root) });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(readFileSync(SRCINFO, "utf8")).toBe(result.stdout);
  });

  test.skipIf(buildMissing.length > 0)("makepkg builds a package from a file:// fixture tarball", () => {
    const root = tempRoot("snipset-aur-build-");
    const release = fakeLinuxRelease({ version: VERSION });
    temps.push(release.dir);
    const fixtureDigest = createHash("sha256").update(readFileSync(release.archive)).digest("hex");

    const original = readFileSync(PKGBUILD, "utf8");
    expect(original).toContain(SOURCE_URL);
    expect(original).toContain(linuxDigest());
    const patched = original.replace(SOURCE_URL, `file://${release.archive}`).replace(linuxDigest(), fixtureDigest);
    const work = join(root, "work");
    mkdirSync(work);
    writeFileSync(join(work, "PKGBUILD"), patched);

    const env = makepkgEnv(root);
    for (const key of MAKEPKG_DIRS) {
      expect(env[key].startsWith(root + sep)).toBe(true);
      expect(env[key]).not.toBe(homedir());
    }
    const cacheBefore = cacheNames();
    const build = run(tool("makepkg"), ["--nodeps", "--noconfirm", "--noprogressbar", "-f"], { cwd: work, env });
    if (build.status !== 0) console.log(build.stdout, build.stderr);
    expect(build.status).toBe(0);

    expect(existsSync(join(env.SRCDEST, SOURCE_NAME))).toBe(true);
    const packages = readdirSync(env.PKGDEST).filter((name) => name.includes(".pkg.tar"));
    expect(packages).toHaveLength(1);
    expect(packages[0]).toStartWith(`snipset-cli-${VERSION}-1-x86_64.pkg.tar`);
    const pkg = join(env.PKGDEST, packages[0]);

    const list = run(tool("bsdtar"), ["-tf", pkg]);
    expect(list.status).toBe(0);
    const files = list.stdout.split("\n").filter((entry) => entry !== "" && !entry.startsWith(".") && !entry.endsWith("/"));
    console.log(`packaging-aur: package files ${files.join(" ")}`);
    expect(files.sort()).toEqual(Object.keys(INSTALLED).sort());

    const verbose = run(tool("bsdtar"), ["-tvf", pkg]);
    expect(verbose.status).toBe(0);
    const modes = {};
    for (const line of verbose.stdout.split("\n")) {
      const fields = line.trim().split(/\s+/);
      if (Object.hasOwn(INSTALLED, fields.at(-1))) modes[fields.at(-1)] = fields[0];
    }
    expect(modes).toEqual(INSTALLED);

    const added = [...cacheNames()].filter((name) => !cacheBefore.has(name));
    expect(added).toEqual([]);
  });
});
