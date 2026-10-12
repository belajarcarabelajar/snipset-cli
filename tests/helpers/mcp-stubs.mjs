// Harness CLI stubs and probes shared by tests/install-mcp.test.mjs and
// tests/install-ps1-mcp.test.mjs. Each stub logs its argv as one tab-separated
// line and keeps its registry in "$HOME/.stub-<cli>" (line 1 command, line 2 args),
// like the vendor config file.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const IDS = ["claude", "codex", "gemini", "opencode", "cursor", "vscode"];

export const LOG_ARGV = (name) =>
  `{ printf '%s' ${name}; for a in "$@"; do printf '\\t%s' "$a"; done; printf '\\n'; } >> "$HOME/mcp-calls.log"\n`;

export function getStyleStub(name, getOutput, { failAdd = false } = {}) {
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

export const STUBS = {
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

export const mcpPaths = (sb) => ({
  opencode: join(sb.home, ".config", "opencode", "opencode.json"),
  cursor: join(sb.home, ".cursor", "mcp.json"),
  vscode: join(sb.home, ".config", "Code", "User", "mcp.json"),
});

export function calls(sb) {
  const log = join(sb.home, "mcp-calls.log");
  if (!existsSync(log)) return [];
  return readFileSync(log, "utf8").split("\n").filter(Boolean).map((line) => line.split("\t"));
}

export const adds = (sb) => calls(sb).filter((argv) => argv[2] === "add" || argv[1] === "--add-mcp");

export const removes = (sb) => calls(sb).filter((argv) => argv[2] === "remove");

export function seed(sb, cli, command, args = "mcp") {
  writeFileSync(join(sb.home, `.stub-${cli}`), `${command}\n${args}\n`);
}

export function writeFile(path, content) {
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
export function claudeGetStub(blocks) {
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
export function geminiSettings(sb, servers) {
  const mcpServers = typeof servers === "string" ? { snipset: { command: servers, args: ["mcp"] } } : servers;
  writeFile(join(sb.home, ".gemini", "settings.json"), `${JSON.stringify({ mcpServers }, null, 2)}\n`);
}
