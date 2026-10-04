//! The extended Worlds tool set for Claude: workspace overview, page queries
//! and bulk actions, find and replace, layout blocks, covers and page style,
//! profile blocks and images, versions and undo, attachments, automation runs.
//!
//! Every write goes through the store with the caller's context, so it is
//! recorded in history and can be undone like any other AI change.

use super::{md_nodes, os, s, tool};
use crate::content;
use crate::store::{self, Ctx};
use anyhow::{anyhow, bail, Result};
use rusqlite::{params, Connection};
use serde_json::{json, Map, Value};

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

fn now_local() -> Value {
    let n = chrono::Local::now();
    json!({
        "iso": n.to_rfc3339(),
        "date": n.format("%Y-%m-%d").to_string(),
        "time": n.format("%H:%M").to_string(),
        "weekday": n.format("%A").to_string(),
        "utcOffset": n.format("%:z").to_string(),
    })
}

fn prop_text(v: &Value) -> String {
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

fn find_prop<'a>(props: &'a Value, name: &str) -> Option<&'a Value> {
    props.as_array()?.iter().find(|p| p.get("name").and_then(Value::as_str).map(|n| n.eq_ignore_ascii_case(name)).unwrap_or(false))
}

fn page_brief(p: &store::PageMeta) -> Value {
    json!({ "id": p.id, "title": p.title, "icon": p.icon, "parentId": p.parent_id, "pinned": p.pinned, "favorite": p.favorite, "archived": p.archived, "updatedAt": p.updated_at, "properties": p.properties })
}

/// Replace text in every text node of a ProseMirror JSON tree. Returns the number of replacements.
fn replace_in(node: &mut Value, find: &str, rep: &str, match_case: bool) -> usize {
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

fn ensure_props(v: &Value) -> Vec<Value> {
    v.as_array().cloned().unwrap_or_default()
}

fn new_prop_id() -> String {
    format!("p{}", &uuid::Uuid::new_v4().simple().to_string()[..8])
}

fn set_prop_value(props: &mut Vec<Value>, name: &str, value: Value) {
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

fn import(conn: &Connection, page: Option<&str>, a: &Value) -> Result<Option<String>> {
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

fn profile_blocks(conn: &Connection) -> Result<Vec<Value>> {
    Ok(store::profile(conn)?.blocks.as_array().cloned().unwrap_or_default())
}

fn save_profile_blocks(conn: &Connection, ctx: &Ctx, blocks: Vec<Value>) -> Result<Value> {
    let p = store::update_profile_as(conn, ctx, store::ProfilePatch { blocks: Some(Value::Array(blocks)), ..Default::default() })?;
    Ok(p.blocks)
}

pub fn call(conn: &Connection, ctx: &Ctx, name: &str, a: &Value) -> Result<Option<Value>> {
    let out = match name {
        "time_now" => now_local(),
        "workspace_overview" => {
            let all = store::list_pages(conn, false)?;
            let pages: Vec<&store::PageMeta> = all.iter().filter(|p| p.kind == "page").collect();
            let mut recent: Vec<&store::PageMeta> = pages.iter().copied().filter(|p| !p.archived).collect();
            recent.sort_by_key(|p| std::cmp::Reverse(p.updated_at));
            let automations: i64 = conn.query_row("SELECT COUNT(*) FROM automations", [], |r| r.get(0)).unwrap_or(0);
            let chats: i64 = conn.query_row("SELECT COUNT(*) FROM ai_chats", [], |r| r.get(0)).unwrap_or(0);
            let profile = store::profile(conn)?;
            json!({
                "now": now_local(),
                "owner": { "name": profile.display_name, "handle": profile.handle, "status": profile.status },
                "counts": {
                    "pages": pages.iter().filter(|p| !p.archived).count(),
                    "archived": pages.iter().filter(|p| p.archived).count(),
                    "templates": all.iter().filter(|p| p.kind == "template").count(),
                    "automations": automations,
                    "chats": chats,
                    "profileBlocks": profile.blocks.as_array().map(|b| b.len()).unwrap_or(0),
                },
                "pinned": pages.iter().filter(|p| p.pinned).map(|p| page_brief(p)).collect::<Vec<_>>(),
                "favorites": pages.iter().filter(|p| p.favorite).map(|p| page_brief(p)).collect::<Vec<_>>(),
                "recent": recent.iter().take(12).map(|p| page_brief(p)).collect::<Vec<_>>(),
            })
        }
        "pages_query" => {
            let all = store::list_pages(conn, false)?;
            let templates = a.get("templates").and_then(Value::as_bool).unwrap_or(false);
            let inc_arch = a.get("includeArchived").and_then(Value::as_bool).unwrap_or(false);
            let since = a.get("updatedWithinDays").and_then(Value::as_f64).map(|d| crate::db::now() - (d * 86_400_000.0) as i64);
            let title = os(a, "titleContains").map(str::to_lowercase);
            let tag = os(a, "tag").map(str::to_lowercase);
            let status = os(a, "status").map(str::to_lowercase);
            let prop = os(a, "property");
            let pval = os(a, "value").map(str::to_lowercase);
            let mut hits: Vec<&store::PageMeta> = all
                .iter()
                .filter(|p| (p.kind == "template") == templates)
                .filter(|p| inc_arch || !p.archived)
                .filter(|p| os(a, "parentId").map(|pid| p.parent_id.as_deref() == Some(pid)).unwrap_or(true))
                .filter(|p| title.as_ref().map(|t| p.title.to_lowercase().contains(t)).unwrap_or(true))
                .filter(|p| since.map(|s| p.updated_at >= s).unwrap_or(true))
                .filter(|p| {
                    status
                        .as_ref()
                        .map(|st| find_prop(&p.properties, "Status").map(|x| prop_text(&x["value"]).to_lowercase() == *st).unwrap_or(false))
                        .unwrap_or(true)
                })
                .filter(|p| {
                    tag.as_ref()
                        .map(|t| {
                            p.properties
                                .as_array()
                                .map(|ps| {
                                    ps.iter().any(|x| {
                                        x["value"]
                                            .as_array()
                                            .map(|vs| vs.iter().any(|v| v.as_str().map(|s| s.to_lowercase() == *t).unwrap_or(false)))
                                            .unwrap_or(false)
                                    })
                                })
                                .unwrap_or(false)
                        })
                        .unwrap_or(true)
                })
                .filter(|p| match (prop, &pval) {
                    (Some(name), Some(v)) => {
                        find_prop(&p.properties, name).map(|x| prop_text(&x["value"]).to_lowercase().contains(v.as_str())).unwrap_or(false)
                    }
                    (Some(name), None) => find_prop(&p.properties, name).is_some(),
                    _ => true,
                })
                .collect();
            match os(a, "sort").unwrap_or("updated") {
                "created" => hits.sort_by_key(|x| std::cmp::Reverse(x.created_at)),
                "title" => hits.sort_by_key(|x| x.title.to_lowercase()),
                _ => hits.sort_by_key(|x| std::cmp::Reverse(x.updated_at)),
            }
            let limit = a.get("limit").and_then(Value::as_u64).unwrap_or(50).min(200) as usize;
            json!({ "count": hits.len(), "pages": hits.iter().take(limit).map(|p| page_brief(p)).collect::<Vec<_>>() })
        }
        "pages_tree" => {
            let all = store::list_pages(conn, false)?;
            let max = a.get("maxDepth").and_then(Value::as_u64).unwrap_or(8) as usize;
            let mut out = Vec::new();
            fn walk(all: &[store::PageMeta], parent: Option<&str>, depth: usize, max: usize, out: &mut Vec<Value>) {
                for p in all.iter().filter(|p| p.parent_id.as_deref() == parent && p.kind == "page" && !p.archived) {
                    out.push(json!({ "id": p.id, "title": p.title, "icon": p.icon, "depth": depth, "properties": p.properties }));
                    if depth < max {
                        walk(all, Some(&p.id), depth + 1, max, out);
                    }
                }
            }
            walk(&all, os(a, "pageId"), 0, max, &mut out);
            json!(out)
        }
        "pages_export_markdown" => {
            let id = s(a, "pageId")?;
            let page = store::get_page(conn, id)?.ok_or_else(|| anyhow!("page not found"))?;
            let body: Vec<String> = page.blocks.iter().map(|b| content::to_markdown(&b.content)).filter(|m| !m.trim().is_empty()).collect();
            json!({ "title": page.meta.title, "markdown": format!("# {}\n\n{}", page.meta.title, body.join("\n\n")) })
        }
        "pages_outline" => {
            let blocks = store::blocks_of(conn, s(a, "pageId")?)?;
            let heads: Vec<Value> = blocks
                .iter()
                .filter(|b| {
                    b.block_type == "heading"
                        || (b.block_type == "toggle"
                            && content::children(&b.content).first().map(|c| content::node_type(c) == "heading").unwrap_or(false))
                })
                .map(|b| {
                    let level = b
                        .content
                        .pointer("/attrs/level")
                        .and_then(Value::as_u64)
                        .or_else(|| content::children(&b.content).first().and_then(|c| c.pointer("/attrs/level")).and_then(Value::as_u64))
                        .unwrap_or(1);
                    json!({ "blockId": b.id, "level": level, "text": content::plain_text(&b.content).lines().next().unwrap_or("").trim() })
                })
                .collect();
            json!(heads)
        }
        "pages_append_markdown" => {
            let page = s(a, "pageId")?;
            store::page_meta_by_id(conn, page)?.ok_or_else(|| anyhow!("page not found"))?;
            let last = store::blocks_of(conn, page)?.last().map(|b| b.id.clone());
            let ids = store::insert_blocks(conn, ctx, page, last.as_deref(), md_nodes(s(a, "markdown")?)?)?;
            json!({ "inserted": ids })
        }
        "pages_find_text" => {
            let text = s(a, "text")?.to_lowercase();
            if text.trim().is_empty() {
                bail!("text is empty");
            }
            let limit = a.get("limit").and_then(Value::as_u64).unwrap_or(30) as usize;
            let pages: Vec<String> = match os(a, "pageId") {
                Some(p) => vec![p.to_string()],
                None => store::list_pages(conn, false)?.into_iter().filter(|p| !p.archived && p.kind == "page").map(|p| p.id).collect(),
            };
            let mut hits = Vec::new();
            'outer: for pid in pages {
                for b in store::blocks_of(conn, &pid)? {
                    let t = content::plain_text(&b.content);
                    if let Some(pos) = t.to_lowercase().find(&text) {
                        let start = t.char_indices().map(|(i, _)| i).rfind(|i| *i <= pos.saturating_sub(40)).unwrap_or(0);
                        let excerpt: String = t[start..].chars().take(140).collect();
                        hits.push(json!({ "pageId": pid, "blockId": b.id, "type": b.block_type, "excerpt": excerpt }));
                        if hits.len() >= limit {
                            break 'outer;
                        }
                    }
                }
            }
            json!(hits)
        }
        "pages_replace_text" => {
            let page = s(a, "pageId")?;
            let find = s(a, "find")?;
            if find.is_empty() {
                bail!("find is empty");
            }
            let rep = s(a, "replace")?;
            let mc = a.get("matchCase").and_then(Value::as_bool).unwrap_or(false);
            let mut total = 0;
            let mut changed = 0;
            for b in store::blocks_of(conn, page)? {
                let mut node = b.content.clone();
                let n = replace_in(&mut node, find, rep, mc);
                if n > 0 {
                    store::update_block(conn, ctx, &b.id, node)?;
                    total += n;
                    changed += 1;
                }
            }
            json!({ "replacements": total, "blocksChanged": changed })
        }
        "pages_backlinks" => json!(store::backlinks(conn, s(a, "pageId")?)?),
        "pages_set_cover" => {
            let id = s(a, "pageId")?;
            let clear = a.get("clear").and_then(Value::as_bool).unwrap_or(false);
            let cover = if clear { None } else { import(conn, Some(id), a)? };
            if cover.is_none() && !clear {
                bail!("give attachmentId, path, or clear");
            }
            let meta = store::update_page(conn, ctx, id, store::PagePatch { cover: Some(cover), ..Default::default() })?;
            if let Some(c) = os(a, "crop") {
                let mut look = meta.look.as_object().cloned().unwrap_or_default();
                look.insert("coverCrop".into(), json!(c));
                store::set_page_meta(conn, ctx, id, "look", Value::Object(look))?;
            }
            json!({ "ok": true, "cover": meta.cover })
        }
        "pages_set_style" => {
            let id = s(a, "pageId")?;
            let meta = store::page_meta_by_id(conn, id)?.ok_or_else(|| anyhow!("page not found"))?;
            let mut look: Map<String, Value> = meta.look.as_object().cloned().unwrap_or_default();
            if let Some(f) = os(a, "font") {
                look.insert("font".into(), json!(f));
            }
            for k in ["small", "full"] {
                if let Some(b) = a.get(k).and_then(Value::as_bool) {
                    look.insert(k.into(), json!(b));
                }
            }
            let m = store::set_page_meta(conn, ctx, id, "look", Value::Object(look))?;
            json!({ "ok": true, "look": m.look })
        }
        "pages_create_many" => {
            let parent = os(a, "parentId").map(str::to_string);
            let items = a.get("items").and_then(Value::as_array).cloned().unwrap_or_default();
            if items.is_empty() {
                bail!("items is empty");
            }
            let mut made = Vec::new();
            for it in items.iter().take(60) {
                let meta = store::create_page(
                    conn,
                    ctx,
                    store::NewPage {
                        title: it.get("title").and_then(Value::as_str).map(str::to_string),
                        icon: it.get("icon").and_then(Value::as_str).map(str::to_string),
                        parent_id: parent.clone(),
                        markdown: it.get("markdown").and_then(Value::as_str).map(str::to_string),
                        ..Default::default()
                    },
                )?;
                if let Some(props) = it.get("properties").filter(|p| p.is_array()) {
                    let mut list = ensure_props(props);
                    for p in &mut list {
                        if p.get("id").is_none() {
                            p["id"] = json!(new_prop_id());
                        }
                    }
                    store::set_page_meta(conn, ctx, &meta.id, "properties", Value::Array(list))?;
                }
                made.push(json!({ "id": meta.id, "title": meta.title }));
            }
            json!({ "created": made })
        }
        "pages_bulk" => {
            let ids: Vec<String> = a
                .get("pageIds")
                .and_then(Value::as_array)
                .map(|v| v.iter().filter_map(Value::as_str).map(str::to_string).collect())
                .unwrap_or_default();
            if ids.is_empty() {
                bail!("pageIds is empty");
            }
            let action = s(a, "action")?;
            let mut done = 0;
            for id in ids.iter().take(200) {
                let patch = |f: &dyn Fn(&mut store::PagePatch)| -> Result<()> {
                    let mut p = store::PagePatch::default();
                    f(&mut p);
                    store::update_page(conn, ctx, id, p)?;
                    Ok(())
                };
                match action {
                    "move" => {
                        store::move_page(conn, ctx, id, os(a, "parentId"), None)?;
                    }
                    "archive" => patch(&|p| p.archived = Some(true))?,
                    "unarchive" => patch(&|p| p.archived = Some(false))?,
                    "pin" => patch(&|p| p.pinned = Some(true))?,
                    "unpin" => patch(&|p| p.pinned = Some(false))?,
                    "favorite" => patch(&|p| p.favorite = Some(true))?,
                    "unfavorite" => patch(&|p| p.favorite = Some(false))?,
                    "set_icon" => {
                        let icon = os(a, "icon").map(str::to_string);
                        patch(&|p| p.icon = Some(icon.clone()))?
                    }
                    "delete" => store::delete_page(conn, ctx, id)?,
                    "tag" | "untag" | "set_property" => {
                        let meta = store::page_meta_by_id(conn, id)?.ok_or_else(|| anyhow!("page {id} not found"))?;
                        let mut props = ensure_props(&meta.properties);
                        if action == "set_property" {
                            set_prop_value(&mut props, s(a, "property")?, a.get("value").cloned().unwrap_or(Value::Null));
                        } else {
                            let tag = s(a, "tag")?.trim().to_string();
                            let idx = props.iter().position(|p| p.get("type").and_then(Value::as_str) == Some("tags"));
                            let i = match idx {
                                Some(i) => i,
                                None => {
                                    props.push(json!({ "id": new_prop_id(), "name": "Tags", "type": "tags", "value": [], "options": [] }));
                                    props.len() - 1
                                }
                            };
                            let mut vals: Vec<String> = props[i]["value"]
                                .as_array()
                                .map(|v| v.iter().filter_map(Value::as_str).map(str::to_string).collect())
                                .unwrap_or_default();
                            if action == "tag" {
                                if !vals.iter().any(|v| v.eq_ignore_ascii_case(&tag)) {
                                    vals.push(tag.clone());
                                }
                                let opts = props[i]["options"].as_array().cloned().unwrap_or_default();
                                if !opts.iter().any(|o| o["name"].as_str() == Some(tag.as_str())) {
                                    let mut o = opts;
                                    o.push(json!({ "name": tag, "color": "blue" }));
                                    props[i]["options"] = Value::Array(o);
                                }
                            } else {
                                vals.retain(|v| !v.eq_ignore_ascii_case(&tag));
                            }
                            props[i]["value"] = json!(vals);
                        }
                        store::set_page_meta(conn, ctx, id, "properties", Value::Array(props))?;
                    }
                    other => bail!("unknown action {other}"),
                }
                done += 1;
            }
            json!({ "ok": true, "pages": done })
        }
        "blocks_insert_layout" => {
            let page = s(a, "pageId")?;
            store::page_meta_by_id(conn, page)?.ok_or_else(|| anyhow!("page not found"))?;
            let node = match s(a, "kind")? {
                "columns" => {
                    let cols = a.get("columns").and_then(Value::as_array).cloned().unwrap_or_default();
                    if !(2..=3).contains(&cols.len()) {
                        bail!("columns needs 2 or 3 Markdown strings");
                    }
                    let mut content = Vec::new();
                    for c in cols {
                        let md = c.as_str().unwrap_or("");
                        let nodes = if md.trim().is_empty() { vec![json!({ "type": "paragraph" })] } else { md_nodes(md)? };
                        content.push(json!({ "type": "column", "content": nodes }));
                    }
                    json!({ "type": "columns", "content": content })
                }
                "toggle" => {
                    let summary = os(a, "summary").unwrap_or("");
                    let level = a.get("headingLevel").and_then(Value::as_u64).unwrap_or(0);
                    let text = if summary.is_empty() { json!([]) } else { json!([{ "type": "text", "text": summary }]) };
                    let head = if (1..=3).contains(&level) {
                        json!({ "type": "heading", "attrs": { "level": level }, "content": text })
                    } else {
                        json!({ "type": "paragraph", "content": text })
                    };
                    let mut content = vec![head];
                    match os(a, "markdown") {
                        Some(md) if !md.trim().is_empty() => content.extend(md_nodes(md)?),
                        _ => content.push(json!({ "type": "paragraph" })),
                    }
                    json!({ "type": "toggle", "attrs": { "open": true }, "content": content })
                }
                "collection" => json!({ "type": "collection", "attrs": {
                    "title": os(a, "title").unwrap_or(""),
                    "source": os(a, "source").unwrap_or("children"),
                    "tag": os(a, "tag").unwrap_or(""),
                    "view": os(a, "view").unwrap_or("table"),
                    "groupBy": os(a, "groupBy").unwrap_or("Status"),
                    "sortBy": "updated", "sortDir": "desc", "filter": "", "columns": null
                } }),
                other => bail!("unknown layout kind {other}"),
            };
            let after = match os(a, "afterBlockId") {
                Some(b) => Some(b.to_string()),
                None => store::blocks_of(conn, page)?.last().map(|b| b.id.clone()),
            };
            let ids = store::insert_blocks(conn, ctx, page, after.as_deref(), vec![node])?;
            json!({ "inserted": ids })
        }
        "profile_blocks_add" => {
            let mut block = a.get("block").cloned().ok_or_else(|| anyhow!("block is required"))?;
            if block.get("type").and_then(Value::as_str).is_none() {
                bail!("block.type is required");
            }
            if block.get("id").and_then(Value::as_str).is_none() {
                block["id"] = json!(format!("b{}", &uuid::Uuid::new_v4().simple().to_string()[..8]));
            }
            for (k, v) in [("size", json!("12x1")), ("style", json!("solid"))] {
                if block.get(k).is_none() {
                    block[k] = v;
                }
            }
            let mut blocks = profile_blocks(conn)?;
            if blocks.len() >= 12 {
                bail!("the profile already has 12 blocks; remove one first");
            }
            let id = block["id"].clone();
            let at = a.get("index").and_then(Value::as_u64).map(|i| (i as usize).min(blocks.len())).unwrap_or(blocks.len());
            blocks.insert(at, block);
            save_profile_blocks(conn, ctx, blocks)?;
            json!({ "ok": true, "id": id })
        }
        "profile_blocks_update" => {
            let id = s(a, "id")?;
            let patch = a.get("patch").and_then(Value::as_object).cloned().ok_or_else(|| anyhow!("patch must be an object"))?;
            let mut blocks = profile_blocks(conn)?;
            let b = blocks.iter_mut().find(|b| b["id"].as_str() == Some(id)).ok_or_else(|| anyhow!("no block with id {id}"))?;
            for (k, v) in patch {
                if k != "id" {
                    b[k] = v;
                }
            }
            save_profile_blocks(conn, ctx, blocks)?;
            json!({ "ok": true })
        }
        "profile_blocks_remove" => {
            let id = s(a, "id")?;
            let mut blocks = profile_blocks(conn)?;
            let before = blocks.len();
            blocks.retain(|b| b["id"].as_str() != Some(id));
            if blocks.len() == before {
                bail!("no block with id {id}");
            }
            save_profile_blocks(conn, ctx, blocks)?;
            json!({ "ok": true })
        }
        "profile_blocks_move" => {
            let id = s(a, "id")?;
            let mut blocks = profile_blocks(conn)?;
            let from = blocks.iter().position(|b| b["id"].as_str() == Some(id)).ok_or_else(|| anyhow!("no block with id {id}"))?;
            let b = blocks.remove(from);
            let to = (a.get("index").and_then(Value::as_u64).unwrap_or(0) as usize).min(blocks.len());
            blocks.insert(to, b);
            save_profile_blocks(conn, ctx, blocks)?;
            json!({ "ok": true })
        }
        "profile_set_image" => {
            let field = s(a, "field")?;
            let clear = a.get("clear").and_then(Value::as_bool).unwrap_or(false);
            let id = if clear { None } else { import(conn, None, a)? };
            if id.is_none() && !clear {
                bail!("give attachmentId, path, or clear");
            }
            let crop = os(a, "crop").map(str::to_string);
            let mut patch = store::ProfilePatch::default();
            match field {
                "avatar" => {
                    patch.avatar = Some(id);
                    patch.avatar_crop = Some(crop);
                }
                "banner" => {
                    patch.banner = Some(id);
                    patch.banner_focus = Some(crop);
                }
                _ => bail!("field must be avatar or banner"),
            }
            store::update_profile_as(conn, ctx, patch)?;
            json!({ "ok": true })
        }
        "versions_list" => json!(store::list_versions(conn, s(a, "pageId")?)?),
        "versions_restore" => json!(store::restore_version(conn, ctx, s(a, "versionId")?)?),
        "history_undo" => json!({ "restoredBlocks": store::undo_op(conn, ctx, s(a, "opId")?)? }),
        "attachments_list" => match os(a, "pageId") {
            Some(p) => json!(store::get_page(conn, p)?.ok_or_else(|| anyhow!("page not found"))?.attachments),
            None => json!(store::recent_media(conn, a.get("limit").and_then(Value::as_i64).unwrap_or(40))?),
        },
        "automations_runs" => {
            let mut stmt = conn.prepare(
                "SELECT id, status, trigger, scheduled_for, started_at, finished_at, error FROM runs WHERE automation_id = ?1 ORDER BY COALESCE(started_at, scheduled_for) DESC LIMIT ?2",
            )?;
            let limit = a.get("limit").and_then(Value::as_i64).unwrap_or(20).clamp(1, 200);
            let rows = stmt
                .query_map(params![s(a, "automationId")?, limit], |r| {
                    Ok(json!({
                        "id": r.get::<_, String>(0)?, "status": r.get::<_, String>(1)?, "trigger": r.get::<_, String>(2)?,
                        "scheduledFor": r.get::<_, Option<i64>>(3)?, "startedAt": r.get::<_, Option<i64>>(4)?,
                        "finishedAt": r.get::<_, Option<i64>>(5)?, "error": r.get::<_, Option<String>>(6)?
                    }))
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            json!(rows)
        }
        _ => return Ok(None),
    };
    Ok(Some(out))
}
