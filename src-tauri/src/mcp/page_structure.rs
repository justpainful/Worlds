//! Worlds tools: page structure, archive, properties and collections.

use super::more2::{
    block, collect_links, count_types, for_tasks, fresh, last_block, order_children, page_meta, props_vec, same_name, scope_pages,
};
use super::{md_nodes, os, s};
use crate::content;
use crate::store::{self, Ctx};
use anyhow::{anyhow, bail, Result};
use rusqlite::Connection;
use serde_json::{json, Value};
use std::collections::BTreeMap;

pub fn call(conn: &Connection, ctx: &Ctx, name: &str, a: &Value) -> Result<Option<Value>> {
    let out = match name {
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
                    if item.pointer("/attrs/checked").and_then(Value::as_bool).unwrap_or(false) {
                        done += 1
                    } else {
                        open += 1
                    }
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
            let mut all: Vec<store::PageMeta> =
                store::list_pages(conn, false)?.into_iter().filter(|p| p.kind == "page" && !p.archived).collect();
            if os(a, "by") == Some("opened") {
                all.sort_by_key(|p| std::cmp::Reverse(p.opened_at.unwrap_or(0)));
            } else {
                all.sort_by_key(|p| std::cmp::Reverse(p.updated_at));
            }
            let n = a.get("limit").and_then(Value::as_u64).unwrap_or(15) as usize;
            json!(all
                .iter()
                .take(n)
                .map(|p| json!({ "id": p.id, "title": p.title, "icon": p.icon, "updatedAt": p.updated_at, "openedAt": p.opened_at }))
                .collect::<Vec<_>>())
        }
        "pages_stale" => {
            let days = a.get("days").and_then(Value::as_i64).unwrap_or(60);
            let cutoff = crate::db::now() - days * 86_400_000;
            let mut list: Vec<store::PageMeta> =
                store::list_pages(conn, false)?.into_iter().filter(|p| p.kind == "page" && !p.archived && p.updated_at < cutoff).collect();
            list.sort_by_key(|p| p.updated_at);
            let n = a.get("limit").and_then(Value::as_u64).unwrap_or(30) as usize;
            json!(list.iter().take(n).map(|p| json!({ "id": p.id, "title": p.title, "updatedAt": p.updated_at, "daysIdle": (crate::db::now() - p.updated_at) / 86_400_000 })).collect::<Vec<_>>())
        }
        "pages_reorder_children" => {
            let ids: Vec<String> = a
                .get("orderedIds")
                .and_then(Value::as_array)
                .map(|v| v.iter().filter_map(Value::as_str).map(str::to_string).collect())
                .unwrap_or_default();
            json!({ "ordered": order_children(conn, ctx, os(a, "parentId"), &ids)? })
        }
        "pages_sort_children" => {
            let parent = os(a, "parentId");
            let by = s(a, "by")?;
            let desc = a.get("descending").and_then(Value::as_bool).unwrap_or(false);
            let mut kids: Vec<store::PageMeta> =
                store::list_pages(conn, false)?.into_iter().filter(|p| p.parent_id.as_deref() == parent && p.kind == "page").collect();
            let key = |p: &store::PageMeta| -> String {
                match by {
                    "title" => p.title.to_lowercase(),
                    "created" => format!("{:020}", p.created_at),
                    "updated" => format!("{:020}", p.updated_at),
                    prop => p
                        .properties
                        .as_array()
                        .and_then(|ps| ps.iter().find(|x| same_name(x, prop)))
                        .map(|x| match &x["value"] {
                            Value::Number(n) => format!("{:020.4}", n.as_f64().unwrap_or(0.0) + 1e12),
                            v => v.to_string().to_lowercase(),
                        })
                        .unwrap_or_else(|| "\u{10FFFF}".into()),
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
            let sources: Vec<String> = a
                .get("sourcePageIds")
                .and_then(Value::as_array)
                .map(|v| v.iter().filter_map(Value::as_str).map(str::to_string).collect())
                .unwrap_or_default();
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
                        let sub = store::create_page(
                            conn,
                            ctx,
                            store::NewPage {
                                title: Some(title.clone()),
                                parent_id: Some(page.to_string()),
                                blocks: Some(section.iter().map(|x| fresh(&x.content)).collect()),
                                ..Default::default()
                            },
                        )?;
                        for x in &section {
                            store::delete_block(conn, ctx, &x.id)?;
                        }
                        store::insert_blocks(
                            conn,
                            ctx,
                            page,
                            Some(&b.id),
                            vec![json!({ "type": "pageLink", "attrs": { "pageId": sub.id, "title": title } })],
                        )?;
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
            let pages: Vec<store::PageMeta> = if a.get("pageIds").is_some() || a.get("parentId").is_some() {
                scope_pages(conn, a)?
            } else {
                bail!("give pageIds or parentId")
            };
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
            let list: Vec<Value> = store::list_pages(conn, false)?
                .into_iter()
                .filter(|p| p.archived && p.kind == "page")
                .map(|p| json!({ "id": p.id, "title": p.title, "updatedAt": p.updated_at }))
                .collect();
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
            let list: Vec<Value> = store::blocks_of(conn, s(a, "pageId")?)?
                .into_iter()
                .filter(|b| b.block_type == "collection")
                .map(|b| json!({ "blockId": b.id, "settings": b.content.get("attrs") }))
                .collect();
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
        _ => return Ok(None),
    };
    Ok(Some(out))
}
