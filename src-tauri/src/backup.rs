//! SQLite backups and recovery.
//!
//! - Before any schema migration, a copy of the database is taken.
//! - At most once a day, at launch, an automatic copy is taken.
//! - The user can take one at any time, and restore one: the restore is
//!   staged and applied at the next launch, before anything opens the file.
//! - If the database cannot be opened at launch, the damaged file is set
//!   aside and the newest backup that opens cleanly is restored.
//!
//! Copies are made with `VACUUM INTO`, which writes a consistent, compact
//! snapshot even while the database is in use (WAL mode).

use crate::db;
use anyhow::{anyhow, bail, Context, Result};
use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use std::path::{Path, PathBuf};

/// Automatic copies kept (manual and pre-migration copies are kept longer).
const KEEP_AUTO: usize = 10;
const KEEP_OTHER: usize = 20;
const DAY: i64 = 24 * 60 * 60 * 1000;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    pub file: String,
    pub created_at: i64,
    pub reason: String,
    pub size: u64,
}

pub fn backups_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("backups")
}

fn pending_marker(data_dir: &Path) -> PathBuf {
    data_dir.join("restore.pending")
}

/// Copy the open database to `backups/worlds-<millis>-<reason>.db`.
pub fn backup_conn(conn: &Connection, data_dir: &Path, reason: &str) -> Result<BackupInfo> {
    let dir = backups_dir(data_dir);
    std::fs::create_dir_all(&dir).context("create backups folder")?;
    let created_at = db::now();
    let reason: String = reason.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').collect();
    let file = format!("worlds-{created_at}-{reason}.db");
    let path = dir.join(&file);
    let target = path.to_string_lossy().replace('\'', "''");
    conn.execute_batch(&format!("VACUUM INTO '{target}'")).context("write backup")?;
    let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    prune(data_dir)?;
    Ok(BackupInfo { file, created_at, reason, size })
}

/// Backups, newest first.
pub fn list(data_dir: &Path) -> Vec<BackupInfo> {
    let Ok(rd) = std::fs::read_dir(backups_dir(data_dir)) else { return Vec::new() };
    let mut out: Vec<BackupInfo> = rd
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let file = e.file_name().to_string_lossy().to_string();
            let rest = file.strip_prefix("worlds-")?.strip_suffix(".db")?;
            let (ts, reason) = rest.split_once('-')?;
            Some(BackupInfo {
                created_at: ts.parse().ok()?,
                reason: reason.to_string(),
                size: e.metadata().map(|m| m.len()).unwrap_or(0),
                file,
            })
        })
        .collect();
    out.sort_by_key(|b| std::cmp::Reverse(b.created_at));
    out
}

fn prune(data_dir: &Path) -> Result<()> {
    let all = list(data_dir);
    let (auto, other): (Vec<_>, Vec<_>) = all.into_iter().partition(|b| b.reason == "daily");
    for b in auto.iter().skip(KEEP_AUTO).chain(other.iter().skip(KEEP_OTHER)) {
        let _ = std::fs::remove_file(backups_dir(data_dir).join(&b.file));
    }
    Ok(())
}

/// Make sure a backup file name is one of ours (no paths, no traversal).
fn checked(data_dir: &Path, file: &str) -> Result<PathBuf> {
    if file.contains(['/', '\\']) || file.contains("..") || !file.starts_with("worlds-") || !file.ends_with(".db") {
        bail!("not a Worlds backup: {file}");
    }
    let path = backups_dir(data_dir).join(file);
    if !path.is_file() {
        bail!("backup not found: {file}");
    }
    Ok(path)
}

/// Open a file read-only and run SQLite's integrity check.
pub fn verify(path: &Path) -> Result<()> {
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX)?;
    let res: String = conn.query_row("PRAGMA quick_check", [], |r| r.get(0))?;
    if res != "ok" {
        bail!("integrity check failed: {res}");
    }
    Ok(())
}

/// Cheap launch-time check: the file is a SQLite database whose schema can be
/// read. (The full page-by-page check runs in the background, see `daily`.)
pub fn readable(path: &Path) -> Result<()> {
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX)?;
    let _: i64 = conn.query_row("SELECT COUNT(*) FROM sqlite_master", [], |r| r.get(0))?;
    Ok(())
}

/// Stage a restore for the next launch.
pub fn schedule_restore(data_dir: &Path, file: &str) -> Result<()> {
    let path = checked(data_dir, file)?;
    verify(&path).context("the backup itself is damaged")?;
    std::fs::write(pending_marker(data_dir), file).context("stage restore")?;
    Ok(())
}

pub fn pending_restore(data_dir: &Path) -> Option<String> {
    std::fs::read_to_string(pending_marker(data_dir)).ok().map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

pub fn cancel_restore(data_dir: &Path) {
    let _ = std::fs::remove_file(pending_marker(data_dir));
}

/// Move the live database files aside (into backups/) under `reason`.
fn set_aside(db_path: &Path, data_dir: &Path, reason: &str) -> Result<()> {
    let dir = backups_dir(data_dir);
    std::fs::create_dir_all(&dir)?;
    let stamp = db::now();
    for suffix in ["", "-wal", "-shm"] {
        let src = PathBuf::from(format!("{}{suffix}", db_path.display()));
        if src.exists() {
            let dst = dir.join(format!("worlds-{stamp}-{reason}.db{suffix}"));
            std::fs::rename(&src, &dst).or_else(|_| std::fs::copy(&src, &dst).map(|_| ()).and_then(|_| std::fs::remove_file(&src)))?;
        }
    }
    Ok(())
}

fn put_in_place(backup: &Path, db_path: &Path) -> Result<()> {
    std::fs::copy(backup, db_path).context("copy backup into place")?;
    Ok(())
}

/// Everything that has to happen before the database is opened.
/// Returns a note for the UI when something was recovered or restored.
pub fn prepare(db_path: &Path, data_dir: &Path) -> Result<Option<String>> {
    // 1. A restore the user asked for.
    if let Some(file) = pending_restore(data_dir) {
        cancel_restore(data_dir);
        let src = checked(data_dir, &file)?;
        verify(&src)?;
        set_aside(db_path, data_dir, "before-restore")?;
        put_in_place(&src, db_path)?;
        return Ok(Some(format!("Restored the backup from {}.", stamp_of(&file))));
    }
    if !db_path.exists() {
        return Ok(None);
    }
    // 2. A database that cannot be read: recover from the newest good backup.
    if let Err(e) = readable(db_path) {
        for b in list(data_dir) {
            let p = backups_dir(data_dir).join(&b.file);
            if verify(&p).is_ok() {
                set_aside(db_path, data_dir, "damaged")?;
                put_in_place(&p, db_path)?;
                return Ok(Some(format!(
                    "The database could not be read ({e:#}). It was set aside and the backup from {} was restored.",
                    stamp_of(&b.file)
                )));
            }
        }
        return Err(anyhow!("the database could not be read and no usable backup exists: {e:#}"));
    }
    // 3. Schema changes ahead: keep a copy of the current state first.
    let conn = Connection::open_with_flags(db_path, OpenFlags::SQLITE_OPEN_READ_WRITE)?;
    let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if version < db::schema_version() {
        backup_conn(&conn, data_dir, &format!("pre-migration-v{version}"))?;
    }
    Ok(None)
}

/// A daily copy, taken after launch, off the startup path. The full integrity
/// check runs first: a damaged database is never copied over good backups,
/// and the problem is recorded for Settings > Storage.
pub fn daily(conn: &Connection, data_dir: &Path) -> Result<Option<BackupInfo>> {
    let last = list(data_dir).into_iter().find(|b| b.reason == "daily").map(|b| b.created_at).unwrap_or(0);
    if db::now() - last < DAY {
        return Ok(None);
    }
    let check: String = conn.query_row("PRAGMA quick_check", [], |r| r.get(0))?;
    let health = if check == "ok" {
        serde_json::json!({ "ok": true, "at": db::now() })
    } else {
        serde_json::json!({ "ok": false, "at": db::now(), "detail": check })
    };
    db::set_setting(conn, "storage.health", &health)?;
    if check != "ok" {
        bail!("integrity check failed: {check}");
    }
    backup_conn(conn, data_dir, "daily").map(Some)
}

fn stamp_of(file: &str) -> String {
    let ms: i64 = file.strip_prefix("worlds-").and_then(|r| r.split('-').next()).and_then(|t| t.parse().ok()).unwrap_or(0);
    chrono::DateTime::from_timestamp_millis(ms)
        .map(|d| d.with_timezone(&chrono::Local).format("%Y-%m-%d %H:%M").to_string())
        .unwrap_or_else(|| file.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("worlds-test-{name}-{}", db::new_id()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn backup_restore_roundtrip() {
        let dir = temp_dir("backup");
        let path = dir.join("worlds.db");
        {
            let conn = db::open(&path).unwrap();
            db::set_setting(&conn, "probe", &serde_json::json!("before")).unwrap();
            let b = backup_conn(&conn, &dir, "manual").unwrap();
            assert!(b.size > 0);
            db::set_setting(&conn, "probe", &serde_json::json!("after")).unwrap();
            schedule_restore(&dir, &b.file).unwrap();
        }
        let note = prepare(&path, &dir).unwrap();
        assert!(note.is_some());
        let conn = db::open(&path).unwrap();
        assert_eq!(db::get_setting(&conn, "probe").unwrap(), Some(serde_json::json!("before")));
        // The replaced database was kept.
        assert!(list(&dir).iter().any(|b| b.reason == "before-restore"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn damaged_database_recovers_from_backup() {
        let dir = temp_dir("damaged");
        let path = dir.join("worlds.db");
        {
            let conn = db::open(&path).unwrap();
            db::set_setting(&conn, "probe", &serde_json::json!(1)).unwrap();
            backup_conn(&conn, &dir, "daily").unwrap();
        }
        let _ = std::fs::remove_file(dir.join("worlds.db-wal"));
        let _ = std::fs::remove_file(dir.join("worlds.db-shm"));
        std::fs::write(&path, b"this is not a database").unwrap();
        let note = prepare(&path, &dir).unwrap();
        assert!(note.unwrap().contains("set aside"));
        let conn = db::open(&path).unwrap();
        assert_eq!(db::get_setting(&conn, "probe").unwrap(), Some(serde_json::json!(1)));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_foreign_paths() {
        let dir = temp_dir("paths");
        assert!(schedule_restore(&dir, "../worlds.db").is_err());
        assert!(schedule_restore(&dir, "C:\\Windows\\x.db").is_err());
        assert!(schedule_restore(&dir, "other.db").is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn daily_runs_once() {
        let dir = temp_dir("daily");
        let conn = db::open(&dir.join("worlds.db")).unwrap();
        assert!(daily(&conn, &dir).unwrap().is_some());
        assert!(daily(&conn, &dir).unwrap().is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
