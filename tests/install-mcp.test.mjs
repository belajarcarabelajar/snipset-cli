import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import {
  cleanupSandbox,
  downloaderShims,
  fakeLinuxRelease,
  makeSandbox,
  runInstaller,
  stubCommand,
} from "./helpers/install-sandbox.mjs";
import {
  IDS,
  STUBS,
  adds,
  calls,
  claudeGetStub,
  geminiSettings,
  mcpPaths,
  removes,
  seed,
  writeFile,
} from "./helpers/mcp-stubs.mjs";

const BASE = ["--version", "0.1.0", "--no-shell", "--no-shims", "--no-init"];
const sandboxes = [];
const releases = [];

afterEach(async () => {
  for (const sb of sandboxes.splice(0)) await cleanupSandbox(sb);
  for (const dir of releases.splice(0)) await rm(dir, { recursive: true, force: true });
});

function setup({ stubs = ["claude", "codex", "gemini", "code"], failAdd = [] } = {}) {
  const sb = makeSandbox();
  sandboxes.push(sb);
  const release = fakeLinuxRelease();
  releases.push(release.dir);
  downloaderShims(sb, release);
  for (const name of stubs) stubCommand(sb, name, STUBS[name]({ failAdd: failAdd.includes(name) }));
  const installDir = join(sb.home, "bin");
  const paths = mcpPaths(sb);
  return { sb, installDir, bin: join(installDir, "snipset"), paths, args: [...BASE, "--install-dir", installDir] };
}

function results(stdout) {
  const re = new RegExp(`^\\[[A-Z]+\\] (${IDS.join("|")}): `);
  return stdout.split("\n").filter((line) => re.test(line));
}

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

test("vscode: an mcp.json without snipset makes code --add-mcp run once and check passes", async () => {
  const { sb, bin, paths, args } = setup();
  writeFile(paths.vscode, '{"servers":{}}\n');
  const r = await runInstaller(sb, [...args, "--with-mcp=vscode"]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(results(r.stdout), ["[ADD] vscode: snipset registered"]);
  assert.deepEqual(adds(sb), [["code", "--add-mcp", JSON.stringify({ name: "snipset", command: bin, args: ["mcp"] })]]);
  const c = await runInstaller(sb, [...args, "--check", "--with-mcp=vscode"]);
  assert.deepEqual(results(c.stdout), [`[OK] vscode: snipset points at ${bin}`]);
  assert.equal(c.code, 0, c.stdout + c.stderr);
});

test("an opencode or cursor file without snipset is kept at install and is not drift in check", async () => {
  const { sb, paths, args } = setup({ stubs: [] });
  writeFile(paths.opencode, '{"mcp":{}}\n');
  writeFile(paths.cursor, '{"mcpServers":{}}\n');
  const r = await runInstaller(sb, [...args, "--with-mcp=opencode,cursor"]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(results(r.stdout), [
    `[KEEP] opencode: ${paths.opencode} exists; left untouched`,
    `[KEEP] cursor: ${paths.cursor} exists; left untouched`,
  ]);
  const c = await runInstaller(sb, [...args, "--check", "--with-mcp=opencode,cursor"]);
  assert.deepEqual(results(c.stdout), [
    `[KEEP] opencode: ${paths.opencode} exists without snipset; not managed by the installer`,
    `[KEEP] cursor: ${paths.cursor} exists without snipset; not managed by the installer`,
  ]);
  assert.equal(c.code, 0, c.stdout + c.stderr);
  assert.equal(readFileSync(paths.opencode, "utf8"), '{"mcp":{}}\n');
  assert.equal(readFileSync(paths.cursor, "utf8"), '{"mcpServers":{}}\n');
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
