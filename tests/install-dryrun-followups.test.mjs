import { afterEach, expect, test } from "bun:test";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import {
  cleanupSandbox,
  diffSnapshots,
  downloaderShims,
  fakeLinuxRelease,
  makeSandbox,
  readDownloads,
  runInstaller,
  snapshotTree,
} from "./helpers/install-sandbox.mjs";

const MARKER = "# snipset-terminal-integration (managed by snipset installer; safe to remove)";
const USER_RC = "# user line\nalias ll='ls -l'\n";

const cleanups = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()();
});

function setup() {
  const sb = makeSandbox();
  cleanups.push(() => cleanupSandbox(sb));
  const rel = fakeLinuxRelease();
  cleanups.push(() => rm(rel.dir, { recursive: true, force: true }));
  downloaderShims(sb, rel);
  return { sb, rel };
}

const lines = (text) => text.split("\n").filter((line) => line.length > 0);
const blockLines = (stdout) => lines(stdout).filter((line) => line.startsWith("[DRY] shell block:"));

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

async function expectSameFailure(sb, args, missing) {
  const real = await runInstaller(sb, args);
  expect(real.code, `${real.stdout}${real.stderr}`).toBe(1);
  expect(real.stderr).toContain(`${missing} is missing`);
  const dry = await runInstaller(sb, ["--dry-run", ...args]);
  expect(dry.code, `${dry.stdout}${dry.stderr}`).toBe(real.code);
  expect(dry.stderr).toBe(real.stderr);
  expect(dry.stdout).not.toContain("nothing was written");
}

test("dry run followups: --from without SHA256SUMS fails like the real run", async () => {
  const { sb, rel } = setup();
  rmSync(rel.sums);
  await expectSameFailure(sb, ["--version", "0.1.0", "--from", rel.dir], join(rel.dir, "SHA256SUMS"));
  await expectSameFailure(sb, ["--from", rel.dir], join(rel.dir, "SHA256SUMS"));
});

test("dry run followups: --from without the archive fails like the real run", async () => {
  const { sb, rel } = setup();
  await expectSameFailure(
    sb,
    ["--version", "0.2.0", "--from", rel.dir],
    join(rel.dir, "snipset-cli-v0.2.0-x86_64-unknown-linux-gnu.tar.gz"),
  );
  rmSync(rel.archive);
  await expectSameFailure(sb, ["--from", rel.dir], rel.archive);
});

test("dry run followups: a valid --from still writes nothing", async () => {
  const { sb, rel } = setup();
  const home = snapshotTree(sb.home);
  const tmp = snapshotTree(sb.tmp);
  const relDir = snapshotTree(rel.dir);
  for (const args of [
    ["--dry-run", "--from", rel.dir],
    ["--dry-run", "--version", "0.1.0", "--from", rel.dir],
  ]) {
    const r = await runInstaller(sb, args);
    expect(r.code, `${args.join(" ")}\n${r.stdout}${r.stderr}`).toBe(0);
    expect(lines(r.stdout).at(-1)).toBe("dry run: nothing was written");
    expect(diffSnapshots(home, snapshotTree(sb.home))).toEqual([]);
    expect(diffSnapshots(tmp, snapshotTree(sb.tmp))).toEqual([]);
  }
  expect(diffSnapshots(relDir, snapshotTree(rel.dir))).toEqual([]);
  expect(readDownloads(sb)).toEqual([]);
});

async function dryBlockLine(sb, rc, extra = []) {
  const bashrc = join(sb.home, ".bashrc");
  if (rc !== undefined) writeFileSync(bashrc, rc);
  const r = await runInstaller(sb, ["--dry-run", "--version", "0.1.0", ...extra]);
  expect(r.code, `${r.stdout}${r.stderr}`).toBe(0);
  if (rc !== undefined) expect(readFileSync(bashrc, "utf8")).toBe(rc);
  return blockLines(r.stdout);
}

test("dry run followups: an exact block gives keep", async () => {
  const { sb } = setup();
  const got = await dryBlockLine(sb, `${USER_RC}\n${v020Block(sb.home)}`);
  expect(got).toEqual([`[DRY] shell block: keep ${join(sb.home, ".bashrc")}`]);
});

test("dry run followups: a v0.2.0 block with --db gives upgrade", async () => {
  const { sb } = setup();
  const got = await dryBlockLine(sb, `${USER_RC}\n${v020Block(sb.home)}`, ["--db", join(sb.home, "data", "s.db")]);
  expect(got).toEqual([`[DRY] shell block: upgrade ${join(sb.home, ".bashrc")}`]);
});

test("dry run followups: no block gives add to", async () => {
  const { sb } = setup();
  const bashrc = join(sb.home, ".bashrc");
  expect(await dryBlockLine(sb, USER_RC)).toEqual([`[DRY] shell block: add to ${bashrc}`]);
  rmSync(bashrc);
  expect(await dryBlockLine(sb, undefined)).toEqual([`[DRY] shell block: add to ${bashrc}`]);
});
