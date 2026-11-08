use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;
use yrs::types::Attrs;
use yrs::{Any, Out, ReadTxn, StateVector, Text, Transact, TransactionMut, Xml, XmlElementPrelim, XmlFragment, XmlOut, XmlTextPrelim, XmlTextRef};

#[derive(Clone, Debug, PartialEq)]
enum Node {
    Element { tag: String, attrs: BTreeMap<String, Any>, children: Vec<Node> },
    Text { attrs: BTreeMap<String, Any>, runs: Vec<(String, Attrs)> },
}

fn attributes(xml: &impl Xml, txn: &impl ReadTxn) -> Result<BTreeMap<String, Any>, String> {
    xml.attributes(txn).map(|(key, value)| match value {
        Out::Any(value) => Ok((key.to_owned(), value)),
        _ => Err("Shared XML attributes are not supported".into()),
    }).collect()
}
fn collect(node: XmlOut, txn: &impl ReadTxn, depth: usize, count: &mut usize) -> Result<Node, String> {
    *count += 1;
    if depth > 128 || *count > 100_000 { return Err("Document structure exceeds limit".into()); }
    match node {
        XmlOut::Element(element) => Ok(Node::Element { tag: element.tag().to_string(), attrs: attributes(&element, txn)?,
            children: element.children(txn).map(|child| collect(child, txn, depth + 1, count)).collect::<Result<_, _>>()? }),
        XmlOut::Text(text) => {
            let mut runs = Vec::new();
            for item in text.diff(txn, |_| ()) {
                let string = match item.insert { Out::Any(Any::String(s)) => s.to_string(), _ => return Err("Embedded objects in text are not supported".into()) };
                runs.push((string, item.attributes.map(|a| *a).unwrap_or_default()));
            }
            Ok(Node::Text { attrs: attributes(&text, txn)?, runs })
        }
        XmlOut::Fragment(_) => Err("Nested XML fragment is not supported".into()),
    }
}
fn children(parent: &impl XmlFragment, txn: &impl ReadTxn) -> Result<Vec<Node>, String> {
    let mut count = 0;
    parent.children(txn).map(|child| collect(child, txn, 0, &mut count)).collect()
}
fn sync_attrs(xml: &impl Xml, txn: &mut TransactionMut, desired: &BTreeMap<String, Any>) -> Result<(), String> {
    let current = attributes(xml, txn)?;
    for key in current.keys() { if !desired.contains_key(key) { xml.remove_attribute(txn, key); } }
    for (key, value) in desired { if current.get(key) != Some(value) { xml.insert_attribute(txn, key.clone(), value.clone()); } }
    Ok(())
}
fn text_string(runs: &[(String, Attrs)]) -> String { runs.iter().map(|(s, _)| s.as_str()).collect() }
fn text_diff(text: &XmlTextRef, txn: &mut TransactionMut, desired: &[(String, Attrs)]) -> Result<(), String> {
    let existing = collect(XmlOut::Text(text.clone()), txn, 0, &mut 0)?;
    let current = match existing { Node::Text { runs, .. } => runs, _ => unreachable!() };
    if current == desired { return Ok(()); }
    let a = text_string(&current); let b = text_string(desired);
    let ac: Vec<char> = a.chars().collect(); let bc: Vec<char> = b.chars().collect();
    let mut prefix = 0; while prefix < ac.len() && prefix < bc.len() && ac[prefix] == bc[prefix] { prefix += 1; }
    let mut suffix = 0; while suffix < ac.len() - prefix && suffix < bc.len() - prefix && ac[ac.len()-1-suffix] == bc[bc.len()-1-suffix] { suffix += 1; }
    let units = |v: &[char]| -> u32 { v.iter().map(|c| c.len_utf16() as u32).sum() };
    let at = units(&ac[..prefix]); let end = units(&ac[..ac.len()-suffix]);
    if end > at { text.remove_range(txn, at, end - at); }
    let insert: String = bc[prefix..bc.len()-suffix].iter().collect();
    if !insert.is_empty() { text.insert(txn, at, &insert); }
    // Reapply target formatting, removing keys that are absent from each target run.
    // Formatting existing text keeps its Yjs identity rather than replacing the node.
    let mut keys: BTreeSet<Arc<str>> = BTreeSet::new();
    for (_, attrs) in current.iter().chain(desired.iter()) { keys.extend(attrs.keys().cloned()); }
    let mut offset = 0u32;
    for (chunk, attrs) in desired {
        let len = chunk.encode_utf16().count() as u32;
        if len > 0 && !keys.is_empty() {
            let mut format = Attrs::new();
            for key in &keys { format.insert(key.clone(), attrs.get(key).cloned().unwrap_or(Any::Null)); }
            text.format(txn, offset, len, format);
        }
        offset += len;
    }
    Ok(())
}
fn compatible(existing: &XmlOut, desired: &Node, txn: &impl ReadTxn) -> bool {
    match (existing, desired) {
        (XmlOut::Text(_), Node::Text { .. }) => true,
        (XmlOut::Element(element), Node::Element { tag, attrs, .. }) => {
            if element.tag().as_ref() != tag { return false; }
            let current = element.get_attribute(txn, "bid");
            match (current, attrs.get("bid")) {
                (Some(Out::Any(a)), Some(b)) => a == *b,
                (None, None) => true,
                _ => false,
            }
        }
        _ => false,
    }
}
fn build(parent: &impl XmlFragment, txn: &mut TransactionMut, index: u32, desired: &Node) -> Result<(), String> {
    match desired {
        Node::Element { tag, attrs, children } => {
            let element = parent.insert(txn, index, XmlElementPrelim::empty(tag.clone()));
            sync_attrs(&element, txn, attrs)?;
            for (i, child) in children.iter().enumerate() { build(&element, txn, i as u32, child)?; }
        }
        Node::Text { attrs, runs } => {
            let text = parent.insert(txn, index, XmlTextPrelim::new(""));
            sync_attrs(&text, txn, attrs)?;
            let mut offset = 0;
            for (chunk, marks) in runs { if !chunk.is_empty() { text.insert_with_attributes(txn, offset, chunk, marks.clone()); offset += chunk.encode_utf16().count() as u32; } }
        }
    }
    Ok(())
}
fn reconcile(parent: &impl XmlFragment, txn: &mut TransactionMut, desired: &[Node]) -> Result<(), String> {
    fn unique_ids(nodes: &[Node]) -> Result<(), String> {
        let mut seen = BTreeSet::new();
        for node in nodes {
            if let Node::Element { attrs, .. } = node {
                if let Some(Any::String(id)) = attrs.get("bid") {
                    if !seen.insert(id.clone()) { return Err("Duplicate block identity".into()); }
                }
            }
        }
        Ok(())
    }
    let current = children(parent, txn)?;
    unique_ids(desired)?; unique_ids(&current)?;
    // Yjs cannot move an integrated node. Deleting and recreating a reordered
    // block can hide an unseen concurrent edit; reject until it can be preserved.
    fn ids(nodes: &[Node]) -> Vec<Arc<str>> {
        nodes.iter().filter_map(|node| match node {
            Node::Element { attrs, .. } => match attrs.get("bid") { Some(Any::String(id)) => Some(id.clone()), _ => None },
            _ => None,
        }).collect()
    }
    // Unkeyed siblings have no stable product identity. Detect exact permutations
    // before editing them in place, which can attach another user's typing to a
    // different list item. Bound the comparison to avoid quadratic work on huge lists.
    let unkeyed = |node: &Node| matches!(node, Node::Element { attrs, .. } if !matches!(attrs.get("bid"), Some(Any::String(_))));
    let old_unkeyed: Vec<_> = desired.iter().filter(|n| unkeyed(n)).collect();
    let live_unkeyed: Vec<_> = current.iter().filter(|n| unkeyed(n)).collect();
    if old_unkeyed.len().max(live_unkeyed.len()) > 256 && old_unkeyed != live_unkeyed {
        return Err("Large unkeyed sibling changes require conflict-safe restoration".into());
    }
    let mut last = None;
    for node in &old_unkeyed {
        if old_unkeyed.iter().filter(|other| *other == node).count() != 1 { continue; }
        let matches: Vec<_> = live_unkeyed.iter().enumerate().filter(|(_, other)| *other == node).map(|(i, _)| i).collect();
        if matches.len() == 1 {
            if last.is_some_and(|previous| matches[0] < previous) { return Err("Reordered blocks require conflict-safe restoration".into()); }
            last = Some(matches[0]);
        }
    }
    let old_ids = ids(desired); let live_ids = ids(&current);
    let live_set: BTreeSet<_> = live_ids.iter().cloned().collect();
    let shared: BTreeSet<_> = old_ids.iter().filter(|id| live_set.contains(*id)).cloned().collect();
    if old_ids.iter().filter(|id| shared.contains(*id)).ne(live_ids.iter().filter(|id| shared.contains(*id))) {
        return Err("Reordered blocks require conflict-safe restoration".into());
    }
    // Match y-tiptap: retain the only text node when the version is empty.
    // A concurrent insertion into that node must remain reachable after merge.
    if desired.is_empty() && parent.len(txn) == 1 {
        if let Some(XmlOut::Text(text)) = parent.get(txn, 0) {
            let len = text.len(txn);
            if len > 0 { text.remove_range(txn, 0, len); }
            return Ok(());
        }
    }
    for (index, node) in desired.iter().enumerate() {
        let index = index as u32;
        let mut existing = parent.get(txn, index);
        if existing.as_ref().is_some_and(|value| !compatible(value, node, txn)) {
            let found = ((index + 1)..parent.len(txn)).find(|&i| parent.get(txn, i).is_some_and(|value| compatible(&value, node, txn)));
            if let Some(position) = found {
                parent.remove_range(txn, index, position - index);
                existing = parent.get(txn, index);
            } else {
                // The version contains a missing node. Insert it before the current node;
                // deleting that current node would discard edits in an unchanged later block.
                build(parent, txn, index, node)?;
                continue;
            }
        }
        if let Some(existing) = existing {
            match (existing, node) {
                (XmlOut::Element(element), Node::Element { attrs, children, .. }) => { sync_attrs(&element, txn, attrs)?; reconcile(&element, txn, children)?; }
                (XmlOut::Text(text), Node::Text { attrs, runs }) => { sync_attrs(&text, txn, attrs)?; text_diff(&text, txn, runs)?; }
                _ => return Err("Unexpected XML node".into()),
            }
        } else { build(parent, txn, index, node)?; }
    }
    let remaining = parent.len(txn).saturating_sub(desired.len() as u32);
    if remaining > 0 { parent.remove_range(txn, desired.len() as u32, remaining); }
    Ok(())
}

fn block_parents(root: &impl XmlFragment, txn: &impl ReadTxn) -> Result<BTreeMap<String, Vec<String>>, String> {
    fn visit(parent: &impl XmlFragment, txn: &impl ReadTxn, path: &mut Vec<String>, result: &mut BTreeMap<String, Vec<String>>, depth: usize, count: &mut usize) -> Result<(), String> {
        if depth > 128 { return Err("Document structure exceeds limit".into()); }
        for child in parent.children(txn) {
            *count += 1; if *count > 100_000 { return Err("Document structure exceeds limit".into()); }
            if let XmlOut::Element(element) = child {
                if let Some(Out::Any(Any::String(id))) = element.get_attribute(txn, "bid") {
                    if result.insert(id.to_string(), path.clone()).is_some() { return Err("Duplicate block identity".into()); }
                }
                path.push(format!("{:?}", XmlOut::Element(element.clone()).id()));
                visit(&element, txn, path, result, depth + 1, count)?;
                path.pop();
            }
        }
        Ok(())
    }
    let mut result = BTreeMap::new();
    visit(root, txn, &mut Vec::new(), &mut result, 0, &mut 0)?;
    Ok(result)
}

fn normalize_marks(value: &mut serde_json::Value) {
    match value {
        serde_json::Value::Object(map) => {
            for child in map.values_mut() { normalize_marks(child); }
            if let Some(serde_json::Value::Array(marks)) = map.get_mut("marks") {
                marks.sort_by_key(|mark| serde_json::to_string(mark).unwrap_or_default());
            }
            if matches!(map.get("content"), Some(serde_json::Value::Array(items)) if items.is_empty()) { map.remove("content"); }
        }
        serde_json::Value::Array(items) => for item in items { normalize_marks(item); },
        _ => (),
    }
}

/// Produce an ordinary Yjs update from current content to the version content.
/// Other Yjs root types are not changed. Unsupported embedded values fail closed.
pub fn restore(current: &[u8], old: &[u8]) -> Result<Vec<u8>, String> {
    let old_doc = super::load(old)?; let old_root = old_doc.get_or_insert_xml_fragment("default");
    let (desired, old_parents) = { let txn = old_doc.transact(); if txn.has_missing_updates() { return Err("Version has missing updates".into()); } (children(&old_root, &txn)?, block_parents(&old_root, &txn)?) };
    let doc = super::load(current)?; let root = doc.get_or_insert_xml_fragment("default");
    let vector = { let txn = doc.transact();
        if txn.has_missing_updates() { return Err("Current document has missing updates".into()); }
        let current_parents = block_parents(&root, &txn)?;
        for (id, old_parent) in &old_parents {
            if current_parents.get(id).is_some_and(|parent| parent != old_parent) { return Err("Moved blocks require conflict-safe restoration".into()); }
        }
        txn.state_vector()
    };
    { let mut txn = doc.transact_mut(); reconcile(&root, &mut txn, &desired)?; }
    let state = doc.transact().encode_state_as_update_v1(&StateVector::default());
    let mut actual: serde_json::Value = serde_json::from_slice(&super::editor::read(&state)?).map_err(|e| e.to_string())?;
    let mut target: serde_json::Value = serde_json::from_slice(&super::editor::read(old)?).map_err(|e| e.to_string())?;
    normalize_marks(&mut actual); normalize_marks(&mut target);
    if actual != target { return Err("Restore does not match version".into()); }
    let update = doc.transact().encode_state_as_update_v1(&vector);
    Ok(update)
}

#[cfg(test)]
mod tests {
    use super::*;
    use yrs::{Doc, Map, StateVector};
    fn bytes(doc: &Doc) -> Vec<u8> { doc.transact().encode_state_as_update_v1(&StateVector::default()) }
    fn fixture() -> Vec<u8> {
        let doc = super::super::load(&[]).unwrap(); let root = doc.get_or_insert_xml_fragment("default"); let other = doc.get_or_insert_map("unrelated");
        {
            let mut txn = doc.transact_mut();
            let p = root.push_back(&mut txn, XmlElementPrelim::empty("paragraph"));
            p.insert_attribute(&mut txn, "bid", "a"); p.insert_attribute(&mut txn, "level", 2i64);
            let t = p.push_back(&mut txn, XmlTextPrelim::new(""));
            let mut bold = Attrs::new(); bold.insert("bold".into(), Any::from(true));
            t.insert_with_attributes(&mut txn, 0, "hello😀", bold);
            let p2 = root.push_back(&mut txn, XmlElementPrelim::empty("paragraph"));
            p2.insert_attribute(&mut txn, "bid", "b");
            p2.push_back(&mut txn, XmlTextPrelim::new("second"));
            other.insert(&mut txn, "keep", "yes");
        }
        bytes(&doc)
    }
    #[test]
    fn restores_nested_content_marks_and_typed_attributes_preserving_other_roots() {
        let old = fixture(); let doc = super::super::load(&old).unwrap(); let root = doc.get_or_insert_xml_fragment("default");
        {
            let mut txn = doc.transact_mut();
            let p = match root.get(&txn, 0).unwrap() { XmlOut::Element(p) => p, _ => panic!() };
            p.insert_attribute(&mut txn, "level", 4i64);
            let t = match p.get(&txn, 0).unwrap() { XmlOut::Text(t) => t, _ => panic!() };
            t.insert(&mut txn, 0, "changed ");
            root.remove(&mut txn, 1);
            let added = root.push_back(&mut txn, XmlElementPrelim::empty("heading"));
            added.insert_attribute(&mut txn, "bid", "new"); added.push_back(&mut txn, XmlTextPrelim::new("later"));
        }
        let current = bytes(&doc);
        let identity = super::super::editor::block_identity(&current, b"a").unwrap();
        let update = restore(&current, &old).unwrap();
        let merged = super::super::merge(&current, &update).unwrap();
        assert_eq!(super::super::editor::read(&merged).unwrap(), super::super::editor::read(&old).unwrap());
        assert_eq!(identity, super::super::editor::block_identity(&merged, b"a").unwrap());
        let restored = super::super::load(&merged).unwrap();
        assert!(matches!(restored.get_or_insert_map("unrelated").get(&restored.transact(), "keep"), Some(Out::Any(Any::String(v))) if v.as_ref() == "yes"));
    }
    #[test]
    fn refuses_exact_reorder_of_distinct_unkeyed_list_items() {
        let initial = super::super::load(&[]).unwrap(); let root = initial.get_or_insert_xml_fragment("default");
        { let mut txn = initial.transact_mut(); let list = root.push_back(&mut txn, XmlElementPrelim::empty("bulletList"));
          list.insert_attribute(&mut txn, "bid", "list");
          for label in ["one", "two"] { let item = list.push_back(&mut txn, XmlElementPrelim::empty("listItem")); item.push_back(&mut txn, XmlTextPrelim::new(label)); } }
        let old = bytes(&initial); let current = super::super::load(&old).unwrap(); let root = current.get_or_insert_xml_fragment("default");
        { let mut txn = current.transact_mut(); let list = match root.get(&txn, 0).unwrap() { XmlOut::Element(e) => e, _ => panic!() };
          list.remove(&mut txn, 0); let item = list.push_back(&mut txn, XmlElementPrelim::empty("listItem")); item.push_back(&mut txn, XmlTextPrelim::new("one")); }
        assert!(restore(&bytes(&current), &old).unwrap_err().contains("Reordered blocks"));
    }
    #[test]
    fn refuses_moving_existing_block_between_unkeyed_containers() {
        let initial = super::super::load(&[]).unwrap(); let root = initial.get_or_insert_xml_fragment("default");
        { let mut txn = initial.transact_mut();
          let a = root.push_back(&mut txn, XmlElementPrelim::empty("group"));
          let p = a.push_back(&mut txn, XmlElementPrelim::empty("paragraph")); p.insert_attribute(&mut txn, "bid", "child"); p.push_back(&mut txn, XmlTextPrelim::new("text"));
          root.push_back(&mut txn, XmlElementPrelim::empty("group")); }
        let old = bytes(&initial); let current = super::super::load(&old).unwrap(); let root = current.get_or_insert_xml_fragment("default");
        { let mut txn = current.transact_mut();
          let a = match root.get(&txn, 0).unwrap() { XmlOut::Element(p) => p, _ => panic!() };
          let b = match root.get(&txn, 1).unwrap() { XmlOut::Element(p) => p, _ => panic!() };
          a.remove(&mut txn, 0); let p = b.push_back(&mut txn, XmlElementPrelim::empty("paragraph"));
          p.insert_attribute(&mut txn, "bid", "child"); p.push_back(&mut txn, XmlTextPrelim::new("text")); }
        assert!(restore(&bytes(&current), &old).unwrap_err().contains("Moved blocks"));
    }
    #[test]
    fn refuses_reorder_of_existing_block_ids_instead_of_discarding_concurrent_text() {
        let old = fixture(); let current = super::super::load(&old).unwrap(); let root = current.get_or_insert_xml_fragment("default");
        // Replace the first block after b, retaining b's existing Yjs identity.
        { let mut txn = current.transact_mut(); root.remove(&mut txn, 0);
          let p = root.push_back(&mut txn, XmlElementPrelim::empty("paragraph"));
          p.insert_attribute(&mut txn, "bid", "a"); p.push_back(&mut txn, XmlTextPrelim::new("hello")); }
        let base = bytes(&current);
        let result = restore(&base, &old);
        assert!(result.unwrap_err().contains("Reordered blocks"));
        assert_eq!(super::super::editor::block_identity(&base, b"b").unwrap(), super::super::editor::block_identity(&bytes(&current), b"b").unwrap());
    }
    #[test]
    fn restoring_empty_paragraph_preserves_concurrent_typing() {
        let initial = super::super::load(&[]).unwrap(); let root = initial.get_or_insert_xml_fragment("default");
        { let mut txn = initial.transact_mut(); let p = root.push_back(&mut txn, XmlElementPrelim::empty("paragraph")); p.insert_attribute(&mut txn, "bid", "empty"); }
        let old = bytes(&initial);
        let current = super::super::load(&old).unwrap(); let live_root = current.get_or_insert_xml_fragment("default");
        { let mut txn = current.transact_mut(); let p = match live_root.get(&txn, 0).unwrap() { XmlOut::Element(p) => p, _ => panic!() }; p.push_back(&mut txn, XmlTextPrelim::new("local")); }
        let base = bytes(&current); let peer = super::super::load(&base).unwrap(); let peer_root = peer.get_or_insert_xml_fragment("default");
        { let mut txn = peer.transact_mut(); let p = match peer_root.get(&txn, 0).unwrap() { XmlOut::Element(p) => p, _ => panic!() };
          let text = match p.get(&txn, 0).unwrap() { XmlOut::Text(t) => t, _ => panic!() }; let len = text.len(&txn); text.insert(&mut txn, len, "peer"); }
        let restore_update = restore(&base, &old).unwrap(); let restored = super::super::merge(&base, &restore_update).unwrap();
        let delta = peer.transact().encode_state_as_update_v1(&current.transact().state_vector());
        let merged = super::super::merge(&restored, &delta).unwrap();
        let content: serde_json::Value = serde_json::from_slice(&super::super::editor::read(&merged).unwrap()).unwrap();
        assert_eq!(content["content"][0]["content"][0]["text"], "peer");
        let other = super::super::merge(&bytes(&peer), &restore_update).unwrap();
        assert_eq!(super::super::editor::read(&merged).unwrap(), super::super::editor::read(&other).unwrap());
    }
    #[test]
    fn restores_formatting_changes_without_replacing_text_identity() {
        let old = fixture(); let current = super::super::load(&old).unwrap(); let root = current.get_or_insert_xml_fragment("default");
        { let mut txn = current.transact_mut();
          let p = match root.get(&txn, 0).unwrap() { XmlOut::Element(p) => p, _ => panic!() };
          let t = match p.get(&txn, 0).unwrap() { XmlOut::Text(t) => t, _ => panic!() };
          let mut changed = Attrs::new(); changed.insert("bold".into(), Any::Null); changed.insert("italic".into(), Any::from(true));
          let len = t.len(&txn); t.format(&mut txn, 0, len, changed); }
        let base = bytes(&current); let id = super::super::editor::block_identity(&base, b"a").unwrap();
        let update = restore(&base, &old).unwrap(); let merged = super::super::merge(&base, &update).unwrap();
        assert_eq!(super::super::editor::read(&old).unwrap(), super::super::editor::read(&merged).unwrap());
        assert_eq!(id, super::super::editor::block_identity(&merged, b"a").unwrap());
    }
    #[test]
    fn inserting_a_missing_block_preserves_identity_of_the_following_block() {
        let old = fixture(); let current = super::super::load(&old).unwrap(); let root = current.get_or_insert_xml_fragment("default");
        { let mut txn = current.transact_mut(); root.remove(&mut txn, 0); }
        let base = bytes(&current);
        let b_id = super::super::editor::block_identity(&base, b"b").unwrap();
        let peer = super::super::load(&base).unwrap(); let peer_root = peer.get_or_insert_xml_fragment("default");
        { let mut txn = peer.transact_mut();
          let p = match peer_root.get(&txn, 0).unwrap() { XmlOut::Element(p) => p, _ => panic!() };
          let t = match p.get(&txn, 0).unwrap() { XmlOut::Text(t) => t, _ => panic!() };
          let len = t.len(&txn); t.insert(&mut txn, len, "!"); }
        let update = restore(&base, &old).unwrap(); let restored = super::super::merge(&base, &update).unwrap();
        assert_eq!(b_id, super::super::editor::block_identity(&restored, b"b").unwrap());
        let delta = peer.transact().encode_state_as_update_v1(&current.transact().state_vector());
        let merged = super::super::merge(&restored, &delta).unwrap();
        let content: serde_json::Value = serde_json::from_slice(&super::super::editor::read(&merged).unwrap()).unwrap();
        assert_eq!(content["content"][1]["content"][0]["text"], "second!");
    }
    #[test]
    fn concurrent_insert_in_existing_text_survives_restore() {
        let old = fixture(); let current = super::super::load(&old).unwrap(); let root = current.get_or_insert_xml_fragment("default");
        {
            let mut txn = current.transact_mut();
            let p = match root.get(&txn, 0).unwrap() { XmlOut::Element(p) => p, _ => panic!() };
            let t = match p.get(&txn, 0).unwrap() { XmlOut::Text(t) => t, _ => panic!() };
            t.insert(&mut txn, 0, "changed ");
        }
        let base = bytes(&current); let peer = super::super::load(&base).unwrap(); let peer_root = peer.get_or_insert_xml_fragment("default");
        {
            let mut txn = peer.transact_mut();
            let p = match peer_root.get(&txn, 0).unwrap() { XmlOut::Element(p) => p, _ => panic!() };
            let t = match p.get(&txn, 0).unwrap() { XmlOut::Text(t) => t, _ => panic!() };
            let len = t.len(&txn); t.insert(&mut txn, len, "!");
        }
        let update = restore(&base, &old).unwrap();
        let restored = super::super::merge(&base, &update).unwrap();
        let peer_update = peer.transact().encode_state_as_update_v1(&current.transact().state_vector());
        let combined = super::super::merge(&restored, &peer_update).unwrap();
        let content: serde_json::Value = serde_json::from_slice(&super::super::editor::read(&combined).unwrap()).unwrap();
        let first = content["content"][0]["content"].as_array().unwrap();
        let text: String = first.iter().filter_map(|v| v["text"].as_str()).collect();
        assert_eq!(text, "hello😀!");
        let peer_final = super::super::merge(&bytes(&peer), &update).unwrap();
        assert_eq!(super::super::editor::read(&peer_final).unwrap(), super::super::editor::read(&combined).unwrap());
    }
}
