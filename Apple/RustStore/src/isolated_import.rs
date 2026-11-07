//! Experimental SQLite backup into a caller-owned private container.
//! Not exposed to the application: the caller must establish the container's
//! trust and hold security-scoped access to the source for the entire call.
use anyhow::{bail, Context, Result};
use rusqlite::{backup::{Backup, StepResult}, Connection, OpenFlags};
use std::{path::{Path, PathBuf}, time::Duration};

struct PendingDirectory(PathBuf);
impl Drop for PendingDirectory {
    fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); }
}

/// Creates a unique, private destination directory. `private_root` must be an
/// app-controlled directory which cannot be replaced by another process.
/// Copies the whole database, including shared rows; the normal personal access
/// checks remain mandatory. Attachments are not copied.
pub(crate) fn import(source: &Path, private_root: &Path) -> Result<PathBuf> {
    import_with_hook(source, private_root, || Ok(()))
}

fn import_with_hook(source: &Path, private_root: &Path, before_publish: impl FnOnce() -> Result<()>) -> Result<PathBuf> {
    if !source.is_absolute() || !private_root.is_absolute() || !source.is_file() || !private_root.is_dir() {
        bail!("source database and private container must exist at absolute paths")
    }
    let directory = private_root.join(format!("worlds-import-{}", uuid::Uuid::new_v4()));
    let mut builder = std::fs::DirBuilder::new();
    #[cfg(unix)] { use std::os::unix::fs::DirBuilderExt; builder.mode(0o700); }
    builder.create(&directory).context("create isolated import directory")?;
    let pending = PendingDirectory(directory.clone());
    // A surviving marker identifies an incomplete import after a crash. It is
    // not permission to delete the directory while another import may run.
    let marker = directory.join(".incomplete");
    std::fs::OpenOptions::new().write(true).create_new(true).open(&marker)?;
    let destination = directory.join("worlds.db");
    // Reserve the destination without ever replacing an existing file.
    std::fs::OpenOptions::new().write(true).create_new(true).open(&destination)?;
    let source_db = Connection::open_with_flags(source, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX)?;
    source_db.busy_timeout(Duration::from_secs(5))?;
    let mut target = Connection::open_with_flags(&destination, OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX)?;
    {
        let backup = Backup::new(&source_db, &mut target)?;
        let mut retries = 0;
        loop {
            match backup.step(128)? {
                StepResult::Done => break,
                StepResult::More => { retries = 0; },
                StepResult::Busy | StepResult::Locked => {
                    retries += 1;
                    if retries > 100 { bail!("source database remained busy") }
                    std::thread::sleep(Duration::from_millis(50));
                },
                _ => bail!("unexpected SQLite backup result"),
            }
        }
    }
    let version: i64 = target.pragma_query_value(None, "user_version", |r| r.get(0))?;
    if version != 11 { bail!("unsupported schema version {version}") }
    let check: String = target.query_row("PRAGMA integrity_check", [], |r| r.get(0))?;
    if check != "ok" { bail!("database integrity check failed: {check}") }
    // Check columns used by personal project read and write; version alone is
    // not proof of the full original schema or of trustworthy content.
    target.prepare("SELECT id,kind,metadata,workspace_id,deleted_at,updated_at FROM pages LIMIT 0")?;
    target.prepare("SELECT id,page_id,content,sort_key FROM blocks LIMIT 0")?;
    target.prepare("SELECT page_id,kind,origin,at FROM changes LIMIT 0")?;
    drop(target); drop(source_db);
    before_publish()?;
    std::fs::remove_file(marker)?;
    std::mem::forget(pending);
    Ok(destination)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn setup() -> (PathBuf, PathBuf) {
        let root = std::env::temp_dir().join(format!("worlds-import-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let source = root.join("source.db");
        std::fs::copy(Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/worlds-v11.db"), &source).unwrap();
        let container = root.join("container"); std::fs::create_dir(&container).unwrap();
        (source, container)
    }
    #[test]
    fn imports_committed_wal_into_independent_database_without_changing_source_content() {
        let (source, root) = setup();
        let db = Connection::open(&source).unwrap();
        db.pragma_update(None, "journal_mode", "WAL").unwrap();
        db.execute("UPDATE pages SET title='committed WAL' WHERE id='fixture-page'", []).unwrap();
        let copy = import(&source, &root).unwrap();
        let imported = Connection::open(&copy).unwrap();
        assert_eq!(imported.query_row("SELECT title FROM pages WHERE id='fixture-page'", [], |r| r.get::<_, String>(0)).unwrap(), "committed WAL");
        imported.execute("UPDATE pages SET title='independent' WHERE id='fixture-page'", []).unwrap();
        assert_eq!(db.query_row("SELECT title FROM pages WHERE id='fixture-page'", [], |r| r.get::<_, String>(0)).unwrap(), "committed WAL");
        drop(imported); drop(db); std::fs::remove_dir_all(root.parent().unwrap()).unwrap();
    }
    #[test]
    fn ffi_import_request_copies_live_wal() {
        let (source, root) = setup();
        let db = Connection::open(&source).unwrap();
        db.pragma_update(None, "journal_mode", "WAL").unwrap();
        db.execute("UPDATE pages SET title='ffi WAL' WHERE id='fixture-page'", []).unwrap();
        let request = serde_json::json!({"operation":"import_local_snapshot", "source":source, "private_root":root}).to_string();
        let raw = unsafe { crate::worlds_store_call(request.as_ptr(), request.len()) };
        assert!(!raw.is_null());
        let response: serde_json::Value = serde_json::from_str(unsafe { std::ffi::CStr::from_ptr(raw) }.to_str().unwrap()).unwrap();
        unsafe { crate::worlds_store_free(raw) };
        assert_eq!(response["ok"], true, "{response}");
        let copy = Connection::open(response["value"]["path"].as_str().unwrap()).unwrap();
        assert_eq!(copy.query_row("SELECT title FROM pages WHERE id='fixture-page'", [], |r| r.get::<_, String>(0)).unwrap(), "ffi WAL");
        drop(copy); drop(db); std::fs::remove_dir_all(root.parent().unwrap()).unwrap();
    }
    #[test]
    fn failed_import_removes_partial_destination_and_keeps_original() {
        let (source, root) = setup();
        assert!(import_with_hook(&source, &root, || bail!("simulated interruption")).is_err());
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 0);
        let db = Connection::open_with_flags(&source, OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
        assert_eq!(db.query_row("PRAGMA integrity_check", [], |r| r.get::<_, String>(0)).unwrap(), "ok");
        drop(db); std::fs::remove_dir_all(root.parent().unwrap()).unwrap();
    }
    #[test]
    fn unsupported_schema_is_not_published() {
        let (source, root) = setup();
        let db = Connection::open(&source).unwrap(); db.pragma_update(None, "user_version", 12).unwrap(); drop(db);
        assert!(import(&source, &root).is_err());
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 0);
        std::fs::remove_dir_all(root.parent().unwrap()).unwrap();
    }
    #[test]
    fn project_edit_in_copy_does_not_edit_original() {
        let (source, root) = setup();
        let db = Connection::open(&source).unwrap();
        db.execute("INSERT INTO pages(id,title,kind,metadata,created_at,updated_at) VALUES('project','Project','project','{\"project\":{\"status\":\"active\",\"links\":[]}}',1,100)", []).unwrap();
        drop(db);
        let copy = import(&source, &root).unwrap();
        let original = crate::resource_ops::read_resource(&source, "project").unwrap();
        let mut edited = original["metadata"].clone();
        edited["project"]["description"] = serde_json::json!("local draft");
        crate::resource_ops::save_project(&copy, "project", 100, original["metadata"].clone(), edited.clone()).unwrap();
        assert_eq!(crate::resource_ops::read_resource(&copy, "project").unwrap()["metadata"], edited);
        assert_eq!(crate::resource_ops::read_resource(&source, "project").unwrap()["metadata"], original["metadata"]);
        std::fs::remove_dir_all(root.parent().unwrap()).unwrap();
    }
    #[test]
    fn import_does_not_copy_attachment_files_or_grant_shared_access() {
        let (source, root) = setup();
        let outside = root.parent().unwrap().join("private-image.png");
        std::fs::write(&outside, b"synthetic image").unwrap();
        let db = Connection::open(&source).unwrap();
        db.execute("INSERT INTO pages(id,title,kind,workspace_id,metadata,created_at,updated_at) VALUES('shared-project','Shared','project','team','{}',1,100)", []).unwrap();
        db.execute("INSERT INTO attachments(id,page_id,kind,file_name,mime,size,rel_path,created_at) VALUES('private-asset','shared-project','image','private-image.png','image/png',15,'private-image.png',1)", []).unwrap();
        drop(db);
        let copy = import(&source, &root).unwrap();
        let copied = Connection::open(&copy).unwrap();
        assert_eq!(copied.query_row("SELECT count(*) FROM attachments WHERE id='private-asset'", [], |r| r.get::<_, i64>(0)).unwrap(), 1);
        assert!(crate::require_personal(&copied, "shared-project").is_err());
        assert!(!copy.parent().unwrap().join("private-image.png").exists());
        assert_eq!(std::fs::read(outside).unwrap(), b"synthetic image");
        drop(copied); std::fs::remove_dir_all(root.parent().unwrap()).unwrap();
    }
}
