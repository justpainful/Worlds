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
