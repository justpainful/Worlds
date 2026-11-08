use serde_json::{json, Map, Value};
use yrs::{Out, ReadTxn, Text, Transact, Xml, XmlElementPrelim, XmlFragment, XmlOut, XmlTextPrelim};
use yrs::types::ToJson;

fn value(out: &Out, txn: &impl ReadTxn) -> Result<Value, String> {
    let mut json = String::new();
    out.to_json(txn).to_json(&mut json);
    serde_json::from_str(&json).map_err(|e| e.to_string())
}

fn mark_name(s: &str) -> &str {
    let bytes = s.as_bytes();
    if bytes.len() >= 10 {
        let pos = bytes.len() - 10;
        if &bytes[pos..pos + 2] == b"--" && bytes[pos + 2..].iter().all(|b| b.is_ascii_alphanumeric() || b"+/=".contains(b)) {
            return &s[..pos];
        }
    }
    s
}

fn node(out: XmlOut, txn: &impl ReadTxn, depth: usize, count: &mut usize) -> Result<Vec<Value>, String> {
    *count += 1;
    if depth > 128 || *count > 100_000 { return Err("Document structure exceeds limit".into()); }
    match out {
        XmlOut::Element(element) => {
            let mut object = Map::new();
            object.insert("type".into(), json!(element.tag().as_ref()));
            let mut attrs = Map::new();
            for (name, item) in element.attributes(txn) { attrs.insert(name.into(), value(&item, txn)?); }
            if !attrs.is_empty() { object.insert("attrs".into(), Value::Object(attrs)); }
            let children: Vec<_> = element.children(txn).collect();
            if !children.is_empty() {
                let mut content = Vec::new();
                for child in children { content.extend(node(child, txn, depth + 1, count)?); }
                object.insert("content".into(), Value::Array(content));
            }
            Ok(vec![Value::Object(object)])
        }
        XmlOut::Text(text) => {
            let mut result = Vec::new();
            for segment in text.diff(txn, |_| ()) {
                let text = match segment.insert { Out::Any(yrs::Any::String(text)) => text.to_string(), _ => return Err("Embedded Yjs text objects are unsupported".into()) };
                let mut item = Map::new();
                item.insert("type".into(), json!("text")); item.insert("text".into(), json!(text));
                if let Some(attrs) = segment.attributes {
                    let mut marks = Vec::new();
                    for (name, attributes) in attrs.iter() {
                        let mut raw = String::new(); attributes.to_json(&mut raw);
                        let mut mark = Map::new();
                        mark.insert("type".into(), json!(mark_name(name)));
                        mark.insert("attrs".into(), serde_json::from_str(&raw).map_err(|e: serde_json::Error| e.to_string())?);
                        marks.push(Value::Object(mark));
                    }
                    if !marks.is_empty() { item.insert("marks".into(), Value::Array(marks)); }
                }
                result.push(Value::Object(item));
            }
            Ok(result)
        }
        XmlOut::Fragment(_) => Err("Nested fragment is unsupported".into()),
    }
}

pub fn read(snapshot: &[u8]) -> Result<Vec<u8>, String> {
    let doc = super::load(snapshot)?;
    let fragment = doc.get_or_insert_xml_fragment("default");
    let txn = doc.transact();
    let mut blocks = Vec::new(); let mut count = 0;
    for child in fragment.children(&txn) { blocks.extend(node(child, &txn, 0, &mut count)?); }
    serde_json::to_vec(&json!({"type": "doc", "content": blocks})).map_err(|e| e.to_string())
}

/// Append a top-level paragraph using the same XML and block-id shape as Worlds.
pub fn append_paragraph(snapshot: &[u8], request: &[u8]) -> Result<Vec<u8>, String> {
    let input: Value = serde_json::from_slice(request).map_err(|e| e.to_string())?;
    let bid = input["bid"].as_str().filter(|s| !s.is_empty() && s.len() <= 128).ok_or("Invalid block id")?;
    let text = input["text"].as_str().filter(|s| !s.is_empty() && s.len() <= 1_000_000).ok_or("Invalid text")?;
    let doc = super::load(snapshot)?;
    let fragment = doc.get_or_insert_xml_fragment("default");
    let vector = doc.transact().state_vector();
    let mut txn = doc.transact_mut();
    for child in fragment.children(&txn) {
        if let XmlOut::Element(element) = child {
            if matches!(element.get_attribute(&txn, "bid"), Some(Out::Any(yrs::Any::String(id))) if id.as_ref() == bid) {
                return Err("Duplicate block id".into());
            }
        }
    }
    let element = fragment.push_back(&mut txn, XmlElementPrelim::empty("paragraph"));
    element.insert_attribute(&mut txn, "bid", bid);
    element.push_back(&mut txn, XmlTextPrelim::new(text));
    drop(txn);
    let update = doc.transact().encode_state_as_update_v1(&vector);
    Ok(update)
}

pub fn block_identity(snapshot: &[u8], bid: &[u8]) -> Result<Vec<u8>, String> {
    let bid = std::str::from_utf8(bid).map_err(|e| e.to_string())?;
    if bid.is_empty() { return Err("Invalid block id".into()); }
    let doc = super::load(snapshot)?;
    let fragment = doc.get_or_insert_xml_fragment("default");
    let txn = doc.transact();
    let mut found = None;
    for child in fragment.children(&txn) {
        if let XmlOut::Element(element) = &child {
            if matches!(element.get_attribute(&txn, "bid"), Some(Out::Any(yrs::Any::String(id))) if id.as_ref() == bid) {
                if found.is_some() { return Err("Duplicate block id".into()); }
                found = Some(format!("{:?}", child.id()).into_bytes());
            }
        }
    }
    found.ok_or_else(|| "Missing block".into())
}

/// Edit one XmlText identified by a path of Yjs child indices. Offsets are UTF-16 units.
pub fn replace_text(snapshot: &[u8], request: &[u8]) -> Result<Vec<u8>, String> {
    let input: Value = serde_json::from_slice(request).map_err(|e| e.to_string())?;
    let path = input["path"].as_array().ok_or("Invalid path")?;
    if path.is_empty() || path.len() > 128 { return Err("Invalid path".into()); }
    let start = input["start"].as_u64().and_then(|v| u32::try_from(v).ok()).ok_or("Invalid start")?;
    let end = input["end"].as_u64().and_then(|v| u32::try_from(v).ok()).ok_or("Invalid end")?;
    let insert = input["text"].as_str().ok_or("Invalid text")?;
    let doc = super::load(snapshot)?;
    let fragment = doc.get_or_insert_xml_fragment("default");
    let vector = doc.transact().state_vector();
    let mut txn = doc.transact_mut();
    let mut current = None;
    for (i, index) in path.iter().enumerate() {
        let index = index.as_u64().and_then(|v| u32::try_from(v).ok()).ok_or("Invalid index")?;
        current = Some(if i == 0 { fragment.get(&txn, index).ok_or("Missing node")? } else {
            match current.take().ok_or("Missing parent")? {
                XmlOut::Element(element) => element.get(&txn, index).ok_or("Missing node")?,
                _ => return Err("Parent is not an element".into()),
            }
        });
    }
    let text = match current.ok_or("Missing text")? { XmlOut::Text(text) => text, _ => return Err("Node is not text".into()) };
    let segments = text.diff(&txn, |_| ());
    let mut original = String::new();
    for segment in &segments {
        match &segment.insert { Out::Any(yrs::Any::String(s)) => original.push_str(s), _ => return Err("Embedded text objects are unsupported".into()) }
    }
    let mut offsets = vec![0u32];
    for c in original.chars() { offsets.push(offsets.last().unwrap() + c.len_utf16() as u32); }
    if start > end || !offsets.contains(&start) || !offsets.contains(&end) { return Err("Invalid UTF-16 range".into()); }
    let mut inherited = None;
    let mut next = None;
    let mut pos = 0;
    for segment in segments {
        let len = match segment.insert { Out::Any(yrs::Any::String(s)) => s.encode_utf16().count() as u32, _ => return Err("Embedded text objects are unsupported".into()) };
        if pos < start && pos + len >= start { inherited = Some(segment.attributes.clone()); }
        if next.is_none() && pos >= start { next = Some(segment.attributes); }
        pos += len;
    }
    if end > start { text.remove_range(&mut txn, start, end - start); }
    if !insert.is_empty() {
        let attrs = inherited.or(next).flatten().map(|a| *a).unwrap_or_default();
        text.insert_with_attributes(&mut txn, start, insert, attrs);
    }
    drop(txn);
    let update = doc.transact().encode_state_as_update_v1(&vector);
    Ok(update)
}

/// Edit the direct text children of one top-level paragraph or heading identified by bid.
pub fn replace_block_text(snapshot: &[u8], request: &[u8]) -> Result<Vec<u8>, String> {
    let input: Value = serde_json::from_slice(request).map_err(|e| e.to_string())?;
    let bid = input["bid"].as_str().filter(|s| !s.is_empty()).ok_or("Invalid block id")?;
    let start = input["start"].as_u64().and_then(|v| u32::try_from(v).ok()).ok_or("Invalid start")?;
    let end = input["end"].as_u64().and_then(|v| u32::try_from(v).ok()).ok_or("Invalid end")?;
    let inserted = input["text"].as_str().ok_or("Invalid text")?;
    let doc = super::load(snapshot)?;
    let fragment = doc.get_or_insert_xml_fragment("default");
    let vector = doc.transact().state_vector();
    let mut txn = doc.transact_mut();
    let mut found = None;
    for child in fragment.children(&txn) {
        if let XmlOut::Element(element) = child {
            if matches!(element.get_attribute(&txn, "bid"), Some(Out::Any(yrs::Any::String(id))) if id.as_ref() == bid) {
                if found.is_some() { return Err("Duplicate block id".into()); }
                found = Some(element);
            }
        }
    }
    let block = found.ok_or("Missing block")?;
    if !matches!(block.tag().as_ref(), "paragraph" | "heading") { return Err("Unsupported block type".into()); }
    let mut texts = Vec::new();
    let mut whole = String::new();
    for child in block.children(&txn) {
        let text = match child { XmlOut::Text(text) => text, _ => return Err("Unsupported inline node".into()) };
        let segments = text.diff(&txn, |_| ());
        let mut content = String::new();
        for segment in &segments {
            match &segment.insert { Out::Any(yrs::Any::String(s)) => content.push_str(s), _ => return Err("Unsupported embedded object".into()) }
        }
        whole.push_str(&content);
        texts.push((text, content, segments));
    }
    let mut offsets = vec![0u32];
    for c in whole.chars() { offsets.push(offsets.last().unwrap() + c.len_utf16() as u32); }
    if start > end || !offsets.contains(&start) || !offsets.contains(&end) { return Err("Invalid UTF-16 range".into()); }
    if texts.is_empty() && !inserted.is_empty() {
        block.insert(&mut txn, 0, XmlTextPrelim::new(inserted));
    } else if !texts.is_empty() {
        let mut bases = Vec::new(); let mut pos = 0u32;
        for (_, text, _) in &texts { bases.push(pos); pos += text.encode_utf16().count() as u32; }
        let target = texts.iter().enumerate().position(|(i, (_, text, _))| start <= bases[i] + text.encode_utf16().count() as u32).unwrap_or(texts.len() - 1);
        let local_start = start - bases[target];
        let mut before = None; let mut after = None; let mut cursor = 0u32;
        for (_, _, segments) in &texts {
            for segment in segments {
                let len = match &segment.insert { Out::Any(yrs::Any::String(s)) => s.encode_utf16().count() as u32, _ => unreachable!() };
                if cursor < start && cursor + len >= start { before = Some(segment.attributes.clone()); }
                if after.is_none() && cursor >= start { after = Some(segment.attributes.clone()); }
                cursor += len;
            }
        }
        for i in (0..texts.len()).rev() {
            let len = texts[i].1.encode_utf16().count() as u32;
            let from = start.saturating_sub(bases[i]).min(len);
            let to = end.saturating_sub(bases[i]).min(len);
            if to > from { texts[i].0.remove_range(&mut txn, from, to - from); }
        }
        if !inserted.is_empty() {
            let attrs = before.or(after).flatten().map(|a| *a).unwrap_or_default();
            texts[target].0.insert_with_attributes(&mut txn, local_start, inserted, attrs);
        }
    }
    drop(txn);
    let update = doc.transact().encode_state_as_update_v1(&vector);
    Ok(update)
}
