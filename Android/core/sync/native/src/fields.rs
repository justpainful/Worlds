//! A shared pack item's fields (docs/PACKS.md, Design 1): the `fields` map of
//! its content document, next to its blocks, and the item's kind in the
//! `meta` map, written by the desktop. Reading returns both as JSON; writing
//! returns only the update to send, so changes merge field by field.

use serde_json::{json, Value};
use yrs::{Any, Map, Out, ReadTxn, Transact};

const MAX_FIELDS_BYTES: usize = 64 * 1024;

fn to_json(out: &Out, txn: &impl ReadTxn) -> Value {
    let mut text = String::new();
    out.to_json(txn).to_json(&mut text);
    serde_json::from_str(&text).unwrap_or(Value::Null)
}

/// `{"kind": "shop.order" | null, "fields": {...}}` from a document.
pub fn read(snapshot: &[u8], _: &[u8]) -> Result<Vec<u8>, String> {
    let doc = super::load(snapshot)?;
    let fields = doc.get_or_insert_map("fields");
    let meta = doc.get_or_insert_map("meta");
    let txn = doc.transact();
    let mut out = serde_json::Map::new();
    for (key, value) in fields.iter(&txn) {
        out.insert(key.to_string(), to_json(&value, &txn));
    }
    let kind = match meta.get(&txn, "kind") {
        Some(Out::Any(Any::String(s))) => Value::String(s.to_string()),
        _ => Value::Null,
    };
    Ok(json!({ "kind": kind, "fields": out }).to_string().into_bytes())
}

/// Apply `{"set": {...}, "remove": [...]}` and return the update to send.
pub fn write(snapshot: &[u8], request: &[u8]) -> Result<Vec<u8>, String> {
    if request.len() > MAX_FIELDS_BYTES { return Err("Fields too large".into()); }
    let input: Value = serde_json::from_slice(request).map_err(|e| e.to_string())?;
    let set = input.get("set").and_then(Value::as_object).cloned().unwrap_or_default();
    let remove: Vec<String> = input.get("remove").and_then(Value::as_array).map(|a| a.iter().filter_map(|v| v.as_str().map(str::to_string)).collect()).unwrap_or_default();
    let doc = super::load(snapshot)?;
    let fields = doc.get_or_insert_map("fields");
    let before = doc.transact().state_vector();
    {
        let mut txn = doc.transact_mut();
        for (key, value) in set {
            if key.is_empty() || key.len() > 64 { return Err("Invalid field id".into()); }
            let any = Any::from_json(&value.to_string()).map_err(|e| e.to_string())?;
            fields.insert(&mut txn, key, any);
        }
        for key in remove {
            fields.remove(&mut txn, &key);
        }
    }
    Ok(doc.transact().encode_state_as_update_v1(&before))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn apply(snapshot: &[u8], update: &[u8]) -> Vec<u8> { crate::merge(snapshot, update).unwrap() }
    fn fields(snapshot: &[u8]) -> Value { serde_json::from_slice::<Value>(&read(snapshot, &[]).unwrap()).unwrap() }

    #[test]
    fn writes_and_reads_fields() {
        let up = write(&[], br#"{"set":{"status":"sent","total":1150,"paid":false}}"#).unwrap();
        let doc = apply(&[], &up);
        let got = fields(&doc);
        assert_eq!(got["fields"]["status"], "sent");
        assert_eq!(got["fields"]["total"].as_f64(), Some(1150.0));
        assert_eq!(got["fields"]["paid"], false);
        assert_eq!(got["kind"], Value::Null);
        let removed = apply(&doc, &write(&doc, br#"{"remove":["paid"]}"#).unwrap());
        assert!(fields(&removed)["fields"].get("paid").is_none());
    }

    #[test]
    fn two_phones_changing_different_fields_keep_both() {
        let base = apply(&[], &write(&[], br#"{"set":{"status":"draft","total":100}}"#).unwrap());
        let a = write(&base, br#"{"set":{"status":"sent"}}"#).unwrap();
        let b = write(&base, br#"{"set":{"total":230}}"#).unwrap();
        let merged = apply(&apply(&base, &a), &b);
        let got = fields(&merged)["fields"].clone();
        assert_eq!(got["status"], "sent");
        assert_eq!(got["total"].as_f64(), Some(230.0));
    }

    #[test]
    fn refuses_bad_requests() {
        assert!(write(&[], b"not json").is_err());
        assert!(write(&[], br#"{"set":{"":1}}"#).is_err());
    }
}
