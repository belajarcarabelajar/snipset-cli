import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repo = join(import.meta.dir, "..");
const RENDER = join(repo, "scripts", "packaging", "render.mjs");
const TEMPLATES = join(repo, "packaging", "templates");
const FORMULA = join(repo, "Formula", "snipset.rb");

const VERSION = readFileSync(join(repo, "packaging", "VERSION"), "utf8").trim();
const LINUX_ASSET = `snipset-cli-v${VERSION}-x86_64-unknown-linux-gnu.tar.gz`;
const LINUX_URL = `https://github.com/belajarcarabelajar/snipset-cli/releases/download/v${VERSION}/${LINUX_ASSET}`;
const LINUX_SHA = (() => {
  const line = readFileSync(join(repo, "packaging", "SHA256SUMS"), "utf8")
    .split("\n")
    .find((entry) => entry.endsWith(` ${LINUX_ASSET}`) || entry.endsWith(`*${LINUX_ASSET}`));
  if (!line) throw new Error(`packaging/SHA256SUMS has no line for ${LINUX_ASSET}`);
  return line.slice(0, 64).toLowerCase();
})();

const RUBY = Bun.which("ruby");
if (!RUBY) console.log("skip ruby -c Formula/snipset.rb: ruby is not on PATH");

const temps = [];
afterEach(async () => {
  while (temps.length > 0) await rm(temps.pop(), { recursive: true, force: true });
});

function render(...args) {
  const result = spawnSync("bun", [RENDER, ...args], { encoding: "utf8" });
  return { code: result.status, out: `${result.stdout}${result.stderr}` };
}

function formula() {
  return readFileSync(FORMULA, "utf8");
}

// Returns the body between an opener line at two-space indent and its matching "  end".
function block(text, opener) {
  const lines = text.split("\n");
  const start = lines.indexOf(`  ${opener}`);
  if (start === -1) return null;
  const end = lines.indexOf("  end", start + 1);
  if (end === -1) return null;
  return lines.slice(start + 1, end).map((line) => line.trim()).filter((line) => line !== "");
}

describe("Homebrew formula", () => {
  test("declares class Snipset < Formula and closes it", () => {
    const text = formula();
    expect(text.startsWith("class Snipset < Formula\n")).toBe(true);
    expect(text.endsWith("\nend\n")).toBe(true);
  });

  test("url names the Linux asset of packaging/VERSION", () => {
    expect(formula()).toContain(`  url "${LINUX_URL}"\n`);
  });

  test("sha256 equals the Linux line of packaging/SHA256SUMS", () => {
    const match = /^ {2}sha256 "([0-9a-f]{64})"$/m.exec(formula());
    expect(match?.[1]).toBe(LINUX_SHA);
  });

  test("version equals packaging/VERSION", () => {
    expect(formula()).toContain(`  version "${VERSION}"\n`);
  });

  test("desc and homepage are set", () => {
    expect(formula()).toContain('  desc "Terminal companion for the Snipset snippet manager"\n');
    expect(formula()).toContain('  homepage "https://github.com/belajarcarabelajar/snipset-cli"\n');
  });

  test("license uses the documented non-SPDX symbol", () => {
    expect(formula()).toContain("  license :cannot_represent\n");
  });

  test("depends_on :linux at class level", () => {
    expect(formula()).toContain("\n  depends_on :linux\n");
  });

  test("livecheck follows the latest GitHub release", () => {
    expect(block(formula(), "livecheck do")).toEqual(["url :stable", "strategy :github_latest"]);
  });

  test("install refuses ARM with Hardware::CPU.arm? and installs every file", () => {
    expect(block(formula(), "def install")).toEqual([
      'odie "Snipset CLI has no ARM build yet" if Hardware::CPU.arm?',
      'bin.install "snipset"',
      'bin.install "shell/snipset-shims.sh" => "snipset-shims"',
      'bash_completion.install "shell/completion.bash" => "snipset"',
      'pkgshare.install "shell/snipset.sh", "shell/tab.sh"',
    ]);
  });

  test("no on_* block is used, because the Cookbook forbids them inside install", () => {
    expect(formula()).not.toMatch(/\bon_(arm|intel|linux|macos)\b/);
  });

  test("test block asserts the version string", () => {
    expect(block(formula(), "test do")).toEqual([
      'assert_match "snipset #{version}", shell_output("#{bin}/snipset --version")',
    ]);
  });

  test("Formula/ holds only snipset.rb", () => {
    expect(readdirSync(join(repo, "Formula"))).toEqual(["snipset.rb"]);
  });

  test.skipIf(!RUBY)("ruby -c accepts the formula", () => {
    const result = spawnSync(RUBY, ["-c", FORMULA], { encoding: "utf8" });
    expect(`${result.stdout}${result.stderr}`).toContain("Syntax OK");
    expect(result.status).toBe(0);
  });

  test("render --check --channel homebrew exits 0", () => {
    const result = render("--check", "--channel", "homebrew");
    expect(result.out).toBe("");
    expect(result.code).toBe(0);
  });

  test("render --check catches a hand edit of the formula (negative control)", () => {
    const root = mkdtempSync(join(tmpdir(), "homebrew-check-"));
    temps.push(root);
    mkdirSync(join(root, "packaging"), { recursive: true });
    mkdirSync(join(root, "Formula"), { recursive: true });
    for (const name of ["VERSION", "SHA256SUMS"]) {
      writeFileSync(join(root, "packaging", name), readFileSync(join(repo, "packaging", name)));
    }
    writeFileSync(join(root, "Formula", "snipset.rb"), formula().replace(LINUX_SHA, "0".repeat(64)));
    const args = ["--check", "--channel", "homebrew", "--root", root, "--templates", TEMPLATES];
    const drift = render(...args);
    expect(drift.out).toContain("drift Formula/snipset.rb");
    expect(drift.code).toBe(1);
    writeFileSync(join(root, "Formula", "extra.rb"), "");
    expect(render(...args).out).toContain("orphan Formula/extra.rb");
    expect(existsSync(join(root, "Formula", "snipset.rb"))).toBe(true);
  });
});
