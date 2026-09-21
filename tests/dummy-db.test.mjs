import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { createDummyDb } from "./dummy-db.mjs";

const run = promisify(execFile);

test("creates dummy database matching snipset doctor schema fingerprint", async () => {
  const dir = await mkdtemp(join(tmpdir(), "snipset-dummy-test-"));
  const dbPath = join(dir, "snipset-dummy.db");

  try {
    await createDummyDb(dbPath);
    const { stdout } = await run("snipset", ["--json", "doctor", "--db", dbPath]);
    const res = JSON.parse(stdout);
    assert.equal(res.exists, true, "expected database exists");
    assert.equal(res.journal_mode, "wal", "expected journal_mode wal");
    assert.equal(res.schema_match, true, "expected schema_match true");
    assert.equal(res.detail, "schema matches", "expected schema matches detail");
    assert.deepEqual(res.missing_columns, [], "expected no missing columns");
    assert.deepEqual(res.extra_columns, [], "expected no extra columns");
    assert.deepEqual(res.missing_triggers, [], "expected no missing triggers");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
