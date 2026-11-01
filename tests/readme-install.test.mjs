import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const repo = join(import.meta.dir, "..");
const read = (path) => readFileSync(join(repo, path), "utf8");
const readme = read("README.md");
// The adopted release, from the v0.3.0 tag and its asset names, so the README pins are not
// checked against packaging/VERSION, the file they must agree with (asserted below).
const version = "0.3.0";
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
      "What it does",
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

  // v0.2.0 was published on 2026-10-25, so no channel waits on a Draft any more.
  test("no Draft caveat is left once the release is published", () => {
    expect(readme).not.toMatch(/\bDraft\b/);
    expect(readme).not.toContain("only the owner");
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

  // The members that tar -tzf and unzip -l list in the v0.3.0 assets.
  test("the archive lines name every member of the release archives", () => {
    const text = section("Manual downloads").split("\n");
    const linux = text.find((entry) => entry.includes(`snipset-cli-v${version}-x86_64-unknown-linux-gnu.tar.gz`)) ?? "";
    const windows = text.find((entry) => entry.includes(`snipset-cli-v${version}-x86_64-pc-windows-msvc.zip`)) ?? "";
    const members = {
      linux: ["`snipset`", "`LICENSE`", "`THIRD-PARTY-NOTICES.txt`", "`shell/`", "`snipset.sh`", "`completion.bash`", "`tab.sh`", "`snipset-shims.sh`"],
      windows: ["`snipset.exe`", "`LICENSE`", "`THIRD-PARTY-NOTICES.txt`"],
    };
    expect({
      linux: members.linux.filter((member) => !linux.includes(member)),
      windows: members.windows.filter((member) => !windows.includes(member)),
    }).toEqual({ linux: [], windows: [] });
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
    expect(createHash("sha256").update(body).digest("hex")).toBe("b002353bf4de70daf29766284e8749942ba93b56742e14747f8d081f834e64e6");
  });
});

// The CLI source is private, so the groups are pinned from `enum Command` in
// Snipset's crates/snipset-cli/src/cli.rs at version 0.3.0, in help order.
const COMMAND_GROUPS = [
  "doctor", "init", "snippet", "group", "clipboard", "audio", "journal", "task", "note",
  "pomodoro", "stats", "reference", "support", "settings", "import", "export", "backup", "mcp",
];
const LABELS = /^(verified|manifest only|untested): \S/;
const BACKUP_FALLBACK =
  "snipset-live: this snipset has no backup command; copying files instead, which can be inconsistent while Snipset Desktop writes";

function fencedLines(text) {
  const lines = [];
  let inside = false;
  for (const line of text.split("\n")) {
    if (line.startsWith("```")) inside = !inside;
    else if (inside) lines.push(line);
  }
  return lines;
}

describe("README what it does", () => {
  test("what it does: one row per command group of snipset --help, in help order", () => {
    const rows = tableRows(section("What it does")).slice(2).map(cells);
    expect(rows.map((row) => row[0])).toEqual(COMMAND_GROUPS.map((name) => "`" + name + "`"));
    expect(rows.filter((row) => !(row[1]?.length > 0)).map((row) => row[0])).toEqual([]);
    expect(rows.find((row) => row[0] === "`backup`")?.[1]).toContain("new in 0.3.0");
  });

  test("what it does: names the MCP server and points at its registration", () => {
    const text = section("What it does");
    expect(text).toContain("`snipset mcp`");
    expect(text).toContain("Model Context Protocol");
    expect(text).toContain("[MCP registration](#mcp-registration)");
  });

  test("what it does: the four quick examples sit in code blocks", () => {
    const lines = fencedLines(section("What it does"));
    const examples = [
      `bash install-snipset.sh --version v${version} --add-path --with-mcp=claude`,
      "snipset init",
      'snipset snippet search "git status"',
      "snipset --json stats overview",
    ];
    expect(examples.filter((example) => !lines.includes(example))).toEqual([]);
    // snipset init refuses an existing database, and a fresh install.sh run already made one.
    expect(section("What it does")).toContain("`--no-init`");
    expect(section("What it does")).toContain("`--force`");
  });

  test("what it does: the installer example uses flags and an MCP id that install.sh --help prints", () => {
    const help = spawnSync("bash", [join(repo, "install.sh"), "--help"], { encoding: "utf8" });
    expect(help.status).toBe(0);
    const example = fencedLines(section("What it does")).find((line) => line.startsWith("bash install-snipset.sh "));
    expect(example).toBeDefined();
    const flags = example.match(/--[a-z-]+/g);
    expect(flags.filter((flag) => !help.stdout.includes(` ${flag} `))).toEqual([]);
    const listLine = help.stdout.split("\n").find((line) => line.trimStart().startsWith("--with-mcp=LIST"));
    expect(listLine).toMatch(/\bclaude\b/);
    expect(example).toContain("--with-mcp=claude");
  });

  test("what it does: the install matrix labels each channel verified, manifest only, or untested", () => {
    const expected = [
      ["`install.sh` on Arch Linux x86_64", "verified"],
      ["`install.sh` on Ubuntu", "verified"],
      ["`install.sh` on Debian, Fedora, WSL", "untested"],
      ["`install.sh --from` (offline)", "verified"],
      ["`install.ps1` on Windows x64", "verified"],
      ["Scoop", "verified"],
      ["winget", "manifest only"],
      ["AUR", "manifest only"],
      ["Homebrew tap", "verified"],
      ["Nix flake", "verified"],
      ["mise, eget, ubi", "untested"],
      ["`gh release download`", "verified"],
    ];
    const text = section("Install matrix");
    const rows = tableRows(text).slice(2).map(cells);
    expect(rows.map((row) => row[0])).toEqual(expected.map(([channel]) => channel));
    for (const [index, [channel, label]] of expected.entries()) {
      const status = rows[index][1];
      expect({ channel, label: status.match(LABELS)?.[1] }).toEqual({ channel, label });
    }
    for (const label of ["verified means", "manifest only means", "untested means"]) {
      expect({ label, defined: text.includes(label) }).toEqual({ label, defined: true });
    }
  });

  test("what it does: each channel section carries its label", () => {
    const intros = [
      ["Linux x64", "`install.sh` is ", ["verified on Arch Linux and Ubuntu", "untested on Debian, Fedora, and WSL"]],
      ["Offline install", "`--from DIR` ", ["(verified)", "`gh release download` (verified)"]],
      ["Windows x64", "`install.ps1` is ", ["verified"]],
      ["Package managers", "Scoop (", ["(Windows, verified)"]],
      ["Package managers", "winget (", ["(Windows, manifest only)"]],
      ["Package managers", "AUR (", ["(Arch Linux, manifest only)"]],
      ["Package managers", "Homebrew (", ["(Linux only, verified)"]],
      ["Package managers", "Nix (", ["(x86_64-linux, verified)"]],
      ["Version managers", "These ", ["untested"]],
    ];
    for (const [heading, prefix, phrases] of intros) {
      const line = section(heading).split("\n").find((entry) => entry.startsWith(prefix)) ?? "";
      expect({ heading, prefix, missing: phrases.filter((phrase) => !line.includes(phrase)) }).toEqual({ heading, prefix, missing: [] });
    }
  });

  test("what it does: the wrapper refreshes through snipset backup and prints its fallback line", () => {
    const text = section("Querying the live database (companion workflow)");
    expect(text).toContain("`snipset --db <live> backup --to <snap> --force`");
    expect(text).toContain("`snipset backup --help`");
    expect(fencedLines(text)).toContain(BACKUP_FALLBACK);
  });

  test("what it does: the wrapper text matches scripts/snipset-live.sh, a failed backup included", () => {
    const wrapper = read("scripts/snipset-live.sh");
    expect(wrapper).toContain('snipset --db "$live" backup --to "$snap" --force');
    expect(wrapper).toContain(BACKUP_FALLBACK);
    const prose = section("Querying the live database (companion workflow)").replace(/\s+/g, " ");
    expect(prose).toContain("the wrapper exits with the CLI's exit code; it does not fall back to copying files");
  });

  test("what it does: the Windows notes quote the message install.ps1 throws when a DLL is missing", () => {
    const message = read("scripts/installer/ps1/binary.ps1").match(/throw '(install\.ps1: snipset\.exe could not start because [^']+)'/)?.[1];
    expect(message).toBeDefined();
    const text = section("Windows x64");
    expect(text).toContain("`" + message + "`");
    expect(text).not.toContain("a message naming them");
  });

  test("what it does: the Nix label rests on the CI nix build, not on nix run", () => {
    const nixJob = read(".github/workflows/test.yml").match(/\n  nix:\n([\s\S]*?)(?=\n  [a-z][\w-]*:\n|$)/)?.[1] ?? "";
    expect(nixJob).toContain("run: nix build .#default");
    expect(nixJob).toContain('SNIPSET_NIX_BUILD: "1"');
    const row = tableRows(section("Install matrix")).find((line) => cells(line)[0] === "Nix flake");
    expect(row).toContain("`nix build .#default`");
    const text = section("Package managers");
    expect(text).toContain("CI builds the package with `nix build .#default`");
    expect(text).toContain("`nix run` itself is not exercised");
  });
});

// Lines that may still name v0.2.0 because they say what changed in 0.3.0. The last one sits in
// the companion section, whose bytes a test above pins.
const HISTORY_NOTES = [
  "| `backup` |",
  "- v0.2.0 needed `libcrypto-3-x64.dll`",
  "With an older CLI, such as v0.2.0,",
];
// sha256 of LICENSE inside both v0.3.0 archives, equal to Snipset main's LICENSE at bee81a23b.
const EULA_SHA256 = "b834925d2d7db5880b5e68eb8fa96b2a3a130aba9c9867c18e6db9b19ad63826";

describe("README adopts 0.3.0", () => {
  test("adopt 0.3.0: packaging/VERSION names the release the README pins", () => {
    expect(read("packaging/VERSION")).toBe(`${version}\n`);
  });

  test("adopt 0.3.0: v0.2.0 is named only where the README says what changed", () => {
    const lines = readme.split("\n").filter((line) => line.includes("0.2.0"));
    expect(lines.filter((line) => !HISTORY_NOTES.some((note) => line.includes(note)))).toEqual([]);
  });

  test("adopt 0.3.0: the installer examples pin the release", () => {
    const linux = fencedLines(section("Linux x64")).filter((line) => line.includes("--version"));
    expect(linux.length).toBe(3);
    expect(linux.filter((line) => !line.includes(`--version v${version} `))).toEqual([]);
    const windows = section("Windows x64");
    const oneLiner = fencedLines(windows).find((line) => line.includes("/install.ps1).Content")) ?? "";
    expect(oneLiner).toEndWith(`-Version v${version} -AddPath`);
    expect(fencedLines(windows)).toContain(`.\\install.ps1 -Version v${version} -From .\\snipset-assets`);
    expect(tableRows(windows).find((line) => cells(line)[0] === "`-Version`")).toContain("`v" + version + "`");
  });

  test("adopt 0.3.0: the intro says the CLI is free to use under section 7 of the Snipset EULA in LICENSE", () => {
    const intro = readme.slice(0, readme.indexOf("\n## "));
    const phrases = ["free to use", "section 7 of the Snipset EULA", "[`LICENSE`](LICENSE)"];
    expect(phrases.filter((phrase) => !intro.includes(phrase))).toEqual([]);
  });

  test("adopt 0.3.0: LICENSE is the EULA the release archives ship, with the section 7 the README cites", () => {
    const license = readFileSync(join(repo, "LICENSE"));
    expect(createHash("sha256").update(license).digest("hex")).toBe(EULA_SHA256);
    expect(license.toString("utf8")).toContain("\n## 7. SNIPSET CLI\n");
    expect(license.toString("utf8")).toContain("is licensed to you free of charge");
  });

  test("adopt 0.3.0: the Windows notes describe the static exe and keep one line on what v0.2.0 needed", () => {
    const text = section("Windows x64");
    const phrases = [
      "From v0.3.0, `snipset.exe` is static",
      "names only DLLs that ship with Windows",
      "needs no OpenSSL or Visual C++ runtime DLLs",
    ];
    expect(phrases.filter((phrase) => !text.includes(phrase))).toEqual([]);
    const old = text.split("\n").filter((line) => line.includes("0.2.0"));
    expect(old.length).toBe(1);
    expect(old[0]).toStartWith("- v0.2.0 needed ");
  });

  test("adopt 0.3.0: Known limits lists no Windows DLL", () => {
    expect(section("Known limits")).not.toMatch(/\.dll\b/i);
  });

  test("adopt 0.3.0: the matrix evidence names the v0.3.0 assets that CI installs", () => {
    const rows = tableRows(section("Install matrix")).map(cells);
    const status = (channel) => rows.find((row) => row[0] === channel)?.[1] ?? "";
    expect(status("`install.sh` on Arch Linux x86_64")).toContain(`the real v${version} assets`);
    expect(status("`install.ps1` on Windows x64")).toContain(`the published v${version} zip`);
  });
});

describe("no em dash", () => {
  for (const path of ["README.md"]) {
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

  test("deferred hardening: the Windows notes name the two DLLs the v0.2.0 zip did not ship", () => {
    const line = section("Windows x64").split("\n").find((entry) => entry.startsWith("- v0.2.0 needed ")) ?? "";
    expect(line).toContain("`libcrypto-3-x64.dll`");
    expect(line).toContain("`VCRUNTIME140.dll`");
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
