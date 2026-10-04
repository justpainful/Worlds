//! SQLite storage: connection setup and schema migrations.
//!
//! Both the UI process and the `--mcp` tool process open the same database
//! (WAL mode), so every writer appends to `changes` and readers watch it.

use anyhow::{Context, Result};
use rusqlite::Connection;
use std::path::{Path, PathBuf};

pub fn data_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("WORLDS_DATA_DIR") {
        return PathBuf::from(dir);
    }
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("Worlds")
}

pub fn db_path() -> PathBuf {
    data_dir().join("worlds.db")
}

pub fn attachments_dir() -> PathBuf {
    data_dir().join("attachments")
}

pub fn open(path: &Path) -> Result<Connection> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).context("create data dir")?;
    }
    let conn = Connection::open(path).context("open database")?;
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         PRAGMA foreign_keys = ON;
         PRAGMA busy_timeout = 5000;",
    )?;
    migrate(&conn)?;
    Ok(conn)
}

const MIGRATIONS: &[&str] = &[
    // 1: core model
    r#"
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);

    CREATE TABLE profile (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL DEFAULT '',
        handle TEXT,
        avatar TEXT,
        banner TEXT,
        bio TEXT,
        status TEXT,
        accent TEXT,
        theme TEXT NOT NULL DEFAULT 'dark',
        language TEXT NOT NULL DEFAULT 'auto',
        text_direction TEXT NOT NULL DEFAULT 'auto',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    );

    CREATE TABLE pages (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '',
        icon TEXT,
        cover TEXT,
        parent_id TEXT REFERENCES pages(id) ON DELETE SET NULL,
        sort_key REAL NOT NULL DEFAULT 0,
        owner_id TEXT,
        kind TEXT NOT NULL DEFAULT 'page',
        template_category TEXT,
        pinned INTEGER NOT NULL DEFAULT 0,
        pin_order REAL,
        favorite INTEGER NOT NULL DEFAULT 0,
        archived INTEGER NOT NULL DEFAULT 0,
        deleted_at INTEGER,
        metadata TEXT NOT NULL DEFAULT '{}',
        instructions TEXT NOT NULL DEFAULT '[]',
        preview TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        opened_at INTEGER
    );
    CREATE INDEX pages_parent ON pages(parent_id, sort_key);

    CREATE TABLE blocks (
        id TEXT PRIMARY KEY,
        page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        sort_key REAL NOT NULL,
        content TEXT NOT NULL,
        properties TEXT NOT NULL DEFAULT '{}',
        direction TEXT NOT NULL DEFAULT 'auto',
        text TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    );
    CREATE INDEX blocks_page ON blocks(page_id, sort_key);

    CREATE TABLE refs (
        source_page TEXT NOT NULL,
        source_block TEXT NOT NULL,
        target_page TEXT NOT NULL,
        kind TEXT NOT NULL,
        PRIMARY KEY (source_block, target_page, kind)
    );
    CREATE INDEX refs_target ON refs(target_page);
    CREATE INDEX refs_source ON refs(source_page);

    CREATE TABLE attachments (
        id TEXT PRIMARY KEY,
        page_id TEXT,
        kind TEXT NOT NULL,
        file_name TEXT NOT NULL,
        mime TEXT NOT NULL,
        size INTEGER NOT NULL,
        rel_path TEXT NOT NULL,
        width INTEGER,
        height INTEGER,
        created_at INTEGER NOT NULL
    );
    CREATE INDEX attachments_page ON attachments(page_id);

    CREATE TABLE history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        page_id TEXT,
        op_id TEXT,
        actor TEXT NOT NULL,
        kind TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        block_id TEXT,
        before TEXT,
        after TEXT,
        meta TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL
    );
    CREATE INDEX history_page ON history(page_id, created_at);
    CREATE INDEX history_op ON history(op_id);

    CREATE TABLE versions (
        id TEXT PRIMARY KEY,
        page_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        actor TEXT NOT NULL,
        op_id TEXT,
        label TEXT,
        snapshot TEXT NOT NULL
    );
    CREATE INDEX versions_page ON versions(page_id, created_at);

    CREATE TABLE automations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        spec TEXT NOT NULL,
        next_run_at INTEGER,
        last_run_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    );

    CREATE TABLE runs (
        id TEXT PRIMARY KEY,
        automation_id TEXT NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
        status TEXT NOT NULL,
        trigger TEXT NOT NULL DEFAULT 'schedule',
        scheduled_for INTEGER,
        started_at INTEGER,
        finished_at INTEGER,
        version_id TEXT,
        output TEXT,
        error TEXT
    );
    CREATE INDEX runs_automation ON runs(automation_id, started_at);

    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

    CREATE TABLE changes (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        page_id TEXT,
        kind TEXT NOT NULL,
        origin TEXT NOT NULL,
        at INTEGER NOT NULL
    );

    CREATE TABLE pending_actions (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        payload TEXT NOT NULL,
        requested_by TEXT NOT NULL,
        op_id TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        result TEXT,
        created_at INTEGER NOT NULL,
        resolved_at INTEGER
    );

    CREATE TABLE discord_messages (
        id TEXT PRIMARY KEY,
        page_id TEXT,
        automation_id TEXT,
        destination TEXT NOT NULL,
        channel_id TEXT,
        message_id TEXT,
        payload TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        edited_at INTEGER
    );

    CREATE VIRTUAL TABLE pages_fts USING fts5(
        page_id UNINDEXED, title, body, tokenize = 'trigram remove_diacritics 1'
    );
    "#,
    // 2: Claude conversations, richer profile
    r#"
    CREATE TABLE ai_chats (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '',
        page_id TEXT,
        session_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    );
    CREATE TABLE ai_messages (
        id TEXT PRIMARY KEY,
        chat_id TEXT NOT NULL REFERENCES ai_chats(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        steps TEXT NOT NULL DEFAULT '[]',
        op_id TEXT,
        meta TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL
    );
    CREATE INDEX ai_messages_chat ON ai_messages(chat_id, created_at);

    ALTER TABLE profile ADD COLUMN location TEXT;
    ALTER TABLE profile ADD COLUMN links TEXT NOT NULL DEFAULT '[]';
    "#,
    // 3: profile blocks (widgets) and banner focus
    r#"
    ALTER TABLE profile ADD COLUMN blocks TEXT NOT NULL DEFAULT '[]';
    ALTER TABLE profile ADD COLUMN banner_focus TEXT;
    "#,
    // 4: avatar crop ("x,y,zoom")
    r#"
    ALTER TABLE profile ADD COLUMN avatar_crop TEXT;
    "#,
];

fn migrate(conn: &Connection) -> Result<()> {
    let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    for (i, sql) in MIGRATIONS.iter().enumerate() {
        let target = (i + 1) as i64;
        if version < target {
            let tx = conn.unchecked_transaction()?;
            tx.execute_batch(sql)
                .with_context(|| format!("migration {target}"))?;
            tx.execute_batch(&format!("PRAGMA user_version = {target}"))?;
            tx.commit()?;
        }
    }
    Ok(())
}

pub fn now() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

pub fn new_id() -> String {
    uuid::Uuid::now_v7().simple().to_string()
}

/// Record a change so other processes (UI ↔ MCP) can react.
pub fn mark_change(conn: &Connection, page_id: Option<&str>, kind: &str, origin: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO changes (page_id, kind, origin, at) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![page_id, kind, origin, now()],
    )?;
    Ok(())
}

pub fn get_setting(conn: &Connection, key: &str) -> Result<Option<serde_json::Value>> {
    use rusqlite::OptionalExtension;
    let raw: Option<String> = conn
        .query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| r.get(0))
        .optional()?;
    Ok(raw.and_then(|s| serde_json::from_str(&s).ok()))
}

pub fn set_setting(conn: &Connection, key: &str, value: &serde_json::Value) -> Result<()> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        rusqlite::params![key, value.to_string()],
    )?;
    Ok(())
}
