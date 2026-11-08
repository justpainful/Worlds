//! Experimental combined import. Never exposed to the application.
//! Path and metadata checks do not establish atomic source identity for SQLite.
#[cfg(unix)]
mod unix {
    use anyhow::{bail, Result};
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
        let source_dir=crate::attachment_open::open_directory(source)?;
        let attachments=source.join("attachments");
        let attachment_dir=crate::attachment_open::open_directory(&attachments)?;
        let original=crate::attachment_open::open_confined(source,Path::new("worlds.db"))?;
        let db_before=stamp(&original)?;
        if db_before.links != 1 { bail!("database hard links are unsupported") }
        let wal=optional_file(source,"worlds.db-wal")?; let wal_before=optional_stamp(&wal)?;
        if wal_before.as_ref().is_some_and(|item| item.links != 1) { bail!("WAL hard links are unsupported") }
        let pending_dir=private_root.join(format!("worlds-bundle-stage-{}",uuid::Uuid::new_v4()));
        let mut builder=std::fs::DirBuilder::new(); builder.mode(0o700); builder.create(&pending_dir)?;
        let _pending=Pending(pending_dir.clone());
        let copy=crate::isolated_import::import(&source.join("worlds.db"),&pending_dir)?;
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
        let staged=crate::attachment_staging::stage(&copy,&attachments,&pending_dir)?;
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
        let name=copied_dir.file_name().ok_or_else(||anyhow::anyhow!("missing copy name"))?;
        let published=private_root.join(name);
        publish_noreplace(copied_dir,&published)?;
        Ok(published.join("worlds.db"))
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        fn fixture() -> (PathBuf,PathBuf,PathBuf) {
            let root=std::env::temp_dir().canonicalize().unwrap().join(format!("worlds-bundle-test-{}",uuid::Uuid::new_v4()));
            let source=root.join("source"); let private=root.join("private");
            std::fs::create_dir_all(source.join("attachments/2026-11")).unwrap(); std::fs::create_dir(&private).unwrap();
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
            assert_eq!(std::fs::read(copy.parent().unwrap().join("attachments/2026-11/a.bin")).unwrap(),b"safe");
            assert!(!copy.parent().unwrap().join(".incomplete").exists());
            assert_eq!(std::fs::read(source.join("attachments/2026-11/a.bin")).unwrap(),b"safe");
            assert_eq!(std::fs::read_dir(&private).unwrap().count(),1);
            std::fs::remove_dir_all(root).unwrap();
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
