//! Worlds tools: profile blocks and images, versions, undo, attachments and automation runs.

use super::more::{import, profile_blocks, save_profile_blocks};
use super::{os, s};
use crate::store::{self, Ctx};
use anyhow::{anyhow, bail, Result};
use rusqlite::{params, Connection};
use serde_json::{json, Value};

pub fn call(conn: &Connection, ctx: &Ctx, name: &str, a: &Value) -> Result<Option<Value>> {
    let out = match name {
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
