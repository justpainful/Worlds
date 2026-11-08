//! Experimental, isolated CRDT text insertion. Not wired to an editor or store.
use yrs::{Any, Doc, GetString, OffsetKind, Options, Out, ReadTxn, StateVector, Text, Transact, Update, Xml, XmlFragment, XmlOut};
use yrs::updates::decoder::Decode;

#[derive(Debug, PartialEq, Eq)]
pub enum EditError { InvalidUpdate, InvalidPath, UnsupportedContent, StaleText, InvalidOffset, TooLarge, ClientIDCollision }

/// Read-only projection for the narrow subset that can be edited safely.
/// Any unsupported node, attribute or mark rejects the entire projection.
pub fn project_plain(doc: &Doc) -> Result<serde_json::Value, EditError> {
    let txn = doc.transact();
    let fragment = txn.get_xml_fragment("default").ok_or(EditError::UnsupportedContent)?;
    if fragment.len(&txn)==0 || fragment.len(&txn)>10_000 { return Err(EditError::UnsupportedContent); }
    let mut seen=std::collections::HashSet::new();
    let mut blocks=Vec::new(); let mut total=0usize;
    for index in 0..fragment.len(&txn) {
        let Some(XmlOut::Element(element))=fragment.get(&txn,index) else { return Err(EditError::UnsupportedContent) };
        if element.tag().as_ref() != "paragraph" || element.len(&txn)!=1 { return Err(EditError::UnsupportedContent) }
        let attrs=element.attributes(&txn).collect::<Vec<_>>();
        if attrs.len()!=1 || attrs[0].0!="bid" { return Err(EditError::UnsupportedContent) }
        let Out::Any(Any::String(ref id))=attrs[0].1 else { return Err(EditError::UnsupportedContent) };
        if id.is_empty() || id.len()>1024 || !seen.insert(id.to_string()) { return Err(EditError::InvalidPath) }
        let Some(XmlOut::Text(text))=element.get(&txn,0) else { return Err(EditError::UnsupportedContent) };
        let mut nodes=Vec::new();
        for part in text.diff(&txn, |_| ()) {
            let Out::Any(Any::String(value))=part.insert else { return Err(EditError::UnsupportedContent) };
            if value.is_empty() || value.contains(['\n','\r','\u{fffc}']) { return Err(EditError::UnsupportedContent) }
            total=total.checked_add(value.len()).ok_or(EditError::TooLarge)?;
            if total>8*1024*1024 { return Err(EditError::TooLarge) }
            let mut node=serde_json::json!({"type":"text","text":value.as_ref()});
            if let Some(attributes)=part.attributes {
                let mut keys=attributes.keys().collect::<Vec<_>>(); keys.sort();
                let mut marks=Vec::new();
                for name in keys {
                    if !matches!(name.as_ref(),"bold"|"italic"|"underline"|"strike") { return Err(EditError::UnsupportedContent) }
                    let mark=&attributes[name];
                    if !matches!(mark,Any::Map(_) | Any::Bool(true)) { return Err(EditError::UnsupportedContent) }
                    if matches!(mark,Any::Map(map) if !map.is_empty()) { return Err(EditError::UnsupportedContent) }
                    let attrs=serde_json::to_value(mark).map_err(|_|EditError::UnsupportedContent)?;
                    marks.push(serde_json::json!({"type":name.as_ref(),"attrs":attrs}));
                }
                if !marks.is_empty() { node["marks"]=serde_json::Value::Array(marks); }
            }
            nodes.push(node);
        }
        if nodes.is_empty() { return Err(EditError::UnsupportedContent) }
        blocks.push(serde_json::json!({"type":"paragraph","attrs":{"bid":id.as_ref()},"content":nodes}));
    }
    Ok(serde_json::json!({"type":"doc","content":blocks}))
}

/// Prepare an insertion on a private replica. The caller must durably append the
/// resulting update before applying it, and must enforce current permissions.
/// Only one plain XmlText in one top-level element is supported.
pub fn prepare_plain_insert(base: &[u8], block_index: u32, block_id: &str, expected: &str, offset_utf16: u32, insert: &str) -> Result<Vec<u8>, EditError> {
    prepare_plain_replace(base,block_index,block_id,expected,offset_utf16,0,insert)
}

pub fn prepare_plain_delete(base: &[u8], block_index: u32, block_id: &str, expected: &str, offset_utf16: u32, delete_utf16: u32) -> Result<Vec<u8>, EditError> {
    if delete_utf16==0 { return Err(EditError::InvalidOffset) }
    prepare_plain_replace(base,block_index,block_id,expected,offset_utf16,delete_utf16,"")
}

fn prepare_plain_replace(base: &[u8], block_index: u32, block_id: &str, expected: &str, offset_utf16: u32, delete_utf16: u32, insert: &str) -> Result<Vec<u8>, EditError> {
    if base.len() > 64 * 1024 * 1024 || insert.len() > 1024 * 1024 { return Err(EditError::TooLarge); }
    if insert.contains(['\n', '\r', '\u{fffc}']) { return Err(EditError::UnsupportedContent); }
    let update = Update::decode_v1(base).map_err(|_| EditError::InvalidUpdate)?;
    let mut options = Options::default();
    options.offset_kind = OffsetKind::Utf16;
    options.skip_gc = true;
    let doc = Doc::with_options(options);
    { doc.transact_mut().apply_update(update).map_err(|_| EditError::InvalidUpdate)?; }
    let fragment = doc.get_or_insert_xml_fragment("default");
    let txn = doc.transact();
    let base_vector: StateVector = txn.state_vector();
    if base_vector.get(&doc.client_id()) != 0 { return Err(EditError::ClientIDCollision); }
    if block_id.is_empty() || block_id.len() > 1024 { return Err(EditError::InvalidPath); }
    let matching = (0..fragment.len(&txn)).filter(|&index| {
        matches!(fragment.get(&txn, index), Some(XmlOut::Element(ref element))
            if matches!(element.get_attribute(&txn, "bid"), Some(Out::Any(Any::String(ref id))) if id.as_ref() == block_id))
    }).collect::<Vec<_>>();
    if matching.as_slice() != [block_index] { return Err(EditError::InvalidPath); }
    let Some(XmlOut::Element(element)) = fragment.get(&txn, block_index) else { return Err(EditError::InvalidPath) };
    if element.tag().as_ref() != "paragraph" || element.len(&txn) != 1 { return Err(EditError::UnsupportedContent); }
    let Some(XmlOut::Text(text)) = element.get(&txn, 0) else { return Err(EditError::UnsupportedContent) };
    let parts = text.diff(&txn, |_| ());
    if parts.iter().any(|part| part.attributes.as_ref().is_some_and(|a| !a.is_empty()) || !matches!(part.insert, Out::Any(Any::String(_)))) { return Err(EditError::UnsupportedContent); }
    let current = text.get_string(&txn);
    if current != expected { return Err(EditError::StaleText); }
    let end=offset_utf16.checked_add(delete_utf16).ok_or(EditError::InvalidOffset)?;
    let mut boundary = 0u32;
    let mut valid_start = offset_utf16 == 0;
    let mut valid_end = end == 0;
    for c in current.chars() {
        boundary += c.len_utf16() as u32;
        if boundary == offset_utf16 { valid_start = true; }
        if boundary == end { valid_end = true; }
    }
    if !valid_start || !valid_end { return Err(EditError::InvalidOffset); }
    if delete_utf16 == boundary && insert.is_empty() { return Err(EditError::UnsupportedContent); }
    drop(txn);
    { let mut txn = doc.transact_mut(); if delete_utf16>0 { text.remove_range(&mut txn, offset_utf16, delete_utf16); } if !insert.is_empty() { text.insert(&mut txn, offset_utf16, insert); } }
    let result = doc.transact().encode_state_as_update_v1(&base_vector);
    Ok(result)
}

/// Format one range without replacing its Yjs text or other format keys.
pub fn prepare_basic_mark(base: &[u8], block_index: u32, block_id: &str, expected: &str, offset: u32, length: u32, mark: &str, enabled: bool) -> Result<Vec<u8>, EditError> {
    if base.len()>64*1024*1024 || length==0 || !matches!(mark,"bold"|"italic"|"underline"|"strike") { return Err(EditError::UnsupportedContent) }
    let mut options=Options::default(); options.offset_kind=OffsetKind::Utf16; options.skip_gc=true;
    let doc=Doc::with_options(options);
    doc.transact_mut().apply_update(Update::decode_v1(base).map_err(|_|EditError::InvalidUpdate)?).map_err(|_|EditError::InvalidUpdate)?;
    let fragment=doc.get_or_insert_xml_fragment("default"); let txn=doc.transact();
    let vector=txn.state_vector();
    if vector.get(&doc.client_id())!=0 { return Err(EditError::ClientIDCollision) }
    let matching=(0..fragment.len(&txn)).filter(|&i| matches!(fragment.get(&txn,i),Some(XmlOut::Element(ref el)) if matches!(el.get_attribute(&txn,"bid"),Some(Out::Any(Any::String(ref id))) if id.as_ref()==block_id))).collect::<Vec<_>>();
    if block_id.is_empty() || matching.as_slice()!=[block_index] { return Err(EditError::InvalidPath) }
    let Some(XmlOut::Element(element))=fragment.get(&txn,block_index) else { return Err(EditError::InvalidPath) };
    if element.tag().as_ref()!="paragraph" || element.len(&txn)!=1 { return Err(EditError::UnsupportedContent) }
    let Some(XmlOut::Text(text))=element.get(&txn,0) else { return Err(EditError::UnsupportedContent) };
    let mut current=String::new();
    for part in text.diff(&txn, |_| ()) {
        let Out::Any(Any::String(value))=part.insert else { return Err(EditError::UnsupportedContent) };
        current.push_str(&value);
        if let Some(attrs)=part.attributes {
            for (name,value) in attrs.iter() {
                if !matches!(name.as_ref(),"bold"|"italic"|"underline"|"strike") || !matches!(value,Any::Map(_) | Any::Bool(true)) { return Err(EditError::UnsupportedContent) }
                if name.as_ref()==mark && matches!(value,Any::Map(map) if !map.is_empty()) { return Err(EditError::UnsupportedContent) }
            }
        }
    }
    if current!=expected { return Err(EditError::StaleText) }
    let end=offset.checked_add(length).ok_or(EditError::InvalidOffset)?;
    let mut pos=0u32; let mut starts=offset==0; let mut ends=end==0;
    for ch in current.chars() { pos+=ch.len_utf16() as u32; if pos==offset { starts=true } if pos==end { ends=true } }
    if !starts || !ends { return Err(EditError::InvalidOffset) }
    drop(txn);
    let value=if enabled { Any::Map(std::sync::Arc::new(std::collections::HashMap::new())) } else { Any::Null };
    let mut attrs=yrs::types::Attrs::new(); attrs.insert(mark.into(),value);
    text.format(&mut doc.transact_mut(),offset,length,attrs);
    Ok(doc.transact().encode_state_as_update_v1(&vector))
}
