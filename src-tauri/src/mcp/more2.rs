//! Worlds tools, part two: the tool list and the helpers shared by the
//! tasks_tables, page_structure and workspace modules, which hold the
//! handlers. Writes go through the store with the caller's context, so they
//! land in history and can be undone.

use super::{os, tool};
use crate::content;
use crate::store::{self, Ctx};
use anyhow::{anyhow, bail, Result};
use rusqlite::Connection;
use serde_json::{json, Value};
use std::collections::BTreeMap;

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

pub(super) fn para(text: &str) -> Value {
    if text.is_empty() {
        json!({ "type": "paragraph" })
    } else {
        json!({ "type": "paragraph", "content": [{ "type": "text", "text": text }] })
    }
}

pub(super) fn kids_mut(v: &mut Value) -> Option<&mut Vec<Value>> {
    v.get_mut("content").and_then(Value::as_array_mut)
}

pub(super) fn block(conn: &Connection, id: &str) -> Result<store::Block> {
    store::block_by_id(conn, id)?.ok_or_else(|| anyhow!("block {id} not found"))
}

pub(super) fn page_meta(conn: &Connection, id: &str) -> Result<store::PageMeta> {
    store::page_meta_by_id(conn, id)?.ok_or_else(|| anyhow!("page {id} not found"))
}

pub(super) fn last_block(conn: &Connection, page: &str) -> Result<Option<String>> {
    Ok(store::blocks_of(conn, page)?.last().map(|b| b.id.clone()))
}

/// A fresh copy of a stored block for inserting elsewhere (no block id).
pub(super) fn fresh(node: &Value) -> Value {
    let mut n = node.clone();
    if let Some(attrs) = n.get_mut("attrs").and_then(Value::as_object_mut) {
        attrs.remove("bid");
    }
    n
}

pub(super) fn table_rows(node: &Value) -> Vec<Vec<String>> {
    content::children(node)
        .iter()
        .map(|row| content::children(row).iter().map(|c| content::plain_text(c).trim().to_string()).collect())
        .collect()
}

pub(super) fn cell(text: &str, header: bool) -> Value {
    json!({ "type": if header { "tableHeader" } else { "tableCell" }, "content": [para(text)] })
}

pub(super) fn parse_csv(src: &str) -> Vec<Vec<String>> {
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

pub(super) fn csv_escape(v: &str) -> String {
    if v.contains([',', '"', '\n']) {
        format!("\"{}\"", v.replace('"', "\"\""))
    } else {
        v.to_string()
    }
}

/// Visit task items in document order: (item, index).
pub(super) fn for_tasks(node: &mut Value, idx: &mut usize, f: &mut dyn FnMut(&mut Value, usize)) {
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

pub(super) fn scope_pages(conn: &Connection, a: &Value) -> Result<Vec<store::PageMeta>> {
    let all = store::list_pages(conn, false)?;
    if let Some(ids) = a.get("pageIds").and_then(Value::as_array) {
        let ids: Vec<&str> = ids.iter().filter_map(Value::as_str).collect();
        return Ok(all.into_iter().filter(|p| ids.contains(&p.id.as_str())).collect());
    }
    if let Some(parent) = os(a, "parentId") {
        return Ok(all.into_iter().filter(|p| p.parent_id.as_deref() == Some(parent)).collect());
    }
    if a.get("all").and_then(Value::as_bool).unwrap_or(false) {
        return Ok(all.into_iter().filter(|p| store::is_resource(&p.kind)).collect());
    }
    bail!("say which pages: pageIds, parentId or all")
}

pub(super) fn props_vec(p: &store::PageMeta) -> Vec<Value> {
    p.properties.as_array().cloned().unwrap_or_default()
}

pub(super) fn same_name(p: &Value, name: &str) -> bool {
    p.get("name").and_then(Value::as_str).map(|n| n.eq_ignore_ascii_case(name)).unwrap_or(false)
}

pub(super) fn md_of_snapshot(snap: &Value) -> String {
    let list = snap.get("blocks").and_then(Value::as_array).or_else(|| snap.as_array()).cloned().unwrap_or_default();
    list.iter()
        .map(|b| content::to_markdown(b.get("content").filter(|c| c.get("type").is_some()).unwrap_or(b)))
        .filter(|m| !m.trim().is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

pub(super) fn collect_links(node: &Value, pages: &mut Vec<Value>, urls: &mut Vec<String>) {
    match content::node_type(node) {
        "pageMention" => {
            pages.push(json!({ "pageId": node.pointer("/attrs/id"), "label": node.pointer("/attrs/label"), "kind": "mention" }))
        }
        "pageLink" => {
            pages.push(json!({ "pageId": node.pointer("/attrs/pageId"), "label": node.pointer("/attrs/title"), "kind": "subpage" }))
        }
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

pub(super) fn count_types(node: &Value, counts: &mut BTreeMap<String, usize>) {
    *counts.entry(content::node_type(node).to_string()).or_default() += 1;
    for c in content::children(node) {
        count_types(c, counts);
    }
}

pub(super) fn order_children(conn: &Connection, ctx: &Ctx, parent: Option<&str>, ids: &[String]) -> Result<usize> {
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
    if let Some(v) = super::tasks_tables::call(conn, ctx, name, a)? {
        return Ok(Some(v));
    }
    if let Some(v) = super::page_structure::call(conn, ctx, name, a)? {
        return Ok(Some(v));
    }
    if let Some(v) = super::workspace::call(conn, ctx, name, a)? {
        return Ok(Some(v));
    }
    Ok(None)
}
