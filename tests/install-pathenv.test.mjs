import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import {
  cleanupSandbox,
  diffSnapshots,
  downloaderShims,
  fakeLinuxRelease,
  makeSandbox,
  runInstaller,
  snapshotTree,
  stubCommand,
} from "./helpers/install-sandbox.mjs";

const MARK = "# snipset-path (managed by snipset installer; safe to remove)";
const QUIET = ["--add-path", "--no-shell", "--no-init", "--no-shims"];

const envText = (dir) =>
  `${MARK}\ncase ":\${PATH}:" in\n  *":${dir}:"*) ;;\n  *) export PATH="${dir}:$PATH" ;;\nesac\n`;
const fishEnvText = (dir) =>
  `${MARK}\nif not contains -- "${dir}" $PATH\n    set -gx PATH "${dir}" $PATH\nend\n`;
const sourceLine = (share) => `. "${share}/env" ${MARK}`;
const fishConfText = (share) => `${MARK}\nsource "${share}/env.fish"\n`;

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
  sb.installDir = join(sb.home, ".local", "bin");
  sb.share = join(sb.home, ".local", "share", "snipset");
  sb.at = (...parts) => join(sb.home, ...parts);
  return sb;
}

function seed(path, content) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
}

function read(path) {
  return readFileSync(path, "utf8");
}

function countLine(path, line) {
  return read(path).split("\n").filter((l) => l === line).length;
}

async function ok(sb, args, env) {
  const result = await runInstaller(sb, args, { env });
  assert.equal(result.code, 0, `${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
  return result;
}

const STARTUP = [".profile", ".bashrc", ".bash_profile", ".bash_login", ".zshenv"];

test("bash only: env files, ~/.profile, and existing bash files get the source line", async () => {
  const sb = setup();
  seed(sb.at(".bashrc"), "user bashrc\n");
  seed(sb.at(".bash_profile"), "user bash_profile\n");
  await ok(sb, QUIET);
  assert.equal(read(join(sb.share, "env")), envText(sb.installDir));
  assert.equal(read(join(sb.share, "env.fish")), fishEnvText(sb.installDir));
  for (const name of [".profile", ".bashrc", ".bash_profile"]) {
    assert.equal(countLine(sb.at(name), sourceLine(sb.share)), 1, name);
  }
  assert.equal(read(sb.at(".bashrc")), `user bashrc\n\n${sourceLine(sb.share)}\n`);
  assert.equal(existsSync(sb.at(".bash_login")), false);
  assert.equal(existsSync(sb.at(".zshenv")), false);
  assert.equal(existsSync(sb.at(".config", "fish")), false);
  const env = join(sb.share, "env");
  const path = execFileSync("/bin/sh", ["-c", `. "${env}"; . "${env}"; printf %s "$PATH"`], {
    env: { PATH: "/usr/bin" },
    encoding: "utf8",
  });
  assert.equal(path, `${sb.installDir}:/usr/bin`);
});

test("zsh as the login shell gets ~/.zshenv", async () => {
  const sb = setup();
  await ok(sb, QUIET, { SHELL: "/usr/bin/zsh" });
  assert.equal(read(sb.at(".zshenv")), `\n${sourceLine(sb.share)}\n`);
  assert.equal(existsSync(sb.at(".config", "fish")), false);
});

test("zsh on PATH gets ~/.zshenv", async () => {
  const sb = setup();
  stubCommand(sb, "zsh", "exit 0\n");
  await ok(sb, QUIET);
  assert.equal(countLine(sb.at(".zshenv"), sourceLine(sb.share)), 1);
});

test("fish on PATH gets conf.d/snipset.fish", async () => {
  const sb = setup();
  stubCommand(sb, "fish", "exit 0\n");
  await ok(sb, QUIET);
  assert.equal(read(sb.at(".config", "fish", "conf.d", "snipset.fish")), fishConfText(sb.share));
  assert.equal(existsSync(sb.at(".zshenv")), false);
});

test("ZDOTDIR moves the zsh file", async () => {
  const sb = setup();
  const zdot = sb.at("zdot");
  await ok(sb, QUIET, { SHELL: "/bin/zsh", ZDOTDIR: zdot });
  assert.equal(countLine(join(zdot, ".zshenv"), sourceLine(sb.share)), 1);
  assert.equal(existsSync(sb.at(".zshenv")), false);
});

test("XDG_CONFIG_HOME moves the fish file", async () => {
  const sb = setup();
  const xdg = sb.at("xdg");
  await ok(sb, QUIET, { SHELL: "/usr/bin/fish", XDG_CONFIG_HOME: xdg });
  assert.equal(read(join(xdg, "fish", "conf.d", "snipset.fish")), fishConfText(sb.share));
  assert.equal(existsSync(sb.at(".config")), false);
});

test("a second install adds nothing", async () => {
  const sb = setup();
  stubCommand(sb, "zsh", "exit 0\n");
  stubCommand(sb, "fish", "exit 0\n");
  seed(sb.at(".bashrc"), "user bashrc\n");
  await ok(sb, QUIET);
  const first = snapshotTree(sb.home);
  await ok(sb, QUIET);
  assert.deepEqual(diffSnapshots(first, snapshotTree(sb.home)), []);
  for (const name of [".profile", ".bashrc", ".zshenv"]) {
    assert.equal(countLine(sb.at(name), sourceLine(sb.share)), 1, name);
  }
});

test("a fresh HOME with shell integration converges after one install", async () => {
  const sb = setup();
  const flags = ["--add-path", "--no-init", "--no-shims"];
  await ok(sb, flags);
  assert.equal(countLine(sb.at(".bashrc"), sourceLine(sb.share)), 1);
  const first = snapshotTree(sb.home);
  await ok(sb, flags);
  assert.deepEqual(diffSnapshots(first, snapshotTree(sb.home)), []);
  const check = await runInstaller(sb, ["--check", ...flags]);
  assert.doesNotMatch(check.stdout, /^\[(MISSING|DRIFT)\] path/m, check.stdout);
});

test("check reports OK after install and MISSING after a line is deleted", async () => {
  const sb = setup();
  stubCommand(sb, "zsh", "exit 0\n");
  seed(sb.at(".bashrc"), "user bashrc\n");
  await ok(sb, QUIET);
  const good = await runInstaller(sb, ["--check", ...QUIET]);
  assert.equal(good.code, 0, good.stdout + good.stderr);
  for (const file of [sb.at(".profile"), sb.at(".bashrc"), sb.at(".zshenv")]) {
    assert.ok(good.stdout.includes(`[OK] path line: ${file}\n`), good.stdout);
  }
  assert.ok(good.stdout.includes(`[OK] path env: ${join(sb.share, "env")}\n`), good.stdout);
  const zshenv = sb.at(".zshenv");
  writeFileSync(zshenv, read(zshenv).replace(`${sourceLine(sb.share)}\n`, ""));
  const bad = await runInstaller(sb, ["--check", ...QUIET]);
  assert.equal(bad.code, 1, bad.stdout + bad.stderr);
  assert.ok(bad.stdout.includes(`[MISSING] path line: ${zshenv}\n`), bad.stdout);
  assert.ok(bad.stdout.includes(`[OK] path line: ${sb.at(".profile")}\n`), bad.stdout);
});

test("an edited env file is DRIFT on check and kept on uninstall", async () => {
  const sb = setup();
  await ok(sb, QUIET);
  const env = join(sb.share, "env");
  writeFileSync(env, `${read(env)}export EXTRA=1\n`);
  const check = await runInstaller(sb, ["--check", ...QUIET]);
  assert.equal(check.code, 1);
  assert.match(check.stdout, /^\[DRIFT\] path env: .*\/env\b/m, check.stdout);
  const out = await ok(sb, ["--uninstall", ...QUIET]);
  assert.match(out.stdout, /^\[KEEP\] path env: /m, out.stdout);
  assert.ok(read(env).endsWith("export EXTRA=1\n"));
  assert.equal(existsSync(join(sb.share, "env.fish")), false);
});

test("uninstall leaves every startup file as it was before the install", async () => {
  const sb = setup();
  stubCommand(sb, "zsh", "exit 0\n");
  stubCommand(sb, "fish", "exit 0\n");
  for (const name of STARTUP) seed(sb.at(name), `# user ${name} top\nexport USER_${name.slice(1).replace(/\W/g, "_")}=1\n`);
  seed(sb.at(".config", "fish", "conf.d", "user.fish"), "set -gx USER_FISH 1\n");
  const outsideLocal = (tree) => tree.filter((entry) => !entry.path.startsWith(".local"));
  const before = outsideLocal(snapshotTree(sb.home));
  await ok(sb, QUIET);
  for (const name of STARTUP) assert.equal(countLine(sb.at(name), sourceLine(sb.share)), 1, name);
  assert.ok(existsSync(sb.at(".config", "fish", "conf.d", "snipset.fish")));
  const out = await ok(sb, ["--uninstall", ...QUIET]);
  assert.deepEqual(diffSnapshots(before, outsideLocal(snapshotTree(sb.home))), [], out.stdout);
  assert.equal(existsSync(sb.share), false, out.stdout);
});

test("uninstall keeps the unmarked legacy ~/.profile line and says how to remove it", async () => {
  const sb = setup();
  const legacy = `export PATH="${sb.installDir}:$PATH"`;
  const profile = `user profile\n\n${legacy}\nuser tail\n`;
  seed(sb.at(".profile"), profile);
  const out = await ok(sb, ["--uninstall", ...QUIET]);
  assert.equal(read(sb.at(".profile")), profile, out.stdout);
  assert.ok(
    out.stdout.includes(`[KEEP] path legacy line: ${sb.at(".profile")}: remove it by hand if the old installer added it\n`),
    out.stdout,
  );
  assert.doesNotMatch(out.stdout, /^\[REMOVED\] path legacy line: /m);
});

test("a symlinked ~/.profile stays a symlink", async () => {
  const sb = setup();
  const target = sb.at("dotfiles", "profile");
  seed(target, "user profile\n");
  symlinkSync(target, sb.at(".profile"));
  await ok(sb, QUIET);
  assert.ok(lstatSync(sb.at(".profile")).isSymbolicLink());
  assert.equal(countLine(target, sourceLine(sb.share)), 1);
  await ok(sb, ["--uninstall", ...QUIET]);
  assert.ok(lstatSync(sb.at(".profile")).isSymbolicLink());
  assert.equal(read(target), "user profile\n");
});

test("without --add-path nothing is written", async () => {
  const sb = setup();
  stubCommand(sb, "zsh", "exit 0\n");
  stubCommand(sb, "fish", "exit 0\n");
  seed(sb.at(".bashrc"), "user bashrc\n");
  await ok(sb, ["--no-shell", "--no-init", "--no-shims"]);
  assert.equal(read(sb.at(".bashrc")), "user bashrc\n");
  for (const name of [".profile", ".zshenv", ".config", join(".local", "share", "snipset")]) {
    assert.equal(existsSync(sb.at(name)), false, name);
  }
});

const USER_FILES = {
  ".profile": "# user profile\nexport USER_PROFILE=1\n",
  ".bashrc": "# user bashrc\nalias l='ls -l'\n",
};

function seedUserFiles(sb) {
  for (const [name, content] of Object.entries(USER_FILES)) seed(sb.at(name), content);
}

function startupContents(sb) {
  return Object.fromEntries(STARTUP.filter((name) => existsSync(sb.at(name))).map((name) => [name, read(sb.at(name))]));
}

function strays(sb) {
  return readdirSync(sb.home).filter((name) => /\.snipset-(new|bak)\./.test(name));
}

async function uninstallReadOnly(sb, dir, mode = 0o555) {
  chmodSync(dir, mode);
  try {
    return await runInstaller(sb, ["--uninstall", ...QUIET]);
  } finally {
    chmodSync(dir, 0o755);
  }
}

test("a missing TMPDIR cannot empty a startup file on uninstall", async () => {
  const sb = setup();
  seedUserFiles(sb);
  await ok(sb, QUIET);
  const out = await runInstaller(sb, ["--uninstall", ...QUIET], { env: { TMPDIR: join(sb.root, "missing") } });
  for (const [name, content] of Object.entries(USER_FILES)) {
    assert.equal(read(sb.at(name)), content, `${name}\n${out.stdout}\n${out.stderr}`);
  }
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.deepEqual(strays(sb), []);
});

test("a read-only HOME fails the uninstall and leaves every startup file byte-identical", async () => {
  const sb = setup();
  seedUserFiles(sb);
  await ok(sb, QUIET);
  const before = startupContents(sb);
  const out = await uninstallReadOnly(sb, sb.home);
  assert.deepEqual(startupContents(sb), before, out.stdout);
  for (const name of [".profile", ".bashrc"]) {
    assert.ok(out.stdout.includes(`[FAIL] path line: ${sb.at(name)} left unchanged\n`), out.stdout);
  }
  assert.doesNotMatch(out.stdout, /^\[REMOVED\] path line: /m);
  // The kept source lines still read the env files, so those must survive too.
  for (const name of ["env", "env.fish"]) {
    assert.equal(read(join(sb.share, name)), name === "env" ? envText(sb.installDir) : fishEnvText(sb.installDir));
    assert.match(out.stdout, new RegExp(`^\\[KEEP\\] path ${name.replace(".", "\\.")}: `, "m"), out.stdout);
  }
  assert.equal(out.code, 1, out.stdout + out.stderr);
  assert.deepEqual(strays(sb), []);
});

test("a read-only ~/.profile fails the uninstall, stays byte-identical, and names the kept backup", async () => {
  const sb = setup();
  seedUserFiles(sb);
  await ok(sb, QUIET);
  const profile = sb.at(".profile");
  const before = read(profile);
  chmodSync(profile, 0o444);
  const out = await runInstaller(sb, ["--uninstall", ...QUIET]);
  chmodSync(profile, 0o644);
  assert.equal(read(profile), before, out.stdout);
  const fail = out.stdout.split("\n").find((line) => line.startsWith(`[FAIL] path line: ${profile} `));
  assert.ok(fail, out.stdout);
  const backup = fail.match(/\(backup: (.+)\)$/)?.[1];
  assert.ok(backup && backup.startsWith(`${profile}.snipset-bak.`), fail);
  assert.equal(read(backup), before);
  assert.equal(read(sb.at(".bashrc")), USER_FILES[".bashrc"], out.stdout);
  assert.equal(out.code, 1, out.stdout + out.stderr);
});

const notOurs = (label, file, line) =>
  `[KEEP] ${label}: ${file}: not written by the installer; add the line by hand: ${line}\n`;

test("a user's own conf.d/snipset.fish survives install and uninstall byte-identical", async () => {
  const sb = setup();
  stubCommand(sb, "fish", "exit 0\n");
  const conf = sb.at(".config", "fish", "conf.d", "snipset.fish");
  const mine = "abbr -a sn snipset\n";
  seed(conf, mine);
  const install = await ok(sb, QUIET);
  assert.equal(read(conf), mine, install.stdout);
  assert.ok(install.stdout.includes(notOurs("path fish", conf, `source "${join(sb.share, "env.fish")}"`)), install.stdout);
  const out = await ok(sb, ["--uninstall", ...QUIET]);
  assert.equal(read(conf), mine, out.stdout);
  assert.ok(out.stdout.includes(`[KEEP] path fish: ${conf} not written by the installer; left in place\n`), out.stdout);
});

test("a user's own env and env.fish in a custom --share-dir survive install and uninstall byte-identical", async () => {
  const sb = setup();
  stubCommand(sb, "fish", "exit 0\n");
  const share = sb.at("mystuff");
  const flags = [...QUIET, "--share-dir", share];
  const mine = { env: "MY=1\n", "env.fish": "set -gx MY 1\n" };
  for (const [name, content] of Object.entries(mine)) seed(join(share, name), content);
  const before = snapshotTree(sb.home);
  const install = await ok(sb, flags);
  for (const [name, content] of Object.entries(mine)) assert.equal(read(join(share, name)), content, install.stdout);
  assert.ok(install.stdout.includes(notOurs("path env",join(share, "env"), `export PATH="${sb.installDir}:$PATH"`)), install.stdout);
  assert.ok(
    install.stdout.includes(notOurs("path env.fish", join(share, "env.fish"), `set -gx PATH "${sb.installDir}" $PATH`)),
    install.stdout,
  );
  // A source line or fish conf would run the user's file at every login.
  for (const name of [".profile", ".zshenv", ".config"]) assert.equal(existsSync(sb.at(name)), false, name);
  await ok(sb, ["--uninstall", ...flags]);
  const outsideLocal = (tree) => tree.filter((entry) => !entry.path.startsWith(".local"));
  assert.deepEqual(diffSnapshots(outsideLocal(before), outsideLocal(snapshotTree(sb.home))), []);
});

test("a managed env and fish conf from an earlier install are rewritten in place", async () => {
  const sb = setup();
  stubCommand(sb, "fish", "exit 0\n");
  const conf = sb.at(".config", "fish", "conf.d", "snipset.fish");
  const target = sb.at("dotfiles", "snipset.fish");
  seed(target, fishConfText("/old/share"));
  mkdirSync(join(conf, ".."), { recursive: true });
  symlinkSync(target, conf);
  seed(join(sb.share, "env"), envText("/old/bin"));
  const out = await ok(sb, QUIET);
  assert.doesNotMatch(out.stdout, /^\[KEEP\] path/m, out.stdout);
  assert.equal(read(join(sb.share, "env")), envText(sb.installDir));
  assert.ok(lstatSync(conf).isSymbolicLink());
  assert.equal(read(target), fishConfText(sb.share));
  assert.equal(countLine(sb.at(".profile"), sourceLine(sb.share)), 1);
  assert.deepEqual(strays(sb), []);
});
