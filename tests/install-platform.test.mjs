import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import {
  DEFAULT_TOOLS,
  cleanupSandbox,
  downloaderShims,
  fakeLinuxRelease,
  makeSandbox,
  readDownloads,
  runInstaller,
  stubCommand,
} from "./helpers/install-sandbox.mjs";

const INSTALL_ARGS = ["--version", "0.1.0", "--no-shell", "--no-init", "--no-shims"];

const cleanups = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()();
});

// Every sandbox gets a logging downloader, so a guard that is missing shows up as a download.
function sandbox(tools) {
  const sb = makeSandbox(tools ? { tools } : undefined);
  cleanups.push(() => cleanupSandbox(sb));
  const release = fakeLinuxRelease();
  cleanups.push(() => rm(release.dir, { recursive: true, force: true }));
  downloaderShims(sb, release);
  return sb;
}

function stubUname(sb, { s = "Linux", m = "x86_64", r = "6.6.0-generic" } = {}) {
  stubCommand(
    sb,
    "uname",
    `case "$1" in
  -m) echo ${m} ;;
  -r) echo ${r} ;;
  *) echo ${s} ;;
esac
`,
  );
}

function stubGetconf(sb, version) {
  stubCommand(
    sb,
    "getconf",
    `[ "$1" = GNU_LIBC_VERSION ] || exit 1
echo 'glibc ${version}'
`,
  );
}

function stubGlibcLdd(sb, firstLine) {
  stubCommand(
    sb,
    "ldd",
    `[ "$1" = --version ] || exit 1
echo '${firstLine}'
echo 'Copyright (C) 2020 Free Software Foundation, Inc.'
`,
  );
}

// Alpine's ldd prints its banner to stderr and exits 1.
function stubMuslLdd(sb) {
  stubCommand(
    sb,
    "ldd",
    `echo 'musl libc (x86_64)' >&2
echo 'Version 1.2.4' >&2
exit 1
`,
  );
}

function binaryPath(sb) {
  return join(sb.home, ".local", "bin", "snipset");
}

function assertRefused(sb, result, pattern) {
  assert.equal(result.code, 1, `exit ${result.code}\n${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, pattern);
  assert.deepEqual(readDownloads(sb), []);
  assert.equal(existsSync(binaryPath(sb)), false);
}

function assertInstalled(sb, result) {
  assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
  assert.ok(existsSync(binaryPath(sb)), "binary was not placed");
  assert.ok(readDownloads(sb).length > 0, "no release download was attempted");
}

test("Darwin is refused before any download and points at the README limits", async () => {
  const sb = sandbox();
  stubUname(sb, { s: "Darwin", m: "x86_64", r: "23.6.0" });
  assertRefused(
    sb,
    await runInstaller(sb, INSTALL_ARGS),
    /install\.sh: no macOS build is published yet; see "Known limits" in README\.md/,
  );
});

test("an OS other than Linux or Darwin is refused by name", async () => {
  const sb = sandbox();
  stubUname(sb, { s: "FreeBSD" });
  assertRefused(sb, await runInstaller(sb, INSTALL_ARGS), /install\.sh: unsupported OS FreeBSD/);
});

test("aarch64 and arm64 are refused as unpublished ARM builds", async () => {
  for (const m of ["aarch64", "arm64"]) {
    const sb = sandbox();
    stubUname(sb, { m });
    assertRefused(sb, await runInstaller(sb, INSTALL_ARGS), /install\.sh: no ARM build is published yet; /);
  }
});

test("a CPU other than x86_64 or ARM is refused by name", async () => {
  const sb = sandbox();
  stubUname(sb, { m: "riscv64" });
  assertRefused(sb, await runInstaller(sb, INSTALL_ARGS), /install\.sh: unsupported CPU riscv64/);
});

test("musl libc is refused before any download", async () => {
  const sb = sandbox();
  stubUname(sb);
  stubMuslLdd(sb);
  assertRefused(
    sb,
    await runInstaller(sb, INSTALL_ARGS),
    /install\.sh: musl libc \(for example Alpine\) is not supported; the build needs glibc 2\.34 or newer/,
  );
});

test("glibc 2.31 from getconf is refused and the found version is named", async () => {
  const sb = sandbox();
  stubUname(sb);
  stubGetconf(sb, "2.31");
  const result = await runInstaller(sb, INSTALL_ARGS);
  assertRefused(sb, result, /install\.sh: .*glibc 2\.31.*2\.34 or newer/);
});

test("glibc 2.31 from the ldd fallback is refused when getconf is absent", async () => {
  const sb = sandbox();
  stubUname(sb);
  stubGlibcLdd(sb, "ldd (Ubuntu GLIBC 2.31-0ubuntu9.16) 2.31");
  const result = await runInstaller(sb, INSTALL_ARGS);
  assertRefused(sb, result, /install\.sh: .*glibc 2\.31.*2\.34 or newer/);
});

test("glibc 2.39 installs", async () => {
  const sb = sandbox();
  stubUname(sb);
  stubGetconf(sb, "2.39");
  const result = await runInstaller(sb, INSTALL_ARGS);
  assertInstalled(sb, result);
  assert.doesNotMatch(result.stderr, /glibc/);
});

test("an unknown glibc version prints a note and installs", async () => {
  const sb = sandbox();
  stubUname(sb);
  stubGlibcLdd(sb, "ldd (Mystery libc)");
  const result = await runInstaller(sb, INSTALL_ARGS);
  assertInstalled(sb, result);
  assert.match(result.stderr, /install\.sh: could not determine the glibc version/);
});

test("WSL (a microsoft kernel release) installs like any Linux", async () => {
  const sb = sandbox();
  stubUname(sb, { r: "5.15.153.1-microsoft-standard-WSL2" });
  stubGetconf(sb, "2.39");
  assertInstalled(sb, await runInstaller(sb, INSTALL_ARGS));
});

test(
  "the real host uname, ldd, and getconf detect a supported glibc and install",
  { skip: process.platform !== "linux" || process.arch !== "x64" },
  async () => {
    const sb = sandbox([...DEFAULT_TOOLS, "ldd", "getconf"]);
    const result = await runInstaller(sb, INSTALL_ARGS);
    assertInstalled(sb, result);
    assert.doesNotMatch(result.stderr, /could not determine the glibc version/);
  },
);
