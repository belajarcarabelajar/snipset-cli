import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanupSandbox, downloaderShims, fakeLinuxRelease, makeSandbox, runInstaller } from "./helpers/install-sandbox.mjs";

const FLAGS = ["--version", "0.1.0"];
const MARKER = "# snipset-terminal-integration (managed by snipset installer; safe to remove)";
const USER_RC = "# user line\nalias ll='ls -l'\n";

const cleanups = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()();
});

function setup() {
  const sb = makeSandbox();
  cleanups.push(() => cleanupSandbox(sb));
  const release = fakeLinuxRelease();
  cleanups.push(() => rm(release.dir, { recursive: true, force: true }));
  downloaderShims(sb, release);
  return sb;
}

test("shell fixes: --bashrc in a missing directory installs without --add-path", async () => {
  const sb = setup();
  const bashDir = join(sb.home, ".config", "bash");
  const flags = [...FLAGS, "--bashrc", join(bashDir, "bashrc")];
  const install = await runInstaller(sb, flags);
  expect(install.code, `${install.stdout}\n${install.stderr}`).toBe(0);
  expect(existsSync(join(sb.home, ".local", "share", "Snipset", "snipset.db"))).toBe(true);
  const check = await runInstaller(sb, [...flags, "--check"]);
  expect(check.code, check.stdout).toBe(0);
  expect(check.stdout).toContain("check: CURRENT");
  const uninstall = await runInstaller(sb, [...flags, "--uninstall"]);
  expect(uninstall.code, `${uninstall.stdout}\n${uninstall.stderr}`).toBe(0);
  expect(existsSync(bashDir)).toBe(false);
});

// The block a v0.2.0 installer writes, spelled out so the test does not derive it from the code under test.
function v020Block(home) {
  const bin = join(home, ".local", "bin");
  const share = join(home, ".local", "share", "snipset");
  return [
    MARKER,
    `if ! command -v snipset >/dev/null 2>&1; then export PATH="${bin}:$PATH"; fi`,
    `[ -f "${share}/snipset.sh" ] && . "${share}/snipset.sh"`,
    `[ -f "${share}/completion.bash" ] && . "${share}/completion.bash"`,
    `[ -f "${share}/tab.sh" ] && . "${share}/tab.sh"`,
  ].join("\n") + "\n";
}

function dbBlock(home, db) {
  const lines = v020Block(home).split("\n");
  lines.splice(2, 0, `export SNIPSET_DB="${db}"`);
  return lines.join("\n");
}

// A release whose binary keeps snippets in the file named by --db and whose shim generator writes
// the v0.2.0 shim body, which reads SNIPSET_DB at run time.
const DB_SNIPSET = `#!/bin/sh
db="$HOME/.local/share/Snipset/snipset.db"
if [ "$1" = --db ]; then db="$2"; shift 2; fi
case "$1 $2" in
  "init "*)
    if [ -e "$db" ]; then echo "database already exists" >&2; exit 1; fi
    mkdir -p "\${db%/*}"
    printf 'u1\\thii\\tHalo, ada yang bisa dibantu?\\n' > "$db" ;;
  "snippet list") [ -f "$db" ] || exit 1; cat "$db" ;;
  "snippet expand")
    [ -f "$db" ] || exit 1
    while IFS="$(printf '\\t')" read -r _u kw text; do
      if [ "$kw" = "$3" ]; then printf '%s\\n' "$text"; exit 0; fi
    done < "$db"
    exit 1 ;;
  *) echo "snipset 0.1.0" ;;
esac
`;

const DB_SHIMS = `#!/usr/bin/env bash
set -euo pipefail
DIR="$HOME/.local/bin"
while [ $# -gt 0 ]; do case "$1" in --dir) DIR="$2"; shift 2 ;; *) shift ;; esac; done
mkdir -p "$DIR"
DB_ARGS=()
[ -n "\${SNIPSET_DB:-}" ] && DB_ARGS=(--db "$SNIPSET_DB")
: > "$DIR/.snipset-shims"
snipset "\${DB_ARGS[@]}" snippet list --limit 500 | while IFS=$'\\t' read -r _uuid keyword _rest; do
  target="$DIR/$keyword"
  cat > "$target" <<SHIM
#!/bin/sh
# snipset-shim for '$keyword' (print mode, managed by snipset-shims; do not edit).
if [ -n "\\\${SNIPSET_DB:-}" ]; then
  expanded=\\$(snipset --db "\\$SNIPSET_DB" snippet expand '$keyword' --by-keyword --clipboard "\\\${1:-}" 2>/dev/null) || { echo "snipset: expand failed for '$keyword'" >&2; exit 1; }
else
  expanded=\\$(snipset snippet expand '$keyword' --by-keyword --clipboard "\\\${1:-}" 2>/dev/null) || { echo "snipset: expand failed for '$keyword'" >&2; exit 1; }
fi
printf '%s\\n' "\\$expanded"
SHIM
  chmod 755 "$target"
  printf '%s\\n' "$keyword" >> "$DIR/.snipset-shims"
  echo "snipset-shims: installed '$keyword'"
done
`;

function dbRelease() {
  const dir = mkdtempSync(join(tmpdir(), "snipset-t03-rel-"));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  const stage = join(dir, ".stage");
  const files = {
    snipset: DB_SNIPSET,
    LICENSE: "MIT\n",
    "shell/snipset.sh": "# snipset.sh fixture\n",
    "shell/completion.bash": "# completion.bash fixture\n",
    "shell/tab.sh": "# tab.sh fixture\n",
    "shell/snipset-shims.sh": DB_SHIMS,
  };
  mkdirSync(join(stage, "shell"), { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(stage, name), content);
    chmodSync(join(stage, name), 0o755);
  }
  const asset = "snipset-cli-v0.1.0-x86_64-unknown-linux-gnu.tar.gz";
  const tar = spawnSync("tar", ["-czf", join(dir, asset), "-C", stage, ...Object.keys(files)]);
  if (tar.status !== 0) throw new Error(String(tar.stderr));
  const digest = createHash("sha256").update(readFileSync(join(dir, asset))).digest("hex");
  writeFileSync(join(dir, "SHA256SUMS"), `${digest}  ${asset}\n`);
  return dir;
}

function blockLine(stdout) {
  return stdout.split("\n").filter((line) => line.includes("] shell block:"));
}

test("shell fixes: without --db the block is byte-identical to the v0.2.0 block", async () => {
  const sb = setup();
  const bashrc = join(sb.home, ".bashrc");
  writeFileSync(bashrc, USER_RC);
  const install = await runInstaller(sb, FLAGS);
  expect(install.code, `${install.stdout}\n${install.stderr}`).toBe(0);
  expect(readFileSync(bashrc, "utf8")).toBe(`${USER_RC}\n${v020Block(sb.home)}`);
});

test("shell fixes: --db exports SNIPSET_DB so a shim in a new shell expands from that database", async () => {
  const sb = makeSandbox();
  cleanups.push(() => cleanupSandbox(sb));
  const from = dbRelease();
  const db = join(sb.home, "my data", "snipset.db");
  const install = await runInstaller(sb, ["--from", from, "--db", db]);
  expect(install.code, `${install.stdout}\n${install.stderr}`).toBe(0);
  const run = spawnSync(join(sb.bin, "bash"), ["-ic", "hii"], { encoding: "utf8", env: sb.env(), cwd: sb.home });
  expect(run.stdout, run.stderr).toBe("Halo, ada yang bisa dibantu?\n");
  expect(run.status).toBe(0);
  expect(readFileSync(join(sb.home, ".bashrc"), "utf8")).toBe(`\n${dbBlock(sb.home, db)}`);
});

test("shell fixes: --check with --db reports a v0.2.0 block as DRIFT", async () => {
  const sb = setup();
  const bashrc = join(sb.home, ".bashrc");
  const flags = [...FLAGS, "--db", join(sb.home, "data", "s.db")];
  expect((await runInstaller(sb, flags)).code).toBe(0);
  writeFileSync(bashrc, `${USER_RC}\n${v020Block(sb.home)}`);
  const check = await runInstaller(sb, [...flags, "--check"]);
  expect(check.code).toBe(1);
  expect(blockLine(check.stdout)).toHaveLength(1);
  expect(blockLine(check.stdout)[0]).toStartWith("[DRIFT] shell block: ");
});

test("shell fixes: a re-install with --db upgrades a v0.2.0 block and uninstall removes it", async () => {
  const sb = setup();
  const bashrc = join(sb.home, ".bashrc");
  const db = join(sb.home, "data", "s.db");
  const flags = [...FLAGS, "--db", db];
  writeFileSync(bashrc, `${USER_RC}\n${v020Block(sb.home)}`);
  const install = await runInstaller(sb, flags);
  expect(install.code, `${install.stdout}\n${install.stderr}`).toBe(0);
  expect(readFileSync(bashrc, "utf8")).toBe(`${USER_RC}\n${dbBlock(sb.home, db)}`);
  const check = await runInstaller(sb, [...flags, "--check"]);
  expect(check.code, check.stdout).toBe(0);
  expect(check.stdout).toContain("check: CURRENT");
  const uninstall = await runInstaller(sb, [...flags, "--uninstall"]);
  expect(uninstall.code, `${uninstall.stdout}\n${uninstall.stderr}`).toBe(0);
  expect(readFileSync(bashrc, "utf8")).toBe(USER_RC);
});

test("shell fixes: uninstall with --db removes a v0.2.0 block", async () => {
  const sb = setup();
  const bashrc = join(sb.home, ".bashrc");
  const flags = [...FLAGS, "--db", join(sb.home, "data", "s.db")];
  expect((await runInstaller(sb, flags)).code).toBe(0);
  writeFileSync(bashrc, `${USER_RC}\n${v020Block(sb.home)}`);
  const uninstall = await runInstaller(sb, [...flags, "--uninstall"]);
  expect(uninstall.code, `${uninstall.stdout}\n${uninstall.stderr}`).toBe(0);
  expect(blockLine(uninstall.stdout)).toEqual([`[REMOVED] shell block: ${bashrc}`]);
  expect(readFileSync(bashrc, "utf8")).toBe(USER_RC);
});

test("shell fixes: a bashrc without a final newline is byte-identical after install and uninstall", async () => {
  const sb = setup();
  const bashrc = join(sb.home, ".bashrc");
  const before = "# user line\nalias ll=ls";
  writeFileSync(bashrc, before);
  const install = await runInstaller(sb, FLAGS);
  expect(install.code, `${install.stdout}\n${install.stderr}`).toBe(0);
  expect(readFileSync(bashrc, "utf8")).toBe(`${before}\n${v020Block(sb.home)}`);
  const uninstall = await runInstaller(sb, [...FLAGS, "--uninstall"]);
  expect(uninstall.code, `${uninstall.stdout}\n${uninstall.stderr}`).toBe(0);
  expect(JSON.stringify(readFileSync(bashrc, "utf8"))).toBe(JSON.stringify(before));
});

test("shell fixes: re-install with another --db rewrites the export", async () => {
  const sb = setup();
  const bashrc = join(sb.home, ".bashrc");
  const second = join(sb.home, "data", "b.db");
  writeFileSync(bashrc, USER_RC);
  expect((await runInstaller(sb, [...FLAGS, "--db", join(sb.home, "data", "a.db")])).code).toBe(0);
  const install = await runInstaller(sb, [...FLAGS, "--db", second]);
  expect(install.code, `${install.stdout}\n${install.stderr}`).toBe(0);
  expect(readFileSync(bashrc, "utf8")).toBe(`${USER_RC}\n${dbBlock(sb.home, second)}`);
  const check = await runInstaller(sb, [...FLAGS, "--db", second, "--check"]);
  expect(check.code, check.stdout).toBe(0);
  expect(check.stdout).toContain("check: CURRENT");
});

test("shell fixes: re-install without --db drops the export", async () => {
  const sb = setup();
  const bashrc = join(sb.home, ".bashrc");
  writeFileSync(bashrc, USER_RC);
  expect((await runInstaller(sb, [...FLAGS, "--db", join(sb.home, "data", "a.db")])).code).toBe(0);
  const install = await runInstaller(sb, FLAGS);
  expect(install.code, `${install.stdout}\n${install.stderr}`).toBe(0);
  expect(readFileSync(bashrc, "utf8")).toBe(`${USER_RC}\n${v020Block(sb.home)}`);
  const check = await runInstaller(sb, [...FLAGS, "--check"]);
  expect(check.code, check.stdout).toBe(0);
  expect(check.stdout).toContain("check: CURRENT");
});

test("shell fixes: --check names a block that exports another database", async () => {
  const sb = setup();
  const flags = [...FLAGS, "--db", join(sb.home, "data", "b.db")];
  expect((await runInstaller(sb, [...FLAGS, "--db", join(sb.home, "data", "a.db")])).code).toBe(0);
  expect((await runInstaller(sb, flags)).code).toBe(0);
  writeFileSync(join(sb.home, ".bashrc"), `${USER_RC}\n${dbBlock(sb.home, join(sb.home, "data", "a.db"))}`);
  const check = await runInstaller(sb, [...flags, "--check"]);
  expect(check.code).toBe(1);
  expect(blockLine(check.stdout)).toHaveLength(1);
  expect(blockLine(check.stdout)[0]).toMatch(/^\[DRIFT\] shell block: .*SNIPSET_DB/);
});

test("shell fixes: uninstall with another --db still removes the installer's block", async () => {
  const sb = setup();
  const bashrc = join(sb.home, ".bashrc");
  writeFileSync(bashrc, USER_RC);
  expect((await runInstaller(sb, [...FLAGS, "--db", join(sb.home, "data", "a.db")])).code).toBe(0);
  const uninstall = await runInstaller(sb, [...FLAGS, "--db", join(sb.home, "data", "b.db"), "--uninstall"]);
  expect(uninstall.code, `${uninstall.stdout}\n${uninstall.stderr}`).toBe(0);
  expect(blockLine(uninstall.stdout)).toEqual([`[REMOVED] shell block: ${bashrc}`]);
  expect(readFileSync(bashrc, "utf8")).toBe(USER_RC);
});

test("shell fixes: an edited block that exports a database is kept by install and uninstall", async () => {
  const sb = setup();
  const bashrc = join(sb.home, ".bashrc");
  const db = join(sb.home, "data", "a.db");
  const edited = `${USER_RC}\n${dbBlock(sb.home, db).replace("tab.sh\"\n", "tab.sh\" # mine\n")}`;
  expect((await runInstaller(sb, [...FLAGS, "--db", db])).code).toBe(0);
  writeFileSync(bashrc, edited);
  expect((await runInstaller(sb, [...FLAGS, "--db", join(sb.home, "data", "b.db")])).code).toBe(0);
  expect(readFileSync(bashrc, "utf8")).toBe(edited);
  const uninstall = await runInstaller(sb, [...FLAGS, "--uninstall"]);
  expect(uninstall.code).toBe(0);
  expect(readFileSync(bashrc, "utf8")).toBe(edited);
});
