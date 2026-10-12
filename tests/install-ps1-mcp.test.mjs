import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanupSandbox, makeSandbox, stubCommand } from "./helpers/install-sandbox.mjs";

const pwshPath = Bun.which("pwsh");
const pwshSkip = pwshPath ? false : "pwsh not on PATH";
// bun test prints a skipped test's name but not its reason, so say it once here.
if (pwshSkip) console.warn(`skipping install.ps1 MCP tests: ${pwshSkip}`);

const part = (name) => fileURLToPath(new URL(`../scripts/installer/ps1/${name}`, import.meta.url));
const libPart = process.env.SNIPSET_PS1_LIB ?? part("lib.ps1");
const mcpPart = process.env.SNIPSET_PS1_MCP ?? part("mcp.ps1");
const IDS = ["claude", "codex", "gemini", "opencode", "cursor", "vscode"];
const OPTS = { skip: pwshSkip, timeout: 60000 };
const sandboxes = [];

afterEach(async () => {
  for (const sb of sandboxes.splice(0)) await cleanupSandbox(sb);
});

// Same stubs as tests/install-mcp.test.mjs: each logs its argv as one tab-separated
// line and keeps its registry in "$HOME/.stub-<cli>" (line 1 command, line 2 args).
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

function setup({ stubs = ["claude", "codex", "gemini", "code"], failAdd = [], binDir = "bin" } = {}) {
  const sb = makeSandbox();
  sandboxes.push(sb);
  for (const name of stubs) stubCommand(sb, name, STUBS[name]({ failAdd: failAdd.includes(name) }));
  const paths = {
    opencode: join(sb.home, ".config", "opencode", "opencode.json"),
    cursor: join(sb.home, ".cursor", "mcp.json"),
    vscode: join(sb.home, ".config", "Code", "User", "mcp.json"),
  };
  return { sb, bin: join(sb.home, binDir, "snipset.exe"), paths };
}

// pwsh 7.6 colours error records even when stderr is a pipe.
const stripAnsi = (text) => text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");

// Dot-sources lib.ps1 and mcp.ps1 like the bundle does, then runs `body`.
// Ids, bin, and db travel through the environment so no path needs PowerShell quoting.
function ps(sb, body, { ids = [], bin, db } = {}) {
  const script = `. $env:LIB_PART; . $env:MCP_PART; $ids = @($env:IDS -split ',' | Where-Object { $_ }); ${body}`;
  const env = sb.env({ NO_COLOR: "1", LIB_PART: libPart, MCP_PART: mcpPart, IDS: ids.join(","), BIN: bin ?? "", DB: db ?? "" });
  return new Promise((resolve, reject) => {
    const child = spawn(pwshPath, ["-NoProfile", "-NonInteractive", "-Command", script], { env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout: stripAnsi(stdout), stderr: stripAnsi(stderr) }));
  });
}

const dbArg = (db) => (db ? " -Db $env:DB" : "");
const install = (sb, opts) => ps(sb, `Install-SnipsetMcp -Ids $ids -Bin $env:BIN${dbArg(opts.db)}`, opts);
const check = (sb, opts) => ps(sb, "Test-SnipsetMcp -Ids $ids -Bin $env:BIN", opts);
const remove = (sb, opts) => ps(sb, "Remove-SnipsetMcp -Ids $ids -Bin $env:BIN", opts);

function calls(sb) {
  const log = join(sb.home, "mcp-calls.log");
  if (!existsSync(log)) return [];
  return readFileSync(log, "utf8").split("\n").filter(Boolean).map((line) => line.split("\t"));
}

const adds = (sb) => calls(sb).filter((argv) => argv[2] === "add" || argv[1] === "--add-mcp");

function results(stdout) {
  const re = new RegExp(`^\\[[A-Z]+\\] (${IDS.join("|")}|mcp): `);
  return stdout.split(/\r?\n/).filter((line) => re.test(line));
}

function seed(sb, cli, command, args = "mcp") {
  writeFileSync(join(sb.home, `.stub-${cli}`), `${command}\n${args}\n`);
}

function writeFile(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

const opencodeJson = (command) =>
  `${JSON.stringify({ $schema: "https://opencode.ai/config.json", mcp: { snipset: { type: "local", command, enabled: true } } })}\n`;
const cursorJson = (bin, args) => `${JSON.stringify({ mcpServers: { snipset: { type: "stdio", command: bin, args } } })}\n`;

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

function geminiSettings(sb, command) {
  writeFile(
    join(sb.home, ".gemini", "settings.json"),
    `${JSON.stringify({ mcpServers: { snipset: { command, args: ["mcp"] } } }, null, 2)}\n`,
  );
}

const removes = (sb) => calls(sb).filter((argv) => argv[2] === "remove");

test("mcp.ps1 parses and uses neither the script scope nor exit", OPTS, async () => {
  const sb = makeSandbox();
  sandboxes.push(sb);
  const r = await ps(
    sb,
    "$t = $null; $e = $null; $ast = [Management.Automation.Language.Parser]::ParseFile($env:MCP_PART, [ref]$t, [ref]$e); " +
      "$fns = @($ast.FindAll({ param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] }, $false) | ForEach-Object { $_.Name }); " +
      "\"errors=$($e.Count)\"; \"script=$(@($t | Where-Object { $_.Text -match '^\\$script:' }).Count)\"; " +
      "\"exit=$(@($t | Where-Object { $_.Kind -eq 'Exit' }).Count)\"; \"fns=$($fns -join ',')\"",
  );
  assert.equal(r.code, 0, r.stderr);
  const out = r.stdout.split(/\r?\n/);
  for (const line of ["errors=0", "script=0", "exit=0"]) assert.ok(out.includes(line), r.stdout);
  const fns = out.find((line) => line.startsWith("fns=")).slice(4).split(",");
  for (const name of ["Install-SnipsetMcp", "Test-SnipsetMcp", "Remove-SnipsetMcp"]) assert.ok(fns.includes(name), r.stdout);
});

test("Install-SnipsetMcp registers all six ids with one result line each", OPTS, async () => {
  const { sb, bin, paths } = setup();
  const r = await install(sb, { ids: IDS, bin });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(results(r.stdout), [
    "[ADD] claude: snipset registered",
    "[ADD] codex: snipset registered",
    "[ADD] gemini: snipset registered",
    `[ADD] opencode: wrote ${paths.opencode}`,
    `[ADD] cursor: wrote ${paths.cursor}`,
    "[ADD] vscode: snipset registered",
  ]);
  assert.deepEqual(adds(sb), [
    ["claude", "mcp", "add", "--scope", "user", "snipset", "--", bin, "mcp"],
    ["codex", "mcp", "add", "snipset", "--", bin, "mcp"],
    ["gemini", "mcp", "add", "--scope", "user", "snipset", bin, "mcp"],
    ["code", "--add-mcp", JSON.stringify({ name: "snipset", command: bin, args: ["mcp"] })],
  ]);
  // Exact bytes: compact JSON, a final newline, and no UTF-8 BOM.
  assert.equal(readFileSync(paths.cursor, "utf8"), cursorJson(bin, ["mcp"]));
  assert.equal(readFileSync(paths.opencode, "utf8"), opencodeJson([bin, "mcp"]));
  assert.notEqual(readFileSync(paths.cursor)[0], 0xef);
});

test("an existing claude, codex, gemini, or vscode entry gives KEEP and no add call", OPTS, async () => {
  const { sb, bin, paths } = setup();
  for (const cli of ["claude", "codex", "gemini"]) seed(sb, cli, "/elsewhere/snipset");
  writeFile(paths.vscode, '{"servers":{"snipset":{"command":"/elsewhere/snipset"}}}\n');
  const r = await install(sb, { ids: ["claude", "codex", "gemini", "vscode"], bin });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(
    results(r.stdout),
    ["claude", "codex", "gemini", "vscode"].map((id) => `[KEEP] ${id}: snipset is already registered`),
  );
  assert.deepEqual(adds(sb), []);
  assert.equal(readFileSync(join(sb.home, ".stub-claude"), "utf8"), "/elsewhere/snipset\nmcp\n");
});

test("an existing cursor or opencode file is left untouched and the cursor snippet is printed", OPTS, async () => {
  const { sb, bin, paths } = setup({ stubs: [] });
  writeFile(paths.cursor, '{"mcpServers":{}}\n');
  writeFile(paths.opencode, '{"mcp":{}}\n');
  const r = await install(sb, { ids: ["opencode", "cursor"], bin });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(results(r.stdout), [
    `[KEEP] opencode: ${paths.opencode} exists; left untouched`,
    `[KEEP] cursor: ${paths.cursor} exists; left untouched`,
  ]);
  assert.ok(r.stdout.includes(`MCP config exists; leaving ${paths.opencode} untouched`), r.stdout);
  assert.ok(r.stdout.includes(`"snipset":{"type":"stdio","command":"${bin}","args":["mcp"]}`), r.stdout);
  assert.equal(readFileSync(paths.cursor, "utf8"), '{"mcpServers":{}}\n');
  assert.equal(readFileSync(paths.opencode, "utf8"), '{"mcp":{}}\n');
});

test("a harness whose CLI is not on PATH is skipped", OPTS, async () => {
  const { sb, bin } = setup({ stubs: [] });
  const r = await install(sb, { ids: ["claude", "codex", "gemini", "vscode"], bin });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(results(r.stdout), [
    "[SKIP] claude: claude not on PATH",
    "[SKIP] codex: codex not on PATH",
    "[SKIP] gemini: gemini not on PATH",
    "[SKIP] vscode: code not on PATH",
  ]);
});

test("-Db is forwarded to every harness", OPTS, async () => {
  const { sb, bin, paths } = setup();
  const db = join(sb.home, "my data", "custom.db");
  const r = await install(sb, { ids: IDS, bin, db });
  assert.equal(r.code, 0, r.stderr);
  const tail = ["mcp", "--db", db];
  for (const argv of adds(sb).filter((a) => a[0] !== "code")) {
    assert.deepEqual(argv.slice(-4), [bin, ...tail], argv.join(" "));
  }
  const vscode = adds(sb).find((a) => a[0] === "code");
  assert.deepEqual(JSON.parse(vscode[2]).args, tail);
  assert.equal(readFileSync(paths.cursor, "utf8"), cursorJson(bin, tail));
  assert.equal(readFileSync(paths.opencode, "utf8"), opencodeJson([bin, ...tail]));
});

test("a failing add reports its first stderr line, counts into $run, and the loop continues", OPTS, async () => {
  const { sb, bin } = setup({ failAdd: ["claude"] });
  const body = "$run = @{ drift = 0; kept = 0; removed = 0; fail = 0 }; Install-SnipsetMcp -Ids $ids -Bin $env:BIN; \"fail=$($run.fail)\"";
  const r = await ps(sb, body, { ids: ["claude", "codex"], bin });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(results(r.stdout), ["[FAIL] claude: boom first", "[ADD] codex: snipset registered"]);
  assert.ok(r.stdout.split(/\r?\n/).includes("fail=1"), r.stdout);
});

test("arguments with quotes and spaces survive legacy native argument passing", OPTS, async () => {
  const { sb, bin } = setup({ binDir: "my apps" });
  const r = await ps(sb, "$PSNativeCommandArgumentPassing = 'Legacy'; Install-SnipsetMcp -Ids $ids -Bin $env:BIN", {
    ids: ["claude", "vscode"],
    bin,
  });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(adds(sb), [
    ["claude", "mcp", "add", "--scope", "user", "snipset", "--", bin, "mcp"],
    ["code", "--add-mcp", JSON.stringify({ name: "snipset", command: bin, args: ["mcp"] })],
  ]);
});

test("Test-SnipsetMcp reports OK for every entry that points at the bin", OPTS, async () => {
  const { sb, bin } = setup();
  assert.equal((await install(sb, { ids: IDS, bin })).code, 0);
  const r = await check(sb, { ids: IDS, bin });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(
    results(r.stdout),
    IDS.map((id) => `[OK] ${id}: snipset points at ${bin}`),
  );
});

test("Test-SnipsetMcp reports a foreign entry as KEEP, an absent one as MISSING, and a missing CLI as SKIP", OPTS, async () => {
  const { sb, bin } = setup({ stubs: ["claude", "codex"] });
  seed(sb, "claude", "/elsewhere/snipset");
  const body = "$run = @{ drift = 0; kept = 0; removed = 0; fail = 0 }; Test-SnipsetMcp -Ids $ids -Bin $env:BIN; \"drift=$($run.drift)\"";
  const r = await ps(sb, body, { ids: ["claude", "codex", "gemini", "cursor"], bin });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(results(r.stdout), [
    "[KEEP] claude: snipset points elsewhere",
    "[MISSING] codex: snipset is not registered",
    "[SKIP] gemini: gemini not on PATH",
    "[MISSING] cursor: snipset is not registered",
  ]);
  assert.ok(r.stdout.split(/\r?\n/).includes("drift=2"), r.stdout);
});

test("Test-SnipsetMcp without ids skips mcp", OPTS, async () => {
  const { sb, bin } = setup();
  const r = await check(sb, { ids: [], bin });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(results(r.stdout), ["[SKIP] mcp: no -WithMcp list"]);
  assert.deepEqual(calls(sb), []);
});

test("Remove-SnipsetMcp without ids scans all six and keeps a foreign entry", OPTS, async () => {
  const { sb, bin, paths } = setup();
  seed(sb, "codex", "/elsewhere/snipset");
  assert.equal((await install(sb, { ids: IDS, bin })).code, 0);
  const r = await remove(sb, { ids: [], bin });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(calls(sb).filter((argv) => argv[2] === "remove"), [
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

test("Remove-SnipsetMcp keeps an opencode or cursor file that differs from what the installer writes", OPTS, async () => {
  const { sb, bin, paths } = setup({ stubs: [] });
  assert.equal((await install(sb, { ids: ["opencode", "cursor"], bin })).code, 0);
  for (const id of ["opencode", "cursor"]) writeFileSync(paths[id], `${readFileSync(paths[id], "utf8")} `);
  const r = await remove(sb, { ids: ["opencode", "cursor"], bin });
  assert.equal(r.code, 0, r.stderr);
  assert.ok(existsSync(paths.opencode));
  assert.ok(existsSync(paths.cursor));
  assert.deepEqual(results(r.stdout), [
    `[KEEP] opencode: ${paths.opencode} differs from what the installer writes; remove snipset by hand`,
    `[KEEP] cursor: ${paths.cursor} differs from what the installer writes; remove snipset by hand`,
  ]);
});

test("claude: a local-scope entry for the bin and a user-scope entry elsewhere are both kept", OPTS, async () => {
  const { sb, bin } = setup({ stubs: [] });
  stubCommand(sb, "claude", claudeGetStub([["local", bin], ["user", "/elsewhere/snipset"]]));
  const r = await remove(sb, { ids: ["claude"], bin });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(removes(sb), []);
  assert.deepEqual(results(r.stdout), ["[KEEP] claude: local entry left untouched"]);
});

test("claude: a local-scope entry for the bin is not OK in Test-SnipsetMcp and is kept by Remove-SnipsetMcp", OPTS, async () => {
  const { sb, bin } = setup({ stubs: [] });
  stubCommand(sb, "claude", claudeGetStub([["local", bin]]));
  const c = await check(sb, { ids: ["claude"], bin });
  assert.deepEqual(results(c.stdout), ["[KEEP] claude: local entry left untouched"]);
  const r = await remove(sb, { ids: ["claude"], bin });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(removes(sb), []);
  assert.deepEqual(results(r.stdout), ["[KEEP] claude: local entry left untouched"]);
});

test("claude: a user-scope entry for another binary is kept by Remove-SnipsetMcp", OPTS, async () => {
  const { sb, bin } = setup({ stubs: [] });
  stubCommand(sb, "claude", claudeGetStub([["user", "/elsewhere/snipset"]]));
  const r = await remove(sb, { ids: ["claude"], bin });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(removes(sb), []);
  assert.deepEqual(results(r.stdout), ["[KEEP] claude: user entry left untouched"]);
});

test("claude: a user-scope entry for the bin is OK and is removed with --scope user", OPTS, async () => {
  const { sb, bin } = setup({ stubs: [] });
  stubCommand(sb, "claude", claudeGetStub([["user", bin]]));
  const c = await check(sb, { ids: ["claude"], bin });
  assert.deepEqual(results(c.stdout), [`[OK] claude: snipset points at ${bin}`]);
  const r = await remove(sb, { ids: ["claude"], bin });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(removes(sb), [["claude", "mcp", "remove", "--scope", "user", "snipset"]]);
  assert.deepEqual(results(r.stdout), ["[REMOVED] claude: snipset"]);
});

test("gemini: Remove-SnipsetMcp keeps an entry when the user settings file points elsewhere", OPTS, async () => {
  const { sb, bin } = setup({ stubs: ["gemini"] });
  seed(sb, "gemini", bin);
  geminiSettings(sb, "/elsewhere/snipset");
  const r = await remove(sb, { ids: ["gemini"], bin });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(removes(sb), []);
  assert.deepEqual(results(r.stdout), ["[KEEP] gemini: snipset points elsewhere"]);
  assert.ok(existsSync(join(sb.home, ".gemini", "settings.json")));
});

test("gemini: an entry that is not in the user settings file is kept by Test-SnipsetMcp and Remove-SnipsetMcp", OPTS, async () => {
  const { sb, bin } = setup({ stubs: ["gemini"] });
  seed(sb, "gemini", bin);
  const settings = join(sb.home, ".gemini", "settings.json");
  const c = await check(sb, { ids: ["gemini"], bin });
  assert.deepEqual(results(c.stdout), [`[KEEP] gemini: snipset is registered outside ${settings}; left untouched`]);
  const r = await remove(sb, { ids: ["gemini"], bin });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(removes(sb), []);
  assert.deepEqual(results(r.stdout), [`[KEEP] gemini: snipset is registered outside ${settings}; left untouched`]);
});

test("gemini: the user settings entry for the bin is OK and removed even when the list shows another scope", OPTS, async () => {
  const { sb, bin } = setup({ stubs: ["gemini"] });
  seed(sb, "gemini", "/elsewhere/snipset");
  geminiSettings(sb, bin);
  const c = await check(sb, { ids: ["gemini"], bin });
  assert.deepEqual(results(c.stdout), [`[OK] gemini: snipset points at ${bin}`]);
  const r = await remove(sb, { ids: ["gemini"], bin });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(removes(sb), [["gemini", "mcp", "remove", "--scope", "user", "snipset"]]);
  assert.deepEqual(results(r.stdout), ["[REMOVED] gemini: snipset"]);
});
