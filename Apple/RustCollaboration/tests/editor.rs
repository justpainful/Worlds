use worlds_collaboration::editor::{prepare_plain_insert, prepare_plain_delete, prepare_basic_mark, project_plain, EditError};
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
#[test]
fn projection_uses_live_yjs_and_rejects_unsupported_content() {
    let doc=Doc::new(); apply(&doc,BASE);
    let first=project_plain(&doc).unwrap();
    assert_eq!(first["content"][0]["attrs"]["bid"],"block-1");
    assert_eq!(first["content"][0]["content"][0]["text"],"Hello 🌍");
    let change=prepare_plain_insert(BASE,0,"block-1","Hello 🌍",6,"world ").unwrap();
    apply(&doc,&change);
    assert_eq!(project_plain(&doc).unwrap()["content"][0]["content"][0]["text"],"Hello world 🌍");
    let rich=Doc::new(); apply(&rich,RICH);
    let projection=project_plain(&rich).unwrap();
    // Expected output from the repository's yXmlFragmentToProsemirrorJSON.
    assert_eq!(projection,serde_json::json!({"type":"doc","content":[{"type":"paragraph","attrs":{"bid":"block-1"},"content":[{"type":"text","text":"Yjs rich text","marks":[{"type":"bold","attrs":true}]}]}]}));
}
#[test]
fn deletion_preserves_unicode_and_merges_with_remote_insert() {
    let deletion=prepare_plain_delete(BASE,0,"block-1","Hello 🌍",6,2).unwrap();
    let insertion=prepare_plain_insert(BASE,0,"block-1","Hello 🌍",0,"Hi ").unwrap();
    let a=Doc::new(); let b=Doc::new(); apply(&a,BASE);apply(&b,BASE);
    apply(&a,&deletion);apply(&a,&insertion);apply(&b,&insertion);apply(&b,&deletion);
    assert_eq!(text(&a),"Hi Hello "); assert_eq!(text(&a),text(&b));
    assert_eq!(prepare_plain_delete(BASE,0,"block-1","Hello 🌍",7,1),Err(EditError::InvalidOffset));
    assert_eq!(prepare_plain_delete(BASE,0,"block-1","Hello 🌍",0,8),Err(EditError::UnsupportedContent));
    assert_eq!(prepare_plain_delete(RICH,0,"block-1","Yjs rich text",0,1),Err(EditError::UnsupportedContent));
}
#[test]
fn basic_mark_formats_range_and_preserves_existing_bold() {
    let update=prepare_basic_mark(RICH,0,"block-1","Yjs rich text",4,4,"italic",true).unwrap();
    let doc=Doc::new(); apply(&doc,RICH); apply(&doc,&update);
    let projection=project_plain(&doc).unwrap();
    let runs=projection["content"][0]["content"].as_array().unwrap();
    assert!(runs.iter().any(|run| run["text"]=="rich" && run["marks"].as_array().unwrap().iter().any(|m|m["type"]=="italic")));
    assert!(runs.iter().all(|run|run["marks"].as_array().unwrap().iter().any(|m|m["type"]=="bold")));
    assert_eq!(prepare_basic_mark(BASE,0,"block-1","Hello 🌍",7,1,"bold",true),Err(EditError::InvalidOffset));
    assert_eq!(prepare_basic_mark(BASE,0,"block-1","Hello 🌍",0,1,"unknown",true),Err(EditError::UnsupportedContent));
}
