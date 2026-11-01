import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { cleanupSandbox, DEFAULT_TOOLS, makeSandbox, runInstaller } from "./helpers/install-sandbox.mjs";

// Both name `gh release download` directories: the previous release and the one to update to.
const prev = process.env.SNIPSET_PREV_ASSETS || "";
const assets = process.env.SNIPSET_REAL_ASSETS || "";
if (!prev || !assets) console.log("install-update-real: skipped, set SNIPSET_PREV_ASSETS and SNIPSET_REAL_ASSETS to gh release download directories");

// The version is read from the Linux tarball name, the way install.sh --from reads it from SHA256SUMS.
function releaseVersion(dir) {
  const versions = readdirSync(dir).flatMap((name) => name.match(/^snipset-cli-v(.+)-x86_64-unknown-linux-gnu\.tar\.gz$/)?.slice(1) ?? []);
  expect(versions).toHaveLength(1);
  return versions[0];
}

describe.skipIf(!prev || !assets)("real release assets", () => {
  test("install.sh --update moves an install of the previous release to the new one", async () => {
    const from = releaseVersion(prev);
    const to = releaseVersion(assets);
    expect(Bun.semver.order(from, to)).toBe(-1);
    const sb = makeSandbox({ tools: [...DEFAULT_TOOLS, "getconf", "ldd"] });
    try {
      const bin = join(sb.home, ".local", "bin");
      const flags = ["--install-dir", bin, "--add-path"];
      const version = () => spawnSync(join(bin, "snipset"), ["--version"], { encoding: "utf8", env: sb.env() }).stdout;
      const install = await runInstaller(sb, ["--from", prev, "--version", `v${from}`, ...flags]);
      expect(install.code, install.stderr).toBe(0);
      expect(version()).toStartWith(`snipset ${from}`);
      const update = await runInstaller(sb, ["--update", "--from", assets, ...flags]);
      expect(update.code, update.stderr).toBe(0);
      expect(update.stdout).toContain(`Installed snipset v${to}`);
      expect(version()).toStartWith(`snipset ${to}`);
    } finally {
      await cleanupSandbox(sb);
    }
  }, 60_000);
});
