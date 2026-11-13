//! The read-only projection a viewer uses to show any shared page.
use worlds_collaboration::*;
use yrs::{Any, Doc, ReadTxn, StateVector, Text, Transact, Xml, XmlElementPrelim, XmlFragment, XmlTextPrelim};

/// A page the strict editing projection refuses: a heading, an empty
/// paragraph, a bullet list and a bold run, built the way the desktop's
/// Tiptap binding stores blocks.
fn page() -> Vec<u8> {
    let doc = Doc::new();
    let root = doc.get_or_insert_xml_fragment("default");
    {
        let mut txn = doc.transact_mut();
        let heading = root.push_back(&mut txn, XmlElementPrelim::empty("heading"));
        heading.insert_attribute(&mut txn, "level", Any::from(2.0));
        heading.insert_attribute(&mut txn, "bid", "h-1");
        heading.push_back(&mut txn, XmlTextPrelim::new("Order notes"));

        let empty = root.push_back(&mut txn, XmlElementPrelim::empty("paragraph"));
        empty.insert_attribute(&mut txn, "bid", "p-empty");

        let list = root.push_back(&mut txn, XmlElementPrelim::empty("bulletList"));
        let item = list.push_back(&mut txn, XmlElementPrelim::empty("listItem"));
        let inner = item.push_back(&mut txn, XmlElementPrelim::empty("paragraph"));
        inner.push_back(&mut txn, XmlTextPrelim::new("Two boxes"));

        let para = root.push_back(&mut txn, XmlElementPrelim::empty("paragraph"));
        para.insert_attribute(&mut txn, "bid", "p-2");
        let text = para.push_back(&mut txn, XmlTextPrelim::new(""));
        text.insert(&mut txn, 0, "Paid ");
        text.insert_with_attributes(&mut txn, 5, "in full", [("bold".into(), Any::from(true))].into_iter().collect());
    }
    let update = doc.transact().encode_state_as_update_v1(&StateVector::default());
    update
}

fn read(update: &[u8]) -> serde_json::Value {
    let doc = CollaborationDoc::default();
    doc.apply(update).unwrap();
    serde_json::from_slice(&doc.read_projection().unwrap()).unwrap()
}

#[test]
fn reads_headings_lists_empty_paragraphs_and_marks() {
    let update = page();
    let doc = CollaborationDoc::default();
    doc.apply(&update).unwrap();
    // The editing projection refuses this page; the read projection shows it.
    assert!(doc.plain_projection().is_err());
    let got = read(&update);
    let blocks = got["content"].as_array().unwrap();
    assert_eq!(blocks.len(), 4);
    assert_eq!(blocks[0]["type"], "heading");
    assert_eq!(blocks[0]["attrs"]["level"].as_f64(), Some(2.0));
    assert_eq!(blocks[0]["content"][0]["text"], "Order notes");
    assert_eq!(blocks[1]["type"], "paragraph");
    assert!(blocks[1].get("content").is_none());
    assert_eq!(blocks[2]["content"][0]["content"][0]["content"][0]["text"], "Two boxes");
    assert_eq!(blocks[3]["content"][0]["text"], "Paid ");
    assert_eq!(blocks[3]["content"][1]["text"], "in full");
    assert_eq!(blocks[3]["content"][1]["marks"][0]["type"], "bold");
}

#[test]
fn reading_never_changes_the_document() {
    let update = page();
    let doc = CollaborationDoc::default();
    doc.apply(&update).unwrap();
    let before = doc.diff(&[0]).unwrap();
    let _ = doc.read_projection().unwrap();
    assert_eq!(doc.diff(&[0]).unwrap(), before);
}

#[test]
fn an_empty_document_reads_as_no_blocks() {
    let doc = CollaborationDoc::default();
    let got: serde_json::Value = serde_json::from_slice(&doc.read_projection().unwrap()).unwrap();
    assert_eq!(got, serde_json::json!({ "type": "doc", "content": [] }));
}

#[test]
fn the_c_boundary_returns_the_projection() {
    let update = page();
    unsafe {
        let doc = worlds_doc_new();
        assert_eq!(worlds_doc_apply(doc, update.as_ptr(), update.len()), 0);
        let mut out = WorldsBuffer { data: std::ptr::null_mut(), len: 0 };
        assert_eq!(worlds_doc_read_projection(doc, &mut out), 0);
        let json: serde_json::Value = serde_json::from_slice(std::slice::from_raw_parts(out.data, out.len)).unwrap();
        assert_eq!(json["content"][0]["type"], "heading");
        worlds_buffer_free(out);
        assert_eq!(worlds_doc_read_projection(doc, std::ptr::null_mut()), 1);
        worlds_doc_free(doc);
    }
}
