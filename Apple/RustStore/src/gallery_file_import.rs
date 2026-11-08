//! Experimental isolated-copy import. Exposed through FFI, not enabled in the product.
//! The private copy directory must not be writable by an untrusted process.
#[cfg(unix)]
pub(crate) mod unix {
    use anyhow::{bail, Context, Result};
    use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
    use serde_json::{json, Value};
    use std::{fs::{File, OpenOptions}, io::{Read, Write}, os::{fd::AsRawFd, unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt}}, path::Path};
    use crate::BlockInput;
    use crate::GalleryCancellation as Cancellation;

    const MAX_FILE: u64 = 1024 * 1024 * 1024;
    struct Lock(File);
    impl Drop for Lock { fn drop(&mut self) { unsafe { libc::flock(self.0.as_raw_fd(), libc::LOCK_UN); } } }
    fn lock(root: &Path) -> Result<Lock> {
        let directory = crate::attachment_open::open_directory(root)?;
        let meta = directory.metadata()?;
        if meta.uid() != unsafe { libc::geteuid() } || meta.mode() & 0o077 != 0 { bail!("private copy directory required") }
        if unsafe { libc::flock(directory.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } != 0 { bail!("copy is in use") }
        Ok(Lock(directory))
    }
    // Pinned descriptors allow detection of a changed path at each check. They
    // cannot make pathname traversal and SQLite writes one atomic operation.
    fn require_directory_identity(path: &Path, pinned: &File) -> Result<()> {
        let expected=pinned.metadata()?;
        let actual=crate::attachment_open::open_directory(path)?.metadata()?;
        if !expected.is_dir() || !actual.is_dir() || expected.dev()!=actual.dev() || expected.ino()!=actual.ino() {
            bail!("gallery directory identity changed")
        }
        Ok(())
    }
    fn require_private_copy(path: &Path, held: &Lock) -> Result<()> {
        require_directory_identity(path,&held.0)?;
        let metadata=held.0.metadata()?;
        if metadata.uid()!=unsafe { libc::geteuid() } || metadata.mode() & 0o077 != 0 { bail!("private copy directory required") }
        Ok(())
    }
    fn db(root: &Path) -> Result<Connection> {
        // Inspect the existing database before SQLite can create journal files
        // or our recovery tables. This is a point-in-time check, not a proof
        // of container provenance or protection against swap-and-restore.
        let opened = crate::attachment_open::open_confined(root, Path::new("worlds.db"))?;
        let original = opened.metadata()?;
        if original.nlink() != 1 { bail!("database hard links are unsupported") }
        let c = crate::open_existing(&root.join("worlds.db"))?;
        let current = crate::attachment_open::open_confined(root, Path::new("worlds.db"))?.metadata()?;
        if current.dev() != original.dev() || current.ino() != original.ino() || current.nlink() != 1 { bail!("database identity changed") }
        let mut moved: std::ffi::c_int = -1;
        let status = unsafe { rusqlite::ffi::sqlite3_file_control(c.handle(), b"main\0".as_ptr().cast(),
            rusqlite::ffi::SQLITE_FCNTL_HAS_MOVED, (&mut moved as *mut std::ffi::c_int).cast()) };
        if status != rusqlite::ffi::SQLITE_OK || moved != 0 { bail!("database identity cannot be verified") }
        let old: Option<String> = c.query_row("SELECT name FROM sqlite_master WHERE type='table' AND name='native_gallery_import_intents'",[],|r|r.get(0)).optional()?;
        if old.is_some() && c.query_row("SELECT EXISTS(SELECT 1 FROM native_gallery_import_intents)",[],|r|r.get::<_,bool>(0))? { bail!("legacy import intents require manual review") }
        c.execute_batch("CREATE TABLE IF NOT EXISTS native_gallery_import_intents_v2(id TEXT PRIMARY KEY,rel_path TEXT NOT NULL,dir_device INTEGER NOT NULL,dir_inode INTEGER NOT NULL,device INTEGER,inode INTEGER)")?;
        c.execute_batch("CREATE TABLE IF NOT EXISTS native_gallery_import_completed(id TEXT PRIMARY KEY,request TEXT NOT NULL,result TEXT NOT NULL)")?;
        c.pragma_update(None, "synchronous", "FULL")?;
        Ok(c)
    }
    fn valid_relative(id: &str, rel: &str) -> bool {
        let prefix=format!("native-import/{id}/asset.");
        uuid::Uuid::parse_str(id).is_ok() && rel.strip_prefix(&prefix).is_some_and(|ext|
            ["png","jpg","jpeg","gif","webp","avif","bmp","svg","heic","mp4","webm","mov","m4v","mkv","mp3","wav","m4a","ogg","flac"].contains(&ext))
    }
    // Check that the current no-follow path still names the opened output.
    // A swap and restoration between checks is not ruled out.
    fn require_output_identity(attachments: &Path, rel: &str, output: &File, device: u64, inode: u64, size: u64) -> Result<()> {
        let opened=output.metadata()?;
        let current=crate::attachment_open::open_confined(attachments,Path::new(rel))?.metadata()?;
        if !opened.is_file() || opened.nlink()!=1 || current.nlink()!=1 ||
           opened.dev()!=device || opened.ino()!=inode || opened.len()!=size ||
           current.dev()!=opened.dev() || current.ino()!=opened.ino() || current.len()!=opened.len() ||
           current.mtime()!=opened.mtime() || current.mtime_nsec()!=opened.mtime_nsec() ||
           current.ctime()!=opened.ctime() || current.ctime_nsec()!=opened.ctime_nsec() {
            bail!("gallery output identity changed")
        }
        Ok(())
    }
    /// Reconcile only paths generated by this importer. A mismatch is an error,
    /// not permission to delete anything. Caller holds the private-copy lock.
    fn recover_locked(c: &mut Connection, root: &Path) -> Result<()> {
        let intents: Vec<(String,String,i64,i64,Option<i64>,Option<i64>)> = c.prepare("SELECT id,rel_path,dir_device,dir_inode,device,inode FROM native_gallery_import_intents_v2")?
            .query_map([], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?)))?.collect::<rusqlite::Result<_>>()?;
        for (id, rel, dir_device, dir_inode, device, inode) in intents {
            if !valid_relative(&id,&rel) { bail!("invalid import recovery record") }
            let current: Option<String> = c.query_row("SELECT rel_path FROM attachments WHERE id=?1",[&id],|r|r.get(0)).optional()?;
            if current.as_deref().is_some_and(|actual| actual != rel) { bail!("import recovery conflicts with attachment") }
            let target = root.join("attachments").join(&rel);
            let directory=target.parent().ok_or_else(||anyhow::anyhow!("invalid recovery path"))?;
            let dir=match crate::attachment_open::open_directory(directory) {
                Ok(dir) => dir,
                Err(error) if current.is_none() && error.downcast_ref::<std::io::Error>().is_some_and(|e|e.kind()==std::io::ErrorKind::NotFound) => {
                    c.execute("DELETE FROM native_gallery_import_intents_v2 WHERE id=?1",[&id])?; continue
                },
                Err(error) => return Err(error),
            };
            let dir_meta=dir.metadata()?;
            if dir_meta.dev() as i64 != dir_device || dir_meta.ino() as i64 != dir_inode || dir_meta.uid()!=unsafe { libc::geteuid() } || dir_meta.mode() & 0o077 != 0 { bail!("import directory identity changed") }
            if current.is_none() {
                match std::fs::symlink_metadata(&target) {
                    Ok(meta) if meta.is_file() && meta.nlink()==1 && (device.is_none() && inode.is_none() || device == Some(meta.dev() as i64) && inode == Some(meta.ino() as i64)) => std::fs::remove_file(&target)?,
                    Ok(_) => bail!("unsafe import recovery target"),
                    Err(e) if e.kind()==std::io::ErrorKind::NotFound => {},
                    Err(e) => return Err(e.into()),
                }
                dir.sync_all()?;
                std::fs::remove_dir(directory)?;
                File::open(root.join("attachments/native-import"))?.sync_all()?;
            } else {
                let file = crate::attachment_open::open_confined(&root.join("attachments"),Path::new(&rel))?;
                let meta=file.metadata()?;
                if meta.nlink()!=1 || device != Some(meta.dev() as i64) || inode != Some(meta.ino() as i64) { bail!("unsafe committed attachment") }
            }
            c.execute("DELETE FROM native_gallery_import_intents_v2 WHERE id=?1",[&id])?;
        }
        Ok(())
    }
    pub(crate) fn recover(root: &Path) -> Result<()> { let held=lock(root)?; let mut c=db(root)?; require_private_copy(root,&held)?; recover_locked(&mut c,root) }

    /// `source` is already security-scoped by the host. Only the private copy
    /// is mutated; source and its security scope must remain stable throughout.
    pub(crate) fn import(root: &Path, source: &Path, page: &str, base: i64, metadata: Value, expected: Vec<BlockInput>) -> Result<Value> {
        import_with_hooks(root,source,page,base,metadata,expected,&uuid::Uuid::new_v4().to_string(),None,||Ok(()),||Ok(()),||Ok(()))
    }
    pub(crate) fn import_idempotent(root: &Path, source: &Path, page: &str, base: i64, metadata: Value, expected: Vec<BlockInput>, operation: &str) -> Result<Value> {
        import_with_hooks(root,source,page,base,metadata,expected,operation,None,||Ok(()),||Ok(()),||Ok(()))
    }
    pub(crate) fn import_cancellable(root: &Path, source: &Path, page: &str, base: i64, metadata: Value, expected: Vec<BlockInput>, operation: &str, cancel: &Cancellation) -> Result<Value> {
        import_with_hooks(root,source,page,base,metadata,expected,operation,Some(cancel),||Ok(()),||Ok(()),||Ok(()))
    }
    fn import_with_hooks(root: &Path, source: &Path, page: &str, base: i64, metadata: Value, expected: Vec<BlockInput>, operation: &str, cancel: Option<&Cancellation>, after_create: impl FnOnce() -> Result<()>, after_intent: impl FnOnce() -> Result<()>, after_file_create: impl FnOnce() -> Result<()>) -> Result<Value> {
        let operation=uuid::Uuid::parse_str(operation)?.simple().to_string();
        let held=lock(root).context("validate local copy directory")?; let mut c=db(root).context("open local copy database")?;
        require_private_copy(root,&held)?; recover_locked(&mut c,root).context("recover previous import")?;
        let parent=source.parent().ok_or_else(||anyhow::anyhow!("invalid source"))?;
        let name=source.file_name().ok_or_else(||anyhow::anyhow!("invalid source"))?;
        let mut input=crate::attachment_open::open_confined(parent,Path::new(name)).context("open scoped source file")?;
        let before=input.metadata()?;
        if before.nlink()!=1 || before.len()>MAX_FILE { bail!("unsupported source") }
        let request=json!({"page":page,"base":base,"metadata":metadata,"expected":expected,"source_name":name.to_string_lossy(),"device":before.dev(),"inode":before.ino(),"size":before.len(),"mtime":before.mtime(),"mtime_ns":before.mtime_nsec(),"ctime":before.ctime(),"ctime_ns":before.ctime_nsec()}).to_string();
        let read_tx=c.unchecked_transaction()?;
        crate::require_personal(&read_tx,page)?;
        let prior: Option<(String,String)>=read_tx.query_row("SELECT request,result FROM native_gallery_import_completed WHERE id=?1",[&operation],|r|Ok((r.get(0)?,r.get(1)?))).optional()?;
        read_tx.commit()?;
        if let Some((prior_request,result))=prior {
            let mut old_request: Value=serde_json::from_str(&prior_request)?;
            if let Some(object)=old_request.as_object_mut() {
                if object.get("source").and_then(Value::as_str)==Some(source.to_string_lossy().as_ref()) {
                    object.remove("source");
                    object.insert("source_name".into(),json!(name.to_string_lossy()));
                }
            }
            if old_request!=serde_json::from_str::<Value>(&request)? { bail!("conflict: import operation reused with different input") }
            // An operation record is not proof that its attachment still
            // exists. Never report a successful retry for a missing file.
            let stored: Option<(String,i64)>=c.query_row(
                "SELECT rel_path,size FROM attachments WHERE id=?1 AND page_id=?2",
                params![operation,page],|r|Ok((r.get(0)?,r.get(1)?))).optional()?;
            let (rel,size)=stored.ok_or_else(||anyhow::anyhow!("completed import attachment is unavailable"))?;
            if !valid_relative(&operation,&rel) || size < 0 { bail!("completed import attachment is invalid") }
            let file=crate::attachment_open::open_confined(&root.join("attachments"),Path::new(&rel))?;
            let info=file.metadata()?;
            if info.nlink()!=1 || info.len()!=size as u64 || info.len()!=before.len() { bail!("completed import attachment changed") }
            return Ok(serde_json::from_str(&result)?);
        }
        if let Some(cancel)=cancel { cancel.check()?; }
        let filename=crate::store::clean_file_name(&name.to_string_lossy());
        let ext=Path::new(&filename).extension().and_then(|s|s.to_str()).unwrap_or("").to_ascii_lowercase();
        if !["png","jpg","jpeg","gif","webp","avif","bmp","svg","heic","mp4","webm","mov","m4v","mkv","mp3","wav","m4a","ogg","flac"].contains(&ext.as_str()) { bail!("unsupported gallery file") }
        let id=operation.clone(); let rel=format!("native-import/{id}/asset.{ext}");
        let attachments=root.join("attachments");
        match std::fs::DirBuilder::new().mode(0o700).create(&attachments) { Ok(()) => { File::open(root)?.sync_all()?; }, Err(e) if e.kind()==std::io::ErrorKind::AlreadyExists => {}, Err(e) => return Err(e.into()) }
        let attachments_handle=crate::attachment_open::open_directory(&attachments).context("validate attachment directory")?;
        let folder=attachments.join("native-import");
        match std::fs::create_dir(&folder) { Ok(()) => {}, Err(e) if e.kind()==std::io::ErrorKind::AlreadyExists => {}, Err(e) => return Err(e.into()) }
        let folder_handle=crate::attachment_open::open_directory(&folder).context("validate import directory")?;
        File::open(&attachments)?.sync_all()?;
        let item_dir=folder.join(&id);
        let mut builder=std::fs::DirBuilder::new(); builder.mode(0o700); builder.create(&item_dir)?;
        File::open(&folder)?.sync_all()?;
        let item_handle=crate::attachment_open::open_directory(&item_dir).context("validate new import directory")?;
        let item_meta=item_handle.metadata()?;
        after_create()?;
        require_private_copy(root,&held)?;
        require_directory_identity(&attachments,&attachments_handle)?;
        require_directory_identity(&folder,&folder_handle)?;
        require_directory_identity(&item_dir,&item_handle)?;
        c.execute("INSERT INTO native_gallery_import_intents_v2(id,rel_path,dir_device,dir_inode) VALUES(?1,?2,?3,?4)",params![id,rel,item_meta.dev() as i64,item_meta.ino() as i64])?;
        after_intent()?;
        let destination=attachments.join(&rel);
        let work=(|| -> Result<Value> {
            require_private_copy(root,&held)?;
            require_directory_identity(&attachments,&attachments_handle)?;
            require_directory_identity(&folder,&folder_handle)?;
            require_directory_identity(&item_dir,&item_handle)?;
            let mut output=OpenOptions::new().write(true).create_new(true).mode(0o600).open(&destination)?;
            let created=output.metadata()?;
            item_handle.sync_all()?;
            after_file_create()?;
            c.execute("UPDATE native_gallery_import_intents_v2 SET device=?2,inode=?3 WHERE id=?1",params![id,created.dev() as i64,created.ino() as i64])?;
            let mut copied=0_u64; let mut buffer=[0_u8;64*1024];
            loop { if let Some(cancel)=cancel { cancel.check()?; } let count=input.read(&mut buffer)?; if count==0 { break } copied+=count as u64; if copied>before.len() { bail!("source grew") } output.write_all(&buffer[..count])?; }
            output.sync_all()?; item_handle.sync_all()?;
            let after=input.metadata()?;
            if copied!=before.len() || before.dev()!=after.dev() || before.ino()!=after.ino() || before.len()!=after.len() || before.mtime()!=after.mtime() || before.mtime_nsec()!=after.mtime_nsec() || before.ctime()!=after.ctime() || before.ctime_nsec()!=after.ctime_nsec() || after.nlink()!=1 { bail!("source changed during copy") }
            require_output_identity(&attachments,&rel,&output,created.dev(),created.ino(),copied)?;
            let mut mime=mime_guess::from_path(&filename).first_or_octet_stream().essence_str().to_string();
            let image=imagesize::size(&destination).ok();
            require_output_identity(&attachments,&rel,&output,created.dev(),created.ino(),copied)?;
            if mime.starts_with("image/") && !["svg","heic","avif"].contains(&ext.as_str()) && image.is_none() { mime="application/octet-stream".into() }
            let kind=crate::store::kind_for_mime(&mime);
            let tx=c.transaction_with_behavior(TransactionBehavior::Immediate)?;
            crate::require_personal(&tx,page)?;
            tx.execute("INSERT INTO attachments(id,page_id,kind,file_name,mime,size,rel_path,width,height,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",params![id,page,kind,filename,mime,copied as i64,rel,image.as_ref().map(|x|x.width as i64),image.as_ref().map(|x|x.height as i64),crate::db::now()])?;
            let bid=uuid::Uuid::new_v4().simple().to_string();
            let mut next: Vec<BlockInput> = expected.iter().map(|b|BlockInput{id:b.id.clone(),content:b.content.clone()}).collect();
            next.push(BlockInput{id:bid.clone(),content:json!({"type":"galleryItem","attrs":{"bid":bid,"attachmentId":id,"name":filename,"mime":mime,"size":copied,"kind":kind,"caption":""}})});
            let result=crate::resource_ops::save_gallery_transaction(&tx,page,base,metadata.clone(),metadata,expected,next)?;
            tx.execute("INSERT INTO native_gallery_import_completed(id,request,result) VALUES(?1,?2,?3)",params![operation,request,result.to_string()])?;
            require_private_copy(root,&held)?;
            require_directory_identity(&attachments,&attachments_handle)?;
            require_directory_identity(&folder,&folder_handle)?;
            require_directory_identity(&item_dir,&item_handle)?;
            require_output_identity(&attachments,&rel,&output,created.dev(),created.ino(),copied)?;
            if let Some(cancel)=cancel { cancel.commit()?; }
            tx.commit()?; Ok(result)
        })();
        finish_import(&mut c,root,&held,work)
    }
    fn finish_import(c: &mut Connection, root: &Path, held: &Lock, work: Result<Value>) -> Result<Value> {
        // Never run path-based cleanup against a replacement copy directory.
        // The database transaction may already have committed: tell the caller
        // explicitly so it does not present this as a failed import.
        if let Err(error)=require_private_copy(root,held) {
            return match work {
                Ok(_) => Err(error.context("committed: gallery import succeeded but copy identity changed before cleanup")),
                Err(_) => Err(error.context("gallery copy identity changed before cleanup")),
            };
        }
        match work {
            Ok(value) => {
                if let Err(error)=recover_locked(c,root) { bail!("committed: gallery import succeeded but recovery cleanup is pending: {error}") }
                Ok(value)
            },
            Err(error) => { recover_locked(c,root).context("recover failed import")?; Err(error) },
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use std::os::unix::fs::{PermissionsExt, DirBuilderExt};
        #[test]
        fn replacement_after_commit_reports_committed_without_touching_replacement() {
            let parent=std::env::temp_dir().canonicalize().unwrap().join(format!("gallery-after-commit-{}",uuid::Uuid::new_v4()));
            std::fs::DirBuilder::new().mode(0o700).create(&parent).unwrap();
            let root=parent.join("copy");
            std::fs::DirBuilder::new().mode(0o700).create(&root).unwrap();
            std::fs::copy(Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/worlds-v11.db"),root.join("worlds.db")).unwrap();
            let held=lock(&root).unwrap();
            let mut connection=db(&root).unwrap();
            let tx=connection.transaction_with_behavior(TransactionBehavior::Immediate).unwrap();
            tx.execute("INSERT INTO native_gallery_import_completed(id,request,result) VALUES('fixture','{}','{}')",[]).unwrap();
            tx.commit().unwrap();
            let saved=parent.join("original-copy");
            std::fs::rename(&root,&saved).unwrap();
            std::fs::DirBuilder::new().mode(0o700).create(&root).unwrap();
            std::fs::write(root.join("untouched"),b"replacement").unwrap();
            let error=finish_import(&mut connection,&root,&held,Ok(json!({}))).unwrap_err().to_string();
            assert!(error.starts_with("committed:"),"{error}");
            assert_eq!(std::fs::read(root.join("untouched")).unwrap(),b"replacement");
            let count:i64=connection.query_row("SELECT count(*) FROM native_gallery_import_completed WHERE id='fixture'",[],|r|r.get(0)).unwrap();
            assert_eq!(count,1);
            drop(connection); drop(held); std::fs::remove_dir_all(parent).unwrap();
        }
        #[test]
        fn directory_identity_check_rejects_replacement_and_symlink() {
            use std::os::unix::fs::symlink;
            let root=std::env::temp_dir().canonicalize().unwrap().join(format!("gallery-dir-identity-{}",uuid::Uuid::new_v4()));
            std::fs::DirBuilder::new().mode(0o700).create(&root).unwrap();
            let path=root.join("selected"); let old=root.join("old");
            std::fs::create_dir(&path).unwrap();
            let handle=crate::attachment_open::open_directory(&path).unwrap();
            assert!(require_directory_identity(&path,&handle).is_ok());
            std::fs::rename(&path,&old).unwrap(); std::fs::create_dir(&path).unwrap();
            assert!(require_directory_identity(&path,&handle).is_err());
            std::fs::remove_dir(&path).unwrap(); symlink(&old,&path).unwrap();
            assert!(require_directory_identity(&path,&handle).is_err());
            drop(handle); std::fs::remove_dir_all(root).unwrap();
        }
        #[test]
        fn private_copy_recheck_rejects_permissions_broadened_after_lock() {
            let root=std::env::temp_dir().canonicalize().unwrap().join(format!("gallery-private-{}",uuid::Uuid::new_v4()));
            std::fs::DirBuilder::new().mode(0o700).create(&root).unwrap();
            let held=lock(&root).unwrap();
            assert!(require_private_copy(&root,&held).is_ok());
            std::fs::set_permissions(&root,std::fs::Permissions::from_mode(0o755)).unwrap();
            assert!(require_private_copy(&root,&held).is_err());
            std::fs::set_permissions(&root,std::fs::Permissions::from_mode(0o700)).unwrap();
            drop(held); std::fs::remove_dir_all(root).unwrap();
        }
        #[test]
        fn replaced_copy_directory_stops_before_output_and_preserves_replacement() {
            let parent=std::env::temp_dir().canonicalize().unwrap().join(format!("gallery-root-swap-{}",uuid::Uuid::new_v4()));
            std::fs::DirBuilder::new().mode(0o700).create(&parent).unwrap();
            let root=parent.join("copy"); std::fs::DirBuilder::new().mode(0o700).create(&root).unwrap();
            std::fs::copy(Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/worlds-v11.db"),root.join("worlds.db")).unwrap();
            let c=Connection::open(root.join("worlds.db")).unwrap();
            c.execute("INSERT INTO pages(id,title,kind,metadata,created_at,updated_at) VALUES('gallery-test','Gallery','gallery','{}',1,1)",[]).unwrap(); drop(c);
            let source=parent.join("sample.mp3"); std::fs::write(&source,b"original source").unwrap();
            let old=crate::resource_ops::read_resource(&root.join("worlds.db"),"gallery-test").unwrap();
            let expected:Vec<BlockInput>=old["blocks"].as_array().unwrap().iter().map(|v|BlockInput{id:v["id"].as_str().unwrap().into(),content:v["content"].clone()}).collect();
            let saved=parent.join("original-copy"); let operation=uuid::Uuid::new_v4().to_string();
            let result=import_with_hooks(&root,&source,"gallery-test",old["revision"].as_i64().unwrap(),old["metadata"].clone(),expected,&operation,None,|| {
                std::fs::rename(&root,&saved)?;
                std::fs::DirBuilder::new().mode(0o700).create(&root)?;
                std::fs::write(root.join("untouched"),b"replacement")?;
                Ok(())
            },||Ok(()),||Ok(()));
            assert!(result.is_err());
            assert_eq!(std::fs::read(&source).unwrap(),b"original source");
            assert_eq!(std::fs::read(root.join("untouched")).unwrap(),b"replacement");
            assert!(!root.join("attachments").exists());
            let db=Connection::open(saved.join("worlds.db")).unwrap();
            let count:i64=db.query_row("SELECT COUNT(*) FROM attachments WHERE page_id='gallery-test'",[],|r|r.get(0)).unwrap();
            assert_eq!(count,0);
            drop(db); std::fs::remove_dir_all(parent).unwrap();
        }
        #[test]
        fn swapped_destination_is_not_committed_or_deleted() {
            let root=std::env::temp_dir().canonicalize().unwrap().join(format!("gallery-replaced-{}",uuid::Uuid::new_v4()));
            std::fs::DirBuilder::new().mode(0o700).create(&root).unwrap();
            std::fs::copy(Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/worlds-v11.db"),root.join("worlds.db")).unwrap();
            let c=Connection::open(root.join("worlds.db")).unwrap();
            c.execute("INSERT INTO pages(id,title,kind,metadata,created_at,updated_at) VALUES('gallery-test','Gallery','gallery','{}',1,1)",[]).unwrap(); drop(c);
            let source=root.join("sample.mp3"); std::fs::write(&source,b"original source").unwrap();
            let old=crate::resource_ops::read_resource(&root.join("worlds.db"),"gallery-test").unwrap();
            let expected:Vec<BlockInput>=old["blocks"].as_array().unwrap().iter().map(|v|BlockInput{id:v["id"].as_str().unwrap().into(),content:v["content"].clone()}).collect();
            let operation=uuid::Uuid::new_v4();
            let destination=root.join("attachments/native-import").join(operation.simple().to_string()).join("asset.mp3");
            let saved=destination.with_extension("saved");
            let result=import_with_hooks(&root,&source,"gallery-test",old["revision"].as_i64().unwrap(),old["metadata"].clone(),expected,&operation.to_string(),None,||Ok(()),||Ok(()),|| {
                std::fs::rename(&destination,&saved)?;
                std::fs::write(&destination,b"replacement")?;
                Ok(())
            });
            assert!(result.is_err());
            assert_eq!(std::fs::read(&source).unwrap(),b"original source");
            assert_eq!(std::fs::read(&destination).unwrap(),b"replacement");
            let c=Connection::open(root.join("worlds.db")).unwrap();
            let count:i64=c.query_row("SELECT COUNT(*) FROM attachments WHERE page_id='gallery-test'",[],|r|r.get(0)).unwrap();
            assert_eq!(count,0);
            drop(c); std::fs::remove_dir_all(root).unwrap();
        }
        #[test]
        fn database_symlink_and_hardlink_are_rejected_before_mutation() {
            use std::os::unix::fs::symlink;
            let root=std::env::temp_dir().canonicalize().unwrap().join(format!("gallery-db-identity-{}",uuid::Uuid::new_v4()));
            std::fs::DirBuilder::new().mode(0o700).create(&root).unwrap();
            let original=root.join("original.db");
            std::fs::copy(Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/worlds-v11.db"),&original).unwrap();
            let database=root.join("worlds.db");
            symlink(&original,&database).unwrap();
            assert!(recover(&root).is_err());
            std::fs::remove_file(&database).unwrap();
            std::fs::hard_link(&original,&database).unwrap();
            assert!(recover(&root).is_err());
            let c=Connection::open(&original).unwrap();
            let count:i64=c.query_row("SELECT count(*) FROM sqlite_master WHERE name IN ('native_gallery_import_intents_v2','native_gallery_import_completed')",[],|r|r.get(0)).unwrap();
            assert_eq!(count,0);
            drop(c); std::fs::remove_dir_all(root).unwrap();
        }
        #[test]
        fn cancellation_rolls_back_and_same_operation_can_retry() {
            let root=std::env::temp_dir().canonicalize().unwrap().join(format!("gallery-cancel-{}",uuid::Uuid::new_v4()));
            std::fs::DirBuilder::new().mode(0o700).create(&root).unwrap();
            std::fs::copy(Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/worlds-v11.db"),root.join("worlds.db")).unwrap();
            let c=Connection::open(root.join("worlds.db")).unwrap();
            c.execute("INSERT INTO pages(id,title,kind,metadata,created_at,updated_at) VALUES('gallery-test','Gallery','gallery','{}',1,1)",[]).unwrap(); drop(c);
            let source=root.join("sample.mp3"); std::fs::write(&source,b"synthetic file").unwrap();
            let old=crate::resource_ops::read_resource(&root.join("worlds.db"),"gallery-test").unwrap();
            let expected: Vec<BlockInput>=old["blocks"].as_array().unwrap().iter().map(|v|BlockInput{id:v["id"].as_str().unwrap().into(),content:v["content"].clone()}).collect();
            let op=uuid::Uuid::new_v4().to_string(); let token=Cancellation::new();
            let failed=import_with_hooks(&root,&source,"gallery-test",old["revision"].as_i64().unwrap(),old["metadata"].clone(),expected.clone(),&op,Some(&token),||Ok(()),||Ok(()),||{token.cancel();Ok(())});
            assert!(failed.unwrap_err().to_string().starts_with("cancelled:"));
            let c=Connection::open(root.join("worlds.db")).unwrap();
            assert_eq!(c.query_row("SELECT count(*) FROM attachments WHERE page_id='gallery-test'",[],|r|r.get::<_,i64>(0)).unwrap(),0);
            assert_eq!(c.query_row("SELECT count(*) FROM native_gallery_import_intents_v2",[],|r|r.get::<_,i64>(0)).unwrap(),0); drop(c);
            let retry=import_cancellable(&root,&source,"gallery-test",old["revision"].as_i64().unwrap(),old["metadata"].clone(),expected.clone(),&op,&Cancellation::new()).unwrap();
            assert_eq!(retry,import_cancellable(&root,&source,"gallery-test",old["revision"].as_i64().unwrap(),old["metadata"].clone(),expected,&op,&Cancellation::new()).unwrap());
            assert_eq!(std::fs::read(&source).unwrap(),b"synthetic file");
            std::fs::remove_dir_all(root).unwrap();
        }
        #[test]
        fn ffi_import_retries_atomically_without_duplicate_attachment() {
            let root=std::env::temp_dir().canonicalize().unwrap().join(format!("worlds-import-{}",uuid::Uuid::new_v4()));
            std::fs::DirBuilder::new().mode(0o700).create(&root).unwrap();
            std::fs::copy(Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/worlds-v11.db"),root.join("worlds.db")).unwrap();
            let db=Connection::open(root.join("worlds.db")).unwrap();
            db.execute("INSERT INTO pages(id,title,kind,metadata,created_at,updated_at) VALUES('gallery-test','Gallery','gallery','{}',1,1)",[]).unwrap(); drop(db);
            let source=root.join("source.mp3"); std::fs::write(&source,b"synthetic").unwrap();
            let old=crate::resource_ops::read_resource(&root.join("worlds.db"),"gallery-test").unwrap();
            let request=json!({"operation":"import_local_gallery_file","path":root.join("worlds.db"),"source":source,"page":"gallery-test","base":old["revision"],"metadata":old["metadata"],"expected":old["blocks"],"operation_id":uuid::Uuid::new_v4().to_string()}).to_string();
            let call=|| -> Value {
                let ptr=unsafe { crate::worlds_store_call(request.as_ptr(),request.len()) };
                assert!(!ptr.is_null());
                let value=serde_json::from_str(unsafe { std::ffi::CStr::from_ptr(ptr) }.to_str().unwrap()).unwrap();
                unsafe { crate::worlds_store_free(ptr) }; value
            };
            let first=call(); assert_eq!(first["ok"],true,"{first}"); assert_eq!(call(),first);
            let db=Connection::open(root.join("worlds.db")).unwrap();
            assert_eq!(db.query_row("SELECT count(*) FROM attachments WHERE page_id='gallery-test'",[],|r|r.get::<_,i64>(0)).unwrap(),1);
            assert_eq!(db.query_row("SELECT count(*) FROM native_gallery_import_completed",[],|r|r.get::<_,i64>(0)).unwrap(),1);
            let rel:String=db.query_row("SELECT rel_path FROM attachments WHERE page_id='gallery-test'",[],|r|r.get(0)).unwrap();
            std::fs::remove_file(root.join("attachments").join(rel)).unwrap();
            let missing=call(); assert_eq!(missing["ok"],false,"missing attachment must not be reported as successful");
            assert_eq!(db.query_row("SELECT count(*) FROM attachments WHERE page_id='gallery-test'",[],|r|r.get::<_,i64>(0)).unwrap(),1);
            assert_eq!(std::fs::read(&source).unwrap(),b"synthetic");
            drop(db); std::fs::remove_dir_all(root).unwrap();
        }
        #[test]
        fn interruption_after_exclusive_create_leaves_unclaimed_file_and_recovery_continues() {
            let root=std::env::temp_dir().canonicalize().unwrap().join(format!("gallery-interruption-{}",uuid::Uuid::new_v4()));
            std::fs::create_dir(&root).unwrap(); std::fs::set_permissions(&root,std::fs::Permissions::from_mode(0o700)).unwrap();
            std::fs::create_dir(root.join("attachments")).unwrap();
            std::fs::copy(Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/worlds-v11.db"),root.join("worlds.db")).unwrap();
            let source=root.join("source.mp3"); std::fs::write(&source,b"original").unwrap();
            let result=import_with_hooks(&root,&source,"fixture-page",0,json!({}),vec![],&uuid::Uuid::new_v4().to_string(),None,||anyhow::bail!("interrupted before intent"),||Ok(()),||Ok(()));
            assert!(result.is_err());
            let db=Connection::open(root.join("worlds.db")).unwrap();
            assert_eq!(db.query_row("SELECT count(*) FROM native_gallery_import_intents_v2",[],|r|r.get::<_,i64>(0)).unwrap(),0);
            assert_eq!(db.query_row("SELECT count(*) FROM attachments",[],|r|r.get::<_,i64>(0)).unwrap(),0);
            drop(db);
            let entries:Vec<_>=std::fs::read_dir(root.join("attachments/native-import")).unwrap().collect();
            assert_eq!(entries.len(),1);
            let orphan=entries[0].as_ref().unwrap().path();
            assert!(orphan.is_dir()); assert_eq!(std::fs::read_dir(&orphan).unwrap().count(),0);
            recover(&root).unwrap(); assert!(orphan.exists());
            let result=import_with_hooks(&root,&source,"fixture-page",0,json!({}),vec![],&uuid::Uuid::new_v4().to_string(),None,||Ok(()),||anyhow::bail!("interrupted after intent"),||Ok(()));
            assert!(result.is_err());
            let db=Connection::open(root.join("worlds.db")).unwrap();
            assert_eq!(db.query_row("SELECT count(*) FROM native_gallery_import_intents_v2",[],|r|r.get::<_,i64>(0)).unwrap(),1); drop(db);
            assert_eq!(std::fs::read_dir(root.join("attachments/native-import")).unwrap().count(),2);
            recover(&root).unwrap();
            assert_eq!(std::fs::read_dir(root.join("attachments/native-import")).unwrap().count(),1);
            assert!(orphan.exists());
            // Simulate process death after create_new, before recording file identity.
            let id=uuid::Uuid::new_v4().simple().to_string();
            let dir=root.join("attachments/native-import").join(&id);
            std::fs::DirBuilder::new().mode(0o700).create(&dir).unwrap();
            let dir_meta=std::fs::metadata(&dir).unwrap();
            let rel=format!("native-import/{id}/asset.mp3");
            let db=Connection::open(root.join("worlds.db")).unwrap();
            db.execute("INSERT INTO native_gallery_import_intents_v2(id,rel_path,dir_device,dir_inode) VALUES(?1,?2,?3,?4)",params![id,rel,dir_meta.dev() as i64,dir_meta.ino() as i64]).unwrap(); drop(db);
            std::fs::write(root.join("attachments").join(&rel),b"partial").unwrap();
            recover(&root).unwrap(); assert!(!dir.exists()); assert!(orphan.exists());
            let result=import_with_hooks(&root,&source,"fixture-page",0,json!({}),vec![],&uuid::Uuid::new_v4().to_string(),None,||Ok(()),||Ok(()),||anyhow::bail!("interrupted after file creation"));
            assert!(result.is_err());
            assert_eq!(std::fs::read_dir(root.join("attachments/native-import")).unwrap().count(),1);
            assert_eq!(std::fs::read(source).unwrap(),b"original");
            std::fs::remove_dir_all(root).unwrap();
        }
        #[test]
        fn imports_and_recovers_uncommitted_file_without_touching_source() {
            let root=std::env::temp_dir().canonicalize().unwrap().join(format!("gallery-import-{}",uuid::Uuid::new_v4()));
            std::fs::create_dir(&root).unwrap(); std::fs::set_permissions(&root,std::fs::Permissions::from_mode(0o700)).unwrap();
            std::fs::create_dir(root.join("attachments")).unwrap();
            std::fs::copy(Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/worlds-v11.db"),root.join("worlds.db")).unwrap();
            let c=Connection::open(root.join("worlds.db")).unwrap();
            c.execute("INSERT INTO pages(id,title,kind,metadata,created_at,updated_at) VALUES('gallery-test','Gallery','gallery','{}',1,1)",[]).unwrap(); drop(c);
            let source=root.join("sample.mp3"); std::fs::write(&source,b"synthetic media").unwrap();
            let old=crate::resource_ops::read_resource(&root.join("worlds.db"),"gallery-test").unwrap();
            assert!(import(&root,&source,"gallery-test",-1,old["metadata"].clone(),vec![]).is_err());
            let c=Connection::open(root.join("worlds.db")).unwrap();
            assert_eq!(c.query_row("SELECT count(*) FROM native_gallery_import_intents_v2",[],|r|r.get::<_,i64>(0)).unwrap(),0);
            assert_eq!(c.query_row("SELECT count(*) FROM attachments WHERE page_id='gallery-test'",[],|r|r.get::<_,i64>(0)).unwrap(),0);
            assert_eq!(std::fs::read_dir(root.join("attachments/native-import")).unwrap().count(),0); drop(c);
            let existing: Vec<BlockInput>=old["blocks"].as_array().unwrap().iter().map(|v|BlockInput{id:v["id"].as_str().unwrap().into(),content:v["content"].clone()}).collect();
            let operation=uuid::Uuid::new_v4().to_string();
            let result=import_idempotent(&root,&source,"gallery-test",old["revision"].as_i64().unwrap(),old["metadata"].clone(),existing.clone(),&operation).unwrap();
            let retry=import_idempotent(&root,&source,"gallery-test",old["revision"].as_i64().unwrap(),old["metadata"].clone(),existing.clone(),&operation).unwrap();
            assert_eq!(result,retry);
            assert!(import_idempotent(&root,&source,"gallery-test",old["revision"].as_i64().unwrap()+1,old["metadata"].clone(),existing,&operation).is_err());
            assert_eq!(std::fs::read(&source).unwrap(),b"synthetic media");
            assert!(result["blocks"].as_array().unwrap().iter().any(|v|v["content"]["type"]=="galleryItem"));
            let c=Connection::open(root.join("worlds.db")).unwrap();
            let (committed_id,committed_rel):(String,String)=c.query_row("SELECT id,rel_path FROM attachments WHERE page_id='gallery-test'",[],|r|Ok((r.get(0)?,r.get(1)?))).unwrap();
            let committed_path=root.join("attachments").join(&committed_rel);
            let committed_meta=std::fs::metadata(&committed_path).unwrap();
            let committed_dir=std::fs::metadata(committed_path.parent().unwrap()).unwrap();
            c.execute("INSERT INTO native_gallery_import_intents_v2(id,rel_path,dir_device,dir_inode,device,inode) VALUES(?1,?2,?3,?4,?5,?6)",params![committed_id,committed_rel,committed_dir.dev() as i64,committed_dir.ino() as i64,committed_meta.dev() as i64,committed_meta.ino() as i64]).unwrap();
            let saved=committed_path.with_extension("saved"); std::fs::rename(&committed_path,&saved).unwrap();
            std::fs::write(&committed_path,b"replacement").unwrap(); drop(c);
            assert!(recover(&root).is_err());
            assert_eq!(std::fs::read(&committed_path).unwrap(),b"replacement");
            std::fs::remove_file(&committed_path).unwrap(); std::fs::rename(&saved,&committed_path).unwrap();
            recover(&root).unwrap();
            let id=uuid::Uuid::new_v4().simple().to_string(); let rel=format!("native-import/{id}/asset.mp3");
            let c=Connection::open(root.join("worlds.db")).unwrap();
            std::fs::DirBuilder::new().mode(0o700).create(root.join("attachments/native-import").join(&id)).unwrap();
            std::fs::write(root.join("attachments").join(&rel),b"interrupted").unwrap();
            let file=std::fs::metadata(root.join("attachments").join(&rel)).unwrap();
            let dir=std::fs::metadata(root.join("attachments/native-import").join(&id)).unwrap();
            c.execute("INSERT INTO native_gallery_import_intents_v2(id,rel_path,dir_device,dir_inode,device,inode) VALUES(?1,?2,?3,?4,?5,?6)",params![id,rel,dir.dev() as i64,dir.ino() as i64,file.dev() as i64,file.ino() as i64]).unwrap(); drop(c);
            recover(&root).unwrap(); assert!(!root.join("attachments").join(&rel).exists());
            let c=Connection::open(root.join("worlds.db")).unwrap();
            assert_eq!(c.query_row("SELECT count(*) FROM attachments WHERE page_id='gallery-test'",[],|r|r.get::<_,i64>(0)).unwrap(),1);
            assert_eq!(c.query_row("SELECT count(*) FROM native_gallery_import_intents_v2",[],|r|r.get::<_,i64>(0)).unwrap(),0);
            let unproven=uuid::Uuid::new_v4().simple().to_string(); let target=format!("native-import/{unproven}/asset.mp3");
            std::fs::DirBuilder::new().mode(0o700).create(root.join("attachments/native-import").join(&unproven)).unwrap();
            std::fs::write(root.join("attachments").join(&target),b"do not delete").unwrap();
            c.execute("INSERT INTO native_gallery_import_intents_v2(id,rel_path,dir_device,dir_inode) VALUES(?1,?2,-1,-1)",params![unproven,target]).unwrap(); drop(c);
            assert!(recover(&root).is_err());
            assert_eq!(std::fs::read(root.join("attachments").join(&target)).unwrap(),b"do not delete");
            std::fs::remove_dir_all(root).unwrap();
        }
    }
}
