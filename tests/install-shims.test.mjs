import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, chmodSync, existsSync, lstatSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import {
  cleanupSandbox,
  downloaderShims,
  fakeLinuxRelease,
  makeSandbox,
  runInstaller,
} from "./helpers/install-sandbox.mjs";

const cleanups = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()();
});

function shimBody(kw) {
  return `#!/bin/sh\n# snipset-shim for '${kw}' (exec mode, managed by snipset-shims; do not edit).\nexec snipset snippet expand "${kw}" --by-keyword\n`;
}

function lines(text) {
  return text.split("\n").filter((line) => line.length > 0);
}

function hasLine(stdout, expected) {
  return lines(stdout).includes(expected);
}

async function installed(args = []) {
  const sb = makeSandbox();
  cleanups.push(() => cleanupSandbox(sb));
  const release = fakeLinuxRelease();
  cleanups.push(() => rm(release.dir, { recursive: true, force: true }));
  downloaderShims(sb, release);
  const result = await runInstaller(sb, args);
  assert.equal(result.code, 0, `install failed:\n${result.stdout}\n${result.stderr}`);
  const binDir = join(sb.home, ".local", "bin");
  return { sb, binDir, manifest: join(binDir, ".snipset-shims") };
}

test("check reports each generated shim [OK] after a full install", async () => {
  const { sb, binDir } = await installed();
  assert.equal(readFileSync(join(binDir, ".snipset-shims"), "utf8"), ",k1\n;k2\n");
  const result = await runInstaller(sb, ["--check"]);
  for (const kw of [",k1", ";k2"]) {
    assert.ok(hasLine(result.stdout, `[OK] shims: ${join(binDir, kw)}`), result.stdout);
  }
  assert.doesNotMatch(result.stdout, /^\[(MISSING|DRIFT)\] shims:/m);
});

test("check reports a deleted shim [MISSING] and exits 1", async () => {
  const { sb, binDir } = await installed();
  await rm(join(binDir, ",k1"));
  const result = await runInstaller(sb, ["--check"]);
  assert.equal(result.code, 1, result.stdout);
  assert.ok(hasLine(result.stdout, `[MISSING] shims: ${join(binDir, ",k1")}`), result.stdout);
  assert.ok(hasLine(result.stdout, `[OK] shims: ${join(binDir, ";k2")}`), result.stdout);
});

test("check reports a listed file without the shim header [DRIFT]", async () => {
  const { sb, binDir } = await installed();
  writeFileSync(join(binDir, ";k2"), "#!/bin/sh\necho mine\n");
  const result = await runInstaller(sb, ["--check"]);
  assert.equal(result.code, 1, result.stdout);
  assert.match(result.stdout, new RegExp(`^\\[DRIFT\\] shims: ${join(binDir, ";k2")}: `, "m"));
});

test("check without a manifest reports [SKIP] shims: none generated", async () => {
  const { sb, manifest } = await installed(["--no-shims"]);
  assert.equal(existsSync(manifest), false);
  const result = await runInstaller(sb, ["--check", "--no-shims"]);
  assert.ok(hasLine(result.stdout, "[SKIP] shims: none generated"), result.stdout);
});

test("uninstall removes the generated shims and the manifest", async () => {
  const { sb, binDir, manifest } = await installed();
  const result = await runInstaller(sb, ["--uninstall"]);
  assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
  for (const kw of [",k1", ";k2"]) {
    assert.equal(existsSync(join(binDir, kw)), false, `${kw} survived`);
    assert.ok(hasLine(result.stdout, `[REMOVED] shims: ${join(binDir, kw)}`), result.stdout);
  }
  assert.equal(existsSync(manifest), false, "manifest survived");
  assert.ok(hasLine(result.stdout, `[REMOVED] shims: ${manifest}`), result.stdout);
});

test("uninstall keeps a user file at a listed name and keeps the manifest", async () => {
  const { sb, binDir, manifest } = await installed();
  const user = join(binDir, ",k1");
  const mine = "#!/bin/sh\necho mine\n";
  writeFileSync(user, mine);
  const result = await runInstaller(sb, ["--uninstall"]);
  assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(readFileSync(user, "utf8"), mine);
  assert.match(result.stdout, new RegExp(`^\\[KEEP\\] shims: ${join(binDir, ",k1")}: `, "m"));
  assert.equal(existsSync(join(binDir, ";k2")), false, ";k2 survived");
  assert.equal(existsSync(manifest), true, "manifest removed while a listed name remains");
});

test("uninstall keeps a symlink at a listed name, even one pointing at a shim header", async () => {
  const { sb, binDir } = await installed();
  const link = join(binDir, ",k1");
  const target = join(sb.root, "user-shim");
  writeFileSync(target, shimBody(",k1"));
  await rm(link);
  symlinkSync(target, link);
  const result = await runInstaller(sb, ["--uninstall"]);
  assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(lstatSync(link).isSymbolicLink(), true, "symlink removed");
  assert.equal(readFileSync(target, "utf8"), shimBody(",k1"));
  assert.match(result.stdout, new RegExp(`^\\[KEEP\\] shims: ${join(binDir, ",k1")}: `, "m"));
  assert.equal(existsSync(join(binDir, ";k2")), false, ";k2 survived");
});

test("uninstall never removes an unlisted file, even one with the shim header", async () => {
  const { sb, binDir } = await installed();
  const extra = join(binDir, "extra");
  writeFileSync(extra, shimBody("extra"));
  const result = await runInstaller(sb, ["--uninstall"]);
  assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(readFileSync(extra, "utf8"), shimBody("extra"));
  assert.equal(existsSync(join(binDir, ",k1")), false, "listed shim survived");
});

test("a listed name that leaves the install dir is never removed", async () => {
  const { sb, binDir, manifest } = await installed();
  const outside = join(sb.home, ".local", "outside");
  writeFileSync(outside, shimBody("outside"));
  appendFileSync(manifest, "../outside\n");
  const check = await runInstaller(sb, ["--check"]);
  assert.equal(check.code, 1, check.stdout);
  assert.match(check.stdout, /^\[DRIFT\] shims: .*\.\.\/outside: /m);
  const result = await runInstaller(sb, ["--uninstall"]);
  assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(readFileSync(outside, "utf8"), shimBody("outside"));
  assert.equal(existsSync(join(binDir, ",k1")), false, ",k1 survived");
});

test("keywords with punctuation are used literally", async () => {
  const { sb, binDir, manifest } = await installed();
  const odd = ["-dash", "a+b:c.d%e@f=g,h", "*"];
  for (const kw of odd) {
    writeFileSync(join(binDir, kw), shimBody(kw));
    chmodSync(join(binDir, kw), 0o755);
    appendFileSync(manifest, `${kw}\n`);
  }
  const bystander = join(binDir, "zz-bystander");
  writeFileSync(bystander, "user\n");
  const check = await runInstaller(sb, ["--check"]);
  for (const kw of [",k1", ";k2", ...odd]) {
    assert.ok(hasLine(check.stdout, `[OK] shims: ${join(binDir, kw)}`), check.stdout);
  }
  const result = await runInstaller(sb, ["--uninstall"]);
  assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
  for (const kw of [",k1", ";k2", ...odd]) {
    assert.equal(existsSync(join(binDir, kw)), false, `${kw} survived`);
  }
  assert.equal(readFileSync(bystander, "utf8"), "user\n");
  assert.equal(existsSync(manifest), false, "manifest survived");
});
