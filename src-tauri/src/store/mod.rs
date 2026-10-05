//! The single data layer. UI commands, the MCP tool server and the
//! automation runner all go through these functions; nothing else touches
//! SQL directly. Every mutation records history and a change row.

use crate::content;
use crate::db::{self, mark_change, new_id, now};
use anyhow::{anyhow, bail, Result};
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

/// Who is performing a mutation.
#[derive(Clone, Debug)]
pub struct Ctx {
    pub actor: String,         // "user" | "ai" | "automation"
    pub op_id: Option<String>, // groups AI / automation changes for review + undo
    pub origin: String,        // "ui" | "mcp" | "runner"
}

impl Ctx {
    pub fn user() -> Self {
        Ctx { actor: "user".into(), op_id: None, origin: "ui".into() }
    }
    fn is_user(&self) -> bool {
        self.actor == "user"
    }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: String,
    pub display_name: String,
    pub handle: Option<String>,
    pub avatar: Option<String>,
    pub banner: Option<String>,
    pub bio: Option<String>,
    pub status: Option<String>,
    pub accent: Option<String>,
    pub theme: String,
    pub language: String,
    pub text_direction: String,
    pub location: Option<String>,
    /// [{ label, url }]
    pub links: Value,
    /// Profile blocks (widgets): [{ id, type, size, style, ... }]
    pub blocks: Value,
    /// Banner focus point "x,y" in 0..1.
    pub banner_focus: Option<String>,
    /// Avatar crop "x,y,zoom" (percent, percent, 1..4).
    pub avatar_crop: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PageMeta {
    pub id: String,
    pub title: String,
    pub icon: Option<String>,
    pub cover: Option<String>,
    pub parent_id: Option<String>,
    pub sort_key: f64,
    pub owner_id: Option<String>,
    pub kind: String,
    pub template_category: Option<String>,
    pub pinned: bool,
    pub pin_order: Option<f64>,
    pub favorite: bool,
    pub archived: bool,
    pub deleted_at: Option<i64>,
    pub preview: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub opened_at: Option<i64>,
    /// Typed page properties (metadata.properties), for collections and search.
    pub properties: Value,
    /// Presentation settings (metadata.look): cover crop, font, width.
    pub look: Value,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Block {
    pub id: String,
    pub page_id: String,
    #[serde(rename = "type")]
    pub block_type: String,
    pub order: f64,
    pub content: Value,
    pub properties: Value,
    pub direction: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Backlink {
    pub page_id: String,
    pub title: String,
    pub icon: Option<String>,
    pub block_id: String,
    pub kind: String,
    pub excerpt: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Page {
    #[serde(flatten)]
    pub meta: PageMeta,
    pub metadata: Value,
    pub instructions: Vec<String>,
    pub blocks: Vec<Block>,
    pub backlinks: Vec<Backlink>,
    pub attachments: Vec<Attachment>,
    pub breadcrumbs: Vec<Crumb>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Crumb {
    pub id: String,
    pub title: String,
    pub icon: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    pub id: String,
    pub page_id: Option<String>,
    pub kind: String,
    pub file_name: String,
    pub mime: String,
    pub size: i64,
    pub rel_path: String,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub created_at: i64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub id: i64,
    pub page_id: Option<String>,
    pub page_title: Option<String>,
    pub op_id: Option<String>,
    pub actor: String,
    pub kind: String,
    pub summary: String,
    pub block_id: Option<String>,
    pub before: Option<Value>,
    pub after: Option<Value>,
    pub meta: Value,
    pub created_at: i64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Version {
    pub id: String,
    pub page_id: String,
    pub created_at: i64,
    pub actor: String,
    pub op_id: Option<String>,
    pub label: Option<String>,
    pub block_count: i64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub page_id: String,
    pub title: String,
    pub icon: Option<String>,
    pub kind: String,
    pub snippet: String,
    pub parent_title: Option<String>,
    pub updated_at: i64,
}

#[derive(Deserialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct NewPage {
    pub title: Option<String>,
    pub icon: Option<String>,
    pub parent_id: Option<String>,
    pub after_id: Option<String>,
    pub kind: Option<String>,
    pub template_category: Option<String>,
    pub markdown: Option<String>,
    pub blocks: Option<Vec<Value>>,
    pub instructions: Option<Vec<String>>,
    pub metadata: Option<Value>,
}

#[derive(Deserialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct PagePatch {
    pub title: Option<String>,
    #[serde(default, deserialize_with = "explicit_null")]
    pub icon: Option<Option<String>>,
    #[serde(default, deserialize_with = "explicit_null")]
    pub cover: Option<Option<String>>,
    pub pinned: Option<bool>,
    pub favorite: Option<bool>,
    pub archived: Option<bool>,
    pub metadata: Option<Value>,
    pub instructions: Option<Vec<String>>,
    #[serde(default, deserialize_with = "explicit_null")]
    pub template_category: Option<Option<String>>,
}

#[derive(Serialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct SaveResult {
    pub added: usize,
    pub changed: usize,
    pub removed: usize,
    pub remapped: Vec<(String, String)>,
    pub updated_at: i64,
}

/// Distinguishes a missing field (`None`) from an explicit `null` (`Some(None)`),
/// so a patch can clear a value (remove an icon, a banner) as well as set it.
fn explicit_null<'de, T, D>(d: D) -> std::result::Result<Option<Option<T>>, D::Error>
where
    T: Deserialize<'de>,
    D: serde::Deserializer<'de>,
{
    Option::<T>::deserialize(d).map(Some)
}

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

const PAGE_COLS: &str = "id, title, icon, cover, parent_id, sort_key, owner_id, kind, template_category, \
    pinned, pin_order, favorite, archived, deleted_at, preview, created_at, updated_at, opened_at,     json_extract(metadata, '$.properties'), json_extract(metadata, '$.look')";

fn page_meta(r: &Row) -> rusqlite::Result<PageMeta> {
    Ok(PageMeta {
        id: r.get(0)?,
        title: r.get(1)?,
        icon: r.get(2)?,
        cover: r.get(3)?,
        parent_id: r.get(4)?,
        sort_key: r.get(5)?,
        owner_id: r.get(6)?,
        kind: r.get(7)?,
        template_category: r.get(8)?,
        pinned: r.get::<_, i64>(9)? != 0,
        pin_order: r.get(10)?,
        favorite: r.get::<_, i64>(11)? != 0,
        archived: r.get::<_, i64>(12)? != 0,
        deleted_at: r.get(13)?,
        preview: r.get(14)?,
        created_at: r.get(15)?,
        updated_at: r.get(16)?,
        opened_at: r.get(17)?,
        properties: r.get::<_, Option<String>>(18)?.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or(json!([])),
        look: r.get::<_, Option<String>>(19)?.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or(json!({})),
    })
}

/// Merge one key (properties or look) into a page's metadata without touching the rest.
pub fn set_page_meta(conn: &Connection, ctx: &Ctx, id: &str, key: &str, value: Value) -> Result<PageMeta> {
    // One key of the metadata object at a time, so no editor can overwrite
    // what another part of the app keeps there.
    if !matches!(key, "properties" | "look" | "doc" | "deck" | "project" | "gallery" | "file" | "stream") {
        bail!("unknown page setting {key}");
    }
    let value = if key == "properties" {
        let list: Vec<Value> = value
            .as_array()
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .filter(|p| p.get("name").and_then(Value::as_str).map(|n| !n.trim().is_empty()).unwrap_or(false))
            .take(40)
            .collect();
        Value::Array(list)
    } else {
        value
    };
    require_page(conn, id)?;
    conn.execute(
        &format!("UPDATE pages SET metadata = json_set(metadata, '$.{key}', json(?1)), updated_at = ?2 WHERE id = ?3"),
        params![value.to_string(), now(), id],
    )?;
    if matches!(key, "stream" | "project" | "doc") {
        index_page(conn, id)?;
    }
    if key == "properties" && !ctx.is_user() {
        record(conn, ctx, Some(id), "properties", "Updated properties", None, None, None, json!({}))?;
    }
    mark_change(conn, Some(id), "page", &ctx.origin)?;
    page_meta_by_id(conn, id)?.ok_or_else(|| anyhow!("page not found"))
}

fn block_row(r: &Row) -> rusqlite::Result<Block> {
    let content: String = r.get(4)?;
    let props: String = r.get(5)?;
    Ok(Block {
        id: r.get(0)?,
        page_id: r.get(1)?,
        block_type: r.get(2)?,
        order: r.get(3)?,
        content: serde_json::from_str(&content).unwrap_or(Value::Null),
        properties: serde_json::from_str(&props).unwrap_or(json!({})),
        direction: r.get(6)?,
        created_at: r.get(7)?,
        updated_at: r.get(8)?,
    })
}

const BLOCK_COLS: &str = "id, page_id, type, sort_key, content, properties, direction, created_at, updated_at";

fn attachment_row(r: &Row) -> rusqlite::Result<Attachment> {
    Ok(Attachment {
        id: r.get(0)?,
        page_id: r.get(1)?,
        kind: r.get(2)?,
        file_name: r.get(3)?,
        mime: r.get(4)?,
        size: r.get(5)?,
        rel_path: r.get(6)?,
        width: r.get(7)?,
        height: r.get(8)?,
        created_at: r.get(9)?,
    })
}

const ATTACHMENT_COLS: &str = "id, page_id, kind, file_name, mime, size, rel_path, width, height, created_at";

mod attachments;
mod blocks;
mod history;
mod kinds;
mod pages;
mod profile;
mod search;
mod templates;

pub use attachments::*;
pub use blocks::*;
pub use history::*;
pub use kinds::*;
pub use pages::*;
pub use profile::*;
pub use search::*;
pub use templates::*;
