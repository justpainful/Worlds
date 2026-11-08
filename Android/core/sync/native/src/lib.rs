use jni::objects::{JByteArray, JClass};
use jni::sys::jbyteArray;
use jni::JNIEnv;
use yrs::updates::decoder::Decode;
use yrs::updates::encoder::Encode;
use yrs::{Doc, ReadTxn, StateVector, Transact, Update, Options, OffsetKind};

mod editor;
mod comments;
mod restore;

pub fn editor_read(snapshot: &[u8]) -> Result<Vec<u8>, String> { editor::read(snapshot) }
/// Exposed for cross-runtime conformance fixtures.
pub fn editor_restore(snapshot: &[u8], version: &[u8]) -> Result<Vec<u8>, String> { restore::restore(snapshot, version) }
pub fn editor_replace_text(snapshot: &[u8], request: &[u8]) -> Result<Vec<u8>, String> { editor::replace_text(snapshot, request) }
pub fn editor_replace_block_text(snapshot: &[u8], request: &[u8]) -> Result<Vec<u8>, String> { editor::replace_block_text(snapshot, request) }

// Stateless calls keep ownership explicit across JNI. Inputs are v1 Yjs wire data.
fn load(snapshot: &[u8]) -> Result<Doc, String> {
    let doc = Doc::with_options(Options { offset_kind: OffsetKind::Utf16, skip_gc: true, ..Options::default() });
    if !snapshot.is_empty() {
        let update = Update::decode_v1(snapshot).map_err(|e| e.to_string())?;
        doc.transact_mut().apply_update(update).map_err(|e| e.to_string())?;
    }
    Ok(doc)
}

fn vector(snapshot: &[u8]) -> Result<Vec<u8>, String> {
    Ok(load(snapshot)?.transact().state_vector().encode_v1())
}

fn diff(snapshot: &[u8], remote: &[u8]) -> Result<Vec<u8>, String> {
    let state = StateVector::decode_v1(remote).map_err(|e| e.to_string())?;
    Ok(load(snapshot)?.transact().encode_state_as_update_v1(&state))
}

pub fn merge(snapshot: &[u8], incoming: &[u8]) -> Result<Vec<u8>, String> {
    let doc = load(snapshot)?;
    let update = Update::decode_v1(incoming).map_err(|e| e.to_string())?;
    doc.transact_mut().apply_update(update).map_err(|e| e.to_string())?;
    let result = doc.transact().encode_state_as_update_v1(&StateVector::default());
    Ok(result)
}

fn invoke(mut env: JNIEnv, first: JByteArray, second: Option<JByteArray>, f: fn(&[u8], &[u8]) -> Result<Vec<u8>, String>) -> jbyteArray {
    let result = (|| {
        let a = env.convert_byte_array(first).map_err(|e| e.to_string())?;
        let b = match second { Some(value) => env.convert_byte_array(value).map_err(|e| e.to_string())?, None => Vec::new() };
        if a.len() > 64 * 1024 * 1024 || b.len() > 64 * 1024 * 1024 {
            return Err("Yjs data exceeds limit".into());
        }
        std::panic::catch_unwind(|| f(&a, &b)).map_err(|_| "Invalid Yjs data".to_string())?
    })();
    match result.and_then(|bytes| env.byte_array_from_slice(&bytes).map_err(|e| e.to_string())) {
        Ok(bytes) => bytes.into_raw(),
        Err(_) => { let _ = env.throw_new("java/lang/IllegalArgumentException", "Invalid Yjs data"); std::ptr::null_mut() }
    }
}

#[no_mangle]
pub extern "system" fn Java_worlds_sync_YrsNative_stateVector(env: JNIEnv, _: JClass, snapshot: JByteArray) -> jbyteArray {
    invoke(env, snapshot, None, |a, _| vector(a))
}

#[no_mangle]
pub extern "system" fn Java_worlds_sync_YrsNative_diff(env: JNIEnv, _: JClass, snapshot: JByteArray, state: JByteArray) -> jbyteArray {
    invoke(env, snapshot, Some(state), diff)
}

#[no_mangle]
pub extern "system" fn Java_worlds_sync_YrsNative_merge(env: JNIEnv, _: JClass, snapshot: JByteArray, update: JByteArray) -> jbyteArray {
    invoke(env, snapshot, Some(update), merge)
}

#[no_mangle]
pub extern "system" fn Java_worlds_sync_YrsNative_editorJsonBytes(env: JNIEnv, _: JClass, snapshot: JByteArray) -> jbyteArray {
    invoke(env, snapshot, None, |a, _| editor::read(a))
}

#[no_mangle]
pub extern "system" fn Java_worlds_sync_YrsNative_replaceTextBytes(env: JNIEnv, _: JClass, snapshot: JByteArray, request: JByteArray) -> jbyteArray {
    invoke(env, snapshot, Some(request), editor::replace_text)
}

#[no_mangle]
pub extern "system" fn Java_worlds_sync_YrsNative_replaceBlockTextBytes(env: JNIEnv, _: JClass, snapshot: JByteArray, request: JByteArray) -> jbyteArray {
    invoke(env, snapshot, Some(request), editor::replace_block_text)
}

#[no_mangle]
pub extern "system" fn Java_worlds_sync_YrsNative_restoreVersionBytes(env: JNIEnv, _: JClass, snapshot: JByteArray, version: JByteArray) -> jbyteArray {
    invoke(env, snapshot, Some(version), restore::restore)
}

#[no_mangle]
pub extern "system" fn Java_worlds_sync_YrsNative_blockIdentityBytes(env: JNIEnv, _: JClass, snapshot: JByteArray, bid: JByteArray) -> jbyteArray {
    invoke(env, snapshot, Some(bid), editor::block_identity)
}

#[cfg(test)]
mod tests {
    use super::*;
    use yrs::{GetString, Text};
    #[test]
    fn converges_and_rejects_bad_updates() {
        let a = Doc::new();
        let b = Doc::new();
        a.get_or_insert_text("body").insert(&mut a.transact_mut(), 0, "Hello ");
        b.get_or_insert_text("body").insert(&mut b.transact_mut(), 0, "World");
        let empty = StateVector::default();
        let sa = a.transact().encode_state_as_update_v1(&empty);
        let sb = b.transact().encode_state_as_update_v1(&empty);
        let combined = merge(&sa, &sb).unwrap();
        let missing = diff(&combined, &vector(&sa).unwrap()).unwrap();
        let result = merge(&sa, &missing).unwrap();
        let doc = load(&result).unwrap();
        let value = doc.get_or_insert_text("body").get_string(&doc.transact());
        assert!(value.contains("Hello ") && value.contains("World"));
        assert!(merge(&sa, &[255]).is_err());
    }
}

#[no_mangle]
pub extern "system" fn Java_worlds_sync_YrsNative_commentsJsonBytes(env: JNIEnv, _: JClass, snapshot: JByteArray) -> jbyteArray {
    invoke(env, snapshot, None, |a, _| comments::read(a))
}
#[no_mangle]
pub extern "system" fn Java_worlds_sync_YrsNative_replyCommentBytes(env: JNIEnv, _: JClass, snapshot: JByteArray, request: JByteArray) -> jbyteArray {
    invoke(env, snapshot, Some(request), comments::mutate)
}
