//! Experimental combined import. Debug-only fixture bridge; not product-enabled.
//! Path and metadata checks do not establish atomic source identity for SQLite.
#[cfg(unix)]
pub(crate) mod unix {
    use anyhow::{bail, Context, Result};
    use rusqlite::{Connection, OpenFlags};
    use std::{ffi::CString, fs::File, os::unix::{ffi::OsStrExt, fs::{DirBuilderExt, MetadataExt}}, path::{Path, PathBuf}};

    #[derive(Debug, PartialEq, Eq)]
    struct Stamp { dev: u64, ino: u64, size: u64, mtime: i64, mtime_ns: i64, ctime: i64, ctime_ns: i64, links: u64 }
    fn stamp(file: &File) -> Result<Stamp> {
        let m=file.metadata()?;
        Ok(Stamp { dev:m.dev(), ino:m.ino(), size:m.len(), mtime:m.mtime(), mtime_ns:m.mtime_nsec(), ctime:m.ctime(), ctime_ns:m.ctime_nsec(), links:m.nlink() })
    }
    fn same_directory(first: &File, second: &File) -> Result<bool> {
        let a=first.metadata()?; let b=second.metadata()?;
        Ok(a.is_dir() && b.is_dir() && a.dev()==b.dev() && a.ino()==b.ino())
    }
    fn optional_file(root: &Path, name: &str) -> Result<Option<File>> {
        match std::fs::symlink_metadata(root.join(name)) {
            Err(error) if error.kind()==std::io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error.into()),
            Ok(_) => Ok(Some(crate::attachment_open::open_confined(root,Path::new(name))?)),
        }
    }
    fn optional_stamp(value: &Option<File>) -> Result<Option<Stamp>> { value.as_ref().map(stamp).transpose() }

    // HAS_MOVED compares SQLite's own open file against its current pathname.
    // It cannot prevent a concurrent swap and restoration between checks.
    fn sqlite_source_matches(db: &Connection, source: &Path, expected: &Stamp) -> Result<()> {
        let mut moved: std::ffi::c_int = -1;
        let result = unsafe {
            rusqlite::ffi::sqlite3_file_control(
                db.handle(), b"main\0".as_ptr().cast(), rusqlite::ffi::SQLITE_FCNTL_HAS_MOVED,
                (&mut moved as *mut std::ffi::c_int).cast(),
            )
        };
        if result != rusqlite::ffi::SQLITE_OK || moved != 0 { bail!("SQLite source identity changed or cannot be verified") }
        let current=crate::attachment_open::open_confined(source,Path::new("worlds.db"))?;
        if &stamp(&current)? != expected { bail!("source database identity changed") }
        Ok(())
    }

    #[derive(Debug, PartialEq, Eq)]
    pub(crate) enum AttachmentIssueKind { Missing, Inaccessible, SizeOrIdentityMismatch }
    #[derive(Debug, PartialEq, Eq)]
    pub(crate) struct AttachmentIssue { pub(crate) id: String, pub(crate) kind: AttachmentIssueKind }
    /// A read-only, point-in-time diagnostic, not proof that the directory
    /// belongs to this database or a permit to expose/import its files.
    pub(crate) fn inspect_copy(database_copy: &Path, source_attachments: &Path) -> Result<Vec<AttachmentIssue>> {
        if !database_copy.is_absolute() || !source_attachments.is_absolute() { bail!("invalid inspection roots") }
        let source_dir=crate::attachment_open::open_directory(source_attachments)?;
        let mut db=Connection::open_with_flags(database_copy,OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX)?;
        db.execute_batch("PRAGMA trusted_schema=OFF")?;
        let version:i64=db.pragma_query_value(None,"user_version",|r|r.get(0))?;
        if version!=11 { bail!("unsupported schema") }
        let tx=db.transaction()?;
        let records=crate::attachment_staging::inventory(&tx)?;
        let mut issues=Vec::new();
        for record in records {
            let kind=match crate::attachment_open::open_confined(source_attachments,&record.relative) {
                Ok(file) => {
                    let meta=stamp(&file)?;
                    if meta.links != 1 || meta.size != record.size { Some(AttachmentIssueKind::SizeOrIdentityMismatch) } else { None }
                },
                Err(error) => {
                    let missing=error.downcast_ref::<std::io::Error>().is_some_and(|io|io.kind()==std::io::ErrorKind::NotFound);
                    Some(if missing { AttachmentIssueKind::Missing } else { AttachmentIssueKind::Inaccessible })
                }
            };
            if let Some(kind)=kind { issues.push(AttachmentIssue{id:record.id,kind}); }
        }
        let current=crate::attachment_open::open_directory(source_attachments)?;
        if !same_directory(&source_dir,&current)? { bail!("source attachment directory changed") }
        tx.commit()?;
        Ok(issues)
    }

    struct Pending(PathBuf);
    impl Drop for Pending { fn drop(&mut self) { let _=std::fs::remove_dir_all(&self.0); } }

    // No-replace publication is supported only where the OS provides it.
    fn publish_noreplace(from: &Path, to: &Path) -> Result<()> {
        let from=CString::new(from.as_os_str().as_bytes())?; let to=CString::new(to.as_os_str().as_bytes())?;
        #[cfg(any(target_os="macos",target_os="ios"))]
        let result=unsafe { libc::renamex_np(from.as_ptr(),to.as_ptr(),libc::RENAME_EXCL) };
        #[cfg(target_os="linux")]
        let result=unsafe { libc::renameat2(libc::AT_FDCWD,from.as_ptr(),libc::AT_FDCWD,to.as_ptr(),libc::RENAME_NOREPLACE) };
        #[cfg(not(any(target_os="macos",target_os="ios",target_os="linux")))]
        let result={ let _=(&from,&to); -1 };
        if result != 0 { bail!("atomic no-replace publication failed: {}",std::io::Error::last_os_error()) }
        Ok(())
    }

    pub(crate) fn prepare(source: &Path, private_root: &Path) -> Result<PathBuf> {
        prepare_with_hooks(source,private_root,||Ok(()),||Ok(()))
    }
    fn prepare_with_hooks(source: &Path, private_root: &Path, after_backup: impl FnOnce() -> Result<()>, after_staging: impl FnOnce() -> Result<()>) -> Result<PathBuf> {
        if !source.is_absolute() || !private_root.is_absolute() || !private_root.is_dir() { bail!("invalid import roots") }
        let source_canonical=source.canonicalize()?;
        let private_canonical=private_root.canonicalize()?;
        if private_canonical.starts_with(&source_canonical) { bail!("private staging must not be inside the source directory") }
        let private_dir=crate::attachment_open::open_directory(private_root).context("open private staging root")?;
        let private_meta=private_dir.metadata()?;
        if private_meta.uid()!=unsafe { libc::geteuid() } || private_meta.mode() & 0o077 != 0 { bail!("private staging directory required") }
        let source_dir=crate::attachment_open::open_directory(source).context("open source root")?;
        let attachments=source.join("attachments");
        let attachment_dir=crate::attachment_open::open_directory(&attachments).context("open source attachments")?;
        let original=crate::attachment_open::open_confined(source,Path::new("worlds.db")).context("open source database")?;
        let db_before=stamp(&original)?;
        if db_before.links != 1 { bail!("database hard links are unsupported") }
        let wal=optional_file(source,"worlds.db-wal")?; let wal_before=optional_stamp(&wal)?;
        if wal_before.as_ref().is_some_and(|item| item.links != 1) { bail!("WAL hard links are unsupported") }
        let pending_dir=private_root.join(format!("worlds-bundle-stage-{}",uuid::Uuid::new_v4()));
        let mut builder=std::fs::DirBuilder::new(); builder.mode(0o700); builder.create(&pending_dir)?;
        let _pending=Pending(pending_dir.clone());
        let copy=crate::isolated_import::import_with_source_validation(&source.join("worlds.db"),&pending_dir,|db|sqlite_source_matches(db,source,&db_before)).context("backup source database")?;
        after_backup()?;
        let db=Connection::open_with_flags(&copy,OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX)?;
        let entries=crate::attachment_staging::inventory(&db)?;
        let mut files=Vec::new();
        for entry in entries {
            let file=crate::attachment_open::open_confined(&attachments,&entry.relative)?;
            let before=stamp(&file)?;
            if before.links!=1 || before.size!=entry.size { bail!("attachment identity or size changed") }
            files.push((entry.relative,file,before));
        }
        drop(db);
        let staged=crate::attachment_staging::stage(&copy,&attachments,&pending_dir).context("stage source attachments")?;
        after_staging()?;
        let live_dir=crate::attachment_open::open_directory(source)?;
        let live_attachments=crate::attachment_open::open_directory(&attachments)?;
        if !same_directory(&source_dir,&live_dir)? || !same_directory(&attachment_dir,&live_attachments)? { bail!("source directory changed") }
        let current_db=crate::attachment_open::open_confined(source,Path::new("worlds.db"))?;
        if stamp(&original)? != db_before || stamp(&current_db)? != db_before { bail!("source database changed") }
        let current_wal=optional_file(source,"worlds.db-wal")?;
        if optional_stamp(&wal)? != wal_before || optional_stamp(&current_wal)? != wal_before { bail!("source WAL changed") }
        for (relative,opened,before) in files {
            let current=crate::attachment_open::open_confined(&attachments,&relative)?;
            if stamp(&opened)? != before || stamp(&current)? != before { bail!("source attachment changed") }
        }
        let copied_dir=copy.parent().ok_or_else(||anyhow::anyhow!("missing copy directory"))?;
        std::fs::rename(staged.join("attachments"),copied_dir.join("attachments"))?;
        // This experimental bundle is not verified for product use. Its name
        // must not match the ordinary local-copy inventory's worlds-import-*.
        let published=private_root.join(format!("worlds-unverified-bundle-{}",uuid::Uuid::new_v4()));
        publish_noreplace(copied_dir,&published)?;
        Ok(published.join("worlds.db"))
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        fn fixture() -> (PathBuf,PathBuf,PathBuf) {
            let root=std::env::temp_dir().canonicalize().unwrap().join(format!("worlds-bundle-test-{}",uuid::Uuid::new_v4()));
            let source=root.join("source"); let private=root.join("private");
            std::fs::create_dir_all(source.join("attachments/2026-11")).unwrap(); std::fs::DirBuilder::new().mode(0o700).create(&private).unwrap();
            let dbpath=source.join("worlds.db");
            std::fs::copy(Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/worlds-v11.db"),&dbpath).unwrap();
            let db=Connection::open(&dbpath).unwrap();
            db.execute("INSERT INTO attachments(id,page_id,kind,file_name,mime,size,rel_path,created_at) VALUES('a','fixture-page','file','a.bin','application/octet-stream',4,'2026-11/a.bin',1)",[]).unwrap();
            drop(db); std::fs::write(source.join("attachments/2026-11/a.bin"),b"safe").unwrap();
            (root,source,private)
        }
        #[test]
        fn combined_bundle_publishes_database_and_personal_file_together() {
            let (root,source,private)=fixture();
            let copy=prepare(&source,&private).unwrap();
            assert!(copy.parent().unwrap().file_name().unwrap().to_string_lossy().starts_with("worlds-unverified-bundle-"));
            assert_eq!(std::fs::read(copy.parent().unwrap().join("attachments/2026-11/a.bin")).unwrap(),b"safe");
            assert!(!copy.parent().unwrap().join(".incomplete").exists());
            assert_eq!(std::fs::read(source.join("attachments/2026-11/a.bin")).unwrap(),b"safe");
            assert_eq!(std::fs::read_dir(&private).unwrap().count(),1);
            std::fs::remove_dir_all(root).unwrap();
        }
        #[test]
        fn fixture_bundle_ffi_restricts_paths_and_copies_synthetic_data() {
            let (root,source,private)=fixture();
            let request=serde_json::json!({"operation":"import_fixture_attachment_bundle","source":source,"private_root":private}).to_string();
            let ptr=unsafe { crate::worlds_store_call(request.as_ptr(),request.len()) };
            assert!(!ptr.is_null());
            let value:serde_json::Value=serde_json::from_str(unsafe { std::ffi::CStr::from_ptr(ptr) }.to_str().unwrap()).unwrap();
            unsafe { crate::worlds_store_free(ptr) };
            assert_eq!(value["ok"],true,"{value}");
            let copy=Path::new(value["value"]["path"].as_str().unwrap());
            assert_eq!(std::fs::read(copy.parent().unwrap().join("attachments/2026-11/a.bin")).unwrap(),b"safe");
            let blocked=serde_json::json!({"operation":"import_fixture_attachment_bundle","source":"/","private_root":private}).to_string();
            let ptr=unsafe { crate::worlds_store_call(blocked.as_ptr(),blocked.len()) };
            let value:serde_json::Value=serde_json::from_str(unsafe { std::ffi::CStr::from_ptr(ptr) }.to_str().unwrap()).unwrap();
            unsafe { crate::worlds_store_free(ptr) };
            assert_eq!(value["ok"],false);
            std::fs::remove_dir_all(root).unwrap();
        }
        #[test]
        fn sqlite_opened_replacement_is_rejected_after_original_path_is_restored() {
            let (root,source,_private)=fixture();
            let original=crate::attachment_open::open_confined(&source,Path::new("worlds.db")).unwrap();
            let expected=stamp(&original).unwrap();
            let initial=Connection::open_with_flags(source.join("worlds.db"),OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
            sqlite_source_matches(&initial,&source,&expected).unwrap(); drop(initial);
            let path=source.join("worlds.db"); let saved=source.join("saved.db");
            std::fs::rename(&path,&saved).unwrap(); std::fs::copy(&saved,&path).unwrap();
            let db=Connection::open_with_flags(&path,OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
            std::fs::remove_file(&path).unwrap(); std::fs::rename(&saved,&path).unwrap();
            let expected=stamp(&original).unwrap();
            assert_eq!(stamp(&crate::attachment_open::open_confined(&source,Path::new("worlds.db")).unwrap()).unwrap(),expected);
            assert!(sqlite_source_matches(&db,&source,&expected).is_err());
            drop(db); drop(original); std::fs::remove_dir_all(root).unwrap();
        }
        #[test]
        fn source_database_change_during_backup_never_publishes() {
            let (root,source,private)=fixture();
            let result=prepare_with_hooks(&source,&private,|| {
                let db=Connection::open(source.join("worlds.db"))?;
                db.execute("UPDATE pages SET title='changed by fixture' WHERE id='fixture-page'",[])?; Ok(())
            },||Ok(()));
            assert!(result.is_err()); assert_eq!(std::fs::read_dir(&private).unwrap().count(),0);
            std::fs::remove_dir_all(root).unwrap();
        }
        #[test]
        fn source_attachment_change_after_staging_never_publishes() {
            let (root,source,private)=fixture();
            let result=prepare_with_hooks(&source,&private,||Ok(()),|| {
                std::fs::write(source.join("attachments/2026-11/a.bin"),b"different")?; Ok(())
            });
            assert!(result.is_err()); assert_eq!(std::fs::read_dir(&private).unwrap().count(),0);
            std::fs::remove_dir_all(root).unwrap();
        }
        #[test]
        fn inspection_reports_missing_inaccessible_and_mismatched_files_without_publishing() {
            use std::os::unix::fs::symlink;
            let (root,source,private)=fixture();
            let db=Connection::open(source.join("worlds.db")).unwrap();
            db.execute("INSERT INTO attachments(id,page_id,kind,file_name,mime,size,rel_path,created_at) VALUES('b','fixture-page','file','b','application/octet-stream',4,'2026-11/missing',1),('c','fixture-page','file','c','application/octet-stream',4,'2026-11/link',1),('d','fixture-page','file','d','application/octet-stream',9,'2026-11/small',1)",[]).unwrap();
            drop(db);
            symlink(source.join("attachments/2026-11/a.bin"),source.join("attachments/2026-11/link")).unwrap();
            std::fs::write(source.join("attachments/2026-11/small"),b"x").unwrap();
            let copy=crate::isolated_import::import(&source.join("worlds.db"),&private).unwrap();
            let issues=inspect_copy(&copy,&source.join("attachments")).unwrap();
            assert_eq!(issues,vec![
                AttachmentIssue{id:"b".into(),kind:AttachmentIssueKind::Missing},
                AttachmentIssue{id:"c".into(),kind:AttachmentIssueKind::Inaccessible},
                AttachmentIssue{id:"d".into(),kind:AttachmentIssueKind::SizeOrIdentityMismatch},
            ]);
            assert_eq!(std::fs::read(source.join("attachments/2026-11/a.bin")).unwrap(),b"safe");
            let db=Connection::open(&copy).unwrap();
            db.execute("UPDATE pages SET workspace_id='team' WHERE id='fixture-page'",[]).unwrap(); drop(db);
            assert!(inspect_copy(&copy,&source.join("attachments")).is_err());
            std::fs::remove_dir_all(root).unwrap();
        }
        #[test]
        fn missing_file_rolls_back_entire_unpublished_bundle() {
            let (root,source,private)=fixture();
            std::fs::remove_file(source.join("attachments/2026-11/a.bin")).unwrap();
            assert!(prepare(&source,&private).is_err());
            assert_eq!(std::fs::read_dir(&private).unwrap().count(),0);
            assert!(source.join("worlds.db").exists());
            std::fs::remove_dir_all(root).unwrap();
        }
        #[test]
        fn staging_inside_source_is_rejected_without_creating_copy() {
            let (root,source,_private)=fixture();
            let inside=source.join("private"); std::fs::create_dir(&inside).unwrap();
            assert!(prepare(&source,&inside).is_err());
            assert_eq!(std::fs::read_dir(&inside).unwrap().count(),0);
            std::fs::remove_dir_all(root).unwrap();
        }
        #[test]
        fn atomic_publication_does_not_replace_existing_directory() {
            let (root,_source,private)=fixture();
            let first=private.join("first"); let occupied=private.join("occupied");
            std::fs::create_dir(&first).unwrap(); std::fs::create_dir(&occupied).unwrap();
            std::fs::write(occupied.join("keep"),b"original").unwrap();
            assert!(publish_noreplace(&first,&occupied).is_err());
            assert_eq!(std::fs::read(occupied.join("keep")).unwrap(),b"original"); assert!(first.exists());
            std::fs::remove_dir_all(root).unwrap();
        }
    }
}
