//! Worlds tools: tasks, tables and block surgery.

use super::more2::{block, cell, csv_escape, for_tasks, fresh, kids_mut, last_block, page_meta, para, parse_csv, table_rows};
use super::{md_nodes, os, s};
use crate::content;
use crate::store::{self, Ctx};
use anyhow::{anyhow, bail, Result};
use rusqlite::Connection;
use serde_json::{json, Value};

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
                        if checked {
                            done += 1
                        } else {
                            open += 1
                        }
                        let keep = match status {
                            "done" => checked,
                            "all" => true,
                            _ => !checked,
                        };
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
            let items: Vec<String> = a
                .get("items")
                .and_then(Value::as_array)
                .map(|v| v.iter().filter_map(Value::as_str).map(|t| format!("- [ ] {}", t.trim())).collect())
                .unwrap_or_default();
            if items.is_empty() {
                bail!("items is empty");
            }
            let after = match os(a, "afterBlockId") {
                Some(b) => Some(b.to_string()),
                None => last_block(conn, page)?,
            };
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
            let cells: Vec<String> = a
                .get("cells")
                .and_then(Value::as_array)
                .map(|v| v.iter().map(|c| c.as_str().map(str::to_string).unwrap_or_else(|| c.to_string())).collect())
                .unwrap_or_default();
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
            let target = kids_mut(&mut node)
                .and_then(|rows| rows.get_mut(r))
                .and_then(|row| kids_mut(row))
                .and_then(|cells| cells.get_mut(c))
                .ok_or_else(|| anyhow!("no cell at row {r}, column {c}"))?;
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
            let after = match os(a, "afterBlockId") {
                Some(b) => Some(b.to_string()),
                None => last_block(conn, page)?,
            };
            json!({ "inserted": store::insert_blocks(conn, ctx, page, after.as_deref(), vec![json!({ "type": "table", "content": content })])?, "rows": rows.len(), "columns": width })
        }
        "tables_to_csv" => {
            let b = block(conn, s(a, "blockId")?)?;
            let csv = table_rows(&b.content)
                .iter()
                .map(|r| r.iter().map(|c| csv_escape(c)).collect::<Vec<_>>().join(","))
                .collect::<Vec<_>>()
                .join("\n");
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
            let ids: Vec<String> = a
                .get("blockIds")
                .and_then(Value::as_array)
                .map(|v| v.iter().filter_map(Value::as_str).map(str::to_string).collect())
                .unwrap_or_default();
            if ids.is_empty() {
                bail!("blockIds is empty");
            }
            let mut nodes = Vec::new();
            for id in &ids {
                nodes.push(fresh(&block(conn, id)?.content));
            }
            let after = match os(a, "afterBlockId") {
                Some(b) => Some(b.to_string()),
                None => last_block(conn, target)?,
            };
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
            let node =
                md_nodes(if md.trim().is_empty() { " " } else { &md })?.into_iter().next().ok_or_else(|| anyhow!("nothing to convert"))?;
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
        _ => return Ok(None),
    };
    Ok(Some(out))
}
