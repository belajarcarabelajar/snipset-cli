import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const assets = process.env.SNIPSET_REAL_ASSETS || "";
const repoLicense = readFileSync(join(import.meta.dir, "..", "LICENSE"));
if (!assets) console.log("license-sync: archive comparison skipped, set SNIPSET_REAL_ASSETS to a gh release download directory");

const temps = [];
afterEach(async () => {
  while (temps.length > 0) await rm(temps.pop(), { recursive: true, force: true });
});

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function archivedLicense(pattern) {
  const names = readdirSync(assets).filter((name) => pattern.test(name));
  expect(names).toHaveLength(1);
  const dir = mkdtempSync(join(tmpdir(), "snipset-license-"));
  temps.push(dir);
  const extract = spawnSync("bsdtar", ["-xf", join(assets, names[0]), "-C", dir, "LICENSE"], { encoding: "utf8" });
  expect(extract.status, extract.stderr).toBe(0);
  return { name: names[0], bytes: readFileSync(join(dir, "LICENSE")) };
}

test("LICENSE carries the Snipset CLI section of the EULA", () => {
  expect(repoLicense.toString("utf8")).toContain("## 7. SNIPSET CLI");
});

describe.skipIf(!assets)("real release assets", () => {
  for (const [kind, pattern] of [
    ["tarball", /^snipset-cli-v.+-x86_64-unknown-linux-gnu\.tar\.gz$/],
    ["zip", /^snipset-cli-v.+-x86_64-pc-windows-msvc\.zip$/],
  ]) {
    test(`LICENSE equals the one in the release ${kind} byte for byte`, () => {
      const { name, bytes } = archivedLicense(pattern);
      expect(repoLicense.equals(bytes), `${name} LICENSE is ${sha256(bytes)}, the repo LICENSE is ${sha256(repoLicense)}`).toBe(true);
    });
  }
});
