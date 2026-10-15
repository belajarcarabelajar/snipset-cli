import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import {
  cleanupSandbox,
  downloaderShims,
  fakeLinuxRelease,
  makeSandbox,
  runInstaller,
} from "./helpers/install-sandbox.mjs";
import { IDS, mcpPaths, writeFile } from "./helpers/mcp-stubs.mjs";

const BASE = ["--version", "0.1.0", "--no-shell", "--no-shims", "--no-init"];
const sandboxes = [];
const releases = [];

afterEach(async () => {
  for (const sb of sandboxes.splice(0)) await cleanupSandbox(sb);
  for (const dir of releases.splice(0)) await rm(dir, { recursive: true, force: true });
});

function setup() {
  const sb = makeSandbox();
  sandboxes.push(sb);
  const release = fakeLinuxRelease();
  releases.push(release.dir);
  downloaderShims(sb, release);
  const installDir = join(sb.home, "bin");
  return { sb, bin: join(installDir, "snipset"), paths: mcpPaths(sb), args: [...BASE, "--install-dir", installDir] };
}

function results(stdout) {
  const re = new RegExp(`^\\[[A-Z]+\\] (${IDS.join("|")}): `);
  return stdout.split("\n").filter((line) => re.test(line));
}

const siblingOnly = (bin) => ({
  opencode: `${JSON.stringify({ mcp: { "snipset-dev": { type: "local", command: [bin, "mcp", "--db", "/tmp/dev.db"] } } })}\n`,
  cursor: `${JSON.stringify({ mcpServers: { "snipset-dev": { command: bin, args: ["mcp", "--db", "/tmp/dev.db"] } } })}\n`,
});

test("mcp probe: a file holding only snipset-dev with the installed binary is not registered", async () => {
  const { sb, paths, args } = setup();
  const files = siblingOnly(join(sb.home, "bin", "snipset"));
  for (const id of ["opencode", "cursor"]) writeFile(paths[id], files[id]);
  const install = await runInstaller(sb, [...args, "--with-mcp=opencode,cursor"]);
  assert.equal(install.code, 0, install.stderr);
  assert.deepEqual(results(install.stdout), [
    `[KEEP] opencode: ${paths.opencode} exists; left untouched`,
    `[KEEP] cursor: ${paths.cursor} exists; left untouched`,
  ]);
  const check = await runInstaller(sb, [...args, "--check", "--with-mcp=opencode,cursor"]);
  assert.deepEqual(results(check.stdout), [
    `[KEEP] opencode: ${paths.opencode} exists without snipset; not managed by the installer`,
    `[KEEP] cursor: ${paths.cursor} exists without snipset; not managed by the installer`,
  ]);
  const uninstall = await runInstaller(sb, [...args, "--uninstall", "--with-mcp=opencode,cursor"]);
  assert.equal(uninstall.code, 0, uninstall.stderr);
  for (const id of ["opencode", "cursor"]) assert.equal(readFileSync(paths[id], "utf8"), files[id], id);
});

test("mcp probe: a snipset entry for another binary is foreign though a sibling runs the installed binary", async () => {
  const { sb, bin, paths, args } = setup();
  const files = {
    opencode: `${JSON.stringify({
      mcp: {
        snipset: { type: "local", command: ["/elsewhere/snipset", "mcp"] },
        "snipset-dev": { type: "local", command: [bin, "mcp"] },
      },
    })}\n`,
    cursor: `${JSON.stringify({
      mcpServers: {
        snipset: { command: "/elsewhere/snipset", args: ["mcp"] },
        "snipset-dev": { command: bin, args: ["mcp"] },
      },
    })}\n`,
  };
  for (const id of ["opencode", "cursor"]) writeFile(paths[id], files[id]);
  const check = await runInstaller(sb, [...args, "--check", "--with-mcp=opencode,cursor"]);
  assert.deepEqual(results(check.stdout), [
    "[KEEP] opencode: snipset points elsewhere",
    "[KEEP] cursor: snipset points elsewhere",
  ]);
  const uninstall = await runInstaller(sb, [...args, "--uninstall", "--with-mcp=opencode,cursor"]);
  assert.equal(uninstall.code, 0, uninstall.stderr);
  for (const id of ["opencode", "cursor"]) assert.equal(readFileSync(paths[id], "utf8"), files[id], id);
});

test("mcp probe: a pretty-printed snipset entry for the installed binary is still registered", async () => {
  const { sb, bin, paths, args } = setup();
  writeFile(paths.opencode, `${JSON.stringify({ mcp: { snipset: { type: "local", command: [bin, "mcp"] } } }, null, 2)}\n`);
  writeFile(paths.cursor, `${JSON.stringify({ mcpServers: { snipset: { command: bin, args: ["mcp"] } } }, null, 2)}\n`);
  const check = await runInstaller(sb, [...args, "--check", "--with-mcp=opencode,cursor"]);
  assert.deepEqual(results(check.stdout), [
    `[OK] opencode: snipset points at ${bin}`,
    `[OK] cursor: snipset points at ${bin}`,
  ]);
});

test("mcp probe: an entry with a nested object before command is still ours", async () => {
  const { sb, bin, paths, args } = setup();
  writeFile(
    paths.opencode,
    `${JSON.stringify({ mcp: { snipset: { type: "local", environment: { X: "1" }, command: [bin, "mcp"] } } })}\n`,
  );
  writeFile(
    paths.cursor,
    `${JSON.stringify({ mcpServers: { snipset: { type: "stdio", env: { X: "1" }, command: bin, args: ["mcp"] } } }, null, 2)}\n`,
  );
  const check = await runInstaller(sb, [...args, "--check", "--with-mcp=opencode,cursor"]);
  assert.deepEqual(results(check.stdout), [
    `[OK] opencode: snipset points at ${bin}`,
    `[OK] cursor: snipset points at ${bin}`,
  ]);
});

test("mcp probe: a v0.2.0 opencode file under ~/.config is still found when XDG_CONFIG_HOME is set", async () => {
  const { sb, bin, paths, args } = setup();
  // The bytes the v0.2.0 installer (HEAD before this fix) writes, captured from a HEAD-only bundle.
  const legacy = `{"$schema":"https://opencode.ai/config.json","mcp":{"snipset":{"type":"local","command":["${bin}","mcp"],"enabled":true}}}\n`;
  writeFile(paths.opencode, legacy);
  const xdg = join(sb.root, "xdg-config");
  const env = { XDG_CONFIG_HOME: xdg };
  const install = await runInstaller(sb, [...args, "--with-mcp=opencode"], { env });
  assert.equal(install.code, 0, install.stderr);
  assert.deepEqual(results(install.stdout), ["[KEEP] opencode: snipset is already registered"]);
  assert.ok(!existsSync(join(xdg, "opencode")), "no second opencode file is written");
  assert.equal(readFileSync(paths.opencode, "utf8"), legacy);
  const check = await runInstaller(sb, [...args, "--check", "--with-mcp=opencode"], { env });
  assert.deepEqual(results(check.stdout), [`[OK] opencode: snipset points at ${bin}`]);
  assert.match(check.stdout, /^check: CURRENT$/m);
  assert.equal(check.code, 0, check.stdout + check.stderr);
  const uninstall = await runInstaller(sb, [...args, "--uninstall", "--with-mcp=opencode"], { env });
  assert.equal(uninstall.code, 0, uninstall.stderr);
  assert.deepEqual(results(uninstall.stdout), [`[REMOVED] opencode: ${paths.opencode}`]);
  assert.ok(!existsSync(paths.opencode));
});

test("mcp probe: upgrade uninstall removes the empty v0.2.0 opencode dirs", async () => {
  const { sb, bin, paths, args } = setup();
  // With XDG_CONFIG_HOME unset the install writes and records exactly what v0.2.0 did.
  const old = await runInstaller(sb, [...args, "--with-mcp=opencode"]);
  assert.equal(old.code, 0, old.stderr);
  assert.equal(
    readFileSync(paths.opencode, "utf8"),
    `{"$schema":"https://opencode.ai/config.json","mcp":{"snipset":{"type":"local","command":["${bin}","mcp"],"enabled":true}}}\n`,
  );
  const env = { XDG_CONFIG_HOME: join(sb.root, "xdg-config") };
  const uninstall = await runInstaller(sb, [...args, "--uninstall", "--with-mcp=opencode"], { env });
  assert.equal(uninstall.code, 0, uninstall.stderr);
  assert.ok(!existsSync(join(sb.home, ".config", "opencode")), "~/.config/opencode is removed");
  assert.ok(!existsSync(join(sb.home, ".config")), "~/.config is removed");
});

test("mcp probe: with XDG_CONFIG_HOME set, opencode is written under it and uninstall removes it", async () => {
  const { sb, bin, args } = setup();
  const xdg = join(sb.root, "xdg-config");
  const file = join(xdg, "opencode", "opencode.json");
  const env = { XDG_CONFIG_HOME: xdg };
  const install = await runInstaller(sb, [...args, "--with-mcp=opencode"], { env });
  assert.equal(install.code, 0, install.stderr);
  assert.deepEqual(results(install.stdout), [`[ADD] opencode: wrote ${file}`]);
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")).mcp.snipset.command, [bin, "mcp"]);
  assert.ok(!existsSync(join(sb.home, ".config", "opencode")), "nothing is written under ~/.config");
  const check = await runInstaller(sb, [...args, "--check", "--with-mcp=opencode"], { env });
  assert.deepEqual(results(check.stdout), [`[OK] opencode: snipset points at ${bin}`]);
  assert.equal(check.code, 0, check.stdout + check.stderr);
  const uninstall = await runInstaller(sb, [...args, "--uninstall", "--with-mcp=opencode"], { env });
  assert.equal(uninstall.code, 0, uninstall.stderr);
  assert.deepEqual(results(uninstall.stdout), [`[REMOVED] opencode: ${file}`]);
  assert.ok(!existsSync(xdg), "the directories the install created are removed");
});
