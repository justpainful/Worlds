//! The extended Worlds tool set for Claude: workspace overview, page queries
//! and bulk actions, find and replace, layout blocks, covers and page style,
//! profile blocks and images, versions and undo, attachments, automation runs.
//!
//! Every write goes through the store with the caller's context, so it is
//! recorded in history and can be undone like any other AI change.

use super::{os, tool};
use crate::store::{self, Ctx};
use anyhow::{anyhow, Result};
use rusqlite::Connection;
use serde_json::{json, Value};

pub fn tools() -> Vec<Value> {
    let page_id = json!({ "type": "string", "description": "Page id" });
    let ids = json!({ "type": "array", "items": { "type": "string" }, "description": "Page ids" });
    let md = json!({ "type": "string", "description": "Content in Worlds Markdown" });
    vec![
        tool("workspace_overview", "A snapshot of the whole workspace: counts, pinned and favourite pages, recently edited pages, automations, the owner, and the current local date and time. Call this first when you need orientation.", json!({}), &[]),
        tool("time_now", "Current local date, time, weekday and UTC offset on this PC. Use it before scheduling or writing dates.", json!({}), &[]),
        tool("pages_query", "Find pages by structure and properties: parent, title text, a property value, a tag, a status, recent edits. Returns ids, titles, parents and properties.", json!({
            "parentId": { "type": "string", "description": "Only direct children of this page" },
            "titleContains": { "type": "string" },
            "property": { "type": "string", "description": "Property name to match (with value)" },
            "value": { "type": "string", "description": "Value the property must contain (case-insensitive)" },
            "tag": { "type": "string", "description": "Pages whose Tags (any tags property) include this tag" },
            "status": { "type": "string", "description": "Pages whose Status equals this" },
            "updatedWithinDays": { "type": "number" },
            "includeArchived": { "type": "boolean" },
            "templates": { "type": "boolean", "description": "Search templates instead of pages" },
            "sort": { "type": "string", "enum": ["updated", "created", "title"] },
            "limit": { "type": "integer" }
        }), &[]),
        tool("pages_tree", "The subtree under a page (or the whole workspace) with depth, icons and properties.", json!({ "pageId": { "type": "string", "description": "Root page; omit for everything" }, "maxDepth": { "type": "integer" } }), &[]),
        tool("pages_export_markdown", "A page's full content as Markdown (title first). Best way to read a long page in one go.", json!({ "pageId": page_id }), &["pageId"]),
        tool("pages_outline", "Headings of a page with their block ids, for navigating long pages.", json!({ "pageId": page_id }), &["pageId"]),
        tool("pages_append_markdown", "Add content at the end of a page.", json!({ "pageId": page_id, "markdown": md }), &["pageId", "markdown"]),
        tool("pages_find_text", "Find blocks containing some text, in one page or across all pages. Returns block ids with excerpts.", json!({ "text": { "type": "string" }, "pageId": { "type": "string", "description": "Limit to one page" }, "limit": { "type": "integer" } }), &["text"]),
        tool("pages_replace_text", "Find and replace text inside a page, keeping formatting. Returns how many replacements were made. Undoable.", json!({ "pageId": page_id, "find": { "type": "string" }, "replace": { "type": "string" }, "matchCase": { "type": "boolean" } }), &["pageId", "find", "replace"]),
        tool("pages_backlinks", "Pages that mention or link to this page.", json!({ "pageId": page_id }), &["pageId"]),
        tool("pages_set_cover", "Set, change or clear a page's cover image: an attachment id, a local file path, or clear.", json!({ "pageId": page_id, "attachmentId": { "type": "string" }, "path": { "type": "string" }, "clear": { "type": "boolean" }, "crop": { "type": "string", "description": "Optional focus and zoom \"x,y,zoom\" (percent, percent, 1-4)" } }), &["pageId"]),
        tool("pages_set_style", "Page presentation: font (default, serif, mono), small text, full width.", json!({ "pageId": page_id, "font": { "type": "string", "enum": ["default", "serif", "mono"] }, "small": { "type": "boolean" }, "full": { "type": "boolean" } }), &["pageId"]),
        tool("pages_create_many", "Create several pages at once under a parent (for lists of tasks, notes, people). Each item can have an icon, Markdown content and properties.", json!({
            "parentId": { "type": "string" },
            "items": { "type": "array", "items": { "type": "object", "properties": {
                "title": { "type": "string" }, "icon": { "type": "string" }, "markdown": { "type": "string" },
                "properties": { "type": "array", "items": { "type": "object" } }
            } } }
        }), &["items"]),
        tool("pages_bulk", "Apply one action to many pages: move, archive, unarchive, pin, unpin, favorite, unfavorite, tag, untag, set_property, set_icon, delete (to Trash). Only when the user asked.", json!({
            "pageIds": ids,
            "action": { "type": "string", "enum": ["move", "archive", "unarchive", "pin", "unpin", "favorite", "unfavorite", "tag", "untag", "set_property", "set_icon", "delete"] },
            "parentId": { "type": "string", "description": "For move (omit for top level)" },
            "tag": { "type": "string", "description": "For tag and untag" },
            "property": { "type": "string", "description": "For set_property: property name" },
            "value": { "description": "For set_property: the value (string, number, boolean or list)" },
            "icon": { "type": "string", "description": "For set_icon: emoji or pi:<product icon>" }
        }), &["pageIds", "action"]),
        tool("blocks_insert_layout", "Insert a layout block: columns (2 or 3 columns of Markdown), a toggle (collapsible section with a summary line and hidden content), or a collection (a live table, board, gallery or list of subpages or tagged pages).", json!({
            "pageId": page_id,
            "kind": { "type": "string", "enum": ["columns", "toggle", "collection"] },
            "afterBlockId": { "type": "string", "description": "Insert after this block; omit for the end" },
            "columns": { "type": "array", "items": { "type": "string" }, "description": "For columns: 2 or 3 Markdown strings" },
            "summary": { "type": "string", "description": "For toggle: the always-visible line" },
            "headingLevel": { "type": "integer", "description": "For toggle: 0 for text, 1 to 3 for a heading" },
            "markdown": { "type": "string", "description": "For toggle: the folded content" },
            "view": { "type": "string", "enum": ["table", "board", "gallery", "list"] },
            "source": { "type": "string", "enum": ["children", "tag", "all"] },
            "tag": { "type": "string" },
            "title": { "type": "string" },
            "groupBy": { "type": "string", "description": "For board: property to group by (default Status)" }
        }), &["pageId", "kind"]),
        tool("profile_blocks_add", "Add a Profile Block (widget) to the user's profile. See profile_update for the block format. Returns the new block id.", json!({ "block": { "type": "object" }, "index": { "type": "integer", "description": "Position; omit for the end" } }), &["block"]),
        tool("profile_blocks_update", "Change fields of one Profile Block by id (merged into the block).", json!({ "id": { "type": "string" }, "patch": { "type": "object" } }), &["id", "patch"]),
        tool("profile_blocks_remove", "Remove one Profile Block by id. Only when the user asked.", json!({ "id": { "type": "string" } }), &["id"]),
        tool("profile_blocks_move", "Move a Profile Block to a new position (0 is first; the first three are featured).", json!({ "id": { "type": "string" }, "index": { "type": "integer" } }), &["id", "index"]),
        tool("profile_set_image", "Set the avatar or banner from an attachment id or a local file path, optionally with a crop \"x,y,zoom\".", json!({ "field": { "type": "string", "enum": ["avatar", "banner"] }, "attachmentId": { "type": "string" }, "path": { "type": "string" }, "crop": { "type": "string" }, "clear": { "type": "boolean" } }), &["field"]),
        tool("versions_list", "Saved versions of a page (snapshots before big changes), newest first.", json!({ "pageId": page_id }), &["pageId"]),
        tool("versions_restore", "Restore a page to a saved version (the current state is kept as a version too). Only when the user asked.", json!({ "versionId": { "type": "string" } }), &["versionId"]),
        tool("history_undo", "Undo an earlier change by its op id (from history_read). Only when the user asked.", json!({ "opId": { "type": "string" } }), &["opId"]),
        tool("attachments_list", "Files on a page, or the most recent images, GIFs and videos across the workspace.", json!({ "pageId": { "type": "string" }, "limit": { "type": "integer" } }), &[]),
        tool("automations_runs", "Recent runs of an automation with status, times and errors.", json!({ "automationId": { "type": "string" }, "limit": { "type": "integer" } }), &["automationId"]),
    ]
}

pub(super) fn now_local() -> Value {
    let n = chrono::Local::now();
    json!({
        "iso": n.to_rfc3339(),
        "date": n.format("%Y-%m-%d").to_string(),
        "time": n.format("%H:%M").to_string(),
        "weekday": n.format("%A").to_string(),
        "utcOffset": n.format("%:z").to_string(),
    })
}

pub(super) fn prop_text(v: &Value) -> String {
    match v {
        Value::Array(a) => a.iter().filter_map(Value::as_str).collect::<Vec<_>>().join(", "),
        Value::String(s) => s.clone(),
        Value::Bool(b) => {
            if *b {
                "yes".into()
            } else {
                "no".into()
            }
        }
        Value::Number(n) => n.to_string(),
        _ => String::new(),
    }
}

pub(super) fn find_prop<'a>(props: &'a Value, name: &str) -> Option<&'a Value> {
    props.as_array()?.iter().find(|p| p.get("name").and_then(Value::as_str).map(|n| n.eq_ignore_ascii_case(name)).unwrap_or(false))
}

pub(super) fn page_brief(p: &store::PageMeta) -> Value {
    json!({ "id": p.id, "title": p.title, "icon": p.icon, "parentId": p.parent_id, "pinned": p.pinned, "favorite": p.favorite, "archived": p.archived, "updatedAt": p.updated_at, "properties": p.properties })
}

/// Replace text in every text node of a ProseMirror JSON tree. Returns the number of replacements.
pub(super) fn replace_in(node: &mut Value, find: &str, rep: &str, match_case: bool) -> usize {
    let mut n = 0;
    if node.get("type").and_then(Value::as_str) == Some("text") {
        if let Some(t) = node.get("text").and_then(Value::as_str).map(str::to_string) {
            let (out, count) = if match_case {
                (t.replace(find, rep), t.matches(find).count())
            } else {
                let lower = t.to_lowercase();
                let f = find.to_lowercase();
                let mut out = String::new();
                let mut count = 0;
                let mut i = 0;
                while let Some(pos) = lower[i..].find(&f) {
                    let start = i + pos;
                    // Only safe when lowercasing kept byte offsets (true for Arabic and ASCII).
                    if !t.is_char_boundary(start) || !t.is_char_boundary(start + f.len()) {
                        break;
                    }
                    out.push_str(&t[i..start]);
                    out.push_str(rep);
                    i = start + f.len();
                    count += 1;
                }
                out.push_str(&t[i..]);
                (out, count)
            };
            if count > 0 {
                node["text"] = Value::String(out);
                n += count;
            }
        }
    }
    if let Some(kids) = node.get_mut("content").and_then(Value::as_array_mut) {
        for k in kids {
            n += replace_in(k, find, rep, match_case);
        }
    }
    n
}

pub(super) fn ensure_props(v: &Value) -> Vec<Value> {
    v.as_array().cloned().unwrap_or_default()
}

pub(super) fn new_prop_id() -> String {
    format!("p{}", &uuid::Uuid::new_v4().simple().to_string()[..8])
}

pub(super) fn set_prop_value(props: &mut Vec<Value>, name: &str, value: Value) {
    if let Some(p) = props.iter_mut().find(|p| p.get("name").and_then(Value::as_str).map(|n| n.eq_ignore_ascii_case(name)).unwrap_or(false))
    {
        p["value"] = value;
        return;
    }
    let ty = match (&value, name.to_lowercase().as_str()) {
        (_, "status") => "status",
        (Value::Array(_), _) => "tags",
        (Value::Bool(_), _) => "checkbox",
        (Value::Number(_), _) => "number",
        _ => "text",
    };
    let mut p = json!({ "id": new_prop_id(), "name": name, "type": ty, "value": value });
    if ty == "status" {
        p["options"] = json!([{ "name": "Not started", "color": "gray" }, { "name": "In progress", "color": "blue" }, { "name": "Done", "color": "green" }]);
    }
    props.push(p);
}

pub(super) fn import(conn: &Connection, page: Option<&str>, a: &Value) -> Result<Option<String>> {
    if let Some(id) = os(a, "attachmentId") {
        store::get_attachment(conn, id)?.ok_or_else(|| anyhow!("attachment not found"))?;
        return Ok(Some(id.to_string()));
    }
    if let Some(p) = os(a, "path") {
        crate::mcp::claude_may_attach(std::path::Path::new(p))?;
        let att = store::add_attachment_path(conn, page, std::path::Path::new(p))?;
        return Ok(Some(att.id));
    }
    Ok(None)
}

pub(super) fn profile_blocks(conn: &Connection) -> Result<Vec<Value>> {
    Ok(store::profile(conn)?.blocks.as_array().cloned().unwrap_or_default())
}

pub(super) fn save_profile_blocks(conn: &Connection, ctx: &Ctx, blocks: Vec<Value>) -> Result<Value> {
    let p = store::update_profile_as(conn, ctx, store::ProfilePatch { blocks: Some(Value::Array(blocks)), ..Default::default() })?;
    Ok(p.blocks)
}

pub fn call(conn: &Connection, ctx: &Ctx, name: &str, a: &Value) -> Result<Option<Value>> {
    if let Some(v) = super::page_content::call(conn, ctx, name, a)? {
        return Ok(Some(v));
    }
    if let Some(v) = super::profile_history::call(conn, ctx, name, a)? {
        return Ok(Some(v));
    }
    Ok(None)
}
