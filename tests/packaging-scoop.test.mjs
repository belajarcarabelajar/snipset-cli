import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { checkSchema } from "./helpers/schema-lite.mjs";

const repo = join(import.meta.dir, "..");
const RENDER = join(repo, "scripts", "packaging", "render.mjs");
const BUCKET = join(repo, "bucket");
const MANIFEST = join(BUCKET, "snipset.json");
const TEMPLATE = join(repo, "packaging", "templates", "scoop", "snipset.json.tmpl");
const SCHEMA = join(repo, "tests", "fixtures", "schemas", "scoop.schema.json");

const REPO_URL = "https://github.com/belajarcarabelajar/snipset-cli";
const version = readFileSync(join(repo, "packaging", "VERSION"), "utf8").trim();
const windowsAsset = `snipset-cli-v${version}-x86_64-pc-windows-msvc.zip`;

function windowsSha() {
  const lines = readFileSync(join(repo, "packaging", "SHA256SUMS"), "utf8").split("\n");
  const line = lines.find((entry) => entry.endsWith(` ${windowsAsset}`) || entry.endsWith(`*${windowsAsset}`));
  expect(line).toBeDefined();
  return line.slice(0, 64).toLowerCase();
}

const readManifest = () => JSON.parse(readFileSync(MANIFEST, "utf8"));
const readSchema = () => JSON.parse(readFileSync(SCHEMA, "utf8"));

describe("scoop bucket manifest", () => {
  test("rendered manifest passes the vendored Scoop schema", () => {
    expect(checkSchema(readManifest(), readSchema())).toEqual([]);
  });

  test("an extra top-level key fails the vendored Scoop schema", () => {
    const tampered = { ...readManifest(), unexpected_key: true };
    const errors = checkSchema(tampered, readSchema());
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((error) => error.includes("unexpected_key"))).toBe(true);
  });

  test("64bit hash equals the Windows line of packaging/SHA256SUMS", () => {
    expect(readManifest().architecture["64bit"].hash).toBe(windowsSha());
  });

  test("64bit url names the Windows asset for packaging/VERSION", () => {
    expect(readManifest().architecture["64bit"].url).toBe(`${REPO_URL}/releases/download/v${version}/${windowsAsset}`);
  });

  test("version matches packaging/VERSION", () => {
    expect(readManifest().version).toBe(version);
  });

  test("metadata fields follow the contract", () => {
    const manifest = readManifest();
    expect(manifest.description).toBe("Terminal companion for the Snipset snippet manager");
    expect(manifest.homepage).toBe(REPO_URL);
    expect(manifest.license).toEqual({ identifier: "Proprietary", url: `${REPO_URL}/blob/main/LICENSE` });
    expect(manifest.bin).toBe("snipset.exe");
    expect(manifest.checkver).toBe("github");
  });

  test("autoupdate url is the release url with Scoop's $version variable", () => {
    const manifest = readManifest();
    const template = manifest.autoupdate.architecture["64bit"].url;
    expect(template).toBe(
      `${REPO_URL}/releases/download/v$version/snipset-cli-v$version-x86_64-pc-windows-msvc.zip`,
    );
    expect(template.replaceAll("$version", version)).toBe(manifest.architecture["64bit"].url);
  });

  test("autoupdate hash reads SHA256SUMS next to the download", () => {
    expect(readManifest().autoupdate.hash).toEqual({ url: "$baseurl/SHA256SUMS" });
  });

  test("bucket directory holds only snipset.json", () => {
    expect(readdirSync(BUCKET).sort()).toEqual(["snipset.json"]);
  });

  test("arm64 appears in neither the manifest nor its template", () => {
    expect(readFileSync(MANIFEST, "utf8").toLowerCase()).not.toContain("arm64");
    expect(readFileSync(TEMPLATE, "utf8").toLowerCase()).not.toContain("arm64");
  });

  test("render.mjs --check --channel scoop reports no drift", () => {
    const result = spawnSync(process.execPath, [RENDER, "--check", "--channel", "scoop"], {
      cwd: repo,
      encoding: "utf8",
    });
    expect(`${result.stdout}${result.stderr}`).toBe("");
    expect(result.status).toBe(0);
  });
});
