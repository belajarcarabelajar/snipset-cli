import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
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

const cleanups = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()();
});

function sandboxWithRelease(version = "0.2.0") {
  const sb = makeSandbox();
  cleanups.push(() => cleanupSandbox(sb));
  const rel = fakeLinuxRelease({ version });
  cleanups.push(() => rm(rel.dir, { recursive: true, force: true }));
  downloaderShims(sb, rel);
  return { sb, rel };
}

const lines = (text) => text.split("\n").filter((line) => line.length > 0);

test("dry run validate: --version garbage exits 2 and prints invalid version", async () => {
  const { sb } = sandboxWithRelease();
  const before = snapshotTree(sb.home);
  const r = await runInstaller(sb, ["--dry-run", "--version", "garbage"]);
  assert.equal(r.code, 2, `${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /invalid version/);
  assert.doesNotMatch(r.stdout, /use garbage/);
  assert.deepEqual(readDownloads(sb), []);
  assert.deepEqual(diffSnapshots(before, snapshotTree(sb.home)), []);
});

test("dry run validate: --version 0.2.0 --from <assets> prints v0.2.0", async () => {
  const { sb, rel } = sandboxWithRelease();
  const r = await runInstaller(sb, ["--dry-run", "--version", "0.2.0", "--from", rel.dir]);
  assert.equal(r.code, 0, r.stderr);
  assert.ok(lines(r.stdout).includes("[DRY] version: use v0.2.0"), r.stdout);
  assert.deepEqual(readDownloads(sb), []);
});

test("dry run validate: --from a missing directory exits non-zero like the real run", async () => {
  const { sb } = sandboxWithRelease();
  const missing = join(sb.root, "nonexistent");
  const real = await runInstaller(sb, ["--from", missing]);
  assert.notEqual(real.code, 0, real.stdout);
  const dry = await runInstaller(sb, ["--dry-run", "--from", missing]);
  assert.equal(dry.code, real.code, `${dry.stdout}${dry.stderr}`);
  assert.equal(dry.stderr, real.stderr);
  assert.doesNotMatch(dry.stdout, /nothing was written/);
});

test("dry run validate: a valid dry run still writes nothing", async () => {
  const { sb, rel } = sandboxWithRelease();
  const home = snapshotTree(sb.home);
  const tmp = snapshotTree(sb.tmp);
  const relDir = snapshotTree(rel.dir);
  for (const args of [
    ["--dry-run", "--version", "0.2.0"],
    ["--dry-run", "--version", "v0.2.0", "--from", rel.dir],
    ["--dry-run", "--from", rel.dir],
  ]) {
    const r = await runInstaller(sb, args);
    assert.equal(r.code, 0, `${args.join(" ")}\n${r.stdout}${r.stderr}`);
    assert.equal(lines(r.stdout).at(-1), "dry run: nothing was written", args.join(" "));
    assert.deepEqual(diffSnapshots(home, snapshotTree(sb.home)), [], args.join(" "));
    assert.deepEqual(diffSnapshots(tmp, snapshotTree(sb.tmp)), [], args.join(" "));
  }
  assert.deepEqual(diffSnapshots(relDir, snapshotTree(rel.dir)), []);
  assert.deepEqual(readDownloads(sb), []);
});
