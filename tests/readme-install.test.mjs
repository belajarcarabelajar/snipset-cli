import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const repo = join(import.meta.dir, "..");
const read = (path) => readFileSync(join(repo, path), "utf8");
const readme = read("README.md");
const version = read("packaging/VERSION").trim();
const EM_DASH = String.fromCharCode(0x2014);

function section(heading) {
  const start = readme.indexOf(`\n## ${heading}\n`);
  expect(start).toBeGreaterThanOrEqual(0);
  const next = readme.indexOf("\n## ", start + 1);
  return readme.slice(start + 1, next === -1 ? readme.length : next + 1);
}

const tableRows = (text) => text.split("\n").filter((line) => line.startsWith("|"));
const cells = (row) => row.split("|").slice(1, -1).map((cell) => cell.trim());

describe("README install coverage", () => {
  test("sections appear in the documented order", () => {
    const order = [
      "Install matrix",
      "Linux x64",
      "Check, update, uninstall, dry run",
      "Offline install",
      "Shells and PATH",
      "MCP registration",
      "Windows x64",
      "Package managers",
      "Version managers",
      "Help",
      "Querying the live database (companion workflow)",
      "Manual downloads",
      "Known limits",
      "Updates and uninstall",
    ];
    const positions = order.map((heading) => readme.indexOf(`\n## ${heading}\n`));
    for (const [index, position] of positions.entries()) {
      expect({ heading: order[index], found: position >= 0 }).toEqual({ heading: order[index], found: true });
    }
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  test("every flag printed by install.sh --help has a row in a README table", () => {
    const help = spawnSync("bash", [join(repo, "install.sh"), "--help"], { encoding: "utf8" });
    expect(help.status).toBe(0);
    const flags = [...new Set(help.stdout.match(/(?<![\w-])--?[a-z][a-z-]*(?:=LIST)?/g))];
    expect(flags.length).toBeGreaterThan(15);
    const rows = tableRows(readme);
    const missing = flags.filter((flag) => !rows.some((row) => row.includes("`" + flag)));
    expect(missing).toEqual([]);
  });

  test("every install.ps1 parameter has a row in a README table", () => {
    const block = read("install.ps1").match(/^param\(\n([\s\S]*?)\n\)/m);
    expect(block).not.toBeNull();
    const params = [...block[1].matchAll(/\$(\w+)/g)].map((match) => match[1]);
    expect(params.length).toBe(10);
    const rows = tableRows(readme);
    const missing = params.filter((name) => !rows.some((row) => row.includes("`-" + name)));
    expect(missing).toEqual([]);
  });

  test("the install matrix has one row per channel with its status", () => {
    const expected = [
      ["`install.sh` on Arch Linux x86_64", "verified"],
      ["`install.sh` on Debian, Ubuntu, Fedora, WSL", "not verified"],
      ["`install.sh --from` (offline)", "verified"],
      ["`install.ps1` on Windows x64", "not verified"],
      ["Scoop", "not verified"],
      ["winget", "not submitted"],
      ["AUR", "not published"],
      ["Homebrew tap", "not verified"],
      ["Nix flake", "not verified"],
      ["mise, eget, ubi", "not verified"],
      ["`gh release download`", "verified"],
    ];
    const rows = tableRows(section("Install matrix")).slice(2).map(cells);
    expect(rows.map((row) => row[0])).toEqual(expected.map(([channel]) => channel));
    for (const [index, [channel, status]] of expected.entries()) {
      const text = rows[index][1];
      expect({ channel, status: text.match(/^(verified|not verified|not submitted|not published)\b/)?.[1] }).toEqual({ channel, status });
      expect({ channel, reason: /^(verified|not verified|not submitted|not published)( on Windows)?: \S/.test(text) }).toEqual({ channel, reason: true });
    }
  });

  test("the Draft caveat is in the intro and in Known limits", () => {
    const intro = readme.slice(0, readme.indexOf("\n## "));
    expect(intro).toContain("Draft");
    const limits = section("Known limits");
    expect(limits).toContain("Draft");
    expect(limits).toContain("only the owner");
  });

  test("Known limits names every documented limit", () => {
    const limits = section("Known limits");
    const needles = [
      "glibc 2.34",
      "libcrypto.so.3",
      "bash 4.4",
      "macOS",
      "musl",
      "Windows 10 on Arm",
      "Windows 11 on Arm",
      "Smart App Control",
      "wget",
      "claude mcp get",
      "codex",
      "empty directories",
      "same flags",
      "EULA",
    ];
    expect(needles.filter((needle) => !limits.includes(needle))).toEqual([]);
  });

  test("the Windows zip line names snipset.exe and LICENSE", () => {
    const line = section("Manual downloads").split("\n").find((entry) => entry.includes("x86_64-pc-windows-msvc.zip"));
    expect(line).toBeDefined();
    expect(line).toContain("`snipset.exe`");
    expect(line).toContain("`LICENSE`");
  });

  test("the pinned one-liners point at the release tag", () => {
    const base = `https://raw.githubusercontent.com/belajarcarabelajar/snipset-cli/v${version}`;
    expect(readme).toContain(`${base}/install.sh`);
    expect(readme).toContain(`${base}/install.ps1`);
  });

  test("package and version manager commands match the contract", () => {
    const commands = [
      `gh release download v${version} -R belajarcarabelajar/snipset-cli -D`,
      "scoop bucket add snipset https://github.com/belajarcarabelajar/snipset-cli",
      "scoop install snipset/snipset",
      "winget install BCBAcademy.SnipsetCLI",
      `winget install --manifest packaging/winget/manifests/b/BCBAcademy/SnipsetCLI/${version}`,
      "makepkg -si",
      "brew tap belajarcarabelajar/snipset https://github.com/belajarcarabelajar/snipset-cli",
      "brew install belajarcarabelajar/snipset/snipset",
      "nix run github:belajarcarabelajar/snipset-cli",
      `mise use -g github:belajarcarabelajar/snipset-cli@${version}`,
      `eget belajarcarabelajar/snipset-cli --tag v${version} --file snipset --to ~/.local/bin`,
      `ubi -p belajarcarabelajar/snipset-cli -t v${version} -e snipset -i ~/.local/bin`,
    ];
    expect(commands.filter((command) => !readme.includes(command))).toEqual([]);
  });

  test("every packaging path the README names exists in the repo", () => {
    const paths = [
      "bucket/snipset.json",
      `packaging/winget/manifests/b/BCBAcademy/SnipsetCLI/${version}`,
      "packaging/aur/snipset-cli",
      "Formula/snipset.rb",
      "flake.nix",
    ];
    for (const path of paths) {
      expect({ path, inReadme: readme.includes(path), onDisk: existsSync(join(repo, path)) }).toEqual({ path, inReadme: true, onDisk: true });
    }
  });

  test("the companion section is byte-identical to the committed copy", () => {
    const first = "`scripts/snipset-live.sh` runs the installed `snipset` CLI against a snapshot";
    const last = "value; wrapper flags require a space and `--flag=value` is rejected.";
    const firstAt = readme.indexOf(first);
    expect(firstAt).toBeGreaterThanOrEqual(0);
    expect(readme.indexOf(last, firstAt)).toBeGreaterThan(firstAt);
    const body = section("Querying the live database (companion workflow)");
    expect(createHash("sha256").update(body).digest("hex")).toBe("271d4e87b6c236d2e81b32ec9edef0996d3b4dade0766c25ad636c1e71c572c5");
  });
});

describe("opencode command docs", () => {
  test("check-wiring expects the env source line from --add-path", () => {
    const text = read(".opencode/commands/check-wiring.md");
    expect(text).toContain('. "<share>/env"');
    expect(text).not.toContain('exactly one `export PATH="<install-dir>:$PATH"` line');
  });

  test("verify runs both generator checks", () => {
    const text = read(".opencode/commands/verify.md");
    expect(text).toContain("bun scripts/installer/build.mjs --check");
    expect(text).toContain("bun scripts/packaging/render.mjs --check");
  });
});

describe("no em dash", () => {
  for (const path of ["README.md", ".opencode/commands/check-wiring.md", ".opencode/commands/verify.md"]) {
    test(path, () => {
      expect(read(path).includes(EM_DASH)).toBe(false);
    });
  }
});

describe("deferred hardening notes", () => {
  test("deferred hardening: Homebrew states the host libcrypto.so.3 and glibc 2.34 it relies on", () => {
    const text = section("Package managers");
    expect(text).toContain("libcrypto.so.3");
    expect(text).toContain("glibc 2.34");
    expect(text).toContain("keg-only");
    expect(readme).toContain("- The Homebrew formula relies on the host's `libcrypto.so.3` (OpenSSL 3) and glibc 2.34 or newer.");
  });

  test("deferred hardening: the Windows notes name the two DLLs the zip does not ship", () => {
    const text = section("Windows x64");
    expect(text).toContain("`libcrypto-3-x64.dll`");
    expect(text).toContain("`VCRUNTIME140.dll`");
    expect(section("Known limits")).toContain("`libcrypto-3-x64.dll` and `VCRUNTIME140.dll`");
    // The installer's own message sends the reader here.
    expect(read("scripts/installer/ps1/binary.ps1")).toContain("see the README Windows notes");
  });

  test("deferred hardening: -Database is documented and -Db is explained", () => {
    const row = tableRows(section("Windows x64")).find((line) => cells(line)[0] === "`-Database`");
    expect(row).toBeDefined();
    expect(row).toContain("--db");
    expect(row).toContain("-Debug");
    expect(read("scripts/installer/ps1/params.ps1")).toContain("[string]$Database");
  });

  test("deferred hardening: kept share files and the share-dir manifest are described", () => {
    const text = section("Check, update, uninstall, dry run");
    expect(text).toContain("`<share-dir>/.snipset-bundle`");
    expect(text).toContain("`[KEEP]`");
    expect(text).toContain("the bashrc block is not added");
  });

  test("deferred hardening: uninstall removes only the empty directories the install created", () => {
    const text = section("Check, update, uninstall, dry run");
    expect(text).toContain("`<install-dir>/.snipset-dirs`");
    expect(readme).not.toContain("Empty directories may remain after uninstall");
    expect(section("Known limits")).not.toContain("Uninstall may leave empty directories (for example `~/.local/bin`");
  });

  test("deferred hardening: the default share dir exception for older installs is stated", () => {
    const text = section("Check, update, uninstall, dry run");
    expect(text).toContain("a default share dir (`~/.local/share/snipset`) with no `.snipset-bundle` is taken as an older install");
    expect(text).toContain("except the default share dir an older install left");
  });

  test("deferred hardening: created startup files are removed once only blank lines remain", () => {
    expect(section("Check, update, uninstall, dry run")).toContain("`<install-dir>/.snipset-files`");
  });

  test("deferred hardening: in-use asides on Windows are cleaned up", () => {
    const text = section("Windows x64");
    expect(text).toContain("`snipset.exe.old-<pid>-<8 hex>`");
    expect(text).toContain("Parameters are named only");
  });
});
