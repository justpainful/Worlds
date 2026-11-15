//! Read-only projection of a page's whole block tree as Tiptap JSON.
//!
//! Unlike `editor::project_plain`, which accepts only the narrow subset that
//! can be edited safely, this reads every element, attribute and mark so a
//! viewer can show any page. It never writes to the document. The shape
//! matches Android's reader (Android/core/sync/native/src/editor.rs, `read`).
use serde_json::{Map, Value, json};
use yrs::types::ToJson;
use yrs::{Doc, Out, ReadTxn, Text, Transact, Xml, XmlFragment, XmlOut};

const MAX_DEPTH: usize = 128;
const MAX_NODES: usize = 100_000;

fn value(out: &Out, txn: &impl ReadTxn) -> Result<Value, &'static str> {
    let mut text = String::new();
    out.to_json(txn).to_json(&mut text);
    serde_json::from_str(&text).map_err(|_| "attribute is not JSON")
}

/// Tiptap mark names can carry a `--<id>` suffix when several marks of one
/// type overlap; the suffix is not part of the mark's type.
fn mark_name(name: &str) -> &str {
    let bytes = name.as_bytes();
    if bytes.len() >= 10 {
        let at = bytes.len() - 10;
        if &bytes[at..at + 2] == b"--" && bytes[at + 2..].iter().all(|b| b.is_ascii_alphanumeric() || b"+/=".contains(b)) {
            return &name[..at];
        }
    }
    name
}

fn node(out: XmlOut, txn: &impl ReadTxn, depth: usize, count: &mut usize) -> Result<Vec<Value>, &'static str> {
    *count += 1;
    if depth > MAX_DEPTH || *count > MAX_NODES { return Err("document structure exceeds limit"); }
    match out {
        XmlOut::Element(element) => {
            let mut object = Map::new();
            object.insert("type".into(), json!(element.tag().as_ref()));
            let mut attrs = Map::new();
            for (name, item) in element.attributes(txn) { attrs.insert(name.to_string(), value(&item, txn)?); }
            if !attrs.is_empty() { object.insert("attrs".into(), Value::Object(attrs)); }
            let mut content = Vec::new();
            for child in element.children(txn) { content.extend(node(child, txn, depth + 1, count)?); }
            if !content.is_empty() { object.insert("content".into(), Value::Array(content)); }
            Ok(vec![Value::Object(object)])
        }
        XmlOut::Text(text) => {
            let mut result = Vec::new();
            for segment in text.diff(txn, |_| ()) {
                // Embedded objects inside text are skipped rather than failing the page.
                let Out::Any(yrs::Any::String(part)) = segment.insert else { continue };
                let mut item = Map::new();
                item.insert("type".into(), json!("text"));
                item.insert("text".into(), json!(part.as_ref()));
                if let Some(attributes) = segment.attributes {
                    let mut marks = Vec::new();
                    for (name, mark) in attributes.iter() {
                        let mut raw = String::new();
                        mark.to_json(&mut raw);
                        let attrs: Value = serde_json::from_str(&raw).map_err(|_| "mark is not JSON")?;
                        marks.push(json!({ "type": mark_name(name), "attrs": attrs }));
                    }
                    if !marks.is_empty() { item.insert("marks".into(), Value::Array(marks)); }
                }
                result.push(Value::Object(item));
            }
            Ok(result)
        }
        XmlOut::Fragment(_) => Ok(Vec::new()),
    }
}

/// `{"type":"doc","content":[...]}` for the page's `default` fragment. A page
/// with no blocks yet reads as an empty document.
pub fn read_projection(doc: &Doc) -> Result<Value, &'static str> {
    let txn = doc.transact();
    let Some(fragment) = txn.get_xml_fragment("default") else { return Ok(json!({ "type": "doc", "content": [] })) };
    let mut blocks = Vec::new();
    let mut count = 0;
    for child in fragment.children(&txn) { blocks.extend(node(child, &txn, 0, &mut count)?); }
    Ok(json!({ "type": "doc", "content": blocks }))
}
