//! Worlds tools: versions, templates, automations, chats, profile, activity, the Discord queue, search and settings.

use super::more2::md_of_snapshot;
use super::{os, s};
use crate::content;
use crate::store::{self, Ctx};
use anyhow::{anyhow, bail, Result};
use rusqlite::{params, Connection};
use serde_json::{json, Value};
use std::collections::HashMap;

pub fn call(conn: &Connection, ctx: &Ctx, name: &str, a: &Value) -> Result<Option<Value>> {
    let out = match name {
        // ---- versions
        "versions_diff" => {
            let (page_id, snap): (String, String) =
                conn.query_row("SELECT page_id, snapshot FROM versions WHERE id = ?1", [s(a, "versionId")?], |r| {
                    Ok((r.get(0)?, r.get(1)?))
                })?;
            let old = md_of_snapshot(&serde_json::from_str(&snap).unwrap_or(json!([])));
            let now: String = store::blocks_of(conn, &page_id)?
                .iter()
                .map(|b| content::to_markdown(&b.content))
                .filter(|m| !m.trim().is_empty())
                .collect::<Vec<_>>()
                .join("\n");
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
            let removed: Vec<String> =
                count.into_iter().filter(|(_, c)| *c > 0).flat_map(|(l, c)| std::iter::repeat_n(l.to_string(), c as usize)).collect();
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
            store::update_page(
                conn,
                ctx,
                id,
                store::PagePatch { title: os(a, "title").map(str::to_string), template_category: cat, ..Default::default() },
            )?;
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
            let au = crate::automations::save(
                conn,
                ctx,
                crate::automations::AutomationInput {
                    id: Some(id.to_string()),
                    name: cur.name,
                    enabled: a.get("enabled").and_then(Value::as_bool).unwrap_or(!cur.enabled),
                    spec: cur.spec,
                },
            )?;
            json!({ "id": au.id, "enabled": au.enabled, "nextRunAt": au.next_run_at })
        }
        "automations_upcoming" => {
            let mut list: Vec<crate::automations::Automation> =
                crate::automations::list(conn)?.into_iter().filter(|x| x.enabled && x.next_run_at.is_some()).collect();
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
                    links.retain(|l| {
                        !(label.as_ref().map(|x| l["label"].as_str().map(str::to_lowercase).as_ref() == Some(x)).unwrap_or(false)
                            || url.map(|u| l["url"].as_str() == Some(u)).unwrap_or(false))
                    });
                }
            }
            let p = store::update_profile_as(conn, ctx, store::ProfilePatch { links: Some(Value::Array(links)), ..Default::default() })?;
            json!({ "links": p.links })
        }
        "profile_set_status" => {
            let v = s(a, "status")?.trim().to_string();
            store::update_profile_as(
                conn,
                ctx,
                store::ProfilePatch { status: Some(if v.is_empty() { None } else { Some(v) }), ..Default::default() },
            )?;
            json!({ "ok": true })
        }
        // ---- search and activity
        "search_everything" => {
            let q = s(a, "query")?;
            let n = a.get("limit").and_then(Value::as_i64).unwrap_or(10);
            let like = format!("%{}%", q.replace(['%', '_'], ""));
            let pages = store::search(conn, q, n, true)?;
            let mut stmt = conn.prepare("SELECT DISTINCT c.id, c.title FROM ai_chats c LEFT JOIN ai_messages m ON m.chat_id = c.id WHERE c.title LIKE ?1 OR m.content LIKE ?1 ORDER BY c.updated_at DESC LIMIT ?2")?;
            let chats = stmt
                .query_map(params![like, n], |r| Ok(json!({ "chatId": r.get::<_, String>(0)?, "title": r.get::<_, String>(1)? })))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            let mut stmt = conn.prepare("SELECT id, name FROM automations WHERE name LIKE ?1 LIMIT ?2")?;
            let autos = stmt
                .query_map(params![like, n], |r| Ok(json!({ "id": r.get::<_, String>(0)?, "name": r.get::<_, String>(1)? })))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            let mut stmt =
                conn.prepare("SELECT id, file_name, page_id FROM attachments WHERE file_name LIKE ?1 ORDER BY created_at DESC LIMIT ?2")?;
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
            let mut stmt = conn.prepare(
                "SELECT id, kind, payload, requested_by, created_at FROM pending_actions WHERE status = 'pending' ORDER BY created_at DESC",
            )?;
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
