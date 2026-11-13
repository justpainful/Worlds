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
