use std::panic::{AssertUnwindSafe, catch_unwind};
use std::slice;
use std::sync::Mutex;
use yrs::updates::decoder::Decode;
use yrs::updates::encoder::Encode;
use yrs::{Doc, ReadTxn, StateVector, Transact, Update};

const MAX_INPUT: usize = 64 * 1024 * 1024;

/// One opaque document. Calls serialize through the mutex. The owner must not
/// destroy it while another thread is using it.
pub struct CollaborationDoc(Mutex<Doc>);

impl Default for CollaborationDoc {
    fn default() -> Self { Self(Mutex::new(Doc::new())) }
}
impl CollaborationDoc {
    pub fn apply(&self, bytes: &[u8]) -> Result<(), &'static str> {
        if bytes.len() > MAX_INPUT { return Err("input too large"); }
        let update = Update::decode_v1(bytes).map_err(|_| "invalid update")?;
        let doc = self.0.lock().map_err(|_| "document poisoned")?;
        let result = doc.transact_mut().apply_update(update).map_err(|_| "update failed");
        result
    }
    pub fn state_vector(&self) -> Result<Vec<u8>, &'static str> {
        let doc = self.0.lock().map_err(|_| "document poisoned")?;
        let bytes = doc.transact().state_vector().encode_v1();
        Ok(bytes)
    }
    pub fn diff(&self, vector: &[u8]) -> Result<Vec<u8>, &'static str> {
        if vector.len() > MAX_INPUT { return Err("input too large"); }
        let state = StateVector::decode_v1(vector).map_err(|_| "invalid state vector")?;
        let doc = self.0.lock().map_err(|_| "document poisoned")?;
        let bytes = doc.transact().encode_state_as_update_v1(&state);
        Ok(bytes)
    }
}

#[repr(C)]
pub struct WorldsBuffer { pub data: *mut u8, pub len: usize }

/// Status: 0 success, 1 invalid argument/data, 2 operation failed/panicked.
fn boundary(f: impl FnOnce() -> Result<(), i32>) -> i32 {
    match catch_unwind(AssertUnwindSafe(f)) { Ok(Ok(())) => 0, Ok(Err(e)) => e, Err(_) => 2 }
}

#[unsafe(no_mangle)]
pub extern "C" fn worlds_doc_new() -> *mut CollaborationDoc {
    catch_unwind(|| Box::into_raw(Box::new(CollaborationDoc::default()))).unwrap_or(std::ptr::null_mut())
}

/// # Safety
/// Pointer must be null or returned by `worlds_doc_new`, once only, with no active calls.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn worlds_doc_free(doc: *mut CollaborationDoc) {
    if !doc.is_null() { unsafe { drop(Box::from_raw(doc)); } }
}

/// # Safety
/// `doc` and `data` must be valid for the duration of the call; `data` can be
/// null only if `len` is zero. No mutable aliases may exist.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn worlds_doc_apply(doc: *const CollaborationDoc, data: *const u8, len: usize) -> i32 {
    boundary(|| {
        if doc.is_null() || len > MAX_INPUT || (data.is_null() && len != 0) { return Err(1); }
        let bytes = if len == 0 { &[] } else { unsafe { slice::from_raw_parts(data, len) } };
        unsafe { &*doc }.apply(bytes).map_err(|_| 1)
    })
}

fn write_result(out: *mut WorldsBuffer, value: Vec<u8>) -> Result<(), i32> {
    if out.is_null() { return Err(1); }
    let mut bytes = value.into_boxed_slice();
    let buffer = WorldsBuffer { data: bytes.as_mut_ptr(), len: bytes.len() };
    std::mem::forget(bytes);
    unsafe { out.write(buffer); }
    Ok(())
}

/// # Safety
/// `doc` must be live; `out` must point to writable, uninitialized storage.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn worlds_doc_state_vector(doc: *const CollaborationDoc, out: *mut WorldsBuffer) -> i32 {
    boundary(|| {
        if doc.is_null() || out.is_null() { return Err(1); }
        let value = unsafe { &*doc }.state_vector().map_err(|_| 2)?;
        write_result(out, value)
    })
}

/// # Safety
/// `doc`, `out` and input must be valid as described by the other functions.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn worlds_doc_diff(doc: *const CollaborationDoc, data: *const u8, len: usize, out: *mut WorldsBuffer) -> i32 {
    boundary(|| {
        if doc.is_null() || out.is_null() || len > MAX_INPUT || (data.is_null() && len != 0) { return Err(1); }
        let bytes = if len == 0 { &[] } else { unsafe { slice::from_raw_parts(data, len) } };
        let value = unsafe { &*doc }.diff(bytes).map_err(|_| 1)?;
        write_result(out, value)
    })
}

/// # Safety
/// The buffer must be an unchanged successful result, freed exactly once.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn worlds_buffer_free(buffer: WorldsBuffer) {
    if !buffer.data.is_null() {
        unsafe { drop(Box::from_raw(std::ptr::slice_from_raw_parts_mut(buffer.data, buffer.len))); }
    }
}
pub mod store;

pub struct CollaborationStoreHandle(Mutex<store::SyncStore>);
fn store_error(error: store::StoreError) -> i32 {
    match error { store::StoreError::Denied => 3, store::StoreError::Schema(_) => 4, store::StoreError::Invalid => 1, _ => 2 }
}
unsafe fn ffi_str<'a>(p: *const std::ffi::c_char) -> Result<&'a str, i32> {
    if p.is_null() { return Err(1); }
    let s = unsafe { std::ffi::CStr::from_ptr(p) }.to_str().map_err(|_| 1)?;
    if s.len() > 16_384 { Err(1) } else { Ok(s) }
}
unsafe fn ffi_bytes<'a>(p: *const u8, len: usize) -> Result<&'a [u8], i32> {
    if len > MAX_INPUT || (p.is_null() && len != 0) { return Err(1); }
    Ok(if len == 0 { &[] } else { unsafe { slice::from_raw_parts(p, len) } })
}
/// # Safety
/// Each input must be a valid NUL-terminated UTF-8 string. `out` must be writable.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn worlds_store_open(path: *const std::ffi::c_char, page: *const std::ffi::c_char,
    user: *const std::ffi::c_char, workspace: *const std::ffi::c_char, out: *mut *mut CollaborationStoreHandle) -> i32 {
    boundary(|| {
        if out.is_null() { return Err(1); }
        unsafe { out.write(std::ptr::null_mut()); }
        let (path,page,user,workspace) = unsafe { (ffi_str(path)?,ffi_str(page)?,ffi_str(user)?,ffi_str(workspace)?) };
        let store = store::SyncStore::open(std::path::Path::new(path),page,user,workspace).map_err(store_error)?;
        unsafe { out.write(Box::into_raw(Box::new(CollaborationStoreHandle(Mutex::new(store))))); }
        Ok(())
    })
}
/// # Safety
/// Handle must be null or a live handle returned by worlds_store_open, freed once with no calls in flight.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn worlds_store_free(handle: *mut CollaborationStoreHandle) {
    if !handle.is_null() { unsafe { drop(Box::from_raw(handle)); } }
}
/// # Safety
/// Valid handle and writable output are required. Buffer contains little-endian u64 count, followed by u64 length and bytes per update.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn worlds_store_load(handle: *const CollaborationStoreHandle, channel: i64, out: *mut WorldsBuffer) -> i32 {
    boundary(|| {
        if handle.is_null() || out.is_null() { return Err(1); }
        let guard = unsafe { &*handle }.0.lock().map_err(|_| 2)?;
        let updates = guard.load(channel).map_err(store_error)?;
        let mut data = Vec::new();
        data.extend_from_slice(&(updates.len() as u64).to_le_bytes());
        for update in updates {
            data.extend_from_slice(&(update.len() as u64).to_le_bytes()); data.extend_from_slice(&update);
        }
        write_result(out, data)
    })
}
/// # Safety
/// Handle and input byte range must remain valid. `local` is 0 or 1.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn worlds_store_append(handle: *const CollaborationStoreHandle, channel: i64, data: *const u8, len: usize, local: i32) -> i32 {
    boundary(|| {
        if handle.is_null() || !(0..=1).contains(&local) { return Err(1); }
        let bytes = unsafe { ffi_bytes(data,len)? };
        let mut guard = unsafe { &*handle }.0.lock().map_err(|_| 2)?;
        guard.append(channel,bytes,local == 1).map_err(store_error)
    })
}
/// # Safety
/// Handle and writable output must be valid. A result of -1 means no pending rows.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn worlds_store_max_pending(handle: *const CollaborationStoreHandle, channel: i64, out: *mut i64) -> i32 {
    boundary(|| {
        if handle.is_null() || out.is_null() { return Err(1); }
        let guard = unsafe { &*handle }.0.lock().map_err(|_| 2)?;
        let id = guard.max_pending(channel).map_err(store_error)?.unwrap_or(-1);
        unsafe { out.write(id); } Ok(())
    })
}
/// # Safety
/// Handle must be valid and not concurrently freed.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn worlds_store_ack(handle: *const CollaborationStoreHandle, channel: i64, through: i64) -> i32 {
    boundary(|| {
        if handle.is_null() || through < 0 { return Err(1); }
        let guard = unsafe { &*handle }.0.lock().map_err(|_| 2)?;
        guard.acknowledge(channel,through).map_err(store_error)
    })
}
/// # Safety
/// All pointers must be valid for the call; ID and reason are NUL-terminated UTF-8.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn worlds_store_reject(handle: *const CollaborationStoreHandle, channel: i64,
    id: *const std::ffi::c_char, data: *const u8, len: usize, reason: *const std::ffi::c_char) -> i32 {
    boundary(|| {
        if handle.is_null() { return Err(1); }
        let (id, data, reason) = unsafe { (ffi_str(id)?,ffi_bytes(data,len)?,ffi_str(reason)?) };
        let mut guard = unsafe { &*handle }.0.lock().map_err(|_| 2)?;
        guard.reject(channel,id,data,reason).map_err(store_error)
    })
}
