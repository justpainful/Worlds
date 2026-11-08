use worlds_collaboration::*;
use yrs::updates::decoder::Decode;
use yrs::{Doc, GetString, ReadTxn, StateVector, Text, Transact, Update};

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
fn pending_dependency_survives_full_snapshot_and_wire_diff() {
    let empty = CollaborationDoc::default();
    let pending = CollaborationDoc::default();
    pending.apply(A).unwrap();
    assert_eq!(pending.state_vector().unwrap(), empty.state_vector().unwrap());
    let full = pending.diff(&[0]).unwrap();
    assert_ne!(full, empty.diff(&[0]).unwrap());
    let reconstructed = CollaborationDoc::default();
    reconstructed.apply(&full).unwrap();
    reconstructed.apply(BASE).unwrap();
    let expected = CollaborationDoc::default();
    expected.apply(BASE).unwrap();
    expected.apply(A).unwrap();
    assert_eq!(reconstructed.diff(&[0]).unwrap(), expected.diff(&[0]).unwrap());
    // A peer already possessing BASE must also receive the pending update.
    let peer = CollaborationDoc::default();
    peer.apply(BASE).unwrap();
    let wire = pending.diff(&peer.state_vector().unwrap()).unwrap();
    peer.apply(&wire).unwrap();
    assert_eq!(peer.diff(&[0]).unwrap(), expected.diff(&[0]).unwrap());
}

#[test]
fn pending_deletion_survives_full_snapshot_and_wire_diff() {
    let source = Doc::new();
    source.transact_mut().apply_update(Update::decode_v1(BASE).unwrap()).unwrap();
    let vector = source.transact().state_vector();
    let text = source.transact().get_text("shared").unwrap();
    text.remove_range(&mut source.transact_mut(), 0, 1);
    let deletion = source.transact().encode_state_as_update_v1(&vector);
    let pending = CollaborationDoc::default(); pending.apply(&deletion).unwrap();
    let empty = CollaborationDoc::default();
    assert_eq!(pending.state_vector().unwrap(), empty.state_vector().unwrap());
    let full = pending.diff(&[0]).unwrap();
    assert_ne!(full, empty.diff(&[0]).unwrap());
    let peer = CollaborationDoc::default(); peer.apply(BASE).unwrap();
    peer.apply(&pending.diff(&peer.state_vector().unwrap()).unwrap()).unwrap();
    let expected = CollaborationDoc::default(); expected.apply(BASE).unwrap(); expected.apply(&deletion).unwrap();
    assert_eq!(peer.diff(&[0]).unwrap(), expected.diff(&[0]).unwrap());
    let restored = CollaborationDoc::default(); restored.apply(&full).unwrap(); restored.apply(BASE).unwrap();
    assert_eq!(restored.diff(&[0]).unwrap(), expected.diff(&[0]).unwrap());
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

#[test]
fn concurrent_ffi_document_lifetimes_preserve_buffers() {
    let workers: Vec<_> = (0..12).map(|_| std::thread::spawn(|| {
        for _ in 0..64 {
            unsafe {
                let handle=worlds_doc_new(); assert!(!handle.is_null());
                let mut id=0_u64; assert_eq!(worlds_doc_client_id(handle,&mut id),0);
                assert_eq!(worlds_doc_apply(handle,BASE.as_ptr(),BASE.len()),0);
                let mut vector=WorldsBuffer {data:std::ptr::null_mut(),len:0};
                assert_eq!(worlds_doc_state_vector(handle,&mut vector),0);
                assert_eq!(std::slice::from_raw_parts(vector.data,vector.len),VECTOR);
                worlds_buffer_free(vector); worlds_doc_free(handle);
            }
        }
    })).collect();
    for worker in workers { worker.join().unwrap(); }
}

use yrs::updates::encoder::Encode;

#[test]
fn exported_client_id_matches_document() {
    let doc = worlds_collaboration::worlds_doc_new();
    assert!(!doc.is_null());
    let mut id = u64::MAX;
    assert_eq!(unsafe { worlds_collaboration::worlds_doc_client_id(doc, &mut id) }, 0);
    assert!(id <= 9_007_199_254_740_991);
    let mut second = u64::MAX;
    assert_eq!(unsafe { worlds_collaboration::worlds_doc_client_id(doc, &mut second) }, 0);
    assert_eq!(id, second);
    unsafe { worlds_collaboration::worlds_doc_free(doc); }
}
