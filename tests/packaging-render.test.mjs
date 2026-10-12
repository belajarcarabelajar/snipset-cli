import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repo = join(import.meta.dir, "..");
const RENDER = join(repo, "scripts", "packaging", "render.mjs");
const SCHEMA_LITE = join(repo, "tests", "helpers", "schema-lite.mjs");
const FIXTURES = join(repo, "tests", "fixtures", "packaging");

const VERSION = "0.2.0";
const LINUX_ASSET = "snipset-cli-v0.2.0-x86_64-unknown-linux-gnu.tar.gz";
const WINDOWS_ASSET = "snipset-cli-v0.2.0-x86_64-pc-windows-msvc.zip";
const LINUX_SHA = "57b43b6ee0b55fc690cac8851d2c5009eefdc10e538fb5683bc294cf8c78cfe5";
const WINDOWS_SHA = "90d888f74edb2d6711adee445b5ba25fe85ab3e374bfb341d946aaf18a80edcc";
const DOWNLOAD = "https://github.com/belajarcarabelajar/snipset-cli/releases/download/v0.2.0/";
const OUT_PLAIN = "out/demo/demo.txt";
const OUT_VERSIONED = "out/demo/0.2.0/demo-0.2.0.txt";

const sri = (hex) => `sha256-${Buffer.from(hex, "hex").toString("base64")}`;

const EXPECTED = [
  `version=${VERSION}`,
  `tag=v${VERSION}`,
  `asset.linux=${LINUX_ASSET}`,
  `asset.windows=${WINDOWS_ASSET}`,
  `url.linux=${DOWNLOAD}${LINUX_ASSET}`,
  `url.windows=${DOWNLOAD}${WINDOWS_ASSET}`,
  `sha256.linux=${LINUX_SHA}`,
  `sha256.windows=${WINDOWS_SHA}`,
  `sha256.linux.upper=${LINUX_SHA.toUpperCase()}`,
  `sha256.windows.upper=${WINDOWS_SHA.toUpperCase()}`,
  `sri.linux=${sri(LINUX_SHA)}`,
  `sri.windows=${sri(WINDOWS_SHA)}`,
].join("\n") + "\n";

const temps = [];
afterEach(async () => {
  for (const dir of temps.splice(0)) await rm(dir, { recursive: true, force: true });
});

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), "snipset-render-"));
  temps.push(dir);
  return dir;
}

function tempRoot() {
  const root = tempDir();
  mkdirSync(join(root, "packaging"));
  copyFileSync(join(repo, "packaging", "VERSION"), join(root, "packaging", "VERSION"));
  copyFileSync(join(repo, "packaging", "SHA256SUMS"), join(root, "packaging", "SHA256SUMS"));
  return root;
}

function render(root, args = [], { templates = FIXTURES } = {}) {
  const r = spawnSync(process.execPath, [RENDER, "--root", root, "--templates", templates, ...args], {
    encoding: "utf8",
    timeout: 20000,
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

const lines = (text) => text.split("\n").filter(Boolean);

describe("render.mjs CLI", () => {
  test("renders every output of the demo channel and prints one line per file", () => {
    const root = tempRoot();
    const r = render(root);
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    expect(lines(r.stdout).sort()).toEqual([`rendered ${OUT_VERSIONED}`, `rendered ${OUT_PLAIN}`].sort());
    expect(readFileSync(join(root, OUT_PLAIN), "utf8")).toBe(EXPECTED);
    expect(readFileSync(join(root, OUT_VERSIONED), "utf8")).toBe(EXPECTED);
  });

  test("--check exits 0 right after a render", () => {
    const root = tempRoot();
    expect(render(root).code).toBe(0);
    const r = render(root, ["--check"]);
    expect(r.code).toBe(0);
    expect(r.stdout).not.toMatch(/drift|missing|orphan/);
  });

  test("--check exits 1, names an output whose bytes changed, and leaves it alone", () => {
    const root = tempRoot();
    expect(render(root).code).toBe(0);
    writeFileSync(join(root, OUT_PLAIN), `${EXPECTED}x`);
    const r = render(root, ["--check"]);
    expect(r.code).toBe(1);
    expect(lines(r.stdout)).toEqual([`drift ${OUT_PLAIN}`]);
    expect(readFileSync(join(root, OUT_PLAIN), "utf8")).toBe(`${EXPECTED}x`);
  });

  test("--check reports missing outputs and writes nothing", () => {
    const root = tempRoot();
    const r = render(root, ["--check"]);
    expect(r.code).toBe(1);
    expect(lines(r.stdout).sort()).toEqual([`missing ${OUT_VERSIONED}`, `missing ${OUT_PLAIN}`].sort());
    expect(existsSync(join(root, "out"))).toBe(false);
  });

  test("--check reports a file under owns that no output names as an orphan", () => {
    const root = tempRoot();
    expect(render(root).code).toBe(0);
    writeFileSync(join(root, "out/demo/extra.txt"), "stale\n");
    const r = render(root, ["--check"]);
    expect(r.code).toBe(1);
    expect(lines(r.stdout)).toEqual(["orphan out/demo/extra.txt"]);
  });

  test("an unknown placeholder exits 1 naming the placeholder and the template, writing nothing", () => {
    const root = tempRoot();
    const templates = tempDir();
    mkdirSync(join(templates, "bad"));
    writeFileSync(
      join(templates, "bad", "target.json"),
      JSON.stringify({ outputs: [{ template: "bad.txt.tmpl", out: "out/bad.txt" }] }),
    );
    writeFileSync(join(templates, "bad", "bad.txt.tmpl"), "v={{version}} n={{nope}}\n");
    const r = render(root, [], { templates });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("{{nope}}");
    expect(r.stderr).toContain("bad.txt.tmpl");
    expect(existsSync(join(root, "out"))).toBe(false);
  });

  test("a SHA256SUMS without the Windows asset line exits 1 naming the asset", () => {
    const root = tempRoot();
    writeFileSync(join(root, "packaging", "SHA256SUMS"), `${LINUX_SHA}  ${LINUX_ASSET}\n`);
    const r = render(root);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain(WINDOWS_ASSET);
    expect(existsSync(join(root, "out"))).toBe(false);
  });

  test("a CR character in SHA256SUMS exits 1 with a message", () => {
    const root = tempRoot();
    writeFileSync(
      join(root, "packaging", "SHA256SUMS"),
      `${LINUX_SHA}  ${LINUX_ASSET}\r\n${WINDOWS_SHA}  ${WINDOWS_ASSET}\r\n`,
    );
    const r = render(root);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/\bCR\b/);
  });

  test("--channel nope exits 2 naming the channel", () => {
    const root = tempRoot();
    const r = render(root, ["--channel", "nope"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("nope");
    expect(existsSync(join(root, "out"))).toBe(false);
  });

  test("--channel limits rendering and checking to one channel", () => {
    const root = tempRoot();
    const templates = tempDir();
    cpSync(join(FIXTURES, "demo"), join(templates, "demo"), { recursive: true });
    mkdirSync(join(templates, "other"));
    writeFileSync(
      join(templates, "other", "target.json"),
      JSON.stringify({ outputs: [{ template: "o.tmpl", out: "out/other.txt" }] }),
    );
    writeFileSync(join(templates, "other", "o.tmpl"), "{{tag}}\n");
    const r = render(root, ["--channel", "demo"], { templates });
    expect(r.code).toBe(0);
    expect(existsSync(join(root, "out/other.txt"))).toBe(false);
    expect(render(root, ["--check", "--channel", "demo"], { templates }).code).toBe(0);
    const all = render(root, ["--check"], { templates });
    expect(all.code).toBe(1);
    expect(lines(all.stdout)).toEqual(["missing out/other.txt"]);
  });

  test("an unknown flag exits 2 with a usage line", () => {
    const root = tempRoot();
    const r = render(root, ["--bogus"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("usage:");
  });
});

describe("render.mjs functions", () => {
  test("sriFromHex of the empty-input digest matches the known SRI", async () => {
    const { sriFromHex } = await import(RENDER);
    expect(sriFromHex("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")).toBe(
      "sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=",
    );
  });

  test("the committed packaging files hold version 0.2.0 and its two digests", async () => {
    const { parseSums } = await import(RENDER);
    expect(readFileSync(join(repo, "packaging", "VERSION"), "utf8")).toBe("0.2.0\n");
    const text = readFileSync(join(repo, "packaging", "SHA256SUMS"), "utf8");
    expect(text).toBe(`${LINUX_SHA}  ${LINUX_ASSET}\n${WINDOWS_SHA}  ${WINDOWS_ASSET}\n`);
    expect(parseSums(text, VERSION)).toEqual({ linux: LINUX_SHA, windows: WINDOWS_SHA });
  });

  test("parseSums accepts the binary marker form", async () => {
    const { parseSums } = await import(RENDER);
    const text = `${LINUX_SHA} *${LINUX_ASSET}\n${WINDOWS_SHA} *${WINDOWS_ASSET}\n`;
    expect(parseSums(text, VERSION)).toEqual({ linux: LINUX_SHA, windows: WINDOWS_SHA });
  });

  test("the demo template uses every placeholder", () => {
    const text = readFileSync(join(FIXTURES, "demo", "demo.txt.tmpl"), "utf8");
    const names = [
      "version", "tag", "asset.linux", "asset.windows", "url.linux", "url.windows",
      "sha256.linux", "sha256.windows", "sha256.linux.upper", "sha256.windows.upper",
      "sri.linux", "sri.windows",
    ];
    for (const name of names) expect(text).toContain(`{{${name}}}`);
  });
});

const SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://example.com/demo.json",
  title: "demo",
  description: "schema-lite test schema",
  type: "object",
  required: ["name", "kind"],
  additionalProperties: false,
  properties: {
    name: { type: "string", pattern: "^[a-z][a-z0-9-]*$", minLength: 2, maxLength: 20 },
    kind: { enum: ["cli", "gui"], default: "cli" },
    version: { $ref: "#/definitions/semver" },
    license: { $ref: "#/$defs/license" },
    tags: { type: "array", items: { type: "string" }, uniqueItems: true, minItems: 1, maxItems: 3 },
    size: { type: ["integer", "null"], minimum: 0, maximum: 100 },
    homepage: { type: "string", format: "uri" },
    source: { oneOf: [{ type: "string", pattern: "^https://" }, { type: "string", pattern: "\\.tar\\.gz$" }] },
    channel: { allOf: [{ type: "string" }, { not: { const: "nope" } }], anyOf: [{ minLength: 3 }, { const: "x" }] },
    meta: { type: "object", patternProperties: { "^x-": { type: "string" } }, additionalProperties: false },
  },
  definitions: { semver: { type: "string", pattern: "^\\d+\\.\\d+\\.\\d+$" } },
  $defs: { license: { const: "LicenseRef-Snipset-EULA" } },
};

const VALID = {
  name: "snipset-cli",
  kind: "cli",
  version: "0.2.0",
  license: "LicenseRef-Snipset-EULA",
  tags: ["cli", "snippets"],
  size: 5,
  homepage: "not checked because format is ignored",
  source: "https://example.com/a.zip",
  channel: "x",
  meta: { "x-note": "ok" },
};

async function check(patch) {
  const { checkSchema } = await import(SCHEMA_LITE);
  const doc = structuredClone(VALID);
  patch(doc);
  return checkSchema(doc, SCHEMA);
}

describe("schema-lite checkSchema", () => {
  test("a valid document passes (positive control)", async () => {
    expect(await check(() => {})).toEqual([]);
  });

  test("a missing required key fails with its pointer", async () => {
    const errors = await check((d) => delete d.kind);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStartWith("/kind: ");
  });

  test("an extra key under additionalProperties false fails with its pointer", async () => {
    const errors = await check((d) => (d.extra = 1));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStartWith("/extra: ");
  });

  test("a value outside the enum fails with its pointer", async () => {
    const errors = await check((d) => (d.kind = "tui"));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStartWith("/kind: ");
  });

  test("a pattern miss fails with its pointer", async () => {
    const errors = await check((d) => (d.name = "Bad Name"));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStartWith("/name: ");
  });

  test("a $ref target violation fails with the pointer of the referring value", async () => {
    const errors = await check((d) => (d.version = "v1"));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStartWith("/version: ");
  });

  test("a oneOf with two matching branches fails with its pointer", async () => {
    const errors = await check((d) => (d.source = "https://example.com/a.tar.gz"));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStartWith("/source: ");
  });

  test("an array item error points at the item index", async () => {
    const errors = await check((d) => (d.tags = ["cli", 7]));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStartWith("/tags/1: ");
  });

  test("if/then applies the then schema only when the if schema matches", async () => {
    const { checkSchema } = await import(SCHEMA_LITE);
    const schema = { if: { properties: { arch: { const: "64bit" } } }, then: { required: ["url"] } };
    expect(checkSchema({ arch: "32bit" }, schema)).toEqual([]);
    expect(checkSchema({ arch: "64bit", url: "u" }, schema)).toEqual([]);
    const errors = checkSchema({ arch: "64bit" }, schema);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toStartWith("/url: ");
  });

  test("an unsupported keyword is reported instead of silently ignored", async () => {
    const { checkSchema } = await import(SCHEMA_LITE);
    const errors = checkSchema({ a: 1 }, { type: "object", dependentRequired: { a: ["b"] } });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("dependentRequired");
  });
});
