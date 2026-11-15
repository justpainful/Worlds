//! Worlds tools: planning and Study pack items (subjects, weekly classes, exams,
//! assignments, things to bring, tasks, events). Their fields live in
//! `metadata.<kind>` exactly as the planning views write them
//! (src/planning/model.ts), so what is made here shows up in Study, Calendar and
//! Tasks. Writes go through the store with the caller's context: creations are
//! recorded in history, and every change is snapshotted first, so it can be undone.

use super::{os, s, tool};
use crate::store::{self, Ctx};
use anyhow::{anyhow, bail, Result};
use rusqlite::Connection;
use serde_json::{json, Map, Value};

/// The planning kinds these tools handle, with the icon the app gives a new one.
const KINDS: &[(&str, &str)] = &[
    ("subject", "graduation"),
    ("event", "calendar"),
    ("exam", "medal"),
    ("assignment", "clipboard"),
    ("requirement", "printer"),
    ("task", "checklist"),
    ("lesson", "notebook"),
    ("goal", "target"),
    ("inbox", "inbox"),
];

fn icon_for(kind: &str) -> Option<&'static str> {
    KINDS.iter().find(|(k, _)| *k == kind).map(|(_, i)| *i)
}

pub fn tools() -> Vec<Value> {
    let data = json!({ "type": "object", "description": "The kind's fields (metadata.<kind>). \
        subject {color: gray|blue|green|yellow|orange|red|purple|pink, teacher, room, code, symbol}; \
        event {date: YYYY-MM-DD, start: HH:MM, end: HH:MM, allDay, location, weekly: [0-6, Sun=0] for a class or \
        repeating event (date = first day), until: YYYY-MM-DD (last day, inclusive), skip: [YYYY-MM-DD]}; \
        exam {date, time, scope, location}; assignment {due, time, instructions, submitted}; \
        requirement {due, action, ready}; task {due, time, priority 0-3, done}. \
        A weekly event inside a subject is one of its classes. Any item may add symbol (an SF Symbol name) \
        and important: true." });
    let kind = json!({ "type": "string", "enum": KINDS.iter().map(|(k, _)| *k).collect::<Vec<_>>() });
    vec![
        tool(
            "planning_list",
            "List planning and Study items (subjects, classes and other events, exams, assignments, things to bring, tasks) with their fields and parent.",
            json!({ "kinds": { "type": "array", "items": kind.clone() }, "includeArchived": { "type": "boolean" } }),
            &[],
        ),
        tool(
            "planning_create",
            "Create planning or Study items: one (kind, title, parentId, data) or several at once in `items`. An item in \
             `items` can sit under an earlier one in the same call with parentRef (its index), e.g. a subject and its weekly classes.",
            json!({
                "kind": kind.clone(), "title": { "type": "string" }, "parentId": { "type": "string" }, "data": data.clone(),
                "items": { "type": "array", "items": { "type": "object", "description": "{ kind, title, parentId?, parentRef?, data }" } }
            }),
            &[],
        ),
        tool(
            "planning_update",
            "Change a planning or Study item: data is merged into its fields (a null removes a field), title renames it, \
             archived archives it. Snapshotted first, undoable.",
            json!({ "pageId": { "type": "string" }, "data": data, "title": { "type": "string" }, "archived": { "type": "boolean" } }),
            &["pageId"],
        ),
    ]
}

fn item_view(p: &store::PageMeta) -> Value {
    json!({ "id": p.id, "kind": p.kind, "title": p.title, "parentId": p.parent_id, "archived": p.archived, "data": p.data })
}

fn create_one(
    conn: &Connection,
    ctx: &Ctx,
    kind: &str,
    title: &str,
    parent: Option<String>,
    data: Option<&Value>,
) -> Result<store::PageMeta> {
    let icon = icon_for(kind).ok_or_else(|| anyhow!("unknown planning kind {kind}"))?;
    let data = data.cloned().unwrap_or_else(|| json!({}));
    if !data.is_object() {
        bail!("data must be an object");
    }
    let mut metadata = Map::new();
    metadata.insert(kind.to_string(), data);
    store::create_page(
        conn,
        ctx,
        store::NewPage {
            title: Some(title.to_string()),
            icon: Some(format!("pi:{icon}")),
            parent_id: parent,
            kind: Some(kind.to_string()),
            metadata: Some(Value::Object(metadata)),
            ..Default::default()
        },
    )
}

pub fn call(conn: &Connection, ctx: &Ctx, name: &str, a: &Value) -> Result<Option<Value>> {
    let out = match name {
        "planning_list" => {
            let wanted: Vec<String> = a
                .get("kinds")
                .and_then(Value::as_array)
                .map(|v| v.iter().filter_map(Value::as_str).map(str::to_string).collect())
                .unwrap_or_default();
            let archived = a.get("includeArchived").and_then(Value::as_bool).unwrap_or(false);
            let items: Vec<Value> = store::list_pages(conn, false)?
                .iter()
                .filter(|p| icon_for(&p.kind).is_some())
                .filter(|p| wanted.is_empty() || wanted.iter().any(|k| *k == p.kind))
                .filter(|p| archived || !p.archived)
                .map(item_view)
                .collect();
            json!(items)
        }
        "planning_create" => {
            if let Some(list) = a.get("items").and_then(Value::as_array) {
                if list.len() > 200 {
                    bail!("at most 200 items per call");
                }
                let mut made: Vec<store::PageMeta> = Vec::new();
                for (i, it) in list.iter().enumerate() {
                    let kind = s(it, "kind").map_err(|_| anyhow!("item {i}: missing kind"))?;
                    let parent = match it.get("parentRef").and_then(Value::as_u64) {
                        Some(r) => {
                            Some(made.get(r as usize).ok_or_else(|| anyhow!("item {i}: parentRef {r} is not an earlier item"))?.id.clone())
                        }
                        None => os(it, "parentId").map(str::to_string),
                    };
                    let title = it.get("title").and_then(Value::as_str).unwrap_or("");
                    made.push(create_one(conn, ctx, kind, title, parent, it.get("data")).map_err(|e| anyhow!("item {i}: {e}"))?);
                }
                json!({ "created": made.iter().map(|p| json!({ "id": p.id, "kind": p.kind, "title": p.title })).collect::<Vec<_>>() })
            } else {
                let p = create_one(
                    conn,
                    ctx,
                    s(a, "kind")?,
                    a.get("title").and_then(Value::as_str).unwrap_or(""),
                    os(a, "parentId").map(str::to_string),
                    a.get("data"),
                )?;
                json!({ "id": p.id, "kind": p.kind, "title": p.title })
            }
        }
        "planning_update" => {
            let id = s(a, "pageId")?;
            let p = store::page_meta_by_id(conn, id)?.ok_or_else(|| anyhow!("page not found"))?;
            if icon_for(&p.kind).is_none() {
                bail!("{} is a {}, not a planning item", p.title, p.kind);
            }
            store::ensure_op_snapshot(conn, ctx, id)?;
            if let Some(patch) = a.get("data") {
                let patch = patch.as_object().ok_or_else(|| anyhow!("data must be an object"))?;
                let mut merged = p.data.as_object().cloned().unwrap_or_default();
                for (k, v) in patch {
                    if v.is_null() {
                        merged.remove(k);
                    } else {
                        merged.insert(k.clone(), v.clone());
                    }
                }
                store::set_page_meta(conn, ctx, id, &p.kind, Value::Object(merged))?;
                store::record(conn, ctx, Some(id), "updated", &format!("Changed “{}”", p.title), None, None, None, json!({}))?;
            }
            if os(a, "title").is_some() || a.get("archived").and_then(Value::as_bool).is_some() {
                store::update_page(
                    conn,
                    ctx,
                    id,
                    store::PagePatch {
                        title: os(a, "title").map(str::to_string),
                        archived: a.get("archived").and_then(Value::as_bool),
                        ..Default::default()
                    },
                )?;
            }
            let p = store::page_meta_by_id(conn, id)?.ok_or_else(|| anyhow!("page not found"))?;
            item_view(&p)
        }
        _ => return Ok(None),
    };
    Ok(Some(out))
}
