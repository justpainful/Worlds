//! Anchored no-follow traversal for a prospective drawing attachment reader.
//! This does not make a SQLite reference and a filesystem path one atomic object.
use anyhow::{bail, Result};
use std::{fs::File, path::Path};
#[cfg(unix)] use std::path::Component;

#[cfg(unix)]
pub(crate) fn open_directory(root: &Path) -> Result<File> {
    use std::{ffi::CString, os::{fd::{AsRawFd, FromRawFd, OwnedFd}, unix::ffi::OsStrExt}};
    if !root.is_absolute() { bail!("invalid directory path") }
    let mut components = root.components();
    if components.next() != Some(Component::RootDir) { bail!("invalid root") }
    let slash = CString::new("/")?;
    let fd = unsafe { libc::open(slash.as_ptr(), libc::O_RDONLY | libc::O_DIRECTORY | libc::O_CLOEXEC | libc::O_NOFOLLOW) };
    if fd < 0 { return Err(std::io::Error::last_os_error().into()); }
    let mut directory = unsafe { OwnedFd::from_raw_fd(fd) };
    for (index,part) in components.enumerate() {
        let Component::Normal(name) = part else { bail!("invalid root component") };
        let name = CString::new(name.as_bytes())?;
        let fd = unsafe { libc::openat(directory.as_raw_fd(), name.as_ptr(), libc::O_RDONLY | libc::O_DIRECTORY | libc::O_CLOEXEC | libc::O_NOFOLLOW) };
        if fd < 0 { return Err(anyhow::Error::new(std::io::Error::last_os_error()).context(format!("no-follow directory component {index}"))); }
        directory = unsafe { OwnedFd::from_raw_fd(fd) };
    }
    Ok(File::from(directory))
}

#[cfg(unix)]
pub(crate) fn open_confined(root: &Path, relative: &Path) -> Result<File> {
    use std::{ffi::CString, os::{fd::{AsRawFd, FromRawFd, OwnedFd}, unix::ffi::OsStrExt}};
    if relative.as_os_str().is_empty() { bail!("invalid attachment path") }
    let root_file = open_directory(root)?;
    let mut directory: OwnedFd = root_file.into();
    let parts: Vec<_> = relative.components().collect();
    for (index, part) in parts.iter().enumerate() {
        let Component::Normal(name) = part else { bail!("invalid attachment component") };
        let name = CString::new(name.as_bytes())?;
        let last = index + 1 == parts.len();
        let flags = libc::O_RDONLY | libc::O_CLOEXEC | libc::O_NOFOLLOW | if last { libc::O_NONBLOCK } else { libc::O_DIRECTORY };
        let fd = unsafe { libc::openat(directory.as_raw_fd(), name.as_ptr(), flags) };
        if fd < 0 { return Err(std::io::Error::last_os_error().into()); }
        let opened = unsafe { OwnedFd::from_raw_fd(fd) };
        if last {
            let file = File::from(opened);
            if !file.metadata()?.is_file() { bail!("attachment is not a regular file") }
            return Ok(file);
        }
        directory = opened;
    }
    bail!("invalid attachment path")
}

#[cfg(not(unix))]
pub(crate) fn open_confined(_: &Path, _: &Path) -> Result<File> {
    bail!("atomic attachment traversal is unavailable on this platform")
}

#[cfg(all(test, unix))]
mod tests {
    use super::open_confined;
    use std::{io::Read, os::unix::fs::symlink, path::Path};

    #[test]
    fn refuses_symlink_components_and_parent_escape() {
        let root = std::env::temp_dir().canonicalize().unwrap().join(format!("worlds-open-{}",uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("sub")).unwrap();
        std::fs::write(root.join("sub/item"), b"safe").unwrap();
        symlink("sub/item",root.join("file-link")).unwrap();
        symlink("sub",root.join("dir-link")).unwrap();
        assert!(open_confined(&root,Path::new("sub/item")).is_ok());
        assert!(open_confined(&root,Path::new("file-link")).is_err());
        assert!(open_confined(&root,Path::new("dir-link/item")).is_err());
        assert!(open_confined(&root,Path::new("../outside")).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn open_handle_does_not_pin_future_path_contents() {
        let root = std::env::temp_dir().canonicalize().unwrap().join(format!("worlds-replace-{}",uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("item"), b"old").unwrap();
        let mut opened = open_confined(&root,Path::new("item")).unwrap();
        std::fs::rename(root.join("item"),root.join("old")).unwrap();
        std::fs::write(root.join("item"), b"new").unwrap();
        let mut old = Vec::new(); opened.read_to_end(&mut old).unwrap();
        assert_eq!(old,b"old"); assert_eq!(std::fs::read(root.join("item")).unwrap(),b"new");
        std::fs::remove_dir_all(root).unwrap();
    }
}
