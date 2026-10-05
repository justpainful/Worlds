//! Worlds MCP server (stdio, JSON-RPC 2.0, newline-delimited).
//!
//! `worlds.exe --mcp [--actor ai] [--op <id>]`
//!
//! Exposes structured tools over the same `store` layer the UI uses. Claude
//! never sees SQL. Every write is attributed (actor + op id), snapshotted
//! before first touch, and undoable from the History panel. Anything with
//! external consequences (Discord) is queued for the user's approval.

use crate::content;
use crate::db;
use crate::discord::{self, render::RenderOptions};
use crate::store::{self, Ctx};
use anyhow::{anyhow, bail, Result};
use rusqlite::Connection;
use serde_json::{json, Value};
use std::io::{BufRead, Write};

mod more;
mod more2;
mod page_content;
mod page_structure;
mod profile_history;
mod resources;
mod tasks_tables;
mod workspace;

fn arg_after(args: &[String], flag: &str) -> Option<String> {
    args.iter().position(|a| a == flag).and_then(|i| args.get(i + 1)).cloned()
}

pub fn run_stdio(args: &[String]) -> Result<()> {
    let actor = arg_after(args, "--actor").unwrap_or_else(|| "ai".into());
    // A session without an explicit op id (e.g. Claude Code Desktop) still
    // groups its changes per server process.
    let op = arg_after(args, "--op").unwrap_or_else(|| format!("session-{}", db::new_id()));
    let ctx = Ctx { actor, op_id: Some(op), origin: "mcp".into() };
    let conn = db::open(&db::db_path())?;

    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout();
    for line in stdin.lock().lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        let msg: Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let id = msg.get("id").cloned();
        let method = msg.get("method").and_then(Value::as_str).unwrap_or("");
        let params = msg.get("params").cloned().unwrap_or(json!({}));
        let Some(id) = id else { continue }; // notification
        let response = match method {
            "initialize" => {
                let version = params.get("protocolVersion").and_then(Value::as_str).unwrap_or("2025-06-18");
                json!({ "jsonrpc": "2.0", "id": id, "result": {
                    "protocolVersion": version,
                    "capabilities": { "tools": {} },
                    "serverInfo": { "name": "worlds", "version": env!("CARGO_PKG_VERSION") },
                    "instructions": "Tools for the user's local Worlds workspace (pages made of blocks). Read before writing; change the smallest set of blocks; Discord sends are queued for the user's approval."
                }})
            }
            "ping" => json!({ "jsonrpc": "2.0", "id": id, "result": {} }),
            "tools/list" => json!({ "jsonrpc": "2.0", "id": id, "result": { "tools": tool_list() } }),
            "tools/call" => {
                let name = params.get("name").and_then(Value::as_str).unwrap_or("");
                let a = params.get("arguments").cloned().unwrap_or(json!({}));
                let result = {
                    let tx = conn.unchecked_transaction();
                    match tx {
                        Ok(tx) => match call_tool(&tx, &ctx, name, &a) {
                            Ok(v) => tx.commit().map(|_| v).map_err(anyhow::Error::from),
                            Err(e) => Err(e),
                        },
                        Err(e) => Err(e.into()),
                    }
                };
                match result {
                    Ok(v) => {
                        let text = if v.is_string() { v.as_str().unwrap().to_string() } else { serde_json::to_string_pretty(&v)? };
                        json!({ "jsonrpc": "2.0", "id": id, "result": { "content": [{ "type": "text", "text": text }] } })
                    }
                    Err(e) => json!({ "jsonrpc": "2.0", "id": id, "result": {
                        "content": [{ "type": "text", "text": format!("Error: {e:#}") }], "isError": true
                    }}),
                }
            }
            _ => json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -32601, "message": format!("unknown method {method}") } }),
        };
        writeln!(stdout, "{}", response)?;
        stdout.flush()?;
    }
    Ok(())
}

fn s<'a>(a: &'a Value, k: &str) -> Result<&'a str> {
    a.get(k).and_then(Value::as_str).filter(|v| !v.is_empty()).ok_or_else(|| anyhow!("missing argument `{k}`"))
}
fn os<'a>(a: &'a Value, k: &str) -> Option<&'a str> {
    a.get(k).and_then(Value::as_str).filter(|v| !v.is_empty())
}

fn tool(name: &str, description: &str, props: Value, required: &[&str]) -> Value {
    json!({
        "name": name,
        "description": description,
        "inputSchema": { "type": "object", "properties": props, "required": required }
    })
}

fn tool_list() -> Vec<Value> {
    let page_id = json!({ "type": "string", "description": "Page id" });
    let md = json!({ "type": "string", "description": "Content in Worlds Markdown" });
    let trigger = json!({
        "type": "object",
        "description": "{kind:'once', at: epoch-ms} | {kind:'daily', time:'HH:MM'} | {kind:'weekly', days:[0-6 Sun=0], time} | {kind:'monthly', day:1-31, time} | {kind:'manual'}"
    });
    vec![
        tool("pages_search", "Full-text search page titles and content (Arabic and English).", json!({ "query": { "type": "string" }, "limit": { "type": "integer" } }), &["query"]),
        tool("pages_list", "List pages as a tree (id, title, parent, flags). Use parentId to list one branch.", json!({ "parentId": { "type": "string" }, "includeArchived": { "type": "boolean" } }), &[]),
        tool("pages_read", "Read a page: metadata, assistant instructions, blocks (id, type, markdown), subpages and backlinks.", json!({ "pageId": page_id }), &["pageId"]),
        tool("pages_create", "Create a page (optionally inside a parent) with initial Markdown content.", json!({ "title": { "type": "string" }, "parentId": { "type": "string" }, "icon": { "type": "string", "description": "single emoji" }, "markdown": md }), &["title"]),
        tool("pages_rename", "Rename a page.", json!({ "pageId": page_id, "title": { "type": "string" } }), &["pageId", "title"]),
        tool("pages_move", "Move a page under another parent (omit parentId for top level), optionally before a sibling.", json!({ "pageId": page_id, "parentId": { "type": "string" }, "beforeId": { "type": "string" } }), &["pageId"]),
        tool("pages_archive", "Archive or unarchive a page.", json!({ "pageId": page_id, "archived": { "type": "boolean" } }), &["pageId", "archived"]),
        tool("blocks_read", "Read blocks of a page, or one block by id.", json!({ "pageId": page_id, "blockId": { "type": "string" } }), &[]),
        tool("blocks_insert", "Insert new blocks (parsed from Markdown) after a block, or at the end when afterBlockId is omitted. Use afterBlockId:'start' to insert at the top.", json!({ "pageId": page_id, "afterBlockId": { "type": "string" }, "markdown": md }), &["pageId", "markdown"]),
        tool("blocks_update", "Replace one block's content. If the Markdown yields several blocks, the first replaces the block and the rest are inserted after it.", json!({ "blockId": { "type": "string" }, "markdown": md }), &["blockId", "markdown"]),
        tool("blocks_move", "Move a block after another block (omit afterBlockId to move to the top).", json!({ "blockId": { "type": "string" }, "afterBlockId": { "type": "string" } }), &["blockId"]),
        tool("blocks_delete", "Delete one block.", json!({ "blockId": { "type": "string" } }), &["blockId"]),
        tool("references_search", "Pages that mention or link to a page (backlinks) and pages it references.", json!({ "pageId": page_id }), &["pageId"]),
        tool("references_resolve", "Find page ids by (partial) title, to build @[Title](page:ID) mentions.", json!({ "title": { "type": "string" } }), &["title"]),
        tool("attachments_add", "Attach a picture, video, audio file or document from the user's Desktop, Downloads, Documents, Pictures, Videos or Music folders to a page and append it as a block. Other locations and program files are refused.", json!({ "pageId": page_id, "path": { "type": "string", "description": "absolute local path" } }), &["pageId", "path"]),
        tool("attachments_insert", "Place an existing Worlds attachment (for example a file the user attached in chat) into a page as an image, video or file block.", json!({ "pageId": page_id, "attachmentId": { "type": "string" }, "afterBlockId": { "type": "string" }, "caption": { "type": "string" } }), &["pageId", "attachmentId"]),
        tool("attachments_read_metadata", "List attachment metadata for a page.", json!({ "pageId": page_id }), &["pageId"]),
        tool("templates_list", "List templates.", json!({}), &[]),
        tool("templates_instantiate", "Create a new page from a template.", json!({ "templateId": { "type": "string" }, "parentId": { "type": "string" }, "title": { "type": "string" } }), &["templateId"]),
        tool("automations_list", "List automations with their schedules and last status.", json!({}), &[]),
        tool("automations_create", "Create a scheduled automation that renders a page and sends it to Discord through the bridge. Runs created by Claude always wait for the user's approval.", json!({
            "name": { "type": "string" }, "pageId": page_id, "trigger": trigger,
            "destination": { "type": "object", "description": "{kind:'channel'|'thread'|'dm', id, label}" },
            "transformInstructions": { "type": "string", "description": "optional: what Claude should change in a snapshot before sending" }
        }), &["name", "pageId", "trigger"]),
        tool("automations_update", "Change an automation's name, trigger, destination or enabled state.", json!({ "id": { "type": "string" }, "name": { "type": "string" }, "enabled": { "type": "boolean" }, "trigger": trigger, "destination": { "type": "object" } }), &["id"]),
        tool("automations_run", "Request a run of an automation now. The user approves the preview in Worlds before anything is sent.", json!({ "id": { "type": "string" } }), &["id"]),
        tool("discord_inspect", "Known Discord servers, channels, threads and the bridge bot state (from the last refresh in Worlds).", json!({}), &[]),
        tool("discord_preview", "Render a page as a Discord Components V2 message and report limit warnings. Sends nothing.", json!({ "pageId": page_id, "includeTitle": { "type": "boolean" }, "hideCompleted": { "type": "boolean" } }), &["pageId"]),
        tool("discord_send", "Queue a page to be sent to Discord through the bridge. Nothing is sent until the user approves the preview in Worlds.", json!({ "pageId": page_id, "destination": { "type": "object", "description": "{kind:'channel'|'thread'|'dm', id, label}" }, "includeTitle": { "type": "boolean" } }), &["pageId", "destination"]),
        tool("discord_edit", "Queue an edit of a Discord message previously sent by Worlds, re-rendered from the page. Requires user approval.", json!({ "pageId": page_id, "channelId": { "type": "string" }, "messageId": { "type": "string" } }), &["pageId", "channelId", "messageId"]),
        tool("profile_read", "The local profile (owner of all pages).", json!({}), &[]),
        tool("history_read", "Recent history for a page (or everywhere).", json!({ "pageId": page_id, "limit": { "type": "integer" } }), &[]),
        tool("instructions_read", "Global assistant instructions and, if given, the page's instructions.", json!({ "pageId": page_id }), &[]),
        tool("instructions_update", "Replace the assistant instructions, either global (scope 'global') or for one page (scope 'page' with pageId). Only do this when the user asks.", json!({
            "scope": { "type": "string", "enum": ["global", "page"] }, "pageId": page_id,
            "instructions": { "type": "array", "items": { "type": "string" } }
        }), &["scope", "instructions"]),
        tool("profile_update", "Update the user's local profile. Only change fields the user asked about.", json!({
            "displayName": { "type": "string" }, "handle": { "type": "string" }, "bio": { "type": "string" },
            "status": { "type": "string" }, "location": { "type": "string" },
            "links": { "type": "array", "items": { "type": "object", "properties": { "label": { "type": "string" }, "url": { "type": "string" } } }, "description": "replaces all links; urls must start with http" },
            "accent": { "type": "string", "description": "hex colour like #d2a46e" },
            "language": { "type": "string", "enum": ["auto", "en", "ar"] },
            "blocks": { "type": "array", "items": { "type": "object" }, "description": "Profile Blocks (widgets). Replaces the whole list: read the profile first and send it back with your changes. Each block: { id, type: info|progress|quote|grid|list|media|fields|links|badges|dynamic, size: 12x1|12x2|6x1|6x2|4x1, style: soft|tinted|solid|compact|showcase|minimal, accent?: #hex, url? } plus type fields: info {label,title,subtitle,badge}; progress {icon,title,caption,value,max,display:ratio|percent|none}; quote {label,statement,subtext,align}; grid {title,columns:1-4,items:[{icon,title,subtitle,url}]}; list {title,items}; fields {title,fields:[{key,value}]}; links {title,links:[{icon,title,url}]}; badges {title,badges:[{icon,title}]}; dynamic {source: session|streak|activity|latest-page|bridge, goal}. Icons are 'pi:<name>' (home, claude, pages, templates, automations, integrations, activity, trash, settings, profile, search, discord, presentation, spreadsheet, document, pdf, image, video, audio, code, archive, file, gamedev, design, engineering, creative, music, writing, star, rocket) or an emoji. At most 12 blocks." }
        }), &[]),
        tool("pages_set_icon", "Set or clear a page's emoji icon.", json!({ "pageId": page_id, "icon": { "type": "string", "description": "single emoji, or empty to clear" } }), &["pageId"]),
        tool("pages_pin", "Pin or unpin a page (pinned pages sit at the top of the sidebar and Home).", json!({ "pageId": page_id, "pinned": { "type": "boolean" } }), &["pageId", "pinned"]),
        tool("pages_favorite", "Mark or unmark a page as a favourite.", json!({ "pageId": page_id, "favorite": { "type": "boolean" } }), &["pageId", "favorite"]),
        tool("pages_duplicate", "Duplicate a page (with its subpages by default). Returns the new page id.", json!({ "pageId": page_id, "deep": { "type": "boolean" } }), &["pageId"]),
        tool("pages_delete", "Move a page and its subpages to Trash (restorable). Only when the user asks to delete.", json!({ "pageId": page_id }), &["pageId"]),
        tool("pages_restore", "Restore a page from Trash.", json!({ "pageId": page_id }), &["pageId"]),
        tool("trash_list", "Pages currently in Trash.", json!({}), &[]),
        tool("pages_replace_content", "Replace the entire content of a page with new Markdown. Use for full rewrites or restructuring; prefer blocks_update for small edits. A version is kept, so this is undoable.", json!({ "pageId": page_id, "markdown": md }), &["pageId", "markdown"]),
        tool("templates_create_from_page", "Save a copy of a page (and its subpages) as a reusable template.", json!({ "pageId": page_id }), &["pageId"]),
        tool("chats_search", "Find earlier conversations with Claude in Worlds by title or content. Empty query lists the most recent.", json!({ "query": { "type": "string" }, "limit": { "type": "integer" } }), &[]),
        tool("chats_read", "Read an earlier conversation (by chatId, or by title when the user names it).", json!({ "chatId": { "type": "string" }, "title": { "type": "string" } }), &[]),
        tool("pages_set_properties", "Replace a page's properties (typed fields under the title, used by collection views). Read the page first and send the full list back with your change.", json!({
            "pageId": page_id,
            "properties": { "type": "array", "items": { "type": "object" }, "description": "Each: { id, name, type: status|select|tags|date|number|checkbox|url|text, value, options?: [{ name, color: gray|blue|green|yellow|orange|red|purple|pink }] }. Status values default to Not started, In progress, Done. Dates are YYYY-MM-DD." }
        }), &["pageId", "properties"]),
        tool("automations_delete", "Delete an automation (the source page is untouched). Only when the user asks.", json!({ "id": { "type": "string" } }), &["id"]),
    ]
    .into_iter()
    .chain(more::tools())
    .chain(more2::tools())
    .chain(resources::tools())
    .collect()
}

fn block_view(b: &store::Block) -> Value {
    json!({ "id": b.id, "type": b.block_type, "direction": b.direction, "markdown": content::to_markdown(&b.content) })
}

fn md_nodes(md: &str) -> Result<Vec<Value>> {
    let nodes = content::from_markdown(md);
    if nodes.is_empty() {
        bail!("the Markdown produced no blocks");
    }
    Ok(nodes)
}

fn call_tool(conn: &Connection, ctx: &Ctx, name: &str, a: &Value) -> Result<Value> {
    match name {
        "pages_search" => {
            let hits = store::search(conn, s(a, "query")?, a.get("limit").and_then(Value::as_i64).unwrap_or(15), false)?;
            Ok(json!(hits
                .iter()
                .map(|h| json!({
                    "pageId": h.page_id, "title": h.title, "parent": h.parent_title,
                    "snippet": h.snippet.replace('\u{E000}', "«").replace('\u{E001}', "»")
                }))
                .collect::<Vec<_>>()))
        }
        "pages_list" => {
            let all = store::list_pages(conn, false)?;
            let include_archived = a.get("includeArchived").and_then(Value::as_bool).unwrap_or(false);
            let root = os(a, "parentId");
            let mut out = Vec::new();
            fn walk(all: &[store::PageMeta], parent: Option<&str>, depth: usize, inc: bool, out: &mut Vec<Value>) {
                for p in all.iter().filter(|p| p.parent_id.as_deref() == parent && store::is_resource(&p.kind) && (inc || !p.archived)) {
                    out.push(json!({ "id": p.id, "title": p.title, "icon": p.icon, "depth": depth, "pinned": p.pinned, "archived": p.archived, "updatedAt": p.updated_at }));
                    if depth < 12 {
                        walk(all, Some(&p.id), depth + 1, inc, out);
                    }
                }
            }
            walk(&all, root, 0, include_archived, &mut out);
            Ok(json!(out))
        }
        "pages_read" => {
            let id = s(a, "pageId")?;
            let p = store::get_page(conn, id)?.ok_or_else(|| anyhow!("page not found"))?;
            let subpages: Vec<Value> = store::list_pages(conn, false)?
                .into_iter()
                .filter(|x| x.parent_id.as_deref() == Some(id))
                .map(|x| json!({ "id": x.id, "title": x.title, "properties": x.properties }))
                .collect();
            let owner = store::profile(conn)?;
            Ok(json!({
                "id": p.meta.id, "title": p.meta.title, "icon": p.meta.icon, "kind": p.meta.kind,
                "owner": owner.display_name, "archived": p.meta.archived, "properties": p.meta.properties,
                "path": p.breadcrumbs.iter().map(|c| c.title.clone()).collect::<Vec<_>>(),
                "assistantInstructions": p.instructions,
                "blocks": p.blocks.iter().map(block_view).collect::<Vec<_>>(),
                "subpages": subpages,
                "backlinks": p.backlinks.iter().map(|b| json!({ "pageId": b.page_id, "title": b.title })).collect::<Vec<_>>(),
                "updatedAt": p.meta.updated_at,
            }))
        }
        "pages_create" => {
            let p = store::create_page(
                conn,
                ctx,
                store::NewPage {
                    title: Some(s(a, "title")?.to_string()),
                    icon: os(a, "icon").map(str::to_string),
                    parent_id: os(a, "parentId").map(str::to_string),
                    markdown: os(a, "markdown").map(str::to_string),
                    ..Default::default()
                },
            )?;
            Ok(json!({ "pageId": p.id, "title": p.title }))
        }
        "pages_rename" => {
            let p = store::update_page(
                conn,
                ctx,
                s(a, "pageId")?,
                store::PagePatch { title: Some(s(a, "title")?.to_string()), ..Default::default() },
            )?;
            Ok(json!({ "pageId": p.id, "title": p.title }))
        }
        "pages_move" => {
            let p = store::move_page(conn, ctx, s(a, "pageId")?, os(a, "parentId"), os(a, "beforeId"))?;
            Ok(json!({ "pageId": p.id, "parentId": p.parent_id }))
        }
        "pages_archive" => {
            let archived = a.get("archived").and_then(Value::as_bool).unwrap_or(true);
            store::update_page(conn, ctx, s(a, "pageId")?, store::PagePatch { archived: Some(archived), ..Default::default() })?;
            Ok(json!({ "ok": true }))
        }
        "blocks_read" => {
            if let Some(bid) = os(a, "blockId") {
                let b = store::block_by_id(conn, bid)?.ok_or_else(|| anyhow!("block not found"))?;
                return Ok(block_view(&b));
            }
            let blocks = store::blocks_of(conn, s(a, "pageId")?)?;
            Ok(json!(blocks.iter().map(block_view).collect::<Vec<_>>()))
        }
        "blocks_insert" => {
            let page = s(a, "pageId")?;
            store::page_meta_by_id(conn, page)?.ok_or_else(|| anyhow!("page not found"))?;
            let nodes = md_nodes(s(a, "markdown")?)?;
            let ids = match os(a, "afterBlockId") {
                Some("start") => {
                    let ids = store::insert_blocks(conn, ctx, page, None, nodes)?;
                    // move them to the top, keeping order
                    let mut prev: Option<String> = None;
                    for id in &ids {
                        store::move_block(conn, ctx, id, prev.as_deref())?;
                        prev = Some(id.clone());
                    }
                    ids
                }
                after => store::insert_blocks(conn, ctx, page, after, nodes)?,
            };
            Ok(json!({ "inserted": ids }))
        }
        "blocks_update" => {
            let bid = s(a, "blockId")?;
            let existing = store::block_by_id(conn, bid)?.ok_or_else(|| anyhow!("block not found"))?;
            let mut nodes = md_nodes(s(a, "markdown")?)?;
            let first = nodes.remove(0);
            // keep explicit direction set by the user
            let first = match (content::attr_str(&existing.content, "dir"), first) {
                (Some(d), mut n) if d == "ltr" || d == "rtl" => {
                    if let Some(o) = n.as_object_mut() {
                        o.entry("attrs").or_insert(json!({}))["dir"] = json!(d);
                    }
                    n
                }
                (_, n) => n,
            };
            store::update_block(conn, ctx, bid, first)?;
            let mut extra = Vec::new();
            if !nodes.is_empty() {
                extra = store::insert_blocks(conn, ctx, &existing.page_id, Some(bid), nodes)?;
            }
            Ok(json!({ "updated": bid, "inserted": extra }))
        }
        "blocks_move" => {
            store::move_block(conn, ctx, s(a, "blockId")?, os(a, "afterBlockId"))?;
            Ok(json!({ "ok": true }))
        }
        "blocks_delete" => {
            store::delete_block(conn, ctx, s(a, "blockId")?)?;
            Ok(json!({ "ok": true }))
        }
        "references_search" => {
            let id = s(a, "pageId")?;
            let back = store::backlinks(conn, id)?;
            let mut stmt = conn.prepare(
                "SELECT DISTINCT r.target_page, p.title, r.kind FROM refs r JOIN pages p ON p.id = r.target_page WHERE r.source_page = ?1",
            )?;
            let outgoing: Vec<Value> = stmt
                .query_map([id], |r| {
                    Ok(json!({ "pageId": r.get::<_, String>(0)?, "title": r.get::<_, String>(1)?, "kind": r.get::<_, String>(2)? }))
                })?
                .collect::<rusqlite::Result<_>>()?;
            Ok(json!({
                "backlinks": back.iter().map(|b| json!({ "pageId": b.page_id, "title": b.title, "kind": b.kind, "excerpt": b.excerpt })).collect::<Vec<_>>(),
                "outgoing": outgoing,
            }))
        }
        "references_resolve" => {
            let q = s(a, "title")?;
            let hits = store::search(conn, q, 8, false)?;
            Ok(json!(hits
                .iter()
                .map(|h| json!({ "pageId": h.page_id, "title": h.title, "mention": format!("@[{}](page:{})", h.title, h.page_id) }))
                .collect::<Vec<_>>()))
        }
        "attachments_add" => {
            let page = s(a, "pageId")?;
            let path = std::path::Path::new(s(a, "path")?);
            claude_may_attach(path)?;
            let att = store::add_attachment_path(conn, Some(page), path)?;
            let node_type = match att.kind.as_str() {
                "image" | "gif" => "image",
                "video" => "video",
                _ => "file",
            };
            let node = json!({ "type": node_type, "attrs": {
                "attachmentId": att.id, "name": att.file_name, "mime": att.mime, "size": att.size,
                "width": att.width, "height": att.height
            }});
            let ids = store::insert_blocks(conn, ctx, page, None, vec![node])?;
            Ok(json!({ "attachmentId": att.id, "blockId": ids.first() }))
        }
        "attachments_insert" => {
            let page = s(a, "pageId")?;
            store::page_meta_by_id(conn, page)?.ok_or_else(|| anyhow!("page not found"))?;
            let att = store::get_attachment(conn, s(a, "attachmentId")?)?.ok_or_else(|| anyhow!("attachment not found"))?;
            if att.page_id.is_none() {
                conn.execute("UPDATE attachments SET page_id = ?1 WHERE id = ?2", rusqlite::params![page, att.id])?;
            }
            let node_type = match att.kind.as_str() {
                "image" | "gif" => "image",
                "video" => "video",
                _ => "file",
            };
            let node = json!({ "type": node_type, "attrs": {
                "attachmentId": att.id, "name": att.file_name, "mime": att.mime, "size": att.size,
                "width": att.width, "height": att.height, "caption": os(a, "caption").unwrap_or("")
            }});
            let ids = store::insert_blocks(conn, ctx, page, os(a, "afterBlockId"), vec![node])?;
            Ok(json!({ "blockId": ids.first() }))
        }
        "attachments_read_metadata" => {
            let p = store::get_page(conn, s(a, "pageId")?)?.ok_or_else(|| anyhow!("page not found"))?;
            Ok(json!(p.attachments))
        }
        "templates_list" => {
            let t: Vec<Value> = store::list_pages(conn, false)?
                .into_iter()
                .filter(|p| p.kind == "template")
                .map(|p| json!({ "templateId": p.id, "title": p.title, "category": p.template_category }))
                .collect();
            Ok(json!(t))
        }
        "templates_instantiate" => {
            let p = store::instantiate_template(conn, ctx, s(a, "templateId")?, os(a, "parentId"), os(a, "title"))?;
            Ok(json!({ "pageId": p.id, "title": p.title }))
        }
        "automations_list" => Ok(json!(crate::automations::list(conn)?)),
        "automations_create" => {
            let mut spec = json!({
                "trigger": a.get("trigger").cloned().ok_or_else(|| anyhow!("missing trigger"))?,
                "source": { "pageId": s(a, "pageId")? },
                "transform": match os(a, "transformInstructions") {
                    Some(i) => json!({ "kind": "claude", "instructions": i }),
                    None => json!({ "kind": "none" }),
                },
                "action": { "kind": "discord.send" },
                "policy": { "unattended": false, "graceMinutes": 30 },
            });
            if let Some(d) = a.get("destination") {
                spec["destination"] = d.clone();
            }
            let au = crate::automations::save(
                conn,
                ctx,
                crate::automations::AutomationInput { id: None, name: s(a, "name")?.to_string(), enabled: true, spec },
            )?;
            Ok(json!({ "id": au.id, "nextRunAt": au.next_run_at, "note": "Each run waits for the user's approval in Worlds." }))
        }
        "automations_update" => {
            let id = s(a, "id")?;
            let cur = crate::automations::get(conn, id)?.ok_or_else(|| anyhow!("automation not found"))?;
            let mut spec = cur.spec.clone();
            if let Some(t) = a.get("trigger") {
                spec["trigger"] = t.clone();
            }
            if let Some(d) = a.get("destination") {
                spec["destination"] = d.clone();
            }
            let au = crate::automations::save(
                conn,
                ctx,
                crate::automations::AutomationInput {
                    id: Some(id.to_string()),
                    name: os(a, "name").map(str::to_string).unwrap_or(cur.name),
                    enabled: a.get("enabled").and_then(Value::as_bool).unwrap_or(cur.enabled),
                    spec,
                },
            )?;
            Ok(json!({ "id": au.id, "enabled": au.enabled, "nextRunAt": au.next_run_at }))
        }
        "automations_run" => {
            let au = crate::automations::get(conn, s(a, "id")?)?.ok_or_else(|| anyhow!("automation not found"))?;
            let page_id = au.spec["source"]["pageId"].as_str().ok_or_else(|| anyhow!("no source page"))?;
            let dest = au.spec.get("destination").cloned().ok_or_else(|| anyhow!("automation has no destination"))?;
            let id = discord::queue_action(
                conn,
                "discord.send",
                json!({
                    "pageId": page_id, "destination": dest, "options": au.spec["action"].get("options"),
                    "automationId": au.id, "automationName": au.name,
                }),
                &ctx.actor,
                ctx.op_id.as_deref(),
            )?;
            Ok(json!({ "queued": id, "note": "Waiting for the user's approval in Worlds." }))
        }
        "discord_inspect" => {
            let cache = db::get_setting(conn, "discord.cache")?;
            Ok(cache
                .unwrap_or(json!({ "note": "No Discord data yet. Ask the user to open Integrations → Discord in Worlds and refresh." })))
        }
        "discord_preview" => {
            let opts = RenderOptions {
                include_title: a.get("includeTitle").and_then(Value::as_bool),
                hide_completed: a.get("hideCompleted").and_then(Value::as_bool),
                ..Default::default()
            };
            let r = discord::render_for_page(conn, s(a, "pageId")?, None, Some(opts))?;
            Ok(json!(r))
        }
        "discord_send" | "discord_edit" => {
            let page_id = s(a, "pageId")?;
            store::page_meta_by_id(conn, page_id)?.ok_or_else(|| anyhow!("page not found"))?;
            let dest = if name == "discord_edit" {
                json!({ "kind": "edit", "channelId": s(a, "channelId")?, "messageId": s(a, "messageId")? })
            } else {
                a.get("destination").cloned().ok_or_else(|| anyhow!("missing destination"))?
            };
            let opts = json!({ "includeTitle": a.get("includeTitle") });
            let id = discord::queue_action(
                conn,
                "discord.send",
                json!({ "pageId": page_id, "destination": dest, "options": opts }),
                &ctx.actor,
                ctx.op_id.as_deref(),
            )?;
            store::record(
                conn,
                ctx,
                Some(page_id),
                "discord_requested",
                "Claude asked to send this page to Discord",
                None,
                None,
                None,
                json!({ "pending": id }),
            )?;
            Ok(json!({ "queued": id, "note": "Nothing has been sent. The user will see a preview in Worlds and decide." }))
        }
        "profile_read" => {
            let p = store::profile(conn)?;
            let stats = store::profile_stats(conn).unwrap_or(json!({}));
            Ok(
                json!({ "displayName": p.display_name, "handle": p.handle, "bio": p.bio, "status": p.status, "location": p.location, "links": p.links, "language": p.language, "blocks": p.blocks, "stats": stats }),
            )
        }
        "history_read" => {
            let h = store::list_history(conn, os(a, "pageId"), None, a.get("limit").and_then(Value::as_i64).unwrap_or(30))?;
            Ok(json!(h
                .iter()
                .map(|e| json!({ "at": e.created_at, "page": e.page_title, "actor": e.actor, "kind": e.kind, "summary": e.summary }))
                .collect::<Vec<_>>()))
        }
        "instructions_read" => {
            let global = crate::ai::global_instructions(conn);
            let page = match os(a, "pageId") {
                Some(id) => store::get_page(conn, id)?.map(|p| p.instructions).unwrap_or_default(),
                None => Vec::new(),
            };
            Ok(json!({ "global": global, "page": page }))
        }
        "instructions_update" => {
            let list: Vec<String> = a
                .get("instructions")
                .and_then(Value::as_array)
                .ok_or_else(|| anyhow!("missing instructions"))?
                .iter()
                .filter_map(|v| v.as_str().map(|x| x.trim().to_string()))
                .filter(|x| !x.is_empty())
                .collect();
            match s(a, "scope")? {
                "global" => {
                    let before = crate::ai::global_instructions(conn);
                    db::set_setting(conn, "ai.instructions", &json!(list))?;
                    store::record(
                        conn,
                        ctx,
                        None,
                        "instructions",
                        "Updated global assistant instructions",
                        None,
                        Some(json!(before)),
                        Some(json!(list)),
                        json!({}),
                    )?;
                    db::mark_change(conn, None, "settings", &ctx.origin)?;
                }
                "page" => {
                    store::update_page(
                        conn,
                        ctx,
                        s(a, "pageId")?,
                        store::PagePatch { instructions: Some(list.clone()), ..Default::default() },
                    )?;
                }
                other => bail!("unknown scope {other}"),
            }
            Ok(json!({ "ok": true, "count": list.len() }))
        }
        "profile_update" => {
            let opt = |k: &str| {
                a.get(k).and_then(Value::as_str).map(|v| {
                    let t = v.trim().to_string();
                    if t.is_empty() {
                        None
                    } else {
                        Some(t)
                    }
                })
            };
            if let Some(acc) = a.get("accent").and_then(Value::as_str) {
                let ok = acc.len() == 7 && acc.starts_with('#') && acc[1..].chars().all(|c| c.is_ascii_hexdigit());
                if !ok {
                    bail!("accent must look like #a1b2c3");
                }
            }
            let p = store::update_profile_as(
                conn,
                ctx,
                store::ProfilePatch {
                    display_name: a.get("displayName").and_then(Value::as_str).map(|v| v.trim().to_string()),
                    handle: opt("handle"),
                    bio: opt("bio"),
                    status: opt("status"),
                    location: opt("location"),
                    accent: opt("accent"),
                    links: a.get("links").cloned(),
                    language: a.get("language").and_then(Value::as_str).map(str::to_string),
                    blocks: a.get("blocks").cloned(),
                    ..Default::default()
                },
            )?;
            Ok(
                json!({ "displayName": p.display_name, "handle": p.handle, "bio": p.bio, "status": p.status, "location": p.location, "links": p.links, "blocks": p.blocks }),
            )
        }
        "pages_set_properties" => {
            let props = a.get("properties").cloned().unwrap_or(json!([]));
            let m = store::set_page_meta(conn, ctx, s(a, "pageId")?, "properties", props)?;
            Ok(json!({ "ok": true, "properties": m.properties }))
        }
        "pages_set_icon" => {
            let icon = a.get("icon").and_then(Value::as_str).map(str::trim).filter(|v| !v.is_empty()).map(str::to_string);
            store::update_page(conn, ctx, s(a, "pageId")?, store::PagePatch { icon: Some(icon), ..Default::default() })?;
            Ok(json!({ "ok": true }))
        }
        "pages_pin" => {
            let pinned = a.get("pinned").and_then(Value::as_bool).unwrap_or(true);
            store::update_page(conn, ctx, s(a, "pageId")?, store::PagePatch { pinned: Some(pinned), ..Default::default() })?;
            Ok(json!({ "ok": true }))
        }
        "pages_favorite" => {
            let fav = a.get("favorite").and_then(Value::as_bool).unwrap_or(true);
            store::update_page(conn, ctx, s(a, "pageId")?, store::PagePatch { favorite: Some(fav), ..Default::default() })?;
            Ok(json!({ "ok": true }))
        }
        "pages_duplicate" => {
            let deep = a.get("deep").and_then(Value::as_bool).unwrap_or(true);
            let p = store::duplicate_page(conn, ctx, s(a, "pageId")?, deep, None, None)?;
            Ok(json!({ "pageId": p.id, "title": p.title }))
        }
        "pages_delete" => {
            store::delete_page(conn, ctx, s(a, "pageId")?)?;
            Ok(json!({ "ok": true, "note": "Moved to Trash; restorable." }))
        }
        "pages_restore" => {
            store::restore_page(conn, ctx, s(a, "pageId")?)?;
            Ok(json!({ "ok": true }))
        }
        "trash_list" => {
            let t: Vec<Value> = store::list_pages(conn, true)?
                .into_iter()
                .filter(|p| p.deleted_at.is_some())
                .map(|p| json!({ "pageId": p.id, "title": p.title, "deletedAt": p.deleted_at }))
                .collect();
            Ok(json!(t))
        }
        "pages_replace_content" => {
            let nodes = md_nodes(s(a, "markdown")?)?;
            let r = store::replace_blocks(conn, ctx, s(a, "pageId")?, nodes)?;
            Ok(json!({ "added": r.added, "changed": r.changed, "removed": r.removed }))
        }
        "templates_create_from_page" => {
            let t = store::save_as_template(conn, ctx, s(a, "pageId")?)?;
            Ok(json!({ "templateId": t.id, "title": t.title }))
        }
        "chats_search" => {
            let q = os(a, "query").unwrap_or("").trim().to_lowercase();
            let limit = a.get("limit").and_then(Value::as_i64).unwrap_or(15).clamp(1, 50);
            let like = format!("%{}%", q.replace(['%', '_'], ""));
            let mut stmt = conn.prepare(
                "SELECT c.id, c.title, c.updated_at,
                        (SELECT content FROM ai_messages m WHERE m.chat_id = c.id AND m.role = 'user' ORDER BY m.created_at LIMIT 1)
                 FROM ai_chats c
                 WHERE ?1 = '%%' OR lower(c.title) LIKE ?1
                    OR EXISTS (SELECT 1 FROM ai_messages m WHERE m.chat_id = c.id AND lower(m.content) LIKE ?1)
                 ORDER BY c.updated_at DESC LIMIT ?2",
            )?;
            let rows: Vec<Value> = stmt
                .query_map(rusqlite::params![like, limit], |r| {
                    let first: Option<String> = r.get(3)?;
                    Ok(json!({
                        "chatId": r.get::<_, String>(0)?,
                        "title": r.get::<_, String>(1)?,
                        "updatedAt": r.get::<_, i64>(2)?,
                        "firstMessage": first.map(|f| f.chars().take(160).collect::<String>()),
                    }))
                })?
                .collect::<rusqlite::Result<_>>()?;
            Ok(json!(rows))
        }
        "chats_read" => {
            let id = match os(a, "chatId") {
                Some(id) => id.to_string(),
                None => {
                    let t = s(a, "title")?.to_lowercase();
                    conn.query_row(
                        "SELECT id FROM ai_chats WHERE lower(title) LIKE ?1 ORDER BY (lower(title) = ?2) DESC, updated_at DESC LIMIT 1",
                        rusqlite::params![format!("%{t}%"), t],
                        |r| r.get::<_, String>(0),
                    )
                    .map_err(|_| anyhow!("no conversation matches that title"))?
                }
            };
            let (title, text) = crate::ai::chat_transcript(conn, &id, 30_000)?;
            Ok(json!({ "chatId": id, "title": title, "transcript": text }))
        }
        "automations_delete" => {
            let id = s(a, "id")?;
            let n = conn.execute("DELETE FROM automations WHERE id = ?1", [id])?;
            if n == 0 {
                bail!("automation not found");
            }
            db::mark_change(conn, None, "automation", &ctx.origin)?;
            Ok(json!({ "ok": true }))
        }
        _ => {
            if let Some(v) = more::call(conn, ctx, name, a)? {
                return Ok(v);
            }
            if let Some(v) = resources::call(conn, ctx, name, a)? {
                return Ok(v);
            }
            match more2::call(conn, ctx, name, a)? {
                Some(v) => Ok(v),
                None => bail!("unknown tool {name}"),
            }
        }
    }
}

/// Claude may attach the user's own media and documents, never arbitrary
/// files: only from the usual personal folders, only common content types,
/// never hidden folders, and at most 500 MB. (Files the user attaches
/// themselves in the UI are not limited by this.)
pub fn claude_may_attach(path: &std::path::Path) -> Result<()> {
    const TYPES: &[&str] = &[
        "png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "svg", "heic", "mp4", "mov", "webm", "mkv", "m4v", "mp3", "wav", "m4a", "ogg",
        "flac", "pdf", "txt", "md", "csv", "json", "docx", "xlsx", "pptx", "doc", "xls", "ppt", "zip",
    ];
    let canonical = std::fs::canonicalize(path).map_err(|_| anyhow!("file not found: {}", path.display()))?;
    let ext = canonical.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    if !TYPES.contains(&ext.as_str()) {
        bail!("Claude can only attach pictures, video, audio and documents (not .{ext} files)");
    }
    let roots: Vec<std::path::PathBuf> =
        [dirs::desktop_dir(), dirs::download_dir(), dirs::document_dir(), dirs::picture_dir(), dirs::video_dir(), dirs::audio_dir()]
            .into_iter()
            .flatten()
            .filter_map(|d| std::fs::canonicalize(d).ok())
            .collect();
    let Some(root) = roots.iter().find(|r| canonical.starts_with(r)) else {
        bail!("Claude can only attach files from Desktop, Downloads, Documents, Pictures, Videos or Music");
    };
    let hidden =
        canonical.strip_prefix(root).map(|rel| rel.components().any(|c| c.as_os_str().to_string_lossy().starts_with('.'))).unwrap_or(true);
    if hidden {
        bail!("Claude cannot attach files from hidden folders");
    }
    let size = std::fs::metadata(&canonical)?.len();
    if size > 500 * 1024 * 1024 {
        bail!("the file is larger than 500 MB");
    }
    Ok(())
}
