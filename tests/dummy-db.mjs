import Database from "bun:sqlite";

export const SNIPPET_COLUMNS = [
  "uuid",
  "name",
  "keyword",
  "snippet",
  "description",
  "matching_mode",
  "case_sensitivity",
  "group_id",
  "enabled",
  "is_favorite",
  "created_at",
  "modified_at",
  "last_used_at",
  "ai_generated",
  "embedding",
  "image_data",
  "content_type",
  "logical_clock",
  "is_deleted",
  "hotkey",
  "file_data",
  "file_path",
  "file_type",
  "app_whitelist",
  "app_blacklist",
  "attachments",
];

export const GROUP_COLUMNS = [
  "uuid",
  "name",
  "description",
  "enabled",
  "created_at",
  "modified_at",
  "is_pinned",
  "sort_order",
  "sync_enabled",
  "logical_clock",
  "is_deleted",
];

function columnDefinition(col) {
  switch (col) {
    case "uuid":
      return "uuid TEXT PRIMARY KEY";
    case "name":
    case "keyword":
    case "snippet":
      return `${col} TEXT NOT NULL`;
    case "enabled":
    case "is_favorite":
    case "ai_generated":
    case "logical_clock":
    case "is_deleted":
    case "is_pinned":
    case "sort_order":
    case "sync_enabled":
      return `${col} INTEGER DEFAULT 0`;
    case "embedding":
      return "embedding BLOB";
    default:
      return `${col} TEXT`;
  }
}

function createTableSql(table, cols) {
  const defs = cols.map(columnDefinition).join(",\n  ");
  return `CREATE TABLE IF NOT EXISTS ${table} (\n  ${defs}\n);`;
}

export async function createDummyDb(dbPath, { seedSampleData = true } = {}) {
  const db = new Database(dbPath, { create: true });

  db.run("PRAGMA journal_mode = WAL;");
  db.run("CREATE TABLE IF NOT EXISTS preferences (key TEXT PRIMARY KEY, value TEXT NOT NULL);");
  db.run(createTableSql("groups", GROUP_COLUMNS));
  db.run(createTableSql("snippets", SNIPPET_COLUMNS));

  db.run(`CREATE VIRTUAL TABLE IF NOT EXISTS snippets_fts USING fts5(
    uuid UNINDEXED, name, keyword, snippet, description,
    content='snippets', content_rowid='rowid',
    tokenize='unicode61 remove_diacritics 2'
  );`);

  db.run(`CREATE TRIGGER IF NOT EXISTS snippets_ai AFTER INSERT ON snippets BEGIN
    INSERT INTO snippets_fts(rowid, uuid, name, keyword, snippet, description)
    VALUES (new.rowid, new.uuid, new.name, new.keyword, new.snippet, new.description);
  END;`);

  db.run(`CREATE TRIGGER IF NOT EXISTS snippets_ad AFTER DELETE ON snippets BEGIN
    INSERT INTO snippets_fts(snippets_fts, rowid, uuid, name, keyword, snippet, description)
    VALUES('delete', old.rowid, old.uuid, old.name, old.keyword, old.snippet, old.description);
  END;`);

  db.run(`CREATE TRIGGER IF NOT EXISTS snippets_au AFTER UPDATE ON snippets BEGIN
    INSERT INTO snippets_fts(snippets_fts, rowid, uuid, name, keyword, snippet, description)
    VALUES('delete', old.rowid, old.uuid, old.name, old.keyword, old.snippet, old.description);
    INSERT INTO snippets_fts(rowid, uuid, name, keyword, snippet, description)
    VALUES (new.rowid, new.uuid, new.name, new.keyword, new.snippet, new.description);
  END;`);

  db.run(`CREATE TABLE IF NOT EXISTS clipboard_history (
    id INTEGER PRIMARY KEY, content TEXT NOT NULL,
    content_type TEXT NOT NULL DEFAULT 'Text', source_app TEXT,
    created_at TEXT NOT NULL, is_favorite INTEGER NOT NULL DEFAULT 0,
    embedding BLOB
  );`);

  db.run("CREATE TABLE IF NOT EXISTS clipboard_entry_tags (entry_id INTEGER NOT NULL, tag TEXT NOT NULL);");
  db.run("CREATE TABLE IF NOT EXISTS clipboard_tag_colors (tag TEXT PRIMARY KEY, color TEXT NOT NULL);");

  db.run(`CREATE TABLE IF NOT EXISTS speech_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT, entry_type TEXT NOT NULL,
    transcription_text TEXT NOT NULL DEFAULT '', result_text TEXT NOT NULL DEFAULT '',
    duration_ms INTEGER NOT NULL DEFAULT 0, word_count INTEGER NOT NULL DEFAULT 0,
    wpm REAL NOT NULL DEFAULT 0, category TEXT NOT NULL DEFAULT 'General',
    target_lang TEXT, timestamp INTEGER NOT NULL, saved INTEGER NOT NULL DEFAULT 0
  );`);

  db.run(`CREATE TABLE IF NOT EXISTS tts_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT, entry_type TEXT NOT NULL,
    text_content TEXT NOT NULL DEFAULT '', word_count INTEGER NOT NULL DEFAULT 0,
    duration_ms INTEGER NOT NULL DEFAULT 0, wpm REAL NOT NULL DEFAULT 0,
    voice_id TEXT, language TEXT, timestamp INTEGER NOT NULL
  );`);

  db.run(`CREATE TABLE IF NOT EXISTS speech_dictionary (
    id INTEGER PRIMARY KEY AUTOINCREMENT, word TEXT NOT NULL,
    replacement TEXT NOT NULL DEFAULT '', is_auto INTEGER NOT NULL DEFAULT 0,
    confidence REAL NOT NULL DEFAULT 0, original_heard TEXT,
    hit_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
  );`);

  db.run(`CREATE TABLE IF NOT EXISTS journals (
    id TEXT PRIMARY KEY, date TEXT NOT NULL, title TEXT NOT NULL DEFAULT '',
    emoji TEXT, truth_score INTEGER NOT NULL DEFAULT 0, dominant_state TEXT,
    journal_json TEXT NOT NULL DEFAULT '{}', rendered_markdown TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );`);

  db.run(`CREATE TABLE IF NOT EXISTS todo_tasks (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT,
    status TEXT NOT NULL DEFAULT 'active', priority INTEGER NOT NULL DEFAULT 0,
    project_id TEXT, parent_id TEXT, due_date TEXT, recurrence TEXT,
    tags TEXT NOT NULL DEFAULT '[]', is_deleted INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, completed_at TEXT, sort_order INTEGER NOT NULL DEFAULT 0
  );`);

  db.run(`CREATE TABLE IF NOT EXISTS todo_projects (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, icon TEXT, color TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0, is_deleted INTEGER NOT NULL DEFAULT 0,
    is_archived INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
  );`);

  db.run(`CREATE TABLE IF NOT EXISTS todo_smart_folders (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, filter_query TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
  );`);

  db.run(`CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', content TEXT NOT NULL DEFAULT '',
    pinned INTEGER NOT NULL DEFAULT 0, labels TEXT NOT NULL DEFAULT '[]',
    archived INTEGER NOT NULL DEFAULT 0, timestamp INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    logical_clock INTEGER NOT NULL DEFAULT 0, is_deleted INTEGER NOT NULL DEFAULT 0
  );`);

  db.run(`CREATE TABLE IF NOT EXISTS usage_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, snippet_uuid TEXT NOT NULL,
    snippet_keyword TEXT NOT NULL, snippet_name TEXT NOT NULL,
    snippet_char_count INTEGER NOT NULL, triggered_at TEXT NOT NULL
  );`);

  db.run(`CREATE TABLE IF NOT EXISTS analytics_events (
    event_id TEXT PRIMARY KEY, occurred_at TEXT NOT NULL, feature TEXT NOT NULL,
    action TEXT NOT NULL, outcome TEXT NOT NULL, source_id TEXT, surface TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    character_count INTEGER NOT NULL DEFAULT 0 CHECK (character_count >= 0),
    duration_ms INTEGER, focus_duration_ms INTEGER, result_count INTEGER,
    support_context INTEGER NOT NULL DEFAULT 0, legacy INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );`);

  if (seedSampleData) {
    db.run(`INSERT INTO groups (uuid, name, description, enabled, created_at, modified_at, is_pinned, sort_order, sync_enabled, logical_clock, is_deleted)
      VALUES ('grp-dummy-1', 'Default Group', 'Standard dummy group for pentest', 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 0, 1, 0, 1, 0);`);

    db.run(`INSERT INTO snippets (uuid, name, keyword, snippet, description, group_id, enabled, is_favorite, created_at, modified_at, logical_clock, is_deleted)
      VALUES ('snp-dummy-1', 'Greeting Snippet', ':hello', 'Hello from isolated test fixture!', 'Demo greeting', 'grp-dummy-1', 1, 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 1, 0);`);

    db.run(`INSERT INTO preferences (key, value) VALUES ('theme', 'dark'), ('telemetry_enabled', 'false');`);

    db.run(`INSERT INTO clipboard_history (id, content, content_type, source_app, created_at, is_favorite)
      VALUES (1, 'Initial clipboard sample for test', 'Text', 'terminal', '2026-01-01T00:00:00Z', 0);`);
    db.run(`INSERT INTO clipboard_entry_tags (entry_id, tag) VALUES (1, 'sample-tag');`);
    db.run(`INSERT INTO clipboard_tag_colors (tag, color) VALUES ('sample-tag', '#3b82f6');`);

    db.run(`INSERT INTO speech_history (id, entry_type, transcription_text, result_text, duration_ms, word_count, wpm, category, target_lang, timestamp, saved)
      VALUES (1, 'stt', 'sample audio text', 'sample audio text', 1200, 3, 150.0, 'General', 'en', 1767225600, 0);`);

    db.run(`INSERT INTO tts_history (id, entry_type, text_content, word_count, duration_ms, wpm, voice_id, language, timestamp)
      VALUES (1, 'tts', 'sample spoken text', 3, 1000, 180.0, 'voice-1', 'en', 1767225600);`);

    db.run(`INSERT INTO speech_dictionary (id, word, replacement, is_auto, confidence, original_heard, hit_count, created_at)
      VALUES (1, 'snipst', 'snipset', 0, 0.95, 'snipst', 1, '2026-01-01T00:00:00Z');`);

    db.run(`INSERT INTO journals (id, date, title, emoji, truth_score, dominant_state, journal_json, rendered_markdown, created_at, updated_at)
      VALUES ('jnl-dummy-1', '2026-09-21', 'Dummy Journal Entry', '🚀', 100, 'productive', '{"summary": "Test journal"}', '# Test Journal Content', '2026-09-21T00:00:00Z', '2026-09-21T00:00:00Z');`);

    db.run(`INSERT INTO todo_projects (id, name, description, icon, color, sort_order, is_deleted, is_archived, created_at)
      VALUES ('prj-dummy-1', 'Pentest Project', 'Project for verification tests', 'folder', '#10b981', 1, 0, 0, '2026-01-01T00:00:00Z');`);

    db.run(`INSERT INTO todo_smart_folders (id, name, filter_query, sort_order, created_at)
      VALUES ('fld-dummy-1', 'High Priority', 'priority > 1', 1, '2026-01-01T00:00:00Z');`);

    db.run(`INSERT INTO todo_tasks (id, title, description, status, priority, project_id, parent_id, tags, is_deleted, created_at, sort_order)
      VALUES ('tsk-dummy-1', 'Test snipset-cli command verification', 'Perform non-destructive testing', 'active', 2, 'prj-dummy-1', NULL, '["test", "cli"]', 0, '2026-01-01T00:00:00Z', 1);`);

    db.run(`INSERT INTO notes (id, title, content, pinned, labels, archived, timestamp, created_at, updated_at, logical_clock, is_deleted)
      VALUES ('not-dummy-1', 'Pentest Scratchpad', 'Dummy note content for cli testing', 1, '["pentest", "fixture"]', 0, 1767225600, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 1, 0);`);

    db.run(`INSERT INTO usage_events (id, snippet_uuid, snippet_keyword, snippet_name, snippet_char_count, triggered_at)
      VALUES (1, 'snp-dummy-1', ':hello', 'Greeting Snippet', 34, '2026-01-01T00:00:00Z');`);

    db.run(`INSERT INTO analytics_events (event_id, occurred_at, feature, action, outcome, source_id, surface, quantity, character_count, support_context, legacy, created_at)
      VALUES ('evt-dummy-1', '2026-01-01T00:00:00Z', 'snippet', 'expand', 'success', 'snp-dummy-1', 'cli', 1, 34, 0, 0, '2026-01-01T00:00:00Z');`);
  }

  db.close();
  return dbPath;
}
