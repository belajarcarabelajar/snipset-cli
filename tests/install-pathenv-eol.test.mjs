import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import {
  cleanupSandbox,
  downloaderShims,
  fakeLinuxRelease,
  makeSandbox,
  runInstaller,
} from "./helpers/install-sandbox.mjs";

const MARK = "# snipset-path (managed by snipset installer; safe to remove)";
const QUIET = ["--add-path", "--no-shell", "--no-init", "--no-shims"];
// A login shell named zsh makes the installer manage ~/.zshenv without zsh being installed.
const ZSH = { SHELL: "/usr/bin/zsh" };
const FILES = [".profile", ".bash_profile", ".zshenv"];

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
  sb.share = join(sb.home, ".local", "share", "snipset");
  sb.at = (...parts) => join(sb.home, ...parts);
  return sb;
}

function seed(path, content) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
}

async function ok(sb, args) {
  const result = await runInstaller(sb, args, { env: ZSH });
  assert.equal(result.code, 0, `${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
  return result;
}

async function roundTrip(contentFor) {
  const sb = setup();
  for (const name of FILES) seed(sb.at(name), contentFor(name));
  await ok(sb, QUIET);
  const line = `. "${sb.share}/env" ${MARK}`;
  for (const name of FILES) {
    assert.ok(readFileSync(sb.at(name), "utf8").includes(`\n${line}\n`), `${name} has the source line`);
  }
  await ok(sb, ["--uninstall", ...QUIET]);
  return sb;
}

test("pathenv eol: startup files without a final newline are byte-identical after install and uninstall", async () => {
  const content = (name) => `# user ${name}\nexport FOO=1`;
  const sb = await roundTrip(content);
  for (const name of FILES) {
    assert.equal(readFileSync(sb.at(name), "utf8"), content(name), name);
  }
});

test("pathenv eol: startup files with a final newline are byte-identical after install and uninstall", async () => {
  const content = (name) => `# user ${name}\nexport FOO=1\n`;
  const sb = await roundTrip(content);
  for (const name of FILES) {
    assert.equal(readFileSync(sb.at(name), "utf8"), content(name), name);
  }
});
