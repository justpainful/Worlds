use serde_json::{json, Value};
use yrs::{Any, Array, ArrayPrelim, Map, MapPrelim, Out, ReadTxn, Transact};
use yrs::types::ToJson;

pub fn read(snapshot: &[u8]) -> Result<Vec<u8>, String> {
    let doc = super::load(snapshot)?;
    let threads = doc.get_or_insert_map("threads");
    let people = doc.get_or_insert_map("people");
    let txn = doc.transact();
    let mut a = String::new(); threads.to_json(&txn).to_json(&mut a);
    let mut b = String::new(); people.to_json(&txn).to_json(&mut b);
    let threads: Value = serde_json::from_str(&a).map_err(|e| e.to_string())?;
    let people: Value = serde_json::from_str(&b).map_err(|e| e.to_string())?;
    serde_json::to_vec(&json!({"threads": threads, "people": people})).map_err(|e| e.to_string())
}

fn valid_id(s: &str) -> bool {
    !s.is_empty() && s.encode_utf16().count() <= 160 && !["__proto__", "constructor", "prototype"].contains(&s)
}

pub fn mutate(snapshot: &[u8], request: &[u8]) -> Result<Vec<u8>, String> {
    let input: Value = serde_json::from_slice(request).map_err(|e| e.to_string())?;
    let field = |key: &str| -> Result<&str, String> { input[key].as_str().filter(|s| valid_id(s)).ok_or_else(|| format!("Invalid {}", key)) };
    let action = input["action"].as_str().ok_or("Missing action")?;
    let thread_id = field("thread")?; let author = field("author")?;
    let created = input["createdAt"].as_f64().filter(|n| n.is_finite() && n.abs() <= 8.64e15).ok_or("Invalid date")?;
    let doc = super::load(snapshot)?;
    let threads = doc.get_or_insert_map("threads");
    let people = doc.get_or_insert_map("people");
    let vector = doc.transact().state_vector();
    let mut txn = doc.transact_mut();
    if action == "delete" {
        let comment_id = field("comment")?;
        let thread = match threads.get(&txn, thread_id) { Some(Out::YMap(m)) => m, _ => return Err("Missing thread".into()) };
        let comments = match thread.get(&txn, "comments") { Some(Out::YArray(a)) => a, _ => return Err("Missing comments".into()) };
        let mut found = None;
        for (i, value) in comments.iter(&txn).enumerate() {
            let comment = match value { Out::YMap(m) => m, _ => return Err("Invalid comment".into()) };
            if matches!(comment.get(&txn, "id"), Some(Out::Any(Any::String(id))) if id.as_ref() == comment_id) {
                if found.is_some() { return Err("Duplicate comment".into()); }
                if !matches!(comment.get(&txn, "author"), Some(Out::Any(Any::String(id))) if id.as_ref() == author) { return Err("Comment belongs to another user".into()); }
                found = Some(i as u32);
            }
        }
        let index = found.ok_or("Missing comment")?;
        let count = comments.len(&txn);
        if index == 0 && count != 1 { return Err("First comment has replies".into()); }
        if index == 0 { threads.remove(&mut txn, thread_id); }
        else { comments.remove(&mut txn, index); }
    } else if action == "edit" {
        let comment_id = field("comment")?;
        let body = input["body"].as_str().filter(|s| !s.trim().is_empty() && s.encode_utf16().count() <= 10_000).ok_or("Invalid body")?;
        let expected = input["expectedBody"].as_str().ok_or("Missing original body")?;
        let thread = match threads.get(&txn, thread_id) { Some(Out::YMap(m)) => m, _ => return Err("Missing thread".into()) };
        let comments = match thread.get(&txn, "comments") { Some(Out::YArray(a)) => a, _ => return Err("Missing comments".into()) };
        let mut found = None;
        for value in comments.iter(&txn) {
            let comment = match value { Out::YMap(m) => m, _ => return Err("Invalid comment".into()) };
            if matches!(comment.get(&txn, "id"), Some(Out::Any(Any::String(id))) if id.as_ref() == comment_id) {
                if found.is_some() { return Err("Duplicate comment".into()); }
                if !matches!(comment.get(&txn, "author"), Some(Out::Any(Any::String(id))) if id.as_ref() == author) { return Err("Comment belongs to another user".into()); }
                if matches!(comment.get(&txn, "deleted"), Some(Out::Any(Any::Bool(true)))) { return Err("Deleted comment".into()); }
                if !matches!(comment.get(&txn, "body"), Some(Out::Any(Any::String(current))) if current.as_ref() == expected) { return Err("Comment changed".into()); }
                found = Some(comment);
            }
        }
        let comment = found.ok_or("Missing comment")?;
        let mut mentions: Vec<Any> = Vec::new();
        for (user, person) in people.iter(&txn) {
            if !valid_id(user) { continue; }
            let mut raw = String::new(); person.to_json(&txn).to_json(&mut raw);
            if let Ok(value) = serde_json::from_str::<Value>(&raw) {
                if let Some(name) = value["name"].as_str().filter(|s| !s.is_empty()) {
                    if body.contains(&format!("@{}", name)) { mentions.push(Any::from(user.to_owned())); }
                }
            }
        }
        if mentions.len() > 100 { return Err("Too many mentions".into()); }
        comment.insert(&mut txn, "body", body);
        comment.insert(&mut txn, "mentions", Any::Array(mentions.into()));
        comment.insert(&mut txn, "editedAt", created);
    } else if action == "resolve" {
        let resolved = input["resolved"].as_bool().ok_or("Invalid resolution")?;
        let thread = match threads.get(&txn, thread_id) { Some(Out::YMap(m)) => m, _ => return Err("Missing thread".into()) };
        thread.insert(&mut txn, "resolved", resolved);
        if resolved { thread.insert(&mut txn, "resolvedBy", author); thread.insert(&mut txn, "resolvedAt", created); }
        else { thread.insert(&mut txn, "resolvedBy", Any::Null); thread.insert(&mut txn, "resolvedAt", Any::Null); }
    } else if action == "reply" || action == "create" {
        let id = field("id")?;
        let body = input["body"].as_str().filter(|s| !s.trim().is_empty() && s.encode_utf16().count() <= 10_000).ok_or("Invalid body")?;
        let mut mentions: Vec<Any> = Vec::new();
        for (user, person) in people.iter(&txn) {
            if !valid_id(user) { continue; }
            let mut raw = String::new(); person.to_json(&txn).to_json(&mut raw);
            if let Ok(value) = serde_json::from_str::<Value>(&raw) {
                if let Some(name) = value["name"].as_str().filter(|s| !s.is_empty()) {
                    if body.contains(&format!("@{}", name)) { mentions.push(Any::from(user.to_owned())); }
                }
            }
        }
        if mentions.len() > 100 { return Err("Too many mentions".into()); }
        let comments = if action == "create" {
            if threads.get(&txn, thread_id).is_some() || threads.len(&txn) >= 10_000 { return Err("Invalid thread".into()); }
            let thread = threads.insert(&mut txn, thread_id, MapPrelim::default());
            thread.insert(&mut txn, "id", thread_id); thread.insert(&mut txn, "anchor", Any::Null);
            thread.insert(&mut txn, "quote", ""); thread.insert(&mut txn, "createdBy", author);
            thread.insert(&mut txn, "createdAt", created); thread.insert(&mut txn, "resolved", false);
            thread.insert(&mut txn, "comments", ArrayPrelim::default())
        } else {
            let thread = match threads.get(&txn, thread_id) { Some(Out::YMap(m)) => m, _ => return Err("Missing thread".into()) };
            match thread.get(&txn, "comments") { Some(Out::YArray(a)) => a, _ => return Err("Missing comments".into()) }
        };
        if comments.len(&txn) >= 10_000 { return Err("Too many comments".into()); }
        let comment = comments.push_back(&mut txn, MapPrelim::default());
        comment.insert(&mut txn, "id", id); comment.insert(&mut txn, "author", author);
        comment.insert(&mut txn, "body", body); comment.insert(&mut txn, "mentions", Any::Array(mentions.into()));
        comment.insert(&mut txn, "createdAt", created);
    } else { return Err("Unknown action".into()); }
    drop(txn);
    let update = doc.transact().encode_state_as_update_v1(&vector);
    Ok(update)
}
#[cfg(test)]
mod comment_tests {
    use super::*;
    use yrs::{updates::decoder::Decode, Update};
    fn apply(snapshot: &[u8], update: &[u8]) -> Vec<u8> {
        let doc = super::super::load(snapshot).unwrap();
        doc.transact_mut().apply_update(Update::decode_v1(update).unwrap()).unwrap();
        let bytes = doc.transact().encode_state_as_update_v1(&yrs::StateVector::default());
        bytes
    }
    fn request(action: &str, author: &str, body: &str, expected: &str) -> Vec<u8> {
        serde_json::to_vec(&json!({"action":action,"thread":"thread","id":"message","comment":"message","author":author,"body":body,"expectedBody":expected,"createdAt":1000})).unwrap()
    }
    #[test]
    fn edits_only_authors_unchanged_message_and_retains_identity() {
        let initial = mutate(&[], &request("create", "alice", "before", "")).unwrap();
        assert!(mutate(&initial, &request("edit", "bob", "after", "before")).is_err());
        assert!(mutate(&initial, &request("edit", "alice", "after", "outdated")).is_err());
        assert!(mutate(&initial, &request("edit", "alice", "   ", "before")).is_err());
        let edit = mutate(&initial, &request("edit", "alice", "after", "before")).unwrap();
        let state = apply(&initial, &edit);
        let result: Value = serde_json::from_slice(&read(&state).unwrap()).unwrap();
        let comment = &result["threads"]["thread"]["comments"][0];
        assert_eq!(comment["id"], "message");
        assert_eq!(comment["author"], "alice");
        assert_eq!(comment["body"], "after");
        assert_eq!(comment["editedAt"], 1000.0);
        assert!(mutate(&state, &request("edit", "alice", "again", "before")).is_err());
    }
}
