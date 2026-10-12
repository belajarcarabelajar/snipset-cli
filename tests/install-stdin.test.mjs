import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  cleanupSandbox,
  downloaderShims,
  fakeLinuxRelease,
  makeSandbox,
  runInstallerPiped,
  stubCommand,
} from "./helpers/install-sandbox.mjs";
import { STUBS as HARNESS_STUBS, mcpPaths } from "./helpers/mcp-stubs.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FLAGS = ["--with-mcp=claude,codex,gemini,vscode", "--no-init", "--no-shims"];
const SENTINEL = "AFTER-SENTINEL";
// Under "curl | bash" the bytes after the bundle are what a harness CLI would swallow from stdin.
const TRAILER = `printf '${SENTINEL}\\n'\n`;
const LOG = "stdin-calls.log";

const sandboxes = [];
const dirs = [];

afterEach(async () => {
  for (const sb of sandboxes.splice(0)) await cleanupSandbox(sb);
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

// Each call logs "<name> <argv> <bytes read from stdin>", then runs the stateful harness stub
// the MCP suites use: a probe finds nothing until "add", then reports exactly what was added,
// so install adds and uninstall reaches "remove" through mcp_run.
const readStdin = (name) => `n=$(wc -c)
printf '%s %s %s\\n' ${name} "$*" "$n" >> "$HOME/${LOG}"
`;
const STUBS = Object.fromEntries(
  ["claude", "codex", "gemini", "code"].map((name) => [name, `${readStdin(name)}${HARNESS_STUBS[name]()}`]),
);

function setup() {
  const sb = makeSandbox();
  sandboxes.push(sb);
  const release = fakeLinuxRelease();
  dirs.push(release.dir);
  downloaderShims(sb, release);
  for (const [name, body] of Object.entries(STUBS)) stubCommand(sb, name, body);
  return sb;
}

const installedBin = (sb) => join(sb.home, ".local", "bin", "snipset");

function takeLog(sb) {
  const path = join(sb.home, LOG);
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, "utf8").split("\n").filter(Boolean);
  writeFileSync(path, "");
  return lines.map((line) => {
    const at = line.lastIndexOf(" ");
    return { argv: line.slice(0, at), bytes: Number(line.slice(at + 1).trim()) };
  });
}

function assertCalls(calls, expected) {
  assert.equal(calls.length, expected.length, JSON.stringify(calls));
  calls.forEach((call, i) => {
    const want = expected[i];
    assert.ok(call.argv === want || call.argv.startsWith(`${want} `), `${call.argv} vs ${want}`);
  });
}

const INSTALL_CALLS = [
  "claude mcp get",
  "claude mcp add",
  "codex mcp get",
  "codex mcp add",
  "gemini mcp list",
  "gemini mcp add",
  "code --add-mcp",
];
// gemini is probed through ~/.gemini/settings.json, which its add wrote, so no "list" here;
// vscode is probed through its mcp.json and kept for removal by hand, so no "code" call.
const UNINSTALL_CALLS = [
  "claude mcp get",
  "claude mcp remove --scope user snipset",
  "codex mcp get",
  "codex mcp remove snipset",
  "gemini mcp remove --scope user snipset",
];

// A private bundle of the committed HEAD parts, built by the repo's build.mjs into a temp root.
function buildHeadBundle(mutate = (name, text) => text) {
  const root = mkdtempSync(join(tmpdir(), "snipset-stdin-head-"));
  dirs.push(root);
  const partsDir = join(root, "scripts", "installer", "sh");
  mkdirSync(partsDir, { recursive: true });
  const show = (path) => execFileSync("git", ["show", `HEAD:${path}`], { cwd: REPO_ROOT, encoding: "utf8" });
  const order = show("scripts/installer/sh/ORDER");
  writeFileSync(join(partsDir, "ORDER"), order);
  const names = order.split("\n").map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
  for (const name of names) {
    writeFileSync(join(partsDir, name), mutate(name, show(`scripts/installer/sh/${name}`)));
  }
  execFileSync(
    process.execPath,
    [join(REPO_ROOT, "scripts", "installer", "build.mjs"), "--target", "sh", "--root", root, "--out", root],
    { cwd: REPO_ROOT, stdio: ["ignore", "pipe", "pipe"] },
  );
  return join(root, "install.sh");
}

const MCP_RUN = /^mcp_run\(\) \{\n[\s\S]*?\n\}\n/m;

function dropMcpRunRedirect(name, text) {
  if (name !== "mcp.sh") return text;
  const body = text.match(MCP_RUN)?.[0];
  assert.ok(body, "mcp_run() not found in HEAD mcp.sh");
  assert.equal(body.split("</dev/null").length - 1, 1, `mcp_run() should hold one </dev/null:\n${body}`);
  // A function replacement: the body holds $' and $@, which a string replacement would expand.
  return text.replace(body, () => body.replace(" </dev/null", () => ""));
}

test("piped install and uninstall: harness CLIs read 0 bytes of stdin and the trailer still runs", async () => {
  const sb = setup();

  const install = await runInstallerPiped(sb, FLAGS, { trailer: TRAILER });
  assert.equal(install.code, 0, install.stderr);
  const installCalls = takeLog(sb);
  assertCalls(installCalls, INSTALL_CALLS);
  for (const call of installCalls) assert.equal(call.bytes, 0, `install: ${call.argv} read stdin`);
  assert.ok(install.stdout.endsWith(`${SENTINEL}\n`), install.stdout);
  const bin = installedBin(sb);
  for (const cli of ["claude", "codex", "gemini"]) {
    assert.equal(readFileSync(join(sb.home, `.stub-${cli}`), "utf8"), `${bin}\nmcp\n`, cli);
  }
  assert.ok(readFileSync(mcpPaths(sb).vscode, "utf8").includes(`"command":"${bin}"`));

  const uninstall = await runInstallerPiped(sb, ["--uninstall", ...FLAGS], { trailer: TRAILER });
  assert.equal(uninstall.code, 0, uninstall.stderr);
  const uninstallCalls = takeLog(sb);
  assertCalls(uninstallCalls, UNINSTALL_CALLS);
  for (const call of uninstallCalls) assert.equal(call.bytes, 0, `uninstall: ${call.argv} read stdin`);
  for (const cli of ["claude", "codex", "gemini"]) {
    assert.ok(uninstall.stdout.includes(`[REMOVED] ${cli}: snipset\n`), uninstall.stdout);
  }
  assert.ok(uninstall.stdout.includes(`[KEEP] vscode: remove snipset from ${mcpPaths(sb).vscode} by hand\n`));
  assert.ok(uninstall.stdout.endsWith(`${SENTINEL}\n`), uninstall.stdout);
});

test("piped uninstall control: without </dev/null in mcp_run the first remove swallows the trailer", async () => {
  const script = buildHeadBundle(dropMcpRunRedirect);
  assert.ok(!readFileSync(script, "utf8").includes('>/dev/null </dev/null)" || rc=$?'), "mcp_run kept its redirect");

  const sb = setup();
  const install = await runInstallerPiped(sb, FLAGS, { trailer: TRAILER });
  assert.equal(install.code, 0, install.stderr);
  takeLog(sb);
  const r = await runInstallerPiped(sb, ["--uninstall", ...FLAGS], { script, trailer: TRAILER });
  const calls = takeLog(sb);
  assert.ok(calls.some((call) => call.argv.startsWith("claude mcp remove ")), JSON.stringify(calls));
  const swallowed = calls.filter((call) => call.bytes > 0);
  assert.ok(
    !r.stdout.endsWith(`${SENTINEL}\n`) || swallowed.length > 0,
    `the mutated bundle kept the sentinel and no stub read stdin:\n${r.stdout}`,
  );
});

test("piped install control: without </dev/null in mcp_run a harness CLI swallows the trailer", async () => {
  const plain = readFileSync(buildHeadBundle(), "utf8");
  const script = buildHeadBundle(dropMcpRunRedirect);
  const mutated = readFileSync(script, "utf8");
  assert.notEqual(mutated, plain, "the mutation did not change the bundle");
  const changed = plain.split("\n").filter((line, i) => line !== mutated.split("\n")[i]);
  assert.deepEqual(changed, ['  out="$("$@" 2>&1 >/dev/null </dev/null)" || rc=$?']);

  const sb = setup();
  const r = await runInstallerPiped(sb, FLAGS, { script, trailer: TRAILER });
  const calls = takeLog(sb);
  // The run must reach mcp_run, or a lost sentinel would prove nothing about stdin.
  assert.ok(calls.some((call) => call.argv.startsWith("claude mcp add ")), JSON.stringify(calls));
  const swallowed = calls.filter((call) => call.bytes > 0);
  assert.ok(
    !r.stdout.endsWith(`${SENTINEL}\n`) || swallowed.length > 0,
    `the mutated bundle kept the sentinel and no stub read stdin:\n${r.stdout}`,
  );
});
