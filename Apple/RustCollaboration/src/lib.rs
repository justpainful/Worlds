pub mod owned_ack;
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
    pub fn plain_projection(&self) -> Result<Vec<u8>, &'static str> {
        let doc = self.0.lock().map_err(|_| "document poisoned")?;
        let value = editor::project_plain(&doc).map_err(|_| "unsupported document")?;
        serde_json::to_vec(&value).map_err(|_| "encoding failed")
    }
    /// Every block of the page as Tiptap JSON, for reading only.
    pub fn read_projection(&self) -> Result<Vec<u8>, &'static str> {
        let doc = self.0.lock().map_err(|_| "document poisoned")?;
        let value = read_projection::read_projection(&doc)?;
        serde_json::to_vec(&value).map_err(|_| "encoding failed")
    }
    /// A shared pack item's kind and fields (docs/PACKS.md, Design 1) as
    /// `{"kind": "shop.order" | null, "fields": {...}}`, read from the
    /// `meta` and `fields` maps the desktop writes next to the blocks.
    pub fn pack_fields(&self) -> Result<Vec<u8>, &'static str> {
        use yrs::{Any, Map, Out};
        let doc = self.0.lock().map_err(|_| "document poisoned")?;
        let fields = doc.get_or_insert_map("fields");
        let meta = doc.get_or_insert_map("meta");
        let txn = doc.transact();
        let mut out = serde_json::Map::new();
        for (key, value) in fields.iter(&txn) {
            // Field values are plain JSON the desktop sets whole, so they arrive as Any.
            let json = match value {
                Out::Any(any) => { let mut text = String::new(); any.to_json(&mut text); serde_json::from_str(&text).unwrap_or(serde_json::Value::Null) }
                _ => serde_json::Value::Null,
            };
            out.insert(key.to_string(), json);
        }
        let kind = match meta.get(&txn, "kind") {
            Some(Out::Any(Any::String(s))) => serde_json::Value::String(s.to_string()),
            _ => serde_json::Value::Null,
        };
        drop(txn);
        serde_json::to_vec(&serde_json::json!({ "kind": kind, "fields": out })).map_err(|_| "encoding failed")
    }
    pub fn client_id(&self) -> Result<u64, &'static str> {
        let doc = self.0.lock().map_err(|_| "document poisoned")?;
        Ok(doc.client_id().get())
    }
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
/// `doc` must be live and `out` must point to writable memory.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn worlds_doc_client_id(doc: *const CollaborationDoc, out: *mut u64) -> i32 {
    boundary(|| {
        if doc.is_null() || out.is_null() { return Err(1); }
        let id = unsafe { &*doc }.client_id().map_err(|_| 2)?;
        unsafe { out.write(id); }
        Ok(())
    })
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
/// Document and output pointers must remain valid for this call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn worlds_doc_plain_projection(doc: *const CollaborationDoc, out: *mut WorldsBuffer) -> i32 {
    boundary(|| {
        if doc.is_null() || out.is_null() { return Err(1); }
        let value = unsafe { &*doc }.plain_projection().map_err(|_| 1)?;
        write_result(out,value)
    })
}

/// # Safety
/// Document and output pointers must remain valid for this call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn worlds_doc_read_projection(doc: *const CollaborationDoc, out: *mut WorldsBuffer) -> i32 {
    boundary(|| {
        if doc.is_null() || out.is_null() { return Err(1); }
        let value = unsafe { &*doc }.read_projection().map_err(|_| 1)?;
        write_result(out, value)
    })
}

/// # Safety
/// Document and output pointers must remain valid for this call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn worlds_doc_pack_fields(doc: *const CollaborationDoc, out: *mut WorldsBuffer) -> i32 {
    boundary(|| {
        if doc.is_null() || out.is_null() { return Err(1); }
        let value = unsafe { &*doc }.pack_fields().map_err(|_| 2)?;
        write_result(out, value)
    })
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
    match error { store::StoreError::Denied => 3, store::StoreError::Conflict => 5, store::StoreError::Schema(_) => 4, store::StoreError::Invalid => 1, _ => 2 }
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
pub unsafe extern "C" fn worlds_collaboration_store_free(handle: *mut CollaborationStoreHandle) {
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
/// Experimental owned-document bridge. Enrollment never claims existing rows.
/// # Safety
/// Handle and NUL-terminated server must remain valid for the call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn worlds_store_owned_enroll(handle:*const CollaborationStoreHandle, channel:i64, server:*const std::ffi::c_char) -> i32 {
    boundary(|| { if handle.is_null() { return Err(1); } let server=unsafe{ffi_str(server)?};
        let mut store=unsafe{&*handle}.0.lock().map_err(|_|2)?; store.enroll_empty_owned_document(channel,server).map_err(store_error) })
}
/// # Safety
/// Handle, server and bytes must remain valid until the call completes.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn worlds_store_owned_append(handle:*const CollaborationStoreHandle,channel:i64,server:*const std::ffi::c_char,data:*const u8,len:usize,local:i32)->i32 {
    boundary(|| { if handle.is_null() || !(0..=1).contains(&local) { return Err(1); }
        let server=unsafe{ffi_str(server)?};let data=unsafe{ffi_bytes(data,len)?};let mut store=unsafe{&*handle}.0.lock().map_err(|_|2)?;
        if local==1 { store.append_owned_document(channel,server,data) } else { store.append_owned_remote(channel,server,data) }.map_err(store_error) })
}
/// # Safety
/// Handle, server, vector and both writable outputs must remain valid. Free the
/// output buffer on success. -1 means no pending watermark. No ACK is implied.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn worlds_store_owned_batch(handle:*const CollaborationStoreHandle,channel:i64,server:*const std::ffi::c_char,vector:*const u8,len:usize,out:*mut WorldsBuffer,watermark:*mut i64)->i32 {
    boundary(|| { if handle.is_null() || out.is_null() || watermark.is_null() { return Err(1); }
        let server=unsafe{ffi_str(server)?};let vector=unsafe{ffi_bytes(vector,len)?};let store=unsafe{&*handle}.0.lock().map_err(|_|2)?;
        let (bytes,id)=store.owned_document_batch(channel,server,vector).map_err(store_error)?;
        write_result(out,bytes)?;unsafe{watermark.write(id.unwrap_or(-1));} Ok(()) })
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
/// Handle, input ranges, NUL-terminated strings, and writable output must be valid.
/// A successful result owns an update that must be released with worlds_buffer_free.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn worlds_store_insert_plain_checked(handle: *const CollaborationStoreHandle,
    base: *const u8, base_len: usize, block_index: u32, block_id: *const std::ffi::c_char,
    expected: *const std::ffi::c_char, offset: u32, insert: *const std::ffi::c_char, out: *mut WorldsBuffer) -> i32 {
    boundary(|| {
        if handle.is_null() || out.is_null() { return Err(1); }
        let base = unsafe { ffi_bytes(base, base_len)? };
        let block_id = unsafe { ffi_str(block_id)? };
        let expected = unsafe { ffi_str(expected)? };
        let insert = unsafe { ffi_str(insert)? };
        let mut store = unsafe { &*handle }.0.lock().map_err(|_| 2)?;
        let update = store.insert_plain_checked(base, block_index, block_id, expected, offset, insert).map_err(store_error)?;
        write_result(out, update)
    })
}
/// # Safety
/// Handle, input ranges, strings and output must remain valid for the call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn worlds_store_delete_plain_checked(handle: *const CollaborationStoreHandle,
    base: *const u8, base_len: usize, block_index: u32, block_id: *const std::ffi::c_char,
    expected: *const std::ffi::c_char, offset: u32, length: u32, out: *mut WorldsBuffer) -> i32 {
    boundary(|| {
        if handle.is_null() || out.is_null() { return Err(1); }
        let base=unsafe { ffi_bytes(base,base_len)? };
        let block_id=unsafe { ffi_str(block_id)? }; let expected=unsafe { ffi_str(expected)? };
        let mut store=unsafe { &*handle }.0.lock().map_err(|_| 2)?;
        let update=store.delete_plain_checked(base,block_index,block_id,expected,offset,length).map_err(store_error)?;
        write_result(out,update)
    })
}
/// # Safety
/// Handle, input ranges, strings and output must remain valid for the call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn worlds_store_format_plain_checked(handle: *const CollaborationStoreHandle,
    base: *const u8, base_len: usize, block_index: u32, block_id: *const std::ffi::c_char,
    expected: *const std::ffi::c_char, offset: u32, length: u32, mark: *const std::ffi::c_char, enabled: i32, out: *mut WorldsBuffer) -> i32 {
    boundary(|| {
        if handle.is_null() || out.is_null() || !(0..=1).contains(&enabled) { return Err(1); }
        let base=unsafe { ffi_bytes(base,base_len)? };
        let block_id=unsafe { ffi_str(block_id)? }; let expected=unsafe { ffi_str(expected)? }; let mark=unsafe { ffi_str(mark)? };
        let mut store=unsafe { &*handle }.0.lock().map_err(|_|2)?;
        let update=store.format_plain_checked(base,block_index,block_id,expected,offset,length,mark,enabled==1).map_err(store_error)?;
        write_result(out,update)
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

/// # Safety
/// Handle, NUL-terminated ID and writable output must remain valid for the call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn worlds_store_rejected_read(handle: *const CollaborationStoreHandle, id: *const std::ffi::c_char, out: *mut WorldsBuffer) -> i32 {
    boundary(|| {
        if handle.is_null() || out.is_null() { return Err(1); }
        let id = unsafe { ffi_str(id)? };
        let store = unsafe { &*handle }.0.lock().map_err(|_| 2)?;
        write_result(out, store.rejected_read(id).map_err(store_error)?)
    })
}

/// # Safety
/// Handle, ID and output follow the same contract as worlds_store_rejected_read.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn worlds_store_rejected_read_channel(handle: *const CollaborationStoreHandle, id: *const std::ffi::c_char, channel: i64, out: *mut WorldsBuffer) -> i32 {
    boundary(|| {
        if handle.is_null() || out.is_null() || !(0..=1).contains(&channel) { return Err(1); }
        let id=unsafe { ffi_str(id)? }; let store=unsafe { &*handle }.0.lock().map_err(|_|2)?;
        write_result(out,store.rejected_read_channel(id,Some(channel)).map_err(store_error)?)
    })
}

/// # Safety
/// Handle and output must be valid. `before_id` is required when `has_before` is 1.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn worlds_store_rejected_list(handle: *const CollaborationStoreHandle, has_before: i32, before_time: i64, before_id: *const std::ffi::c_char, out: *mut WorldsBuffer) -> i32 {
    boundary(|| {
        if handle.is_null() || out.is_null() || !(0..=1).contains(&has_before) { return Err(1); }
        let before = if has_before == 1 { Some((before_time,unsafe { ffi_str(before_id)? })) } else { None };
        let store = unsafe { &*handle }.0.lock().map_err(|_| 2)?;
        let page = store.rejected_list(before).map_err(store_error)?;
        let mut data=Vec::new();
        data.extend_from_slice(&(page.items.len() as u64).to_le_bytes());
        data.push(u8::from(page.next.is_some()));
        for item in page.items {
            data.extend_from_slice(&(item.id.len() as u64).to_le_bytes()); data.extend_from_slice(item.id.as_bytes());
            data.extend_from_slice(&item.channel.to_le_bytes()); data.extend_from_slice(&item.created_at.to_le_bytes()); data.extend_from_slice(&item.size.to_le_bytes());
            data.extend_from_slice(&(item.reason.len() as u64).to_le_bytes()); data.extend_from_slice(item.reason.as_bytes());
        }
        write_result(out,data)
    })
}

pub mod editor;
pub mod read_projection;
pub mod rejected_comments;

/// # Safety
/// The input bytes, owner string and writable output must be valid for the call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn worlds_rejected_comments(data: *const u8, len: usize, owner: *const std::ffi::c_char, out: *mut WorldsBuffer) -> i32 {
    boundary(|| {
        if out.is_null() { return Err(1); }
        let bytes=unsafe { ffi_bytes(data,len)? }; let owner=unsafe { ffi_str(owner)? };
        let result=rejected_comments::extract(bytes,owner).map_err(|_|1)?;
        write_result(out,result)
    })
}
