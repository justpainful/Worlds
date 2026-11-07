use worlds_collaboration::*;
use yrs::updates::decoder::Decode;
use yrs::{Doc, GetString, ReadTxn, StateVector, Transact, Update};

const BASE: &[u8] = include_bytes!("fixtures/base.bin");
const VECTOR: &[u8] = include_bytes!("fixtures/base-vector.bin");
const A: &[u8] = include_bytes!("fixtures/alice-diff.bin");
const B: &[u8] = include_bytes!("fixtures/bob-diff.bin");

fn text(update: &[u8]) -> (String, String) {
    let doc = Doc::new();
    doc.transact_mut().apply_update(Update::decode_v1(update).unwrap()).unwrap();
    let txn = doc.transact();
    let plain = txn.get_text("shared").unwrap().get_string(&txn);
    let xml = txn.get_xml_fragment("default").unwrap().get_string(&txn);
    (plain, xml)
}

#[test]
fn applies_yjs_xml_and_roundtrips_state_vector() {
    let d = CollaborationDoc::default();
    d.apply(BASE).unwrap();
    let delta = d.diff(&StateVector::default().encode_v1()).unwrap();
    let (plain, xml) = text(&delta);
    assert_eq!(plain, "Hello 🌍");
    assert_eq!(xml, include_str!("fixtures/xml.txt"));
    assert_eq!(d.state_vector().unwrap(), VECTOR);
}

#[test]
fn merges_concurrent_updates_regardless_of_order() {
    let expected = include_str!("fixtures/merged.txt");
    for updates in [[A, B], [B, A]] {
        let d = CollaborationDoc::default();
        d.apply(BASE).unwrap();
        for update in updates { d.apply(update).unwrap(); }
        let diff = d.diff(&[0]).unwrap();
        assert_eq!(text(&diff).0, expected);
        d.apply(updates[0]).unwrap();
        assert_eq!(text(&d.diff(&[0]).unwrap()).0, expected);
    }
}

#[test]
fn missing_parent_update_is_not_lost() {
    let d = CollaborationDoc::default();
    d.apply(A).unwrap();
    d.apply(BASE).unwrap();
    d.apply(B).unwrap();
    assert_eq!(text(&d.diff(&[0]).unwrap()).0, include_str!("fixtures/merged.txt"));
}

#[test]
fn rejects_truncated_inputs_and_handles_ffi_ownership() {
    let d = CollaborationDoc::default();
    assert!(d.apply(&[255]).is_err());
    assert!(d.diff(&[255]).is_err());
    unsafe {
        let handle = worlds_doc_new();
        assert!(!handle.is_null());
        assert_eq!(worlds_doc_apply(handle, std::ptr::null(), 3), 1);
        assert_eq!(worlds_doc_apply(handle, BASE.as_ptr(), BASE.len()), 0);
        let mut out = WorldsBuffer { data: std::ptr::null_mut(), len: 0 };
        assert_eq!(worlds_doc_state_vector(handle, &mut out), 0);
        assert_eq!(std::slice::from_raw_parts(out.data, out.len), VECTOR);
        worlds_buffer_free(out);
        worlds_doc_free(handle);
    }
}

use yrs::updates::encoder::Encode;
