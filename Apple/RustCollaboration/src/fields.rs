//! Writing a shared pack item's fields (docs/PACKS.md, Design 1): the
//! `fields` map the desktop keeps next to the page's blocks. Mirrors
//! Android's `fields.rs` `write`: set and remove keys on a private replica of
//! the caller's full state and return only the update, so two people changing
//! different fields both keep their change. Reading is `CollaborationDoc::pack_fields`.
use serde_json::Value;
use yrs::updates::decoder::Decode;
use yrs::{Any, Doc, Map, ReadTxn, Transact, Update};

const MAX_REQUEST_BYTES: usize = 64 * 1024;
const MAX_KEYS: usize = 200;
const MAX_KEY_BYTES: usize = 64;

#[derive(Debug, PartialEq, Eq)]
pub enum FieldsError { InvalidBase, InvalidRequest, TooLarge }

fn valid_key(key: &str) -> bool {
    !key.is_empty() && key.len() <= MAX_KEY_BYTES && !key.contains('\0')
}

/// Apply `{"set": {...}, "remove": [...]}` to a replica of `base` (a full
/// state update) and return the update to persist and send. The caller must
/// check write access and persist the update before applying it.
pub fn prepare_pack_fields(base: &[u8], request: &[u8]) -> Result<Vec<u8>, FieldsError> {
    if request.len() > MAX_REQUEST_BYTES || base.len() > 64 * 1024 * 1024 { return Err(FieldsError::TooLarge); }
    let input: Value = serde_json::from_slice(request).map_err(|_| FieldsError::InvalidRequest)?;
    let object = input.as_object().ok_or(FieldsError::InvalidRequest)?;
    if object.keys().any(|k| k != "set" && k != "remove") { return Err(FieldsError::InvalidRequest); }
    let set = match object.get("set") {
        None => serde_json::Map::new(),
        Some(Value::Object(map)) => map.clone(),
        Some(_) => return Err(FieldsError::InvalidRequest),
    };
    let remove: Vec<String> = match object.get("remove") {
        None => Vec::new(),
        Some(Value::Array(items)) => items.iter().map(|v| v.as_str().map(str::to_string).ok_or(FieldsError::InvalidRequest)).collect::<Result<_, _>>()?,
        Some(_) => return Err(FieldsError::InvalidRequest),
    };
    if set.is_empty() && remove.is_empty() { return Err(FieldsError::InvalidRequest); }
    if set.len() + remove.len() > MAX_KEYS { return Err(FieldsError::TooLarge); }
    if !set.keys().all(|k| valid_key(k)) || !remove.iter().all(|k| valid_key(k)) { return Err(FieldsError::InvalidRequest); }
    if remove.iter().any(|k| set.contains_key(k)) { return Err(FieldsError::InvalidRequest); }

    let doc = Doc::new();
    {
        let update = Update::decode_v1(base).map_err(|_| FieldsError::InvalidBase)?;
        doc.transact_mut().apply_update(update).map_err(|_| FieldsError::InvalidBase)?;
    }
    let fields = doc.get_or_insert_map("fields");
    let before = doc.transact().state_vector();
    {
        let mut txn = doc.transact_mut();
        for (key, value) in set {
            let any = Any::from_json(&value.to_string()).map_err(|_| FieldsError::InvalidRequest)?;
            fields.insert(&mut txn, key, any);
        }
        for key in remove { fields.remove(&mut txn, &key); }
    }
    let update = doc.transact().encode_state_as_update_v1(&before);
    Ok(update)
}
