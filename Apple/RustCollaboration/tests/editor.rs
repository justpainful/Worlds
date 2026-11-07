use worlds_collaboration::editor::{prepare_plain_insert, EditError};
use yrs::{Doc, GetString, Transact, Update, XmlFragment, XmlOut};
use yrs::updates::decoder::Decode;
const BASE: &[u8] = include_bytes!("fixtures/plain-editor.bin");
const RICH: &[u8] = include_bytes!("fixtures/rich-editor.bin");
fn apply(doc: &Doc, update: &[u8]) { doc.transact_mut().apply_update(Update::decode_v1(update).unwrap()).unwrap(); }
fn text(doc: &Doc) -> String {
    let fragment = doc.get_or_insert_xml_fragment("default");
    let txn = doc.transact();
    let XmlOut::Element(block) = fragment.get(&txn, 0).unwrap() else { panic!() };
    let XmlOut::Text(text) = block.get(&txn, 0).unwrap() else { panic!() };
    text.get_string(&txn)
}
#[test]
fn concurrent_insertions_converge_without_losing_either_edit() {
    let a = prepare_plain_insert(BASE, 0, "block-1", "Hello 🌍", 6, "Alice ").unwrap();
    let b = prepare_plain_insert(BASE, 0, "block-1", "Hello 🌍", 6, "Bob ").unwrap();
    let one = Doc::new(); let two = Doc::new();
    apply(&one, BASE); apply(&two, BASE);
    apply(&one, &a); apply(&one, &b); apply(&two, &b); apply(&two, &a);
    let first = text(&one); let second = text(&two);
    assert_eq!(first, second); assert!(first.contains("Alice ")); assert!(first.contains("Bob "));
    assert!(first.starts_with("Hello ")); assert!(first.ends_with('🌍'));
}
#[test]
fn rejects_stale_content_surrogate_boundaries_and_rich_formatting() {
    assert_eq!(prepare_plain_insert(BASE, 0, "block-1", "stale", 0, "x"), Err(EditError::StaleText));
    assert_eq!(prepare_plain_insert(BASE, 0, "block-1", "Hello 🌍", 7, "x"), Err(EditError::InvalidOffset));
    assert_eq!(prepare_plain_insert(RICH, 0, "block-1", "Yjs rich text", 0, "x"), Err(EditError::UnsupportedContent));
    assert_eq!(prepare_plain_insert(BASE, 1, "block-1", "Hello 🌍", 0, "x"), Err(EditError::InvalidPath));
}
