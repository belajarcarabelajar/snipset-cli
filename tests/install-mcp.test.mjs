import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  cleanupSandbox,
  downloaderShims,
  fakeLinuxRelease,
  makeSandbox,
  runInstaller,
  stubCommand,
} from "./helpers/install-sandbox.mjs";

const IDS = ["claude", "codex", "gemini", "opencode", "cursor", "vscode"];
const BASE = ["--version", "0.1.0", "--no-shell", "--no-shims", "--no-init"];
const sandboxes = [];
const releases = [];

afterEach(async () => {
  for (const sb of sandboxes.splice(0)) await cleanupSandbox(sb);
  for (const dir of releases.splice(0)) await rm(dir, { recursive: true, force: true });
});

// Each stub logs its argv as one tab-separated line and keeps its registry in
// "$HOME/.stub-<cli>" (line 1 command, line 2 args), like the vendor config file.
const LOG_ARGV = (name) =>
  `{ printf '%s' ${name}; for a in "$@"; do printf '\\t%s' "$a"; done; printf '\\n'; } >> "$HOME/mcp-calls.log"\n`;

function getStyleStub(name, getOutput, { failAdd = false } = {}) {
  return `${LOG_ARGV(name)}reg="$HOME/.stub-${name}"
[ "$1" = mcp ] || exit 2
case "$2" in
  get)
    if [ ! -f "$reg" ]; then echo "No MCP server named snipset" >&2; exit 1; fi
    cmd=$(sed -n 1p "$reg"); args=$(sed -n 2p "$reg")
    ${getOutput} ;;
  add)
    ${failAdd ? 'echo "boom first" >&2; echo "second line" >&2; exit 1' : ":"}
    while [ "$1" != -- ]; do shift; done
    shift; cmd="$1"; shift
    printf '%s\\n%s\\n' "$cmd" "$*" > "$reg" ;;
  remove)
    if [ ! -f "$reg" ]; then echo "not found" >&2; exit 1; fi
    mv "$reg" "$reg.removed" ;;
  *) exit 2 ;;
esac
`;
}

const STUBS = {
  claude: (opts) =>
    getStyleStub(
      "claude",
      `printf 'snipset:\\n  Scope: User config (available in all your projects)\\n  Type: stdio\\n  Command: %s\\n  Args: %s\\n' "$cmd" "$args"`,
      opts,
    ),
  codex: (opts) =>
    getStyleStub(
      "codex",
      `printf 'snipset\\n  enabled: true\\n  transport: stdio\\n  command: %s\\n  args: %s\\n' "$cmd" "$args"`,
      opts,
    ),
  // "$HOME/.stub-gemini" is the merged view "mcp list" prints (any scope); add and
  // "remove --scope user" also write the user settings file, like the real CLI.
  gemini: () => `${LOG_ARGV("gemini")}reg="$HOME/.stub-gemini"
settings="$HOME/.gemini/settings.json"
[ "$1" = mcp ] || exit 2
case "$2" in
  list)
    if [ ! -f "$reg" ]; then echo "No MCP servers configured."; exit 0; fi
    printf 'Configured MCP servers:\\n\\n\\033[32m+\\033[0m snipset: %s %s (stdio) - Connected\\n' "$(sed -n 1p "$reg")" "$(sed -n 2p "$reg")" ;;
  add)
    shift 2
    while [ "$1" = --scope ]; do shift 2; done
    shift; cmd="$1"; shift
    printf '%s\\n%s\\n' "$cmd" "$*" > "$reg"
    a=""; for x in "$@"; do a="$a\${a:+, }\\"$x\\""; done
    mkdir -p "$HOME/.gemini"
    printf '{\\n  "mcpServers": {\\n    "snipset": {\\n      "command": "%s",\\n      "args": [%s]\\n    }\\n  }\\n}\\n' "$cmd" "$a" > "$settings" ;;
  remove)
    if [ ! -f "$settings" ]; then echo "not found" >&2; exit 1; fi
    mv "$settings" "$settings.removed" ;;
  *) exit 2 ;;
esac
`,
  code: () => `${LOG_ARGV("code")}[ "$1" = --add-mcp ] || exit 2
mkdir -p "$HOME/.config/Code/User"
printf '{"servers":{"snipset":%s}}\\n' "$2" > "$HOME/.config/Code/User/mcp.json"
`,
};

function setup({ stubs = ["claude", "codex", "gemini", "code"], failAdd = [] } = {}) {
  const sb = makeSandbox();
  sandboxes.push(sb);
  const release = fakeLinuxRelease();
  releases.push(release.dir);
  downloaderShims(sb, release);
  for (const name of stubs) stubCommand(sb, name, STUBS[name]({ failAdd: failAdd.includes(name) }));
  const installDir = join(sb.home, "bin");
  const paths = {
    opencode: join(sb.home, ".config", "opencode", "opencode.json"),
    cursor: join(sb.home, ".cursor", "mcp.json"),
    vscode: join(sb.home, ".config", "Code", "User", "mcp.json"),
  };
  return { sb, installDir, bin: join(installDir, "snipset"), paths, args: [...BASE, "--install-dir", installDir] };
}

function calls(sb) {
  const log = join(sb.home, "mcp-calls.log");
  if (!existsSync(log)) return [];
  return readFileSync(log, "utf8").split("\n").filter(Boolean).map((line) => line.split("\t"));
}

const adds = (sb) => calls(sb).filter((argv) => argv[2] === "add" || argv[1] === "--add-mcp");

function results(stdout) {
  const re = new RegExp(`^\\[[A-Z]+\\] (${IDS.join("|")}): `);
  return stdout.split("\n").filter((line) => re.test(line));
}

function seed(sb, cli, command, args = "mcp") {
  writeFileSync(join(sb.home, `.stub-${cli}`), `${command}\n${args}\n`);
}

function writeFile(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

const SCOPES = {
  user: ["User config (available in all your projects)", "user"],
  local: ["Local config (private to you in this project)", "local"],
  project: ["Project config (shared via .mcp.json)", "project"],
};

// The observed "claude mcp get" output shape. The real CLI prints only the
// highest-precedence scope (local over user); this stub may print several blocks.
function claudeGetStub(blocks) {
  const text = blocks
    .map(
      ([scope, command]) =>
        `snipset:\n  Scope: ${SCOPES[scope][0]}\n  Status: ✘ Failed to connect\n  Type: stdio\n  Command: ${command}\n  Args: mcp\n  Environment:\n\nTo remove this server, run: claude mcp remove snipset -s ${SCOPES[scope][1]}\n`,
    )
    .join("\n");
  return `${LOG_ARGV("claude")}[ "$1" = mcp ] || exit 2
case "$2" in
  get) cat <<'EOF'
${text}EOF
    ;;
  remove) : ;;
  *) exit 2 ;;
esac
`;
}

// A string is the command of a lone "snipset" entry; an object is the whole mcpServers map.
function geminiSettings(sb, servers) {
  const mcpServers = typeof servers === "string" ? { snipset: { command: servers, args: ["mcp"] } } : servers;
  writeFile(join(sb.home, ".gemini", "settings.json"), `${JSON.stringify({ mcpServers }, null, 2)}\n`);
}

const removes = (sb) => calls(sb).filter((argv) => argv[2] === "remove");

test("--with-mcp=all registers six harnesses with one result line each", async () => {
  const { sb, bin, paths, args } = setup();
  const r = await runInstaller(sb, [...args, "--with-mcp=all"]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(
    results(r.stdout).map((line) => line.split(":")[0]),
    IDS.map((id) => `[ADD] ${id}`),
  );
  assert.deepEqual(adds(sb), [
    ["claude", "mcp", "add", "--scope", "user", "snipset", "--", bin, "mcp"],
    ["codex", "mcp", "add", "snipset", "--", bin, "mcp"],
    ["gemini", "mcp", "add", "--scope", "user", "snipset", bin, "mcp"],
    ["code", "--add-mcp", JSON.stringify({ name: "snipset", command: bin, args: ["mcp"] })],
  ]);
  assert.equal(
    readFileSync(paths.cursor, "utf8"),
    `${JSON.stringify({ mcpServers: { snipset: { type: "stdio", command: bin, args: ["mcp"] } } })}\n`,
  );
  assert.deepEqual(JSON.parse(readFileSync(paths.opencode, "utf8")).mcp.snipset.command, [bin, "mcp"]);
});

test("existing claude, codex, gemini, and vscode entries are kept without an add call", async () => {
  const { sb, paths, args } = setup();
  for (const cli of ["claude", "codex", "gemini"]) seed(sb, cli, "/elsewhere/snipset");
  writeFile(paths.vscode, '{"servers":{"snipset":{"command":"/elsewhere/snipset"}}}\n');
  const r = await runInstaller(sb, [...args, "--with-mcp=claude,codex,gemini,vscode"]);
  assert.equal(r.code, 0, r.stderr);
  for (const id of ["claude", "codex", "gemini", "vscode"]) {
    assert.ok(r.stdout.includes(`[KEEP] ${id}: snipset is already registered\n`), r.stdout);
  }
  assert.deepEqual(adds(sb), []);
  assert.equal(readFileSync(join(sb.home, ".stub-claude"), "utf8"), "/elsewhere/snipset\nmcp\n");
});

test("an existing cursor file is kept and the snippet is printed instead", async () => {
  const { sb, bin, paths, args } = setup();
  writeFile(paths.cursor, '{"mcpServers":{}}\n');
  const r = await runInstaller(sb, [...args, "--with-mcp=cursor"]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /^\[KEEP\] cursor: /m);
  assert.ok(r.stderr.includes(`"snipset":{"type":"stdio","command":"${bin}","args":["mcp"]}`), r.stderr);
  assert.equal(readFileSync(paths.cursor, "utf8"), '{"mcpServers":{}}\n');
});

test("a harness whose CLI is not on PATH is skipped", async () => {
  const { sb, args } = setup({ stubs: [] });
  const r = await runInstaller(sb, [...args, "--with-mcp=claude,codex,gemini,vscode"]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(results(r.stdout), [
    "[SKIP] claude: claude not on PATH",
    "[SKIP] codex: codex not on PATH",
    "[SKIP] gemini: gemini not on PATH",
    "[SKIP] vscode: code not on PATH",
  ]);
});

test("--db is forwarded to every harness", async () => {
  const { sb, bin, paths, args } = setup();
  const db = join(sb.home, "my data", "custom.db");
  const r = await runInstaller(sb, [...args, "--db", db, "--with-mcp=all"]);
  assert.equal(r.code, 0, r.stderr);
  const tail = ["mcp", "--db", db];
  for (const argv of adds(sb).filter((a) => a[0] !== "code")) {
    assert.deepEqual(argv.slice(-4), [bin, ...tail], argv.join(" "));
  }
  const vscode = adds(sb).find((a) => a[0] === "code");
  assert.deepEqual(JSON.parse(vscode[2]).args, tail);
  assert.deepEqual(JSON.parse(readFileSync(paths.cursor, "utf8")).mcpServers.snipset.args, tail);
  assert.deepEqual(JSON.parse(readFileSync(paths.opencode, "utf8")).mcp.snipset.command, [bin, ...tail]);
});

test("a failing add reports its first stderr line and the loop continues", async () => {
  const { sb, args } = setup({ failAdd: ["claude"] });
  const r = await runInstaller(sb, [...args, "--with-mcp=claude,codex"]);
  assert.equal(r.code, 1, r.stderr);
  assert.deepEqual(results(r.stdout), ["[FAIL] claude: boom first", "[ADD] codex: snipset registered"]);
});

test("check reports OK for every entry that points at the installed binary", async () => {
  const { sb, args } = setup();
  assert.equal((await runInstaller(sb, [...args, "--with-mcp=all"])).code, 0);
  const r = await runInstaller(sb, [...args, "--check", "--with-mcp=all"]);
  assert.deepEqual(
    results(r.stdout).map((line) => line.split(":")[0]),
    IDS.map((id) => `[OK] ${id}`),
  );
});

test("check reports a foreign entry as KEEP, an absent one as MISSING, and a missing CLI as SKIP", async () => {
  const { sb, args } = setup({ stubs: ["claude", "codex"] });
  seed(sb, "claude", "/elsewhere/snipset");
  const r = await runInstaller(sb, [...args, "--check", "--with-mcp=claude,codex,gemini,cursor"]);
  assert.deepEqual(results(r.stdout), [
    "[KEEP] claude: snipset points elsewhere",
    "[MISSING] codex: snipset is not registered",
    "[SKIP] gemini: gemini not on PATH",
    `[MISSING] cursor: snipset is not registered`,
  ]);
  assert.equal(r.code, 1, "MISSING counts as drift");
});

test("check without a --with-mcp list skips mcp", async () => {
  const { sb, args } = setup();
  const r = await runInstaller(sb, [...args, "--check"]);
  assert.ok(r.stdout.includes("[SKIP] mcp: no --with-mcp list\n"), r.stdout);
  assert.deepEqual(results(r.stdout), []);
});

test("uninstall removes only entries that point at the installed binary", async () => {
  const { sb, paths, args } = setup();
  seed(sb, "codex", "/elsewhere/snipset");
  const install = await runInstaller(sb, [...args, "--with-mcp=all"]);
  assert.equal(install.code, 0, install.stderr);
  const r = await runInstaller(sb, [...args, "--uninstall", "--with-mcp=all"]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(removes(sb), [
    ["claude", "mcp", "remove", "--scope", "user", "snipset"],
    ["gemini", "mcp", "remove", "--scope", "user", "snipset"],
  ]);
  assert.equal(readFileSync(join(sb.home, ".stub-codex"), "utf8"), "/elsewhere/snipset\nmcp\n");
  assert.ok(!existsSync(paths.opencode));
  assert.ok(!existsSync(paths.cursor));
  assert.ok(existsSync(paths.vscode));
  assert.deepEqual(results(r.stdout), [
    "[REMOVED] claude: snipset",
    "[KEEP] codex: snipset points elsewhere",
    "[REMOVED] gemini: snipset",
    `[REMOVED] opencode: ${paths.opencode}`,
    `[REMOVED] cursor: ${paths.cursor}`,
    `[KEEP] vscode: remove snipset from ${paths.vscode} by hand`,
  ]);
});

test("uninstall keeps an opencode or cursor file that differs from what the installer writes", async () => {
  const { sb, paths, args } = setup({ stubs: [] });
  assert.equal((await runInstaller(sb, [...args, "--with-mcp=opencode,cursor"])).code, 0);
  for (const id of ["opencode", "cursor"]) writeFileSync(paths[id], `${readFileSync(paths[id], "utf8")} `);
  const r = await runInstaller(sb, [...args, "--uninstall", "--with-mcp=opencode,cursor"]);
  assert.equal(r.code, 0, r.stderr);
  assert.ok(existsSync(paths.opencode));
  assert.ok(existsSync(paths.cursor));
  assert.match(r.stdout, /^\[KEEP\] opencode: /m);
  assert.match(r.stdout, /^\[KEEP\] cursor: /m);
});

test("uninstall without a --with-mcp list calls no harness CLI and keeps every MCP file", async () => {
  const { sb, bin, paths, args } = setup();
  assert.equal((await runInstaller(sb, [...args, "--with-mcp=opencode,cursor"])).code, 0);
  seed(sb, "claude", bin);
  seed(sb, "codex", bin);
  geminiSettings(sb, bin);
  const r = await runInstaller(sb, [...args, "--uninstall"]);
  assert.equal(r.code, 0, r.stderr);
  assert.ok(r.stdout.includes("[SKIP] mcp: no --with-mcp list\n"), r.stdout);
  assert.deepEqual(calls(sb), []);
  assert.deepEqual(results(r.stdout), []);
  assert.ok(existsSync(paths.opencode));
  assert.ok(existsSync(paths.cursor));
});

test("claude: a local-scope entry for the binary and a user-scope entry elsewhere are both kept", async () => {
  const { sb, bin, args } = setup({ stubs: [] });
  stubCommand(sb, "claude", claudeGetStub([["local", bin], ["user", "/elsewhere/snipset"]]));
  const r = await runInstaller(sb, [...args, "--uninstall", "--with-mcp=claude"]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(removes(sb), []);
  assert.deepEqual(results(r.stdout), ["[KEEP] claude: local entry left untouched"]);
});

test("claude: a local-scope entry for the binary is not OK in check and is kept by uninstall", async () => {
  const { sb, bin, args } = setup({ stubs: [] });
  stubCommand(sb, "claude", claudeGetStub([["local", bin]]));
  const check = await runInstaller(sb, [...args, "--check", "--with-mcp=claude"]);
  assert.deepEqual(results(check.stdout), ["[KEEP] claude: local entry left untouched"]);
  const r = await runInstaller(sb, [...args, "--uninstall", "--with-mcp=claude"]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(removes(sb), []);
  assert.deepEqual(results(r.stdout), ["[KEEP] claude: local entry left untouched"]);
});

test("claude: a user-scope entry for another binary is kept by uninstall", async () => {
  const { sb, args } = setup({ stubs: [] });
  stubCommand(sb, "claude", claudeGetStub([["user", "/elsewhere/snipset"]]));
  const r = await runInstaller(sb, [...args, "--uninstall", "--with-mcp=claude"]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(removes(sb), []);
  assert.deepEqual(results(r.stdout), ["[KEEP] claude: user entry left untouched"]);
});

test("claude: a user-scope entry for the binary is removed with --scope user", async () => {
  const { sb, bin, args } = setup({ stubs: [] });
  stubCommand(sb, "claude", claudeGetStub([["user", bin]]));
  const check = await runInstaller(sb, [...args, "--check", "--with-mcp=claude"]);
  assert.deepEqual(results(check.stdout), [`[OK] claude: snipset points at ${bin}`]);
  const r = await runInstaller(sb, [...args, "--uninstall", "--with-mcp=claude"]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(removes(sb), [["claude", "mcp", "remove", "--scope", "user", "snipset"]]);
  assert.deepEqual(results(r.stdout), ["[REMOVED] claude: snipset"]);
});

test("gemini: uninstall keeps an entry when the user settings file points elsewhere", async () => {
  const { sb, bin, args } = setup({ stubs: ["gemini"] });
  seed(sb, "gemini", bin);
  geminiSettings(sb, "/elsewhere/snipset");
  const r = await runInstaller(sb, [...args, "--uninstall", "--with-mcp=gemini"]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(removes(sb), []);
  assert.deepEqual(results(r.stdout), ["[KEEP] gemini: snipset points elsewhere"]);
  assert.ok(existsSync(join(sb.home, ".gemini", "settings.json")));
});

test("gemini: uninstall keeps an entry that is not in the user settings file", async () => {
  const { sb, bin, args } = setup({ stubs: ["gemini"] });
  seed(sb, "gemini", bin);
  const settings = join(sb.home, ".gemini", "settings.json");
  const check = await runInstaller(sb, [...args, "--check", "--with-mcp=gemini"]);
  assert.deepEqual(results(check.stdout), [`[KEEP] gemini: snipset is registered outside ${settings}; left untouched`]);
  const r = await runInstaller(sb, [...args, "--uninstall", "--with-mcp=gemini"]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(removes(sb), []);
  assert.deepEqual(results(r.stdout), [`[KEEP] gemini: snipset is registered outside ${settings}; left untouched`]);
});

test("gemini: uninstall removes the user settings entry for the binary even when the list shows another scope", async () => {
  const { sb, bin, args } = setup({ stubs: ["gemini"] });
  seed(sb, "gemini", "/elsewhere/snipset");
  geminiSettings(sb, bin);
  const check = await runInstaller(sb, [...args, "--check", "--with-mcp=gemini"]);
  assert.deepEqual(results(check.stdout), [`[OK] gemini: snipset points at ${bin}`]);
  const r = await runInstaller(sb, [...args, "--uninstall", "--with-mcp=gemini"]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(removes(sb), [["gemini", "mcp", "remove", "--scope", "user", "snipset"]]);
  assert.deepEqual(results(r.stdout), ["[REMOVED] gemini: snipset"]);
});

test("gemini: a snipset-dev entry for the binary does not make a foreign snipset entry ours", async () => {
  const { sb, bin, args } = setup({ stubs: ["gemini"] });
  const foreign = { command: "/opt/other/snipset", args: ["mcp"] };
  const dev = { command: bin, args: ["mcp"] };
  for (const servers of [{ snipset: foreign, "snipset-dev": dev }, { "snipset-dev": dev, snipset: foreign }]) {
    seed(sb, "gemini", foreign.command);
    geminiSettings(sb, servers);
    const order = Object.keys(servers).join(",");
    const check = await runInstaller(sb, [...args, "--check", "--with-mcp=gemini"]);
    assert.deepEqual(results(check.stdout), ["[KEEP] gemini: snipset points elsewhere"], order);
    const r = await runInstaller(sb, [...args, "--uninstall", "--with-mcp=gemini"]);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(removes(sb), [], order);
    assert.deepEqual(results(r.stdout), ["[KEEP] gemini: snipset points elsewhere"], order);
    assert.ok(existsSync(join(sb.home, ".gemini", "settings.json")), order);
  }
});

test("gemini: a nested object holding the binary inside a foreign snipset entry is not ours", async () => {
  const { sb, bin, args } = setup({ stubs: ["gemini"] });
  geminiSettings(sb, { snipset: { env: { command: bin }, command: "/opt/other/snipset", args: ["mcp"] } });
  const r = await runInstaller(sb, [...args, "--uninstall", "--with-mcp=gemini"]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(removes(sb), []);
  assert.deepEqual(results(r.stdout), ["[KEEP] gemini: snipset points elsewhere"]);
});

test("gemini: a dot in the binary path does not match a path that differs at the dot", async () => {
  const { sb } = setup({ stubs: ["gemini"] });
  const installDir = join(sb.home, "my.bin");
  geminiSettings(sb, join(sb.home, "myXbin", "snipset"));
  const r = await runInstaller(sb, [...BASE, "--install-dir", installDir, "--uninstall", "--with-mcp=gemini"]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(removes(sb), []);
  assert.deepEqual(results(r.stdout), ["[KEEP] gemini: snipset points elsewhere"]);
});

test("gemini: a dot in the binary path still matches its own entry", async () => {
  const { sb } = setup({ stubs: ["gemini"] });
  const installDir = join(sb.home, "my.bin");
  const bin = join(installDir, "snipset");
  geminiSettings(sb, bin);
  const check = await runInstaller(sb, [...BASE, "--install-dir", installDir, "--check", "--with-mcp=gemini"]);
  assert.deepEqual(results(check.stdout), [`[OK] gemini: snipset points at ${bin}`]);
});
