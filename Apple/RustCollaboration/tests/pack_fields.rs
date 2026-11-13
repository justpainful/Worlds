//! A shared pack item's fields, as the desktop writes them next to the blocks
//! (docs/PACKS.md, Design 1), read through the collaboration core.
use worlds_collaboration::*;
use yrs::{Any, Doc, Map, ReadTxn, StateVector, Transact};

fn desktop_update(kind: Option<&str>) -> Vec<u8> {
    let doc = Doc::new();
    let fields = doc.get_or_insert_map("fields");
    let meta = doc.get_or_insert_map("meta");
    {
        let mut txn = doc.transact_mut();
        fields.insert(&mut txn, "status", Any::from("sent"));
        fields.insert(&mut txn, "total", Any::from(1150.0));
        fields.insert(&mut txn, "paid", Any::from(false));
        if let Some(kind) = kind { meta.insert(&mut txn, "kind", Any::from(kind)); }
    }
    let update = doc.transact().encode_state_as_update_v1(&StateVector::default());
    update
}

fn read(update: &[u8]) -> serde_json::Value {
    let d = CollaborationDoc::default();
    d.apply(update).unwrap();
    serde_json::from_slice(&d.pack_fields().unwrap()).unwrap()
}

#[test]
fn reads_the_kind_and_fields_the_desktop_wrote() {
    let got = read(&desktop_update(Some("shop.order")));
    assert_eq!(got["kind"], "shop.order");
    assert_eq!(got["fields"]["status"], "sent");
    assert_eq!(got["fields"]["total"].as_f64(), Some(1150.0));
    assert_eq!(got["fields"]["paid"], false);
}

#[test]
fn a_page_without_pack_fields_reads_empty() {
    let got = read(&desktop_update(None));
    assert!(got["kind"].is_null());
    let empty = CollaborationDoc::default();
    let got: serde_json::Value = serde_json::from_slice(&empty.pack_fields().unwrap()).unwrap();
    assert!(got["kind"].is_null());
    assert_eq!(got["fields"], serde_json::json!({}));
}

fn full_state(update: &[u8]) -> Vec<u8> {
    let d = CollaborationDoc::default();
    d.apply(update).unwrap();
    d.diff(&[0]).unwrap()
}
fn merged(updates: &[&[u8]]) -> serde_json::Value {
    let d = CollaborationDoc::default();
    for u in updates { d.apply(u).unwrap(); }
    serde_json::from_slice(&d.pack_fields().unwrap()).unwrap()
}

#[test]
fn sets_and_removes_fields_and_keeps_the_kind() {
    let base = full_state(&desktop_update(Some("shop.order")));
    let update = fields::prepare_pack_fields(&base, br#"{"set":{"status":"paid","total":1200},"remove":["paid"]}"#).unwrap();
    let got = merged(&[&base, &update]);
    assert_eq!(got["kind"], "shop.order");
    assert_eq!(got["fields"]["status"], "paid");
    assert_eq!(got["fields"]["total"].as_f64(), Some(1200.0));
    assert!(got["fields"].get("paid").is_none());
}

#[test]
fn two_people_changing_different_fields_keep_both() {
    let base = full_state(&desktop_update(Some("shop.order")));
    let a = fields::prepare_pack_fields(&base, br#"{"set":{"status":"paid"}}"#).unwrap();
    let b = fields::prepare_pack_fields(&base, br#"{"set":{"total":230}}"#).unwrap();
    let got = merged(&[&base, &b, &a]);
    assert_eq!(got["fields"]["status"], "paid");
    assert_eq!(got["fields"]["total"].as_f64(), Some(230.0));
}

#[test]
fn the_update_never_touches_blocks_or_kind() {
    let base = full_state(&desktop_update(Some("shop.order")));
    let update = fields::prepare_pack_fields(&base, br#"{"set":{"status":"paid"}}"#).unwrap();
    // Applying the change twice is harmless, and the base document is left as it was.
    let got = merged(&[&base, &update, &update]);
    assert_eq!(got["kind"], "shop.order");
    assert_eq!(full_state(&base), base);
}

#[test]
fn refuses_bad_requests_and_bases() {
    let base = full_state(&desktop_update(Some("shop.order")));
    for bad in [&b"not json"[..], br#"[]"#, br#"{}"#, br#"{"set":{}}"#, br#"{"set":{"":1}}"#, br#"{"set":[1]}"#,
                br#"{"remove":[1]}"#, br#"{"set":{"a":1},"remove":["a"]}"#, br#"{"set":{"a":1},"other":true}"#] {
        assert!(fields::prepare_pack_fields(&base, bad).is_err(), "{}", String::from_utf8_lossy(bad));
    }
    let long_key = format!(r#"{{"set":{{"{}":1}}}}"#, "k".repeat(65));
    assert!(fields::prepare_pack_fields(&base, long_key.as_bytes()).is_err());
    assert_eq!(fields::prepare_pack_fields(&[9, 9, 9], br#"{"set":{"a":1}}"#), Err(fields::FieldsError::InvalidBase));
}

#[test]
fn the_c_boundary_prepares_the_update() {
    let base = full_state(&desktop_update(Some("shop.order")));
    let request = br#"{"set":{"status":"paid"}}"#;
    unsafe {
        let mut out = WorldsBuffer { data: std::ptr::null_mut(), len: 0 };
        assert_eq!(worlds_prepare_pack_fields(base.as_ptr(), base.len(), request.as_ptr(), request.len(), &mut out), 0);
        let update = std::slice::from_raw_parts(out.data, out.len).to_vec();
        worlds_buffer_free(out);
        assert_eq!(merged(&[&base, &update])["fields"]["status"], "paid");
        let bad = b"{}";
        let mut out = WorldsBuffer { data: std::ptr::null_mut(), len: 0 };
        assert_eq!(worlds_prepare_pack_fields(base.as_ptr(), base.len(), bad.as_ptr(), bad.len(), &mut out), 1);
        assert_eq!(worlds_prepare_pack_fields(base.as_ptr(), base.len(), request.as_ptr(), request.len(), std::ptr::null_mut()), 1);
    }
}
