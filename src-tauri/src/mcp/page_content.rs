//! Worlds tools: workspace overview, page queries, markdown, find and replace, covers, styles and layouts.

use super::more::{ensure_props, find_prop, import, new_prop_id, now_local, page_brief, prop_text, replace_in, set_prop_value};
use super::{md_nodes, os, s};
use crate::content;
use crate::store::{self, Ctx};
use anyhow::{anyhow, bail, Result};
use rusqlite::Connection;
use serde_json::{json, Map, Value};

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
        _ => return Ok(None),
    };
    Ok(Some(out))
}
