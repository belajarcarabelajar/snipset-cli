import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repo = join(import.meta.dir, "..");
const RENDER = join(repo, "scripts", "packaging", "render.mjs");
const TEMPLATES = join(repo, "packaging", "templates");
const FLAKE = join(repo, "flake.nix");
const TARGET = join(TEMPLATES, "nix", "target.json");

const temps = [];
afterEach(async () => {
  for (const dir of temps.splice(0)) await rm(dir, { recursive: true, force: true });
});

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), "snipset-nix-"));
  temps.push(dir);
  return dir;
}

function readVersion() {
  return readFileSync(join(repo, "packaging", "VERSION"), "utf8").trim();
}

// Parsed here rather than through render.mjs so the SRI check does not trust the code it verifies.
function linuxDigest(version) {
  const name = `snipset-cli-v${version}-x86_64-unknown-linux-gnu.tar.gz`;
  for (const line of readFileSync(join(repo, "packaging", "SHA256SUMS"), "utf8").split("\n")) {
    const match = /^([0-9a-fA-F]{64}) [ *](.+)$/.exec(line);
    if (match && match[2] === name) return match[1].toLowerCase();
  }
  throw new Error(`packaging/SHA256SUMS has no line for ${name}`);
}

function readFlake() {
  return readFileSync(FLAKE, "utf8");
}

function render(args, root = repo) {
  const r = spawnSync(process.execPath, [RENDER, "--root", root, "--templates", TEMPLATES, ...args], {
    encoding: "utf8",
    timeout: 30000,
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

// Scans Nix source and reports unbalanced {} [] () outside strings and comments.
// Code inside ${ } interpolation counts as code, so its brackets are checked too.
function bracketProblems(src) {
  const stack = [];
  const top = () => stack[stack.length - 1];
  let line = 1;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const pair = src.slice(i, i + 2);
    if (c === "\n") line++;
    const mode = top();
    if (mode === '"') {
      if (c === "\\") i++;
      else if (c === '"') stack.pop();
      else if (pair === "${") {
        stack.push("${");
        i++;
      }
      continue;
    }
    if (mode === "''") {
      if (pair === "''") {
        const next = src[i + 2];
        // ''' and ''$ are escapes, ''\x escapes one character; a bare '' closes the string.
        if (next === "'" || next === "$") i += 2;
        else if (next === "\\") i += 3;
        else {
          stack.pop();
          i++;
        }
      } else if (pair === "${") {
        stack.push("${");
        i++;
      }
      continue;
    }
    if (c === "#") {
      while (i + 1 < src.length && src[i + 1] !== "\n") i++;
    } else if (pair === "/*") {
      const end = src.indexOf("*/", i + 2);
      if (end < 0) return [`line ${line}: unterminated /* comment`];
      line += src.slice(i, end).split("\n").length - 1;
      i = end + 1;
    } else if (c === '"') stack.push('"');
    else if (pair === "''" || pair === "${") {
      stack.push(pair);
      i++;
    } else if (c === "{" || c === "[" || c === "(") stack.push(c);
    else if (c === "}" || c === "]" || c === ")") {
      const opener = { "}": ["{", "${"], "]": ["["], ")": ["("] }[c];
      if (!opener.includes(mode)) return [`line ${line}: unexpected ${c} (open: ${mode ?? "nothing"})`];
      stack.pop();
    }
  }
  return stack.length > 0 ? [`end of file: unclosed ${stack.join(" ")}`] : [];
}

describe("bracket scanner controls", () => {
  test("accepts balanced Nix with brackets inside strings and interpolation", () => {
    const src = [
      '{ a = "}"; b = [ "]" ]; # } unbalanced only in a comment',
      "  c = ''",
      "    echo ''${not} ''' ) ${ toString { d = 1; }.d }",
      "  ''; /* ] */ e = \"${ builtins.concatStringsSep \"{\" [ ] }\"; }",
    ].join("\n");
    expect(bracketProblems(src)).toEqual([]);
  });

  test("rejects a missing closer, a stray closer, and a mismatched pair", () => {
    expect(bracketProblems("{ a = [ 1 2 ];")).not.toEqual([]);
    expect(bracketProblems("{ a = 1; } }")).not.toEqual([]);
    expect(bracketProblems("{ a = [ 1 }; ]")).not.toEqual([]);
  });
});

describe("nix flake", () => {
  test("target.json renders flake.nix at the repo root and owns no directory", () => {
    const target = JSON.parse(readFileSync(TARGET, "utf8"));
    expect(target.outputs).toEqual([{ template: "flake.nix.tmpl", out: "flake.nix" }]);
    // Owning the repo root would report every other tracked file as an orphan.
    expect(Object.hasOwn(target, "owns")).toBe(false);
  });

  test("fetchurl hash is the SRI of the Linux digest in packaging/SHA256SUMS", () => {
    const sri = `sha256-${Buffer.from(linuxDigest(readVersion()), "hex").toString("base64")}`;
    const hashes = [...readFlake().matchAll(/\bhash = "([^"]*)";/g)].map((m) => m[1]);
    expect(hashes).toEqual([sri]);
  });

  test("fetchurl url names the Linux asset of packaging/VERSION", () => {
    const version = readVersion();
    const url = `https://github.com/belajarcarabelajar/snipset-cli/releases/download/v${version}/snipset-cli-v${version}-x86_64-unknown-linux-gnu.tar.gz`;
    const urls = [...readFlake().matchAll(/\burl = "(https:[^"]*)";/g)].map((m) => m[1]);
    expect(urls).toEqual([url]);
    expect(readFlake()).toContain(`version = "${version}";`);
  });

  test("declares the nixpkgs input, unfree import, and derivation identity", () => {
    const flake = readFlake();
    expect(flake).toMatch(/^\s*description = "[^"]{10,}";$/m);
    expect(flake).toContain('inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";');
    expect(flake).toContain("pkgs = import nixpkgs {");
    expect(flake).toContain('system = "x86_64-linux";');
    expect(flake).toContain("config.allowUnfree = true;");
    expect(flake).toContain("pkgs.stdenv.mkDerivation {");
    expect(flake).toContain('pname = "snipset-cli";');
    expect(flake).toContain("src = pkgs.fetchurl {");
  });

  test("unpacks at the tarball root and patches the prebuilt binary", () => {
    const flake = readFlake();
    expect(flake).toContain('sourceRoot = ".";');
    expect(flake).toContain("nativeBuildInputs = [ pkgs.autoPatchelfHook pkgs.installShellFiles ];");
    expect(flake).toContain("buildInputs = [ pkgs.openssl pkgs.stdenv.cc.cc.lib ];");
  });

  test("installPhase installs both commands and the bash completion", () => {
    const install = /installPhase = ''\n([\s\S]*?)\n\s*'';/.exec(readFlake());
    expect(install).not.toBeNull();
    const body = install[1];
    expect(body).toMatch(/runHook preInstall[\s\S]*runHook postInstall/);
    expect(body).toContain("install -Dm755 snipset $out/bin/snipset");
    expect(body).toContain("install -Dm755 shell/snipset-shims.sh $out/bin/snipset-shims");
    expect(body).toContain("installShellCompletion --bash --name snipset.bash shell/completion.bash");
  });

  test("meta marks the package unfree, binary-only, x86_64-linux, with snipset as main program", () => {
    const flake = readFlake();
    expect(flake).toContain("license = pkgs.lib.licenses.unfree;");
    expect(flake).toContain("sourceProvenance = [ pkgs.lib.sourceTypes.binaryNativeCode ];");
    expect(flake).toContain('platforms = [ "x86_64-linux" ];');
    expect(flake).toContain('mainProgram = "snipset";');
  });

  test("exposes the default package and an app that runs bin/snipset", () => {
    const flake = readFlake();
    expect(flake).toMatch(/packages\.x86_64-linux\.default = \w+;/);
    expect(flake).toMatch(/apps\.x86_64-linux\.default = \{\s*type = "app";\s*program = "\$\{\w+\}\/bin\/snipset";\s*\};/);
  });

  test("braces, brackets, and parentheses balance outside strings", () => {
    expect(bracketProblems(readFlake())).toEqual([]);
  });

  test("render.mjs --check --channel nix exits 0", () => {
    const r = render(["--check", "--channel", "nix"]);
    expect(r.out).toBe("");
    expect(r.code).toBe(0);
  });

  test("render.mjs --check --channel nix reports drift when flake.nix is edited", () => {
    const root = tempDir();
    mkdirSync(join(root, "packaging"));
    copyFileSync(join(repo, "packaging", "VERSION"), join(root, "packaging", "VERSION"));
    copyFileSync(join(repo, "packaging", "SHA256SUMS"), join(root, "packaging", "SHA256SUMS"));
    writeFileSync(join(root, "flake.nix"), readFlake().replace('sourceRoot = ".";', 'sourceRoot = "shell";'));
    const r = render(["--check", "--channel", "nix"], root);
    expect(r.code).toBe(1);
    expect(r.out).toContain("drift flake.nix");
  });

  // The check fetches nixpkgs, so it runs only on explicit request; tests stay offline by default.
  const nix = process.env.SNIPSET_NIX_CHECK === "1" ? Bun.which("nix") : null;
  if (!nix) console.log("skip nix flake check: set SNIPSET_NIX_CHECK=1 on a host with nix (needs network)");
  test.skipIf(!nix)("nix flake check evaluates the flake (needs nix and network)", () => {
    const dir = tempDir();
    cpSync(FLAKE, join(dir, "flake.nix"));
    const r = spawnSync(
      nix,
      ["--extra-experimental-features", "nix-command flakes", "flake", "check", "--no-write-lock-file", `path:${dir}`],
      { encoding: "utf8", timeout: 600000 },
    );
    expect(`${r.stdout}${r.stderr}`).not.toMatch(/^error:/m);
    expect(r.status).toBe(0);
  }, 610000);
});
