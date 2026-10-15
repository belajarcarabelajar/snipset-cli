import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import {
  cleanupSandbox,
  downloaderShims,
  fakeLinuxRelease,
  makeSandbox,
  runInstaller,
  snapshotTree,
} from "./helpers/install-sandbox.mjs";

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
  // runInstaller starts bash in sb.root, so relative values resolve there.
  sb.cwd = realpathSync(sb.root);
  return sb;
}

const read = (path) => readFileSync(path, "utf8");

test("args shape: relative paths are written as absolute paths that work from /", async () => {
  const sb = setup();
  const args = ["--install-dir", "rbin", "--share-dir", "rshare", "--add-path", "--db", "data/x.db", "--with-mcp"];
  const r = await runInstaller(sb, args);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const bin = join(sb.cwd, "rbin");
  const share = join(sb.cwd, "rshare");
  const db = join(sb.cwd, "data", "x.db");
  assert.ok(existsSync(join(bin, "snipset")), "binary placed under the cwd");
  assert.ok(existsSync(db), "database created under the cwd");
  const files = {
    bashrc: join(sb.home, ".bashrc"),
    profile: join(sb.home, ".profile"),
    env: join(share, "env"),
    opencode: join(sb.home, ".config", "opencode", "opencode.json"),
  };
  for (const [name, path] of Object.entries(files)) {
    const text = read(path);
    assert.doesNotMatch(text, /(^|[^/\w])(rbin|rshare|data\/x\.db)\b/m, `${name} has a relative path:\n${text}`);
  }
  assert.ok(read(files.env).includes(`export PATH="${bin}:$PATH"`), read(files.env));
  assert.ok(read(files.profile).includes(`. "${share}/env"`), read(files.profile));
  assert.ok(read(files.bashrc).includes(share), read(files.bashrc));
  assert.deepEqual(JSON.parse(read(files.opencode)).mcp.snipset.command, [join(bin, "snipset"), "mcp", "--db", db]);
  // A login shell reads ~/.profile; started from / it must still find the binary.
  const found = execFileSync("/bin/sh", ["-c", '. "$HOME/.profile"; command -v snipset'], {
    cwd: "/",
    env: { HOME: sb.home, PATH: "/usr/bin" },
    encoding: "utf8",
  });
  assert.equal(found.trim(), join(bin, "snipset"));
});

for (const flag of ["--share-dir", "--bashrc", "--install-dir", "--db", "--from"]) {
  test(`args shape: an empty ${flag} exits 2 with nothing written`, async () => {
    const sb = setup();
    const before = snapshotTree(sb.root);
    const r = await runInstaller(sb, [flag, ""]);
    assert.equal(r.code, 2, r.stdout + r.stderr);
    assert.deepEqual(snapshotTree(sb.home), []);
    assert.deepEqual(snapshotTree(sb.root), before);
  });
}

for (const flag of ["--db", "--install-dir"]) {
  test(`args shape: ${flag} --dry-run exits 2 and writes nothing`, async () => {
    const sb = setup();
    const before = snapshotTree(sb.root);
    const r = await runInstaller(sb, [flag, "--dry-run"]);
    assert.equal(r.code, 2, r.stdout + r.stderr);
    assert.deepEqual(snapshotTree(sb.home), []);
    assert.deepEqual(snapshotTree(sb.root), before);
  });
}
