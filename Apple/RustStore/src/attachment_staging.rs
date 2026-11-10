//! Experimental all-or-nothing staging. Not exposed through FFI or the app.
//! The caller must prove the attachment root belongs to the source database.
use anyhow::{bail, Result};
use rusqlite::Connection;
#[cfg(unix)] use rusqlite::OpenFlags;
use std::{collections::HashSet, path::{Component, Path, PathBuf}};

const MAX_FILE: u64 = 1024 * 1024 * 1024;
const MAX_TOTAL: u64 = 4 * MAX_FILE;
const MAX_FILES: usize = 10_000;

#[derive(Debug)]
pub(crate) struct Attachment { pub(crate) id: String, pub(crate) relative: PathBuf, pub(crate) size: u64 }

fn valid_relative(value: &str) -> bool {
    !value.is_empty() && !value.contains(['\\', ':', '\0']) &&
        value.split('/').all(|part| !part.is_empty() && part != "." && part != "..") &&
        Path::new(value).components().all(|part| matches!(part, Component::Normal(_)))
}

/// Fail closed if any record is unowned, shared, malformed or ambiguous.
/// This conservative inventory is not a complete embedded-reference audit.
pub(crate) fn inventory(db: &Connection) -> Result<Vec<Attachment>> {
    let mut statement = db.prepare("SELECT id,page_id,rel_path,size FROM attachments ORDER BY id")?;
    let mut rows = statement.query([])?;
    let mut items = Vec::new(); let mut seen = HashSet::new(); let mut total = 0_u64;
    while let Some(row) = rows.next()? {
        let id: String = row.get(0)?;
        if id.is_empty() || id.len()>1024 || id.as_bytes().contains(&0) { bail!("invalid attachment identifier") }
        let owner: Option<String> = row.get(1)?;
        let owner = owner.filter(|id| !id.is_empty()).ok_or_else(|| anyhow::anyhow!("unowned attachment is unsupported"))?;
        crate::require_personal(db, &owner)?;
        let relative: String = row.get(2)?;
        let size: i64 = row.get(3)?;
        if !valid_relative(&relative) || size < 0 || size as u64 > MAX_FILE || !seen.insert(relative.clone()) { bail!("invalid or ambiguous attachment") }
        total = total.checked_add(size as u64).ok_or_else(|| anyhow::anyhow!("attachment size overflow"))?;
        if total > MAX_TOTAL || items.len() >= MAX_FILES { bail!("attachment staging limit exceeded") }
        items.push(Attachment { id, relative: PathBuf::from(relative), size: size as u64 });
    }
    Ok(items)
}

#[cfg(unix)]
struct Pending(PathBuf);
#[cfg(unix)]
impl Drop for Pending { fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); } }

/// Copies only from already authorized records into a new private staging
/// directory. The caller must hold source scope and must not publish the result
/// until database identity, references and lifecycle are verified separately.
#[cfg(unix)]
pub(crate) fn stage(database: &Path, source_root: &Path, private_root: &Path) -> Result<PathBuf> {
    use std::{io::{Read, Write}, os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt}};
    if !database.is_absolute() || !source_root.is_absolute() || !source_root.is_dir() || !private_root.is_absolute() || !private_root.is_dir() { bail!("invalid staging roots") }
    let mut connection = Connection::open_with_flags(database, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX)?;
    connection.execute_batch("PRAGMA trusted_schema=OFF")?;
    let version: i64 = connection.pragma_query_value(None, "user_version", |r| r.get(0))?;
    if version != 11 { bail!("unsupported schema") }
    let tx = connection.transaction()?;
    let items = inventory(&tx)?;
    let directory = private_root.join(format!("worlds-attachment-stage-{}", uuid::Uuid::new_v4()));
    let mut builder = std::fs::DirBuilder::new(); builder.mode(0o700); builder.create(&directory)?;
    let pending = Pending(directory.clone());
    let marker = directory.join(".incomplete");
    std::fs::OpenOptions::new().write(true).create_new(true).mode(0o600).open(&marker)?;
    let destination = directory.join("attachments");
    std::fs::DirBuilder::new().mode(0o700).create(&destination)?;
    for item in items {
        let mut input = crate::attachment_open::open_confined(source_root, &item.relative)?;
        let before = input.metadata()?;
        if !before.is_file() || before.nlink() != 1 || before.len() != item.size { bail!("attachment changed or size mismatch") }
        let target = destination.join(&item.relative);
        let parent = target.parent().ok_or_else(|| anyhow::anyhow!("invalid target"))?;
        std::fs::DirBuilder::new().recursive(true).mode(0o700).create(parent)?;
        let mut output = std::fs::OpenOptions::new().write(true).create_new(true).mode(0o600).open(&target)?;
        let mut copied = 0_u64; let mut buffer = [0_u8; 64 * 1024];
        loop {
            let count = input.read(&mut buffer)?;
            if count == 0 { break }
            copied = copied.checked_add(count as u64).ok_or_else(|| anyhow::anyhow!("copy size overflow"))?;
            if copied > item.size { bail!("attachment grew while copying") }
            output.write_all(&buffer[..count])?;
        }
        output.sync_all()?;
        let after = input.metadata()?;
        if copied != item.size || before.dev() != after.dev() || before.ino() != after.ino() ||
           before.len() != after.len() || before.mtime() != after.mtime() || before.mtime_nsec() != after.mtime_nsec() ||
           before.ctime() != after.ctime() || before.ctime_nsec() != after.ctime_nsec() || after.nlink() != 1 {
            bail!("attachment changed while copying")
        }
    }
    tx.commit()?;
    std::fs::remove_file(marker)?;
    std::mem::forget(pending);
    Ok(directory)
}

#[cfg(not(unix))]
pub(crate) fn stage(_: &Path, _: &Path, _: &Path) -> Result<PathBuf> {
    bail!("safe attachment staging is unavailable on this platform")
}

#[cfg(test)]
mod tests {
    use super::*;
    fn memory() -> Connection {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch("CREATE TABLE pages(id TEXT PRIMARY KEY, workspace_id TEXT, metadata TEXT NOT NULL, deleted_at INTEGER); CREATE TABLE attachments(id TEXT PRIMARY KEY, page_id TEXT, rel_path TEXT NOT NULL, size INTEGER NOT NULL); INSERT INTO pages VALUES('personal',NULL,'{}',NULL),('shared','team','{}',NULL);").unwrap();
        db
    }
    #[test]
    fn path_validation_rejects_escape_and_ambiguous_components() {
        assert!(valid_relative("2026-11/abc.png"));
        for path in ["", "/absolute", "../secret", "a/../b", "a//b", "a/./b", "a\\b", "c:secret", "a/", "x\0y"] {
            assert!(!valid_relative(path), "{path:?}");
        }
    }
    #[test]
    fn inventory_rejects_unowned_shared_duplicate_and_malformed_records() {
        let db = memory();
        db.execute("INSERT INTO attachments VALUES('a','personal','2026-11/a.png',4)", []).unwrap();
        assert_eq!(inventory(&db).unwrap().len(),1);
        for sql in [
            "INSERT INTO attachments VALUES('b',NULL,'2026-11/b.png',1)",
            "INSERT INTO attachments VALUES('b','shared','2026-11/b.png',1)",
            "INSERT INTO attachments VALUES('b','personal','2026-11/a.png',1)",
            "INSERT INTO attachments VALUES('b','personal','../escape',1)",
            "INSERT INTO attachments VALUES('b','personal','2026-11/b.png',-1)",
        ] {
            db.execute(sql,[]).unwrap(); assert!(inventory(&db).is_err(),"{sql}");
            db.execute("DELETE FROM attachments WHERE id='b'",[]).unwrap();
        }
    }
    #[cfg(unix)]
    #[test]
    fn stages_personal_files_and_rolls_back_if_any_file_is_missing() {
        let root = std::env::temp_dir().canonicalize().unwrap().join(format!("worlds-stage-test-{}",uuid::Uuid::new_v4()));
        let source = root.join("source"); let private = root.join("private");
        std::fs::create_dir_all(source.join("2026-11")).unwrap(); std::fs::create_dir(&private).unwrap();
        std::fs::write(source.join("2026-11/a.bin"),b"safe").unwrap();
        let dbpath=root.join("worlds.db");
        std::fs::copy(Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/worlds-v11.db"),&dbpath).unwrap();
        let db=Connection::open(&dbpath).unwrap();
        db.execute("INSERT INTO attachments(id,page_id,kind,file_name,mime,size,rel_path,created_at) VALUES('a','fixture-page','file','a.bin','application/octet-stream',4,'2026-11/a.bin',1)",[]).unwrap();
        drop(db);
        let result=stage(&dbpath,&source,&private).unwrap();
        assert_eq!(std::fs::read(result.join("attachments/2026-11/a.bin")).unwrap(),b"safe");
        assert!(!result.join(".incomplete").exists());
        assert_eq!(std::fs::read(source.join("2026-11/a.bin")).unwrap(),b"safe");
        std::fs::remove_dir_all(&result).unwrap();
        let db=Connection::open(&dbpath).unwrap();
        db.execute("INSERT INTO attachments(id,page_id,kind,file_name,mime,size,rel_path,created_at) VALUES('b','fixture-page','file','missing','application/octet-stream',1,'2026-11/missing',1)",[]).unwrap(); drop(db);
        assert!(stage(&dbpath,&source,&private).is_err());
        assert_eq!(std::fs::read_dir(&private).unwrap().count(),0);
        std::fs::remove_dir_all(root).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn rejects_symlink_and_hardlink_sources_without_publishing() {
        use std::os::unix::fs::symlink;
        let root = std::env::temp_dir().canonicalize().unwrap().join(format!("worlds-stage-links-{}",uuid::Uuid::new_v4()));
        let source = root.join("source"); let private = root.join("private");
        std::fs::create_dir_all(&source).unwrap(); std::fs::create_dir(&private).unwrap();
        std::fs::write(root.join("outside"),b"safe").unwrap();
        symlink(root.join("outside"),source.join("item")).unwrap();
        let dbpath=root.join("worlds.db"); std::fs::copy(Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/worlds-v11.db"),&dbpath).unwrap();
        let db=Connection::open(&dbpath).unwrap();
        db.execute("INSERT INTO attachments(id,page_id,kind,file_name,mime,size,rel_path,created_at) VALUES('a','fixture-page','file','item','application/octet-stream',4,'item',1)",[]).unwrap(); drop(db);
        assert!(stage(&dbpath,&source,&private).is_err());
        std::fs::remove_file(source.join("item")).unwrap();
        std::fs::hard_link(root.join("outside"),source.join("item")).unwrap();
        assert!(stage(&dbpath,&source,&private).is_err());
        assert_eq!(std::fs::read_dir(&private).unwrap().count(),0);
        std::fs::remove_dir_all(root).unwrap();
    }
}
