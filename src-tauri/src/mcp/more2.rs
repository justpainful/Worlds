//! Worlds tools, part two: tasks, tables, block surgery, page structure,
//! properties and collections, versions, templates, automations, chats,
//! profile links, cross-workspace search, activity, the Discord queue and
//! settings. Writes go through the store with the caller's context, so they
//! land in history and can be undone.

use super::{md_nodes, os, s, tool};
use crate::content;
use crate::store::{self, Ctx};
use anyhow::{anyhow, bail, Result};
use rusqlite::{params, Connection};
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap};

pub fn tools() -> Vec<Value> {
    let pid = json!({ "type": "string", "description": "Page id" });
    let bid = json!({ "type": "string", "description": "Block id" });
    let scope = json!({
        "pageIds": { "type": "array", "items": { "type": "string" } },
        "parentId": { "type": "string", "description": "All direct children of this page" },
        "all": { "type": "boolean", "description": "Every page in the workspace" }
    });
    let with_scope = |extra: Value| -> Value {
        let mut m = scope.as_object().cloned().unwrap();
        for (k, v) in extra.as_object().cloned().unwrap() {
            m.insert(k, v);
        }
        Value::Object(m)
    };
    vec![
        // Tasks
        tool("tasks_list", "Checklist items across the workspace or one page, with their page, block id, index and state. Use it for to-do overviews.", json!({ "pageId": pid, "status": { "type": "string", "enum": ["open", "done", "all"] }, "limit": { "type": "integer" } }), &[]),
        tool("tasks_set", "Check or uncheck a checklist item, by its block id plus index (from tasks_list) or by matching its text.", json!({ "blockId": bid, "index": { "type": "integer" }, "text": { "type": "string" }, "checked": { "type": "boolean" } }), &["checked"]),
        tool("tasks_add", "Add checklist items to a page (at the end, or after a block).", json!({ "pageId": pid, "items": { "type": "array", "items": { "type": "string" } }, "afterBlockId": bid }), &["pageId", "items"]),
        tool("tasks_clear_done", "Remove completed checklist items from a page. Only when the user asked. Undoable.", json!({ "pageId": pid }), &["pageId"]),
        // Tables
        tool("tables_read", "Every table on a page as rows of cell text, with block ids.", json!({ "pageId": pid }), &["pageId"]),
        tool("tables_append_row", "Append a row to a table block.", json!({ "blockId": bid, "cells": { "type": "array", "items": { "type": "string" } } }), &["blockId", "cells"]),
        tool("tables_update_cell", "Set the text of one table cell (row and column start at 0; row 0 is the header).", json!({ "blockId": bid, "row": { "type": "integer" }, "col": { "type": "integer" }, "text": { "type": "string" } }), &["blockId", "row", "col", "text"]),
        tool("tables_from_csv", "Insert a table built from CSV text (first row becomes the header).", json!({ "pageId": pid, "csv": { "type": "string" }, "afterBlockId": bid }), &["pageId", "csv"]),
        tool("tables_to_csv", "A table block as CSV text.", json!({ "blockId": bid }), &["blockId"]),
        // Blocks
        tool("blocks_list_by_type", "Blocks of one type on a page (heading, paragraph, bulletList, orderedList, taskList, table, image, video, file, codeBlock, callout, blockquote, columns, toggle, collection, pageLink, embed).", json!({ "pageId": pid, "type": { "type": "string" } }), &["pageId", "type"]),
        tool("blocks_duplicate", "Duplicate a block right after itself.", json!({ "blockId": bid }), &["blockId"]),
        tool("blocks_copy_to_page", "Copy blocks to another page (at the end, or after a block there).", json!({ "blockIds": { "type": "array", "items": { "type": "string" } }, "targetPageId": pid, "afterBlockId": bid }), &["blockIds", "targetPageId"]),
        tool("blocks_move_to_page", "Move blocks to another page (copied there, removed here). Undoable.", json!({ "blockIds": { "type": "array", "items": { "type": "string" } }, "targetPageId": pid, "afterBlockId": bid }), &["blockIds", "targetPageId"]),
        tool("blocks_convert", "Turn a block into another kind while keeping its text: paragraph, heading1, heading2, heading3, bullet, numbered, todo, quote, callout, code.", json!({ "blockId": bid, "to": { "type": "string", "enum": ["paragraph", "heading1", "heading2", "heading3", "bullet", "numbered", "todo", "quote", "callout", "code"] } }), &["blockId", "to"]),
        tool("blocks_set_direction", "Force a block's text direction: rtl for Arabic, ltr for English, auto to follow the first letter.", json!({ "blockId": bid, "direction": { "type": "string", "enum": ["auto", "rtl", "ltr"] } }), &["blockId", "direction"]),
        // Pages: structure and analysis
        tool("pages_stats", "Numbers for a page: words, characters, reading time, blocks by type, headings, open and done tasks, tables, images, links, attachments, dates.", json!({ "pageId": pid }), &["pageId"]),
        tool("pages_links", "What a page points to: page mentions, subpage links and web links.", json!({ "pageId": pid }), &["pageId"]),
        tool("pages_recent", "Recently opened or edited pages.", json!({ "by": { "type": "string", "enum": ["opened", "edited"] }, "limit": { "type": "integer" } }), &[]),
        tool("pages_stale", "Pages not edited for a number of days (default 60), oldest first. Good for clean-up suggestions.", json!({ "days": { "type": "integer" }, "limit": { "type": "integer" } }), &[]),
        tool("pages_reorder_children", "Put a parent's subpages (or top-level pages) in an exact order.", json!({ "parentId": { "type": "string", "description": "Omit for top level" }, "orderedIds": { "type": "array", "items": { "type": "string" } } }), &["orderedIds"]),
        tool("pages_sort_children", "Sort a parent's subpages by title, created, updated, or a property.", json!({ "parentId": { "type": "string" }, "by": { "type": "string", "description": "title, created, updated, or a property name" }, "descending": { "type": "boolean" } }), &["by"]),
        tool("pages_merge", "Append the content of several pages into one target page (each under its title as a heading), optionally archiving the sources.", json!({ "targetPageId": pid, "sourcePageIds": { "type": "array", "items": { "type": "string" } }, "archiveSources": { "type": "boolean" }, "withHeadings": { "type": "boolean" } }), &["targetPageId", "sourcePageIds"]),
        tool("pages_split_by_headings", "Split a long page: every heading of a level becomes a subpage holding its section, and a link to it stays in place of the moved content.", json!({ "pageId": pid, "level": { "type": "integer", "description": "1 or 2 (default 2)" } }), &["pageId"]),
        tool("pages_insert_toc", "Insert a table of contents (a nested list of the page's headings) at the top or after a block.", json!({ "pageId": pid, "afterBlockId": bid }), &["pageId"]),
        tool("pages_rename_many", "Rename several pages at once: find and replace in titles, or add a prefix or suffix.", json!({ "pageIds": { "type": "array", "items": { "type": "string" } }, "parentId": { "type": "string" }, "find": { "type": "string" }, "replace": { "type": "string" }, "prefix": { "type": "string" }, "suffix": { "type": "string" } }), &[]),
        tool("archive_list", "Archived pages.", json!({}), &[]),
        // Properties and collections
        tool("properties_schema", "The properties used across a set of pages: names, types, options and how many pages fill each.", with_scope(json!({})), &[]),
        tool("properties_rename", "Rename a property across a set of pages.", with_scope(json!({ "from": { "type": "string" }, "to": { "type": "string" } })), &["from", "to"]),
        tool("properties_remove", "Remove a property from a set of pages. Only when the user asked.", with_scope(json!({ "name": { "type": "string" } })), &["name"]),
        tool("properties_set_options", "Set the options (and colours) of a select, status or tags property across a set of pages.", with_scope(json!({ "name": { "type": "string" }, "options": { "type": "array", "items": { "type": "object", "properties": { "name": { "type": "string" }, "color": { "type": "string", "enum": ["gray", "blue", "green", "yellow", "orange", "red", "purple", "pink"] } } } } })), &["name", "options"]),
        tool("collections_list", "Collection blocks (live tables, boards, galleries) on a page with their settings.", json!({ "pageId": pid }), &["pageId"]),
        tool("collections_update", "Change a collection block: view, source, tag, groupBy, sortBy, sortDir, filter, title.", json!({ "blockId": bid, "patch": { "type": "object" } }), &["blockId", "patch"]),
        // Versions
        tool("versions_diff", "What changed between a saved version and the page now: lines added and removed.", json!({ "versionId": { "type": "string" } }), &["versionId"]),
        // Templates
        tool("templates_read", "A template's content as Markdown.", json!({ "templateId": { "type": "string" } }), &["templateId"]),
        tool("templates_update", "Rename a template or change its category.", json!({ "templateId": { "type": "string" }, "title": { "type": "string" }, "category": { "type": "string" } }), &["templateId"]),
        tool("templates_delete", "Move a template to Trash. Only when the user asked.", json!({ "templateId": { "type": "string" } }), &["templateId"]),
        // Automations
        tool("automations_read", "One automation in full: trigger, source page, destination, options, next and last run.", json!({ "id": { "type": "string" } }), &["id"]),
        tool("automations_toggle", "Turn an automation on or off.", json!({ "id": { "type": "string" }, "enabled": { "type": "boolean" } }), &["id", "enabled"]),
        tool("automations_upcoming", "The next scheduled runs across all enabled automations, soonest first.", json!({ "limit": { "type": "integer" } }), &[]),
        // Chats
        tool("chats_list", "Recent conversations with Claude (titles, ids, linked page).", json!({ "limit": { "type": "integer" } }), &[]),
        tool("chats_rename", "Rename a conversation.", json!({ "chatId": { "type": "string" }, "title": { "type": "string" } }), &["chatId", "title"]),
        tool("chats_delete", "Delete a conversation and its messages. Only when the user asked; never the current one.", json!({ "chatId": { "type": "string" } }), &["chatId"]),
        // Profile
        tool("profile_blocks_list", "The profile's blocks in order, with ids and which are featured (the first three).", json!({}), &[]),
        tool("profile_links_set", "Add or remove one profile link.", json!({ "action": { "type": "string", "enum": ["add", "remove"] }, "label": { "type": "string" }, "url": { "type": "string" } }), &["action"]),
        tool("profile_set_status", "Set or clear the short status line under the name.", json!({ "status": { "type": "string", "description": "Empty clears it" } }), &["status"]),
        // Search and activity
        tool("search_everything", "One search across pages, templates, conversations, automations and file names.", json!({ "query": { "type": "string" }, "limit": { "type": "integer" } }), &["query"]),
        tool("attachments_find", "Find attached files by name across the workspace.", json!({ "name": { "type": "string" }, "limit": { "type": "integer" } }), &["name"]),
        tool("activity_summary", "What changed recently, grouped by page and by who (you, Claude, automations).", json!({ "days": { "type": "integer" }, "actor": { "type": "string", "enum": ["user", "ai", "automation"] } }), &[]),
        // Discord
        tool("discord_pending", "Discord sends and edits waiting for the user's approval.", json!({}), &[]),
        tool("discord_sent", "Recently sent Discord messages from Worlds (page, destination, message id).", json!({ "limit": { "type": "integer" } }), &[]),
        // Settings
        tool("settings_read", "The app's settings: appearance, glass, transparency, motion, density, Claude model and effort, background running.", json!({}), &[]),
    ]
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

fn para(text: &str) -> Value {
    if text.is_empty() {
        json!({ "type": "paragraph" })
    } else {
        json!({ "type": "paragraph", "content": [{ "type": "text", "text": text }] })
    }
}

fn kids_mut(v: &mut Value) -> Option<&mut Vec<Value>> {
    v.get_mut("content").and_then(Value::as_array_mut)
}

fn block(conn: &Connection, id: &str) -> Result<store::Block> {
    store::block_by_id(conn, id)?.ok_or_else(|| anyhow!("block {id} not found"))
}

fn page_meta(conn: &Connection, id: &str) -> Result<store::PageMeta> {
    store::page_meta_by_id(conn, id)?.ok_or_else(|| anyhow!("page {id} not found"))
}

fn last_block(conn: &Connection, page: &str) -> Result<Option<String>> {
    Ok(store::blocks_of(conn, page)?.last().map(|b| b.id.clone()))
}

/// A fresh copy of a stored block for inserting elsewhere (no block id).
fn fresh(node: &Value) -> Value {
    let mut n = node.clone();
    if let Some(attrs) = n.get_mut("attrs").and_then(Value::as_object_mut) {
        attrs.remove("bid");
    }
    n
}

fn table_rows(node: &Value) -> Vec<Vec<String>> {
    content::children(node).iter().map(|row| content::children(row).iter().map(|c| content::plain_text(c).trim().to_string()).collect()).collect()
}

fn cell(text: &str, header: bool) -> Value {
    json!({ "type": if header { "tableHeader" } else { "tableCell" }, "content": [para(text)] })
}

fn parse_csv(src: &str) -> Vec<Vec<String>> {
    let mut rows = Vec::new();
    let mut row = Vec::new();
    let mut field = String::new();
    let mut quoted = false;
    let mut chars = src.chars().peekable();
    while let Some(c) = chars.next() {
        if quoted {
            if c == '"' {
                if chars.peek() == Some(&'"') {
                    field.push('"');
                    chars.next();
                } else {
                    quoted = false;
                }
            } else {
                field.push(c);
            }
        } else {
            match c {
                '"' => quoted = true,
                ',' | ';' | '\t' => row.push(std::mem::take(&mut field)),
                '\r' => {}
                '\n' => {
                    row.push(std::mem::take(&mut field));
                    rows.push(std::mem::take(&mut row));
                }
                _ => field.push(c),
            }
        }
    }
    if !field.is_empty() || !row.is_empty() {
        row.push(field);
        rows.push(row);
    }
    rows.into_iter().filter(|r| r.iter().any(|c| !c.trim().is_empty())).collect()
}

fn csv_escape(v: &str) -> String {
    if v.contains([',', '"', '\n']) {
        format!("\"{}\"", v.replace('"', "\"\""))
    } else {
        v.to_string()
    }
}

/// Visit task items in document order: (item, index).
fn for_tasks(node: &mut Value, idx: &mut usize, f: &mut dyn FnMut(&mut Value, usize)) {
    if content::node_type(node) == "taskItem" {
        f(node, *idx);
        *idx += 1;
    }
    if let Some(k) = kids_mut(node) {
        for c in k {
            for_tasks(c, idx, f);
        }
    }
}

fn scope_pages(conn: &Connection, a: &Value) -> Result<Vec<store::PageMeta>> {
    let all = store::list_pages(conn, false)?;
    if let Some(ids) = a.get("pageIds").and_then(Value::as_array) {
        let ids: Vec<&str> = ids.iter().filter_map(Value::as_str).collect();
        return Ok(all.into_iter().filter(|p| ids.contains(&p.id.as_str())).collect());
    }
    if let Some(parent) = os(a, "parentId") {
        return Ok(all.into_iter().filter(|p| p.parent_id.as_deref() == Some(parent)).collect());
    }
    if a.get("all").and_then(Value::as_bool).unwrap_or(false) {
        return Ok(all.into_iter().filter(|p| p.kind == "page").collect());
    }
    bail!("say which pages: pageIds, parentId or all")
}

fn props_vec(p: &store::PageMeta) -> Vec<Value> {
    p.properties.as_array().cloned().unwrap_or_default()
}

fn same_name(p: &Value, name: &str) -> bool {
    p.get("name").and_then(Value::as_str).map(|n| n.eq_ignore_ascii_case(name)).unwrap_or(false)
}

fn md_of_snapshot(snap: &Value) -> String {
    let list = snap.get("blocks").and_then(Value::as_array).or_else(|| snap.as_array()).cloned().unwrap_or_default();
    list.iter()
        .map(|b| content::to_markdown(b.get("content").filter(|c| c.get("type").is_some()).unwrap_or(b)))
        .filter(|m| !m.trim().is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

fn collect_links(node: &Value, pages: &mut Vec<Value>, urls: &mut Vec<String>) {
    match content::node_type(node) {
        "pageMention" => pages.push(json!({ "pageId": node.pointer("/attrs/id"), "label": node.pointer("/attrs/label"), "kind": "mention" })),
        "pageLink" => pages.push(json!({ "pageId": node.pointer("/attrs/pageId"), "label": node.pointer("/attrs/title"), "kind": "subpage" })),
        "embed" => {
            if let Some(u) = node.pointer("/attrs/url").and_then(Value::as_str) {
                urls.push(u.to_string());
            }
        }
        _ => {}
    }
    if let Some(marks) = node.get("marks").and_then(Value::as_array) {
        for m in marks {
            if content::node_type(m) == "link" {
                if let Some(h) = m.pointer("/attrs/href").and_then(Value::as_str) {
                    urls.push(h.to_string());
                }
            }
        }
    }
    for c in content::children(node) {
        collect_links(c, pages, urls);
    }
}

fn count_types(node: &Value, counts: &mut BTreeMap<String, usize>) {
    *counts.entry(content::node_type(node).to_string()).or_default() += 1;
    for c in content::children(node) {
        count_types(c, counts);
    }
}

fn order_children(conn: &Connection, ctx: &Ctx, parent: Option<&str>, ids: &[String]) -> Result<usize> {
    // Moving each page to the end, in order, leaves exactly this order.
    for id in ids {
        store::move_page(conn, ctx, id, parent, None)?;
    }
    Ok(ids.len())
}

// ---------------------------------------------------------------------------
// dispatch
// ---------------------------------------------------------------------------

pub fn call(conn: &Connection, ctx: &Ctx, name: &str, a: &Value) -> Result<Option<Value>> {
    let out = match name {
        // ---- tasks
        "tasks_list" => {
            let status = os(a, "status").unwrap_or("open");
            let limit = a.get("limit").and_then(Value::as_u64).unwrap_or(200) as usize;
            let pages: Vec<store::PageMeta> = match os(a, "pageId") {
                Some(p) => vec![page_meta(conn, p)?],
                None => store::list_pages(conn, false)?.into_iter().filter(|p| p.kind == "page" && !p.archived).collect(),
            };
            let (mut open, mut done) = (0usize, 0usize);
            let mut items = Vec::new();
            for p in &pages {
                for b in store::blocks_of(conn, &p.id)? {
                    let mut node = b.content.clone();
                    let mut i = 0;
                    for_tasks(&mut node, &mut i, &mut |item, idx| {
                        let checked = item.pointer("/attrs/checked").and_then(Value::as_bool).unwrap_or(false);
                        if checked { done += 1 } else { open += 1 }
                        let keep = match status { "done" => checked, "all" => true, _ => !checked };
                        if keep && items.len() < limit {
                            items.push(json!({ "pageId": p.id, "page": p.title, "blockId": b.id, "index": idx, "text": content::plain_text(item).trim(), "checked": checked }));
                        }
                    });
                }
            }
            json!({ "open": open, "done": done, "items": items })
        }
        "tasks_set" => {
            let checked = a.get("checked").and_then(Value::as_bool).ok_or_else(|| anyhow!("checked is required"))?;
            let want_text = os(a, "text").map(str::to_lowercase);
            let candidates: Vec<store::Block> = match os(a, "blockId") {
                Some(b) => vec![block(conn, b)?],
                None => {
                    let t = want_text.clone().ok_or_else(|| anyhow!("give blockId (+ index) or text"))?;
                    let mut found = Vec::new();
                    for p in store::list_pages(conn, false)?.into_iter().filter(|p| p.kind == "page" && !p.archived) {
                        for b in store::blocks_of(conn, &p.id)? {
                            if b.block_type == "taskList" && content::plain_text(&b.content).to_lowercase().contains(&t) {
                                found.push(b);
                            }
                        }
                    }
                    found
                }
            };
            let want_idx = a.get("index").and_then(Value::as_u64).map(|v| v as usize);
            let mut changed = 0;
            for b in candidates {
                let mut node = b.content.clone();
                let mut i = 0;
                let mut hit = false;
                for_tasks(&mut node, &mut i, &mut |item, idx| {
                    let text_ok = want_text.as_ref().map(|t| content::plain_text(item).to_lowercase().contains(t)).unwrap_or(true);
                    let idx_ok = want_idx.map(|w| w == idx).unwrap_or(true);
                    if text_ok && idx_ok && !hit {
                        item["attrs"]["checked"] = json!(checked);
                        hit = true;
                    }
                });
                if hit {
                    store::update_block(conn, ctx, &b.id, node)?;
                    changed += 1;
                    break;
                }
            }
            if changed == 0 {
                bail!("no matching checklist item");
            }
            json!({ "ok": true })
        }
        "tasks_add" => {
            let page = s(a, "pageId")?;
            let items: Vec<String> = a.get("items").and_then(Value::as_array).map(|v| v.iter().filter_map(Value::as_str).map(|t| format!("- [ ] {}", t.trim())).collect()).unwrap_or_default();
            if items.is_empty() {
                bail!("items is empty");
            }
            let after = match os(a, "afterBlockId") { Some(b) => Some(b.to_string()), None => last_block(conn, page)? };
            json!({ "inserted": store::insert_blocks(conn, ctx, page, after.as_deref(), md_nodes(&items.join("\n"))?)? })
        }
        "tasks_clear_done" => {
            let mut removed = 0;
            for b in store::blocks_of(conn, s(a, "pageId")?)? {
                if b.block_type != "taskList" {
                    continue;
                }
                let mut node = b.content.clone();
                let before = content::children(&node).len();
                if let Some(k) = kids_mut(&mut node) {
                    k.retain(|it| !it.pointer("/attrs/checked").and_then(Value::as_bool).unwrap_or(false));
                }
                let after = content::children(&node).len();
                if after == before {
                    continue;
                }
                removed += before - after;
                if after == 0 {
                    store::delete_block(conn, ctx, &b.id)?;
                } else {
                    store::update_block(conn, ctx, &b.id, node)?;
                }
            }
            json!({ "removed": removed })
        }
        // ---- tables
        "tables_read" => {
            let tables: Vec<Value> = store::blocks_of(conn, s(a, "pageId")?)?
                .into_iter()
                .filter(|b| b.block_type == "table")
                .map(|b| json!({ "blockId": b.id, "rows": table_rows(&b.content) }))
                .collect();
            json!(tables)
        }
        "tables_append_row" => {
            let b = block(conn, s(a, "blockId")?)?;
            if b.block_type != "table" {
                bail!("that block is not a table");
            }
            let mut node = b.content.clone();
            let width = content::children(&node).first().map(|r| content::children(r).len()).unwrap_or(1).max(1);
            let cells: Vec<String> = a.get("cells").and_then(Value::as_array).map(|v| v.iter().map(|c| c.as_str().map(str::to_string).unwrap_or_else(|| c.to_string())).collect()).unwrap_or_default();
            let row: Vec<Value> = (0..width).map(|i| cell(cells.get(i).map(String::as_str).unwrap_or(""), false)).collect();
            kids_mut(&mut node).ok_or_else(|| anyhow!("empty table"))?.push(json!({ "type": "tableRow", "content": row }));
            store::update_block(conn, ctx, &b.id, node)?;
            json!({ "ok": true })
        }
        "tables_update_cell" => {
            let b = block(conn, s(a, "blockId")?)?;
            let r = a.get("row").and_then(Value::as_u64).ok_or_else(|| anyhow!("row is required"))? as usize;
            let c = a.get("col").and_then(Value::as_u64).ok_or_else(|| anyhow!("col is required"))? as usize;
            let mut node = b.content.clone();
            let target = kids_mut(&mut node).and_then(|rows| rows.get_mut(r)).and_then(|row| kids_mut(row)).and_then(|cells| cells.get_mut(c)).ok_or_else(|| anyhow!("no cell at row {r}, column {c}"))?;
            target["content"] = json!([para(s(a, "text")?)]);
            store::update_block(conn, ctx, &b.id, node)?;
            json!({ "ok": true })
        }
        "tables_from_csv" => {
            let page = s(a, "pageId")?;
            let rows = parse_csv(s(a, "csv")?);
            if rows.is_empty() {
                bail!("the CSV has no rows");
            }
            let width = rows.iter().map(Vec::len).max().unwrap_or(1);
            let content: Vec<Value> = rows
                .iter()
                .enumerate()
                .map(|(i, r)| json!({ "type": "tableRow", "content": (0..width).map(|c| cell(r.get(c).map(|s| s.trim()).unwrap_or(""), i == 0)).collect::<Vec<_>>() }))
                .collect();
            let after = match os(a, "afterBlockId") { Some(b) => Some(b.to_string()), None => last_block(conn, page)? };
            json!({ "inserted": store::insert_blocks(conn, ctx, page, after.as_deref(), vec![json!({ "type": "table", "content": content })])?, "rows": rows.len(), "columns": width })
        }
        "tables_to_csv" => {
            let b = block(conn, s(a, "blockId")?)?;
            let csv = table_rows(&b.content).iter().map(|r| r.iter().map(|c| csv_escape(c)).collect::<Vec<_>>().join(",")).collect::<Vec<_>>().join("\n");
            json!({ "csv": csv })
        }
        // ---- blocks
        "blocks_list_by_type" => {
            let t = s(a, "type")?;
            let list: Vec<Value> = store::blocks_of(conn, s(a, "pageId")?)?
                .into_iter()
                .filter(|b| b.block_type == t)
                .map(|b| json!({ "blockId": b.id, "excerpt": content::plain_text(&b.content).chars().take(140).collect::<String>() }))
                .collect();
            json!(list)
        }
        "blocks_duplicate" => {
            let b = block(conn, s(a, "blockId")?)?;
            json!({ "inserted": store::insert_blocks(conn, ctx, &b.page_id, Some(&b.id), vec![fresh(&b.content)])? })
        }
        "blocks_copy_to_page" | "blocks_move_to_page" => {
            let target = s(a, "targetPageId")?;
            page_meta(conn, target)?;
            let ids: Vec<String> = a.get("blockIds").and_then(Value::as_array).map(|v| v.iter().filter_map(Value::as_str).map(str::to_string).collect()).unwrap_or_default();
            if ids.is_empty() {
                bail!("blockIds is empty");
            }
            let mut nodes = Vec::new();
            for id in &ids {
                nodes.push(fresh(&block(conn, id)?.content));
            }
            let after = match os(a, "afterBlockId") { Some(b) => Some(b.to_string()), None => last_block(conn, target)? };
            let inserted = store::insert_blocks(conn, ctx, target, after.as_deref(), nodes)?;
            if name == "blocks_move_to_page" {
                for id in &ids {
                    store::delete_block(conn, ctx, id)?;
                }
            }
            json!({ "inserted": inserted })
        }
        "blocks_convert" => {
            let b = block(conn, s(a, "blockId")?)?;
            let text = content::plain_text(&b.content).trim().to_string();
            let md = match s(a, "to")? {
                "heading1" => format!("# {text}"),
                "heading2" => format!("## {text}"),
                "heading3" => format!("### {text}"),
                "bullet" => text.lines().map(|l| format!("- {l}")).collect::<Vec<_>>().join("\n"),
                "numbered" => text.lines().enumerate().map(|(i, l)| format!("{}. {l}", i + 1)).collect::<Vec<_>>().join("\n"),
                "todo" => text.lines().map(|l| format!("- [ ] {l}")).collect::<Vec<_>>().join("\n"),
                "quote" => text.lines().map(|l| format!("> {l}")).collect::<Vec<_>>().join("\n"),
                "callout" => format!("> [!note] {text}"),
                "code" => format!("```\n{text}\n```"),
                _ => text.clone(),
            };
            let node = md_nodes(if md.trim().is_empty() { " " } else { &md })?.into_iter().next().ok_or_else(|| anyhow!("nothing to convert"))?;
            store::update_block(conn, ctx, &b.id, node)?;
            json!({ "ok": true })
        }
        "blocks_set_direction" => {
            let b = block(conn, s(a, "blockId")?)?;
            let dir = s(a, "direction")?;
            if !matches!(dir, "auto" | "rtl" | "ltr") {
                bail!("direction must be auto, rtl or ltr");
            }
            let mut node = b.content.clone();
            if node.get("attrs").is_none() {
                node["attrs"] = json!({});
            }
            node["attrs"]["dir"] = json!(dir);
            store::update_block(conn, ctx, &b.id, node)?;
            json!({ "ok": true })
        }
        // ---- pages
        "pages_stats" => {
            let id = s(a, "pageId")?;
            let page = store::get_page(conn, id)?.ok_or_else(|| anyhow!("page not found"))?;
            let mut types = BTreeMap::new();
            let mut text = String::new();
            let (mut open, mut done) = (0usize, 0usize);
            let mut pages_l = Vec::new();
            let mut urls = Vec::new();
            for b in &page.blocks {
                count_types(&b.content, &mut types);
                text.push_str(&content::plain_text(&b.content));
                text.push('\n');
                let mut node = b.content.clone();
                let mut i = 0;
                for_tasks(&mut node, &mut i, &mut |item, _| {
                    if item.pointer("/attrs/checked").and_then(Value::as_bool).unwrap_or(false) { done += 1 } else { open += 1 }
                });
                collect_links(&b.content, &mut pages_l, &mut urls);
            }
            let words = text.split_whitespace().count();
            json!({
                "title": page.meta.title, "words": words, "characters": text.chars().filter(|c| !c.is_whitespace()).count(),
                "readingMinutes": ((words as f64) / 200.0).ceil() as i64, "blocks": page.blocks.len(),
                "nodeTypes": types, "headings": types.get("heading").copied().unwrap_or(0),
                "tasksOpen": open, "tasksDone": done, "tables": types.get("table").copied().unwrap_or(0),
                "images": types.get("image").copied().unwrap_or(0), "pageLinks": pages_l.len(), "webLinks": urls.len(),
                "attachments": page.attachments.len(), "createdAt": page.meta.created_at, "updatedAt": page.meta.updated_at,
            })
        }
        "pages_links" => {
            let mut pages_l = Vec::new();
            let mut urls = Vec::new();
            for b in store::blocks_of(conn, s(a, "pageId")?)? {
                collect_links(&b.content, &mut pages_l, &mut urls);
            }
            urls.sort();
            urls.dedup();
            json!({ "pages": pages_l, "urls": urls })
        }
        "pages_recent" => {
            let mut all: Vec<store::PageMeta> = store::list_pages(conn, false)?.into_iter().filter(|p| p.kind == "page" && !p.archived).collect();
            if os(a, "by") == Some("opened") {
                all.sort_by(|x, y| y.opened_at.unwrap_or(0).cmp(&x.opened_at.unwrap_or(0)));
            } else {
                all.sort_by(|x, y| y.updated_at.cmp(&x.updated_at));
            }
            let n = a.get("limit").and_then(Value::as_u64).unwrap_or(15) as usize;
            json!(all.iter().take(n).map(|p| json!({ "id": p.id, "title": p.title, "icon": p.icon, "updatedAt": p.updated_at, "openedAt": p.opened_at })).collect::<Vec<_>>())
        }
        "pages_stale" => {
            let days = a.get("days").and_then(Value::as_i64).unwrap_or(60);
            let cutoff = crate::db::now() - days * 86_400_000;
            let mut list: Vec<store::PageMeta> = store::list_pages(conn, false)?.into_iter().filter(|p| p.kind == "page" && !p.archived && p.updated_at < cutoff).collect();
            list.sort_by_key(|p| p.updated_at);
            let n = a.get("limit").and_then(Value::as_u64).unwrap_or(30) as usize;
            json!(list.iter().take(n).map(|p| json!({ "id": p.id, "title": p.title, "updatedAt": p.updated_at, "daysIdle": (crate::db::now() - p.updated_at) / 86_400_000 })).collect::<Vec<_>>())
        }
        "pages_reorder_children" => {
            let ids: Vec<String> = a.get("orderedIds").and_then(Value::as_array).map(|v| v.iter().filter_map(Value::as_str).map(str::to_string).collect()).unwrap_or_default();
            json!({ "ordered": order_children(conn, ctx, os(a, "parentId"), &ids)? })
        }
        "pages_sort_children" => {
            let parent = os(a, "parentId");
            let by = s(a, "by")?;
            let desc = a.get("descending").and_then(Value::as_bool).unwrap_or(false);
            let mut kids: Vec<store::PageMeta> = store::list_pages(conn, false)?.into_iter().filter(|p| p.parent_id.as_deref() == parent && p.kind == "page").collect();
            let key = |p: &store::PageMeta| -> String {
                match by {
                    "title" => p.title.to_lowercase(),
                    "created" => format!("{:020}", p.created_at),
                    "updated" => format!("{:020}", p.updated_at),
                    prop => p.properties.as_array().and_then(|ps| ps.iter().find(|x| same_name(x, prop))).map(|x| match &x["value"] {
                        Value::Number(n) => format!("{:020.4}", n.as_f64().unwrap_or(0.0) + 1e12),
                        v => v.to_string().to_lowercase(),
                    }).unwrap_or_else(|| "\u{10FFFF}".into()),
                }
            };
            kids.sort_by_key(|p| key(p));
            if desc {
                kids.reverse();
            }
            let ids: Vec<String> = kids.into_iter().map(|p| p.id).collect();
            json!({ "sorted": order_children(conn, ctx, parent, &ids)? })
        }
        "pages_merge" => {
            let target = s(a, "targetPageId")?;
            page_meta(conn, target)?;
            let with_heads = a.get("withHeadings").and_then(Value::as_bool).unwrap_or(true);
            let archive = a.get("archiveSources").and_then(Value::as_bool).unwrap_or(false);
            let sources: Vec<String> = a.get("sourcePageIds").and_then(Value::as_array).map(|v| v.iter().filter_map(Value::as_str).map(str::to_string).collect()).unwrap_or_default();
            let mut moved = 0;
            for src in &sources {
                let meta = page_meta(conn, src)?;
                let mut nodes: Vec<Value> = Vec::new();
                if with_heads {
                    nodes.push(json!({ "type": "heading", "attrs": { "level": 2 }, "content": [{ "type": "text", "text": if meta.title.is_empty() { "Untitled" } else { &meta.title } }] }));
                }
                nodes.extend(store::blocks_of(conn, src)?.iter().map(|b| fresh(&b.content)));
                if nodes.is_empty() {
                    continue;
                }
                let after = last_block(conn, target)?;
                moved += store::insert_blocks(conn, ctx, target, after.as_deref(), nodes)?.len();
                if archive {
                    store::update_page(conn, ctx, src, store::PagePatch { archived: Some(true), ..Default::default() })?;
                }
            }
            json!({ "blocksAdded": moved, "archivedSources": archive })
        }
        "pages_split_by_headings" => {
            let page = s(a, "pageId")?;
            let level = a.get("level").and_then(Value::as_u64).unwrap_or(2);
            let blocks = store::blocks_of(conn, page)?;
            let mut made = Vec::new();
            let mut i = 0;
            while i < blocks.len() {
                let b = &blocks[i];
                let lvl = b.content.pointer("/attrs/level").and_then(Value::as_u64);
                if b.block_type == "heading" && lvl == Some(level) {
                    let mut j = i + 1;
                    while j < blocks.len() {
                        let n = &blocks[j];
                        let nl = n.content.pointer("/attrs/level").and_then(Value::as_u64).unwrap_or(9);
                        if n.block_type == "heading" && nl <= level {
                            break;
                        }
                        j += 1;
                    }
                    let section: Vec<&store::Block> = blocks[i + 1..j].iter().collect();
                    if !section.is_empty() {
                        let title = content::plain_text(&b.content).trim().to_string();
                        let sub = store::create_page(conn, ctx, store::NewPage {
                            title: Some(title.clone()),
                            parent_id: Some(page.to_string()),
                            blocks: Some(section.iter().map(|x| fresh(&x.content)).collect()),
                            ..Default::default()
                        })?;
                        for x in &section {
                            store::delete_block(conn, ctx, &x.id)?;
                        }
                        store::insert_blocks(conn, ctx, page, Some(&b.id), vec![json!({ "type": "pageLink", "attrs": { "pageId": sub.id, "title": title } })])?;
                        made.push(json!({ "id": sub.id, "title": sub.title }));
                    }
                    i = j;
                } else {
                    i += 1;
                }
            }
            json!({ "subpages": made })
        }
        "pages_insert_toc" => {
            let page = s(a, "pageId")?;
            let blocks = store::blocks_of(conn, page)?;
            let lines: Vec<String> = blocks
                .iter()
                .filter(|b| b.block_type == "heading")
                .map(|b| {
                    let lvl = b.content.pointer("/attrs/level").and_then(Value::as_u64).unwrap_or(1) as usize;
                    format!("{}- {}", "  ".repeat(lvl.saturating_sub(1)), content::plain_text(&b.content).trim())
                })
                .collect();
            if lines.is_empty() {
                bail!("the page has no headings");
            }
            let md = format!("**Contents**\n\n{}", lines.join("\n"));
            let ids = match os(a, "afterBlockId") {
                Some(after) => store::insert_blocks(conn, ctx, page, Some(after), md_nodes(&md)?)?,
                None => {
                    let ids = store::insert_blocks(conn, ctx, page, None, md_nodes(&md)?)?;
                    let mut prev: Option<String> = None;
                    for id in &ids {
                        store::move_block(conn, ctx, id, prev.as_deref())?;
                        prev = Some(id.clone());
                    }
                    ids
                }
            };
            json!({ "inserted": ids })
        }
        "pages_rename_many" => {
            let pages: Vec<store::PageMeta> = if a.get("pageIds").is_some() || a.get("parentId").is_some() { scope_pages(conn, a)? } else { bail!("give pageIds or parentId") };
            let mut renamed = Vec::new();
            for p in pages {
                let mut t = p.title.clone();
                if let (Some(f), Some(r)) = (os(a, "find"), os(a, "replace")) {
                    if !f.is_empty() {
                        t = t.replace(f, r);
                    }
                }
                if let Some(pre) = os(a, "prefix") {
                    if !t.starts_with(pre) {
                        t = format!("{pre}{t}");
                    }
                }
                if let Some(suf) = os(a, "suffix") {
                    if !t.ends_with(suf) {
                        t = format!("{t}{suf}");
                    }
                }
                if t != p.title {
                    store::update_page(conn, ctx, &p.id, store::PagePatch { title: Some(t.clone()), ..Default::default() })?;
                    renamed.push(json!({ "id": p.id, "from": p.title, "to": t }));
                }
            }
            json!({ "renamed": renamed })
        }
        "archive_list" => {
            let list: Vec<Value> = store::list_pages(conn, false)?.into_iter().filter(|p| p.archived && p.kind == "page").map(|p| json!({ "id": p.id, "title": p.title, "updatedAt": p.updated_at })).collect();
            json!(list)
        }
        // ---- properties and collections
        "properties_schema" => {
            let pages = scope_pages(conn, a)?;
            let mut schema: BTreeMap<String, (String, Vec<Value>, usize)> = BTreeMap::new();
            for p in &pages {
                for pr in props_vec(p) {
                    let name = pr["name"].as_str().unwrap_or("").to_string();
                    if name.is_empty() {
                        continue;
                    }
                    let entry = schema.entry(name).or_insert_with(|| (pr["type"].as_str().unwrap_or("text").to_string(), Vec::new(), 0));
                    for o in pr["options"].as_array().cloned().unwrap_or_default() {
                        if !entry.1.iter().any(|x| x["name"] == o["name"]) {
                            entry.1.push(o);
                        }
                    }
                    let filled = !matches!(&pr["value"], Value::Null) && pr["value"] != json!("") && pr["value"] != json!([]);
                    if filled {
                        entry.2 += 1;
                    }
                }
            }
            json!({ "pages": pages.len(), "properties": schema.into_iter().map(|(n, (t, o, c))| json!({ "name": n, "type": t, "options": o, "filled": c })).collect::<Vec<_>>() })
        }
        "properties_rename" | "properties_remove" | "properties_set_options" => {
            let pages = scope_pages(conn, a)?;
            let target = if name == "properties_rename" { s(a, "from")? } else { s(a, "name")? };
            let mut touched = 0;
            for p in pages {
                let mut props = props_vec(&p);
                let before = props.clone();
                match name {
                    "properties_rename" => {
                        let to = s(a, "to")?;
                        for pr in props.iter_mut().filter(|pr| same_name(pr, target)) {
                            pr["name"] = json!(to);
                        }
                    }
                    "properties_remove" => props.retain(|pr| !same_name(pr, target)),
                    _ => {
                        let opts = a.get("options").cloned().unwrap_or(json!([]));
                        for pr in props.iter_mut().filter(|pr| same_name(pr, target)) {
                            pr["options"] = opts.clone();
                        }
                    }
                }
                if props != before {
                    store::set_page_meta(conn, ctx, &p.id, "properties", Value::Array(props))?;
                    touched += 1;
                }
            }
            json!({ "pagesChanged": touched })
        }
        "collections_list" => {
            let list: Vec<Value> = store::blocks_of(conn, s(a, "pageId")?)?.into_iter().filter(|b| b.block_type == "collection").map(|b| json!({ "blockId": b.id, "settings": b.content.get("attrs") })).collect();
            json!(list)
        }
        "collections_update" => {
            let b = block(conn, s(a, "blockId")?)?;
            if b.block_type != "collection" {
                bail!("that block is not a collection");
            }
            let patch = a.get("patch").and_then(Value::as_object).cloned().ok_or_else(|| anyhow!("patch must be an object"))?;
            let mut node = b.content.clone();
            if node.get("attrs").is_none() {
                node["attrs"] = json!({});
            }
            for (k, v) in patch {
                if matches!(k.as_str(), "view" | "source" | "tag" | "groupBy" | "sortBy" | "sortDir" | "filter" | "title" | "columns") {
                    node["attrs"][k] = v;
                }
            }
            store::update_block(conn, ctx, &b.id, node)?;
            json!({ "ok": true })
        }
        // ---- versions
        "versions_diff" => {
            let (page_id, snap): (String, String) = conn.query_row("SELECT page_id, snapshot FROM versions WHERE id = ?1", [s(a, "versionId")?], |r| Ok((r.get(0)?, r.get(1)?)))?;
            let old = md_of_snapshot(&serde_json::from_str(&snap).unwrap_or(json!([])));
            let now: String = store::blocks_of(conn, &page_id)?.iter().map(|b| content::to_markdown(&b.content)).filter(|m| !m.trim().is_empty()).collect::<Vec<_>>().join("\n");
            let mut count: HashMap<&str, i64> = HashMap::new();
            for l in old.lines().filter(|l| !l.trim().is_empty()) {
                *count.entry(l).or_default() += 1;
            }
            let mut added = Vec::new();
            for l in now.lines().filter(|l| !l.trim().is_empty()) {
                match count.get_mut(l) {
                    Some(c) if *c > 0 => *c -= 1,
                    _ => added.push(l.to_string()),
                }
            }
            let removed: Vec<String> = count.into_iter().filter(|(_, c)| *c > 0).flat_map(|(l, c)| std::iter::repeat(l.to_string()).take(c as usize)).collect();
            json!({ "pageId": page_id, "added": added, "removed": removed })
        }
        // ---- templates
        "templates_read" => {
            let page = store::get_page(conn, s(a, "templateId")?)?.ok_or_else(|| anyhow!("template not found"))?;
            let md = page.blocks.iter().map(|b| content::to_markdown(&b.content)).collect::<Vec<_>>().join("\n\n");
            json!({ "title": page.meta.title, "category": page.meta.template_category, "markdown": md })
        }
        "templates_update" => {
            let id = s(a, "templateId")?;
            let cat = os(a, "category").map(|c| Some(c.to_string()));
            store::update_page(conn, ctx, id, store::PagePatch { title: os(a, "title").map(str::to_string), template_category: cat, ..Default::default() })?;
            json!({ "ok": true })
        }
        "templates_delete" => {
            store::delete_page(conn, ctx, s(a, "templateId")?)?;
            json!({ "ok": true })
        }
        // ---- automations
        "automations_read" => json!(crate::automations::get(conn, s(a, "id")?)?.ok_or_else(|| anyhow!("automation not found"))?),
        "automations_toggle" => {
            let id = s(a, "id")?;
            let cur = crate::automations::get(conn, id)?.ok_or_else(|| anyhow!("automation not found"))?;
            let au = crate::automations::save(conn, ctx, crate::automations::AutomationInput {
                id: Some(id.to_string()),
                name: cur.name,
                enabled: a.get("enabled").and_then(Value::as_bool).unwrap_or(!cur.enabled),
                spec: cur.spec,
            })?;
            json!({ "id": au.id, "enabled": au.enabled, "nextRunAt": au.next_run_at })
        }
        "automations_upcoming" => {
            let mut list: Vec<crate::automations::Automation> = crate::automations::list(conn)?.into_iter().filter(|x| x.enabled && x.next_run_at.is_some()).collect();
            list.sort_by_key(|x| x.next_run_at.unwrap_or(i64::MAX));
            let n = a.get("limit").and_then(Value::as_u64).unwrap_or(10) as usize;
            json!(list.iter().take(n).map(|x| json!({ "id": x.id, "name": x.name, "nextRunAt": x.next_run_at })).collect::<Vec<_>>())
        }
        // ---- chats
        "chats_list" => {
            let mut stmt = conn.prepare("SELECT id, title, page_id, updated_at FROM ai_chats ORDER BY updated_at DESC LIMIT ?1")?;
            let n = a.get("limit").and_then(Value::as_i64).unwrap_or(20).clamp(1, 200);
            let rows = stmt.query_map([n], |r| Ok(json!({ "chatId": r.get::<_, String>(0)?, "title": r.get::<_, String>(1)?, "pageId": r.get::<_, Option<String>>(2)?, "updatedAt": r.get::<_, i64>(3)? })))?.collect::<rusqlite::Result<Vec<_>>>()?;
            json!(rows)
        }
        "chats_rename" => {
            let n = conn.execute("UPDATE ai_chats SET title = ?1 WHERE id = ?2", params![s(a, "title")?.trim(), s(a, "chatId")?])?;
            if n == 0 {
                bail!("conversation not found");
            }
            crate::db::mark_change(conn, None, "chats", &ctx.origin)?;
            json!({ "ok": true })
        }
        "chats_delete" => {
            let n = conn.execute("DELETE FROM ai_chats WHERE id = ?1", [s(a, "chatId")?])?;
            if n == 0 {
                bail!("conversation not found");
            }
            crate::db::mark_change(conn, None, "chats", &ctx.origin)?;
            json!({ "ok": true })
        }
        // ---- profile
        "profile_blocks_list" => {
            let blocks = store::profile(conn)?.blocks.as_array().cloned().unwrap_or_default();
            json!(blocks.iter().enumerate().map(|(i, b)| json!({ "index": i, "featured": i < 3, "block": b })).collect::<Vec<_>>())
        }
        "profile_links_set" => {
            let p = store::profile(conn)?;
            let mut links = p.links.as_array().cloned().unwrap_or_default();
            match s(a, "action")? {
                "add" => {
                    let url = s(a, "url")?.trim().to_string();
                    let url = if url.starts_with("http") { url } else { format!("https://{url}") };
                    links.push(json!({ "label": os(a, "label").unwrap_or(""), "url": url }));
                }
                _ => {
                    let label = os(a, "label").map(str::to_lowercase);
                    let url = os(a, "url");
                    links.retain(|l| !(label.as_ref().map(|x| l["label"].as_str().map(str::to_lowercase).as_ref() == Some(x)).unwrap_or(false) || url.map(|u| l["url"].as_str() == Some(u)).unwrap_or(false)));
                }
            }
            let p = store::update_profile_as(conn, ctx, store::ProfilePatch { links: Some(Value::Array(links)), ..Default::default() })?;
            json!({ "links": p.links })
        }
        "profile_set_status" => {
            let v = s(a, "status")?.trim().to_string();
            store::update_profile_as(conn, ctx, store::ProfilePatch { status: Some(if v.is_empty() { None } else { Some(v) }), ..Default::default() })?;
            json!({ "ok": true })
        }
        // ---- search and activity
        "search_everything" => {
            let q = s(a, "query")?;
            let n = a.get("limit").and_then(Value::as_i64).unwrap_or(10);
            let like = format!("%{}%", q.replace('%', "").replace('_', ""));
            let pages = store::search(conn, q, n, true)?;
            let mut stmt = conn.prepare("SELECT DISTINCT c.id, c.title FROM ai_chats c LEFT JOIN ai_messages m ON m.chat_id = c.id WHERE c.title LIKE ?1 OR m.content LIKE ?1 ORDER BY c.updated_at DESC LIMIT ?2")?;
            let chats = stmt.query_map(params![like, n], |r| Ok(json!({ "chatId": r.get::<_, String>(0)?, "title": r.get::<_, String>(1)? })))?.collect::<rusqlite::Result<Vec<_>>>()?;
            let mut stmt = conn.prepare("SELECT id, name FROM automations WHERE name LIKE ?1 LIMIT ?2")?;
            let autos = stmt.query_map(params![like, n], |r| Ok(json!({ "id": r.get::<_, String>(0)?, "name": r.get::<_, String>(1)? })))?.collect::<rusqlite::Result<Vec<_>>>()?;
            let mut stmt = conn.prepare("SELECT id, file_name, page_id FROM attachments WHERE file_name LIKE ?1 ORDER BY created_at DESC LIMIT ?2")?;
            let files = stmt.query_map(params![like, n], |r| Ok(json!({ "id": r.get::<_, String>(0)?, "fileName": r.get::<_, String>(1)?, "pageId": r.get::<_, Option<String>>(2)? })))?.collect::<rusqlite::Result<Vec<_>>>()?;
            json!({
                "pages": pages.iter().map(|h| json!({ "pageId": h.page_id, "title": h.title, "kind": h.kind, "snippet": h.snippet.replace('\u{E000}', "«").replace('\u{E001}', "»") })).collect::<Vec<_>>(),
                "chats": chats, "automations": autos, "files": files
            })
        }
        "attachments_find" => {
            let like = format!("%{}%", s(a, "name")?.replace('%', ""));
            let n = a.get("limit").and_then(Value::as_i64).unwrap_or(30);
            let mut stmt = conn.prepare("SELECT id, file_name, kind, size, page_id, created_at FROM attachments WHERE file_name LIKE ?1 ORDER BY created_at DESC LIMIT ?2")?;
            let rows = stmt
                .query_map(params![like, n], |r| Ok(json!({ "id": r.get::<_, String>(0)?, "fileName": r.get::<_, String>(1)?, "kind": r.get::<_, String>(2)?, "size": r.get::<_, i64>(3)?, "pageId": r.get::<_, Option<String>>(4)?, "createdAt": r.get::<_, i64>(5)? })))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            json!(rows)
        }
        "activity_summary" => {
            let days = a.get("days").and_then(Value::as_i64).unwrap_or(7);
            let since = crate::db::now() - days * 86_400_000;
            let actor = os(a, "actor");
            let mut stmt = conn.prepare(
                "SELECT h.page_id, COALESCE(p.title, ''), h.actor, COUNT(*), MAX(h.created_at) FROM history h LEFT JOIN pages p ON p.id = h.page_id
                 WHERE h.created_at >= ?1 AND (?2 IS NULL OR h.actor = ?2) GROUP BY h.page_id, h.actor ORDER BY MAX(h.created_at) DESC LIMIT 60",
            )?;
            let rows = stmt
                .query_map(params![since, actor], |r| Ok(json!({ "pageId": r.get::<_, Option<String>>(0)?, "title": r.get::<_, String>(1)?, "actor": r.get::<_, String>(2)?, "changes": r.get::<_, i64>(3)?, "last": r.get::<_, i64>(4)? })))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            let total: i64 = rows.iter().map(|r| r["changes"].as_i64().unwrap_or(0)).sum();
            json!({ "days": days, "totalChanges": total, "byPage": rows })
        }
        // ---- discord
        "discord_pending" => {
            let mut stmt = conn.prepare("SELECT id, kind, payload, requested_by, created_at FROM pending_actions WHERE status = 'pending' ORDER BY created_at DESC")?;
            let rows = stmt
                .query_map([], |r| {
                    let payload: String = r.get(2)?;
                    let v: Value = serde_json::from_str(&payload).unwrap_or(json!({}));
                    Ok(json!({ "id": r.get::<_, String>(0)?, "kind": r.get::<_, String>(1)?, "requestedBy": r.get::<_, String>(3)?, "createdAt": r.get::<_, i64>(4)?, "pageId": v.get("pageId"), "destination": v.get("destination") }))
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            json!(rows)
        }
        "discord_sent" => {
            let n = a.get("limit").and_then(Value::as_i64).unwrap_or(20);
            let mut stmt = conn.prepare("SELECT d.id, d.page_id, COALESCE(p.title, ''), d.destination, d.channel_id, d.message_id, d.created_at, d.edited_at FROM discord_messages d LEFT JOIN pages p ON p.id = d.page_id ORDER BY d.created_at DESC LIMIT ?1")?;
            let rows = stmt
                .query_map([n], |r| {
                    let dest: String = r.get(3)?;
                    Ok(json!({ "id": r.get::<_, String>(0)?, "pageId": r.get::<_, Option<String>>(1)?, "page": r.get::<_, String>(2)?, "destination": serde_json::from_str::<Value>(&dest).unwrap_or(json!(dest)), "channelId": r.get::<_, Option<String>>(4)?, "messageId": r.get::<_, Option<String>>(5)?, "sentAt": r.get::<_, i64>(6)?, "editedAt": r.get::<_, Option<i64>>(7)? }))
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            json!(rows)
        }
        // ---- settings
        "settings_read" => {
            let mut stmt = conn.prepare("SELECT key, value FROM settings WHERE key NOT IN ('session') AND key NOT LIKE 'discord.%key%'")?;
            let mut out = serde_json::Map::new();
            for row in stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))? {
                let (k, v) = row?;
                if v.len() > 4000 {
                    continue;
                }
                out.insert(k, serde_json::from_str(&v).unwrap_or(Value::String(v)));
            }
            Value::Object(out)
        }
        _ => return Ok(None),
    };
    Ok(Some(out))
}
