//! Experimental, isolated CRDT text insertion. Not wired to an editor or store.
use yrs::{Any, Doc, GetString, OffsetKind, Options, Out, ReadTxn, StateVector, Text, Transact, Update, Xml, XmlFragment, XmlOut};
use yrs::updates::decoder::Decode;

#[derive(Debug, PartialEq, Eq)]
pub enum EditError { InvalidUpdate, InvalidPath, UnsupportedContent, StaleText, InvalidOffset, TooLarge, ClientIDCollision }

/// Prepare an insertion on a private replica. The caller must durably append the
/// resulting update before applying it, and must enforce current permissions.
/// Only one plain XmlText in one top-level element is supported.
pub fn prepare_plain_insert(base: &[u8], block_index: u32, block_id: &str, expected: &str, offset_utf16: u32, insert: &str) -> Result<Vec<u8>, EditError> {
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
    if element.len(&txn) != 1 { return Err(EditError::UnsupportedContent); }
    let Some(XmlOut::Text(text)) = element.get(&txn, 0) else { return Err(EditError::UnsupportedContent) };
    let parts = text.diff(&txn, |_| ());
    if parts.iter().any(|part| part.attributes.as_ref().is_some_and(|a| !a.is_empty()) || !matches!(part.insert, Out::Any(Any::String(_)))) { return Err(EditError::UnsupportedContent); }
    let current = text.get_string(&txn);
    if current != expected { return Err(EditError::StaleText); }
    let mut boundary = 0u32;
    let mut valid = offset_utf16 == 0;
    for c in current.chars() {
        boundary += c.len_utf16() as u32;
        if boundary == offset_utf16 { valid = true; }
    }
    if !valid { return Err(EditError::InvalidOffset); }
    drop(txn);
    { let mut txn = doc.transact_mut(); text.insert(&mut txn, offset_utf16, insert); }
    let result = doc.transact().encode_state_as_update_v1(&base_vector);
    Ok(result)
}
