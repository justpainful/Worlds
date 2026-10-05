//! Worlds tools for resource kinds beyond pages: listing and creating any
//! kind, presentations (slides), galleries, files, streams and projects.
//! Text in documents is edited with the block tools, like pages. Every write
//! goes through the store with the caller's context, so it lands in history
//! and can be undone like any other change by Claude.

use super::{os, s, tool};
use crate::store::{self, Ctx, NewPage};
use anyhow::{anyhow, bail, Result};
use rusqlite::Connection;
use serde_json::{json, Value};

pub fn tools() -> Vec<Value> {
    let id = json!({ "type": "string" });
    vec![
        tool(
            "resources_list",
            "List resources of any kind (page, document, presentation, project, gallery, file, stream) with id, title, kind and parent. Optional filters: kind, parentId.",
            json!({ "kind": { "type": "string" }, "parentId": { "type": "string" }, "limit": { "type": "number" } }),
            &[],
        ),
        tool(
            "resources_create",
            "Create a resource: kind is document, presentation, project, gallery or stream (pages use pages_create; files use files_add). For a stream give url. Returns the new id.",
            json!({ "kind": { "type": "string" }, "title": { "type": "string" }, "parentId": id, "url": { "type": "string", "description": "stream only: http(s) link, m3u8 for HLS" } }),
            &["kind", "title"],
        ),
        tool(
            "presentations_read",
            "Read a presentation: every slide with its index, layout, the text of each element, and speaker notes.",
            json!({ "id": id }),
            &["id"],
        ),
        tool(
            "presentations_add_slide",
            "Add a slide. layout: title, title-body, section, two-columns, image or blank. title/body/notes fill the layout's placeholders. after: slide index to insert after (default: end).",
            json!({ "id": id, "layout": { "type": "string" }, "title": { "type": "string" }, "body": { "type": "string" }, "notes": { "type": "string" }, "after": { "type": "number" } }),
            &["id"],
        ),
        tool(
            "presentations_update_slide",
            "Change a slide's title, body text or speaker notes (by 0-based index).",
            json!({ "id": id, "index": { "type": "number" }, "title": { "type": "string" }, "body": { "type": "string" }, "notes": { "type": "string" } }),
            &["id", "index"],
        ),
        tool(
            "galleries_add",
            "Add pictures or videos from the user's personal folders (Desktop, Downloads, Documents, Pictures, Videos, Music) to a gallery, in order.",
            json!({ "id": id, "paths": { "type": "array", "items": { "type": "string" } } }),
            &["id", "paths"],
        ),
        tool(
            "files_add",
            "Add a file from the user's personal folders to Worlds as its own File resource (optionally inside a project or page).",
            json!({ "path": { "type": "string" }, "parentId": id }),
            &["path"],
        ),
        tool(
            "projects_update",
            "Update a project's status (planned, active, paused, done), start or due date (YYYY-MM-DD), or description.",
            json!({ "id": id, "status": { "type": "string" }, "start": { "type": "string" }, "due": { "type": "string" }, "description": { "type": "string" } }),
            &["id"],
        ),
        tool(
            "projects_link",
            "Link an existing resource to a project without moving it (unlink: true removes the link). To move a resource into a project use pages_move.",
            json!({ "id": id, "resourceId": id, "unlink": { "type": "boolean" } }),
            &["id", "resourceId"],
        ),
    ]
}

fn require_kind(conn: &Connection, id: &str, kind: &str) -> Result<store::PageMeta> {
    let p = store::page_meta_by_id(conn, id)?.ok_or_else(|| anyhow!("not found: {id}"))?;
    if p.kind != kind {
        bail!("{id} is a {}, not a {kind}", p.kind);
    }
    Ok(p)
}

fn metadata_of(conn: &Connection, id: &str) -> Result<Value> {
    let m: String = conn.query_row("SELECT metadata FROM pages WHERE id = ?1", [id], |r| r.get(0))?;
    Ok(serde_json::from_str(&m).unwrap_or(json!({})))
}

/// Text box on a 1280 x 720 slide, matching the editor's layouts.
#[allow(clippy::too_many_arguments)]
fn text_el(role: &str, x: i64, y: i64, w: i64, h: i64, size: i64, weight: i64, align: &str, text: &str) -> Value {
    json!({
        "id": crate::db::new_id(), "type": "text", "role": role, "x": x, "y": y, "w": w, "h": h, "text": text,
        "style": { "fontSize": size, "fontWeight": weight, "color": "#f4f2ee", "align": align }
    })
}

fn layout_elements(layout: &str, title: &str, body: &str) -> Vec<Value> {
    match layout {
        "title" => vec![
            text_el("title", 120, 250, 1040, 140, 76, 700, "center", title),
            text_el("subtitle", 200, 400, 880, 70, 30, 400, "center", body),
        ],
        "section" => vec![text_el("title", 90, 280, 1100, 120, 64, 700, "left", title)],
        "two-columns" => {
            let mut cols = body.splitn(2, "\n\n");
            let (a, b) = (cols.next().unwrap_or(""), cols.next().unwrap_or(""));
            vec![
                text_el("title", 90, 70, 1100, 100, 50, 700, "left", title),
                text_el("body", 90, 210, 530, 430, 28, 400, "left", a),
                text_el("body", 660, 210, 530, 430, 28, 400, "left", b),
            ]
        }
        "image" => vec![text_el("title", 90, 560, 1100, 70, 36, 600, "center", title)],
        "blank" => vec![],
        _ => vec![text_el("title", 90, 70, 1100, 100, 54, 700, "left", title), text_el("body", 90, 200, 1100, 440, 30, 400, "left", body)],
    }
}

fn slide_texts(content: &Value) -> Vec<Value> {
    content
        .pointer("/attrs/elements")
        .and_then(Value::as_array)
        .map(|els| {
            els.iter()
                .filter(|e| e.get("type").and_then(Value::as_str) == Some("text"))
                .map(|e| json!({ "role": e.get("role"), "text": e.get("text") }))
                .collect()
        })
        .unwrap_or_default()
}

pub fn call(conn: &Connection, ctx: &Ctx, name: &str, a: &Value) -> Result<Option<Value>> {
    let out = match name {
        "resources_list" => {
            let kind = os(a, "kind");
            let parent = os(a, "parentId");
            let limit = a.get("limit").and_then(Value::as_u64).unwrap_or(200) as usize;
            let list: Vec<Value> = store::list_pages(conn, false)?
                .into_iter()
                .filter(|p| store::is_resource(&p.kind) && !p.archived)
                .filter(|p| kind.is_none_or(|k| p.kind == k))
                .filter(|p| parent.is_none_or(|pid| p.parent_id.as_deref() == Some(pid)))
                .take(limit)
                .map(|p| json!({ "id": p.id, "title": p.title, "kind": p.kind, "parentId": p.parent_id, "updatedAt": p.updated_at }))
                .collect();
            json!(list)
        }
        "resources_create" => {
            let kind = s(a, "kind")?;
            let metadata = match kind {
                "document" => json!({ "doc": { "size": "A4", "orientation": "portrait" } }),
                "presentation" => json!({ "deck": { "aspect": "16:9" } }),
                "project" => json!({ "project": { "status": "active", "description": "", "links": [] } }),
                "gallery" => json!({ "gallery": { "view": "grid" } }),
                "stream" => {
                    let url = s(a, "url")?;
                    if !(url.starts_with("https://") || url.starts_with("http://")) {
                        bail!("a stream needs an http(s) link");
                    }
                    let path = url.split(['?', '#']).next().unwrap_or(url).to_lowercase();
                    let format = if path.ends_with(".m3u8") || path.ends_with(".m3u") {
                        "hls"
                    } else if path.ends_with(".mpd") {
                        "dash"
                    } else {
                        "progressive"
                    };
                    json!({ "stream": { "url": url, "format": format } })
                }
                "page" => bail!("use pages_create for pages"),
                "file" => bail!("use files_add for files"),
                other => bail!("unknown kind {other}"),
            };
            let icon = match kind {
                "document" => "pi:document",
                "presentation" => "pi:presentation",
                "project" => "pi:briefcase",
                "gallery" => "pi:image",
                _ => "pi:film",
            };
            let p = store::create_page(
                conn,
                ctx,
                NewPage {
                    title: Some(s(a, "title")?.to_string()),
                    icon: Some(icon.into()),
                    parent_id: os(a, "parentId").map(str::to_string),
                    kind: Some(kind.into()),
                    metadata: Some(metadata),
                    ..Default::default()
                },
            )?;
            if kind == "presentation" {
                let slide = json!({ "type": "slide", "attrs": { "layout": "title", "background": { "color": "#16161a" }, "notes": "", "elements": layout_elements("title", s(a, "title")?, "") } });
                store::insert_blocks(conn, ctx, &p.id, None, vec![slide])?;
            }
            json!({ "id": p.id, "kind": kind })
        }
        "presentations_read" => {
            let id = s(a, "id")?;
            let p = require_kind(conn, id, "presentation")?;
            let slides: Vec<Value> = store::blocks_of(conn, id)?
                .iter()
                .filter(|b| b.block_type == "slide")
                .enumerate()
                .map(|(i, b)| {
                    json!({
                        "index": i, "id": b.id, "layout": b.content.pointer("/attrs/layout"),
                        "texts": slide_texts(&b.content), "notes": b.content.pointer("/attrs/notes"),
                        "elements": b.content.pointer("/attrs/elements").and_then(Value::as_array).map(|e| e.len()).unwrap_or(0)
                    })
                })
                .collect();
            json!({ "id": id, "title": p.title, "slides": slides })
        }
        "presentations_add_slide" => {
            let id = s(a, "id")?;
            require_kind(conn, id, "presentation")?;
            let layout = os(a, "layout").unwrap_or("title-body");
            let slide = json!({ "type": "slide", "attrs": {
                "layout": layout, "background": { "color": "#16161a" }, "notes": os(a, "notes").unwrap_or(""),
                "elements": layout_elements(layout, os(a, "title").unwrap_or(""), os(a, "body").unwrap_or(""))
            }});
            let slides: Vec<store::Block> = store::blocks_of(conn, id)?.into_iter().filter(|b| b.block_type == "slide").collect();
            let after = a
                .get("after")
                .and_then(Value::as_u64)
                .and_then(|i| slides.get(i as usize))
                .map(|b| b.id.clone())
                .or_else(|| slides.last().map(|b| b.id.clone()));
            let ids = store::insert_blocks(conn, ctx, id, after.as_deref(), vec![slide])?;
            json!({ "slideId": ids.first(), "slides": slides.len() + 1 })
        }
        "presentations_update_slide" => {
            let id = s(a, "id")?;
            require_kind(conn, id, "presentation")?;
            let index = a.get("index").and_then(Value::as_u64).ok_or_else(|| anyhow!("missing argument `index`"))? as usize;
            let block = store::blocks_of(conn, id)?
                .into_iter()
                .filter(|b| b.block_type == "slide")
                .nth(index)
                .ok_or_else(|| anyhow!("no slide at index {index}"))?;
            let mut node = block.content.clone();
            if let Some(notes) = os(a, "notes") {
                node["attrs"]["notes"] = json!(notes);
            }
            if let Some(els) = node.pointer_mut("/attrs/elements").and_then(Value::as_array_mut) {
                let mut body_left = os(a, "body").map(|b| b.split("\n\n").map(str::to_string).collect::<Vec<_>>());
                for el in els.iter_mut() {
                    match el.get("role").and_then(Value::as_str) {
                        Some("title") => {
                            if let Some(t) = os(a, "title") {
                                el["text"] = json!(t);
                            }
                        }
                        Some("body") | Some("subtitle") => {
                            if let Some(parts) = body_left.as_mut() {
                                if !parts.is_empty() {
                                    el["text"] = json!(parts.remove(0));
                                }
                            }
                        }
                        _ => {}
                    }
                }
            }
            store::update_block(conn, ctx, &block.id, node)?;
            json!({ "ok": true, "slideId": block.id })
        }
        "galleries_add" => {
            let id = s(a, "id")?;
            require_kind(conn, id, "gallery")?;
            let paths: Vec<String> = a
                .get("paths")
                .and_then(Value::as_array)
                .map(|v| v.iter().filter_map(|p| p.as_str().map(str::to_string)).collect())
                .unwrap_or_default();
            if paths.is_empty() {
                bail!("give at least one path");
            }
            let mut nodes = Vec::new();
            for p in &paths {
                let path = std::path::Path::new(p);
                super::claude_may_attach(path)?;
                let att = store::add_attachment_path(conn, Some(id), path)?;
                if !(att.mime.starts_with("image/") || att.mime.starts_with("video/") || att.mime.starts_with("audio/")) {
                    bail!("{} is not a picture, video or audio file", att.file_name);
                }
                nodes.push(json!({ "type": "galleryItem", "attrs": {
                    "attachmentId": att.id, "name": att.file_name, "mime": att.mime, "size": att.size, "kind": att.kind, "caption": ""
                }}));
            }
            let ids = store::insert_blocks(conn, ctx, id, None, nodes)?;
            json!({ "added": ids.len() })
        }
        "files_add" => {
            let path = std::path::Path::new(s(a, "path")?);
            super::claude_may_attach(path)?;
            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("File").to_string();
            let p = store::create_page(
                conn,
                ctx,
                NewPage {
                    title: Some(name),
                    icon: Some("pi:file".into()),
                    parent_id: os(a, "parentId").map(str::to_string),
                    kind: Some("file".into()),
                    ..Default::default()
                },
            )?;
            let att = store::add_attachment_path(conn, Some(&p.id), path)?;
            store::set_page_meta(
                conn,
                ctx,
                &p.id,
                "file",
                json!({ "attachmentId": att.id, "name": att.file_name, "mime": att.mime, "size": att.size, "kind": att.kind }),
            )?;
            json!({ "id": p.id, "attachmentId": att.id })
        }
        "projects_update" => {
            let id = s(a, "id")?;
            require_kind(conn, id, "project")?;
            let mut project = metadata_of(conn, id)?.get("project").cloned().unwrap_or(json!({}));
            if let Some(st) = os(a, "status") {
                if !matches!(st, "planned" | "active" | "paused" | "done") {
                    bail!("status must be planned, active, paused or done");
                }
                project["status"] = json!(st);
            }
            for k in ["start", "due", "description"] {
                if let Some(v) = os(a, k) {
                    project[k] = json!(v);
                }
            }
            store::set_page_meta(conn, ctx, id, "project", project.clone())?;
            json!({ "ok": true, "project": project })
        }
        "projects_link" => {
            let id = s(a, "id")?;
            let target = s(a, "resourceId")?;
            require_kind(conn, id, "project")?;
            store::page_meta_by_id(conn, target)?.ok_or_else(|| anyhow!("not found: {target}"))?;
            let mut project = metadata_of(conn, id)?.get("project").cloned().unwrap_or(json!({}));
            let mut links: Vec<String> = project
                .get("links")
                .and_then(Value::as_array)
                .map(|v| v.iter().filter_map(|x| x.as_str().map(str::to_string)).collect())
                .unwrap_or_default();
            if a.get("unlink").and_then(Value::as_bool).unwrap_or(false) {
                links.retain(|l| l != target);
            } else if !links.iter().any(|l| l == target) {
                links.push(target.to_string());
            }
            project["links"] = json!(links);
            store::set_page_meta(conn, ctx, id, "project", project)?;
            json!({ "ok": true, "links": links })
        }
        _ => return Ok(None),
    };
    Ok(Some(out))
}
