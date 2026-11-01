import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// snipset.exe v0.2.0 imported libcrypto-3-x64.dll, VCRUNTIME140.dll and the UCRT api-ms-win-crt-*
// sets without shipping them, so it could not start on a clean Windows. CI missed it because
// GitHub's Windows runners keep the OpenSSL DLLs in System32 (actions/runner-images#13198).
// The allowlist is the one in Snipset's scripts/distribution/check-pe-imports.mjs.
const systemDlls = new Set([
  "kernel32.dll",
  "kernelbase.dll",
  "ntdll.dll",
  "advapi32.dll",
  "bcrypt.dll",
  "bcryptprimitives.dll",
  "combase.dll",
  "ole32.dll",
  "oleaut32.dll",
  "crypt32.dll",
  "ws2_32.dll",
  "user32.dll",
  "gdi32.dll",
  "shell32.dll",
  "shlwapi.dll",
  "secur32.dll",
  "userenv.dll",
  "iphlpapi.dll",
]);

function rejectionReason(name) {
  const lower = name.toLowerCase();
  if (systemDlls.has(lower) || /^api-ms-win-core-.*\.dll$/.test(lower)) return null;
  if (/^(vcruntime.*|msvcp.*|ucrtbase|api-ms-win-crt-.*)\.dll$/.test(lower))
    return "the C runtime must be linked statically";
  if (/^(libcrypto|libssl).*\.dll$/.test(lower)) return "OpenSSL must be linked statically";
  return "not on the system DLL allowlist";
}

function checkImports(names) {
  const offenders = names.flatMap((name) => {
    const reason = rejectionReason(name);
    return reason ? [{ name, reason }] : [];
  });
  // No imports means the import table was not found, so it is never a clean exe.
  return { ok: names.length > 0 && offenders.length === 0, offenders };
}

function parseDllNames(text) {
  return [...text.matchAll(/^[ \t]*DLL Name:[ \t]*(.*?)[ \t\r]*$/gm)].map((match) => match[1]);
}

const assets = process.env.SNIPSET_REAL_ASSETS || "";
const fixture = join(import.meta.dir, "fixtures", "pe-imports", "snipset-cli-v0.2.0.txt");
if (!assets) console.log("release-windows-deps: real exe skipped, set SNIPSET_REAL_ASSETS to a gh release download directory");

const temps = [];
afterEach(async () => {
  while (temps.length > 0) await rm(temps.pop(), { recursive: true, force: true });
});

test("the v0.2.0 import list is rejected for its OpenSSL and C runtime DLLs", () => {
  const { ok, offenders } = checkImports(parseDllNames(readFileSync(fixture, "utf8")));
  expect(ok).toBe(false);
  expect(offenders.map((o) => o.name)).toEqual([
    "libcrypto-3-x64.dll",
    "VCRUNTIME140.dll",
    "api-ms-win-crt-stdio-l1-1-0.dll",
    "api-ms-win-crt-runtime-l1-1-0.dll",
    "api-ms-win-crt-math-l1-1-0.dll",
    "api-ms-win-crt-time-l1-1-0.dll",
    "api-ms-win-crt-heap-l1-1-0.dll",
    "api-ms-win-crt-convert-l1-1-0.dll",
    "api-ms-win-crt-utility-l1-1-0.dll",
    "api-ms-win-crt-string-l1-1-0.dll",
    "api-ms-win-crt-locale-l1-1-0.dll",
  ]);
  expect(offenders[0].reason).toBe("OpenSSL must be linked statically");
});

test("an empty import list is never accepted", () => {
  expect(checkImports(parseDllNames("no import table here\n")).ok).toBe(false);
});

describe.skipIf(!assets)("real release assets", () => {
  test("snipset.exe in the release zip imports only system DLLs", () => {
    const zips = readdirSync(assets).filter((name) => /^snipset-cli-v.+-x86_64-pc-windows-msvc\.zip$/.test(name));
    expect(zips).toHaveLength(1);
    const dir = mkdtempSync(join(tmpdir(), "snipset-pe-"));
    temps.push(dir);
    const unzip = spawnSync("bsdtar", ["-xf", join(assets, zips[0]), "-C", dir, "snipset.exe"], { encoding: "utf8" });
    expect(unzip.status, unzip.stderr).toBe(0);
    // objdump -p also prints the relocation and .pdata tables, far past the default 1 MiB maxBuffer.
    const dump = spawnSync("objdump", ["-p", join(dir, "snipset.exe")], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
    expect(dump.status, dump.stderr).toBe(0);
    expect(checkImports(parseDllNames(dump.stdout))).toEqual({ ok: true, offenders: [] });
  });
});
