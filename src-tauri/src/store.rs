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
    if !matches!(key, "properties" | "look") {
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

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

fn profile_row(r: &Row) -> rusqlite::Result<Profile> {
    Ok(Profile {
        id: r.get(0)?,
        display_name: r.get(1)?,
        handle: r.get(2)?,
        avatar: r.get(3)?,
        banner: r.get(4)?,
        bio: r.get(5)?,
        status: r.get(6)?,
        accent: r.get(7)?,
        theme: r.get(8)?,
        language: r.get(9)?,
        text_direction: r.get(10)?,
        created_at: r.get(11)?,
        updated_at: r.get(12)?,
        location: r.get(13)?,
        links: serde_json::from_str(&r.get::<_, String>(14)?).unwrap_or(json!([])),
        blocks: serde_json::from_str(&r.get::<_, String>(15)?).unwrap_or(json!([])),
        banner_focus: r.get(16)?,
        avatar_crop: r.get(17)?,
    })
}

const PROFILE_COLS: &str = "id, display_name, handle, avatar, banner, bio, status, accent, theme, language, text_direction, created_at, updated_at, location, links, blocks, banner_focus, avatar_crop";

/// The local profile, created silently on first use.
pub fn profile(conn: &Connection) -> Result<Profile> {
    if let Some(p) = conn.query_row(&format!("SELECT {PROFILE_COLS} FROM profile LIMIT 1"), [], profile_row).optional()? {
        return Ok(p);
    }
    let id = new_id();
    let name = std::env::var("USERNAME").unwrap_or_default();
    let t = now();
    conn.execute("INSERT INTO profile (id, display_name, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)", params![id, name, t])?;
    profile(conn)
}

#[derive(Deserialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProfilePatch {
    pub display_name: Option<String>,
    #[serde(default, deserialize_with = "explicit_null")]
    pub handle: Option<Option<String>>,
    #[serde(default, deserialize_with = "explicit_null")]
    pub avatar: Option<Option<String>>,
    #[serde(default, deserialize_with = "explicit_null")]
    pub banner: Option<Option<String>>,
    #[serde(default, deserialize_with = "explicit_null")]
    pub bio: Option<Option<String>>,
    #[serde(default, deserialize_with = "explicit_null")]
    pub status: Option<Option<String>>,
    #[serde(default, deserialize_with = "explicit_null")]
    pub accent: Option<Option<String>>,
    pub theme: Option<String>,
    pub language: Option<String>,
    pub text_direction: Option<String>,
    #[serde(default, deserialize_with = "explicit_null")]
    pub location: Option<Option<String>>,
    pub links: Option<Value>,
    pub blocks: Option<Value>,
    #[serde(default, deserialize_with = "explicit_null")]
    pub banner_focus: Option<Option<String>>,
    #[serde(default, deserialize_with = "explicit_null")]
    pub avatar_crop: Option<Option<String>>,
}

pub fn update_profile(conn: &Connection, patch: ProfilePatch) -> Result<Profile> {
    update_profile_as(conn, &Ctx::user(), patch)
}

pub fn update_profile_as(conn: &Connection, ctx: &Ctx, patch: ProfilePatch) -> Result<Profile> {
    let p = profile(conn)?;
    let mut sets: Vec<String> = Vec::new();
    let mut vals: Vec<rusqlite::types::Value> = Vec::new();
    macro_rules! set {
        ($col:literal, $v:expr) => {{
            sets.push(format!("{} = ?{}", $col, vals.len() + 1));
            vals.push($v);
        }};
    }
    use rusqlite::types::Value as V;
    let opt = |o: Option<String>| o.map(V::Text).unwrap_or(V::Null);
    if let Some(v) = patch.display_name {
        set!("display_name", V::Text(v));
    }
    if let Some(v) = patch.handle {
        set!("handle", opt(v));
    }
    if let Some(v) = patch.avatar {
        set!("avatar", opt(v));
    }
    if let Some(v) = patch.banner {
        set!("banner", opt(v));
    }
    if let Some(v) = patch.bio {
        set!("bio", opt(v));
    }
    if let Some(v) = patch.status {
        set!("status", opt(v));
    }
    if let Some(v) = patch.accent {
        set!("accent", opt(v));
    }
    if let Some(v) = patch.theme {
        set!("theme", V::Text(v));
    }
    if let Some(v) = patch.language {
        set!("language", V::Text(v));
    }
    if let Some(v) = patch.text_direction {
        set!("text_direction", V::Text(v));
    }
    if let Some(v) = patch.location {
        set!("location", opt(v));
    }
    if let Some(v) = patch.links {
        let clean: Vec<Value> = v
            .as_array()
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .filter(|l| l.get("url").and_then(Value::as_str).map(|u| u.starts_with("http")).unwrap_or(false))
            .take(12)
            .collect();
        set!("links", V::Text(Value::Array(clean).to_string()));
    }
    if let Some(v) = patch.blocks {
        // Each block needs an id and a type; at most 12 blocks, each kept small.
        let clean: Vec<Value> = v
            .as_array()
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .filter(|b| b.get("id").and_then(Value::as_str).is_some() && b.get("type").and_then(Value::as_str).is_some())
            .filter(|b| b.to_string().len() <= 16_000)
            .take(12)
            .collect();
        set!("blocks", V::Text(Value::Array(clean).to_string()));
    }
    if let Some(v) = patch.banner_focus {
        set!("banner_focus", opt(v));
    }
    if let Some(v) = patch.avatar_crop {
        set!("avatar_crop", opt(v));
    }
    if !sets.is_empty() {
        set!("updated_at", V::Integer(now()));
        let sql = format!("UPDATE profile SET {} WHERE id = ?{}", sets.join(", "), vals.len() + 1);
        vals.push(V::Text(p.id.clone()));
        conn.execute(&sql, rusqlite::params_from_iter(vals))?;
        if !ctx.is_user() {
            record(conn, ctx, None, "profile", "Updated your profile", None, None, None, json!({}))?;
        }
        mark_change(conn, None, "profile", &ctx.origin)?;
    }
    profile(conn)
}

/// Light, real numbers for the profile header: counts and a daily-activity streak
/// built from local history, page edits and messages sent to Claude.
pub fn profile_stats(conn: &Connection) -> Result<Value> {
    use chrono::{Duration, Local, TimeZone};
    let count = |sql: &str| -> Result<i64> { Ok(conn.query_row(sql, [], |r| r.get(0))?) };
    let pages = count("SELECT COUNT(*) FROM pages WHERE deleted_at IS NULL")?;
    let chats = count("SELECT COUNT(*) FROM ai_chats")?;
    let automations = count("SELECT COUNT(*) FROM automations")?;
    let since = now() - 90 * 86_400_000;
    let mut stmt = conn.prepare(
        "SELECT created_at FROM history WHERE created_at >= ?1 AND actor = 'user'
         UNION ALL SELECT updated_at FROM pages WHERE updated_at >= ?1
         UNION ALL SELECT created_at FROM ai_messages WHERE created_at >= ?1 AND role = 'user'",
    )?;
    let stamps = stmt.query_map([since], |r| r.get::<_, i64>(0))?.collect::<rusqlite::Result<Vec<_>>>()?;
    let day = |ms: i64| Local.timestamp_millis_opt(ms).single().map(|d| d.date_naive());
    let mut counts: std::collections::BTreeMap<chrono::NaiveDate, i64> = Default::default();
    for t in &stamps {
        if let Some(d) = day(*t) {
            *counts.entry(d).or_default() += 1;
        }
    }
    let today = Local::now().date_naive();
    // A streak survives until the end of today: start from yesterday if today is still empty.
    let mut cursor = if counts.contains_key(&today) { today } else { today - Duration::days(1) };
    let mut streak = 0;
    while counts.contains_key(&cursor) {
        streak += 1;
        cursor -= Duration::days(1);
    }
    let week_ago = now() - 7 * 86_400_000;
    let edits7d = stamps.iter().filter(|t| **t >= week_ago).count();
    let active_days: Vec<Value> = (0..28)
        .rev()
        .map(|i| {
            let d = today - Duration::days(i);
            json!({ "date": d.format("%Y-%m-%d").to_string(), "count": counts.get(&d).copied().unwrap_or(0) })
        })
        .collect();
    let words: i64 = conn
        .query_row("SELECT COALESCE(SUM(LENGTH(text) - LENGTH(REPLACE(text, ' ', '')) + 1), 0) FROM blocks WHERE text <> '' AND page_id IN (SELECT id FROM pages WHERE deleted_at IS NULL)", [], |r| r.get(0))
        .unwrap_or(0);
    Ok(json!({
        "pages": pages,
        "chats": chats,
        "automations": automations,
        "streak": streak,
        "edits7d": edits7d,
        "words": words,
        "activeDays": active_days,
    }))
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

pub fn list_pages(conn: &Connection, include_deleted: bool) -> Result<Vec<PageMeta>> {
    let filter = if include_deleted { "" } else { "WHERE deleted_at IS NULL" };
    let mut stmt = conn.prepare(&format!("SELECT {PAGE_COLS} FROM pages {filter} ORDER BY sort_key, created_at"))?;
    let rows = stmt.query_map([], page_meta)?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn page_meta_by_id(conn: &Connection, id: &str) -> Result<Option<PageMeta>> {
    Ok(conn.query_row(&format!("SELECT {PAGE_COLS} FROM pages WHERE id = ?1"), [id], page_meta).optional()?)
}

fn require_page(conn: &Connection, id: &str) -> Result<PageMeta> {
    page_meta_by_id(conn, id)?.ok_or_else(|| anyhow!("page not found: {id}"))
}

pub fn blocks_of(conn: &Connection, page_id: &str) -> Result<Vec<Block>> {
    let mut stmt = conn.prepare(&format!("SELECT {BLOCK_COLS} FROM blocks WHERE page_id = ?1 ORDER BY sort_key"))?;
    let rows = stmt.query_map([page_id], block_row)?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn block_by_id(conn: &Connection, id: &str) -> Result<Option<Block>> {
    Ok(conn.query_row(&format!("SELECT {BLOCK_COLS} FROM blocks WHERE id = ?1"), [id], block_row).optional()?)
}

pub fn get_page(conn: &Connection, id: &str) -> Result<Option<Page>> {
    let Some(meta) = page_meta_by_id(conn, id)? else { return Ok(None) };
    let (metadata, instructions): (String, String) =
        conn.query_row("SELECT metadata, instructions FROM pages WHERE id = ?1", [id], |r| Ok((r.get(0)?, r.get(1)?)))?;
    let blocks = blocks_of(conn, id)?;
    let backlinks = backlinks(conn, id)?;
    let attachments = {
        let mut stmt = conn.prepare(&format!("SELECT {ATTACHMENT_COLS} FROM attachments WHERE page_id = ?1 ORDER BY created_at"))?;
        let rows = stmt.query_map([id], attachment_row)?.collect::<rusqlite::Result<Vec<_>>>()?;
        rows
    };
    let breadcrumbs = breadcrumbs(conn, meta.parent_id.as_deref())?;
    Ok(Some(Page {
        meta,
        metadata: serde_json::from_str(&metadata).unwrap_or(json!({})),
        instructions: serde_json::from_str(&instructions).unwrap_or_default(),
        blocks,
        backlinks,
        attachments,
        breadcrumbs,
    }))
}

fn breadcrumbs(conn: &Connection, parent: Option<&str>) -> Result<Vec<Crumb>> {
    let mut out = Vec::new();
    let mut cur = parent.map(str::to_string);
    while let Some(pid) = cur {
        if out.len() > 64 {
            break;
        }
        let row: Option<(String, Option<String>, Option<String>)> = conn
            .query_row("SELECT title, icon, parent_id FROM pages WHERE id = ?1", [&pid], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .optional()?;
        let Some((title, icon, next)) = row else { break };
        out.push(Crumb { id: pid, title, icon });
        cur = next;
    }
    out.reverse();
    Ok(out)
}

pub fn backlinks(conn: &Connection, page_id: &str) -> Result<Vec<Backlink>> {
    let mut stmt = conn.prepare(
        "SELECT r.source_page, p.title, p.icon, r.source_block, r.kind, COALESCE(b.text, '')
         FROM refs r JOIN pages p ON p.id = r.source_page
         LEFT JOIN blocks b ON b.id = r.source_block
         WHERE r.target_page = ?1 AND r.source_page != ?1 AND p.deleted_at IS NULL
         ORDER BY p.updated_at DESC",
    )?;
    let rows = stmt
        .query_map([page_id], |r| {
            let excerpt: String = r.get(5)?;
            Ok(Backlink {
                page_id: r.get(0)?,
                title: r.get(1)?,
                icon: r.get(2)?,
                block_id: r.get(3)?,
                kind: r.get(4)?,
                excerpt: excerpt.chars().take(160).collect(),
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

fn next_sort_key(conn: &Connection, parent: Option<&str>, after: Option<&str>) -> Result<f64> {
    if let Some(after_id) = after {
        let k: Option<f64> = conn.query_row("SELECT sort_key FROM pages WHERE id = ?1", [after_id], |r| r.get(0)).optional()?;
        if let Some(k) = k {
            let next: Option<f64> = conn
                .query_row(
                    "SELECT MIN(sort_key) FROM pages WHERE parent_id IS ?1 AND sort_key > ?2 AND deleted_at IS NULL",
                    params![parent, k],
                    |r| r.get(0),
                )
                .optional()?
                .flatten();
            return Ok(match next {
                Some(n) => (k + n) / 2.0,
                None => k + 1.0,
            });
        }
    }
    let max: Option<f64> =
        conn.query_row("SELECT MAX(sort_key) FROM pages WHERE parent_id IS ?1", params![parent], |r| r.get(0)).optional()?.flatten();
    Ok(max.map(|m| m + 1.0).unwrap_or(0.0))
}

pub fn create_page(conn: &Connection, ctx: &Ctx, new: NewPage) -> Result<PageMeta> {
    let owner = profile(conn)?.id;
    if let Some(parent) = &new.parent_id {
        require_page(conn, parent)?;
    }
    let id = new_id();
    let t = now();
    let sort = next_sort_key(conn, new.parent_id.as_deref(), new.after_id.as_deref())?;
    let kind = new.kind.clone().unwrap_or_else(|| "page".into());
    conn.execute(
        "INSERT INTO pages (id, title, icon, parent_id, sort_key, owner_id, kind, template_category,
                            metadata, instructions, created_at, updated_at, opened_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11, ?11)",
        params![
            id,
            new.title.clone().unwrap_or_default(),
            new.icon,
            new.parent_id,
            sort,
            owner,
            kind,
            new.template_category,
            new.metadata.clone().unwrap_or(json!({})).to_string(),
            serde_json::to_string(&new.instructions.clone().unwrap_or_default())?,
            t
        ],
    )?;
    record(conn, ctx, Some(&id), "created", &format!("Created “{}”", new.title.clone().unwrap_or_default()), None, None, None, json!({}))?;
    let nodes = match (&new.blocks, &new.markdown) {
        (Some(b), _) => b.clone(),
        (None, Some(md)) => content::from_markdown(md),
        _ => Vec::new(),
    };
    if !nodes.is_empty() {
        let quiet = Ctx { actor: ctx.actor.clone(), op_id: ctx.op_id.clone(), origin: ctx.origin.clone() };
        write_blocks(conn, &quiet, &id, nodes, false)?;
    }
    index_page(conn, &id)?;
    mark_change(conn, Some(&id), "page", &ctx.origin)?;
    require_page(conn, &id)
}

pub fn update_page(conn: &Connection, ctx: &Ctx, id: &str, patch: PagePatch) -> Result<PageMeta> {
    let before = require_page(conn, id)?;
    let t = now();
    if let Some(title) = &patch.title {
        if *title != before.title {
            conn.execute("UPDATE pages SET title = ?1, updated_at = ?2 WHERE id = ?3", params![title, t, id])?;
            record(
                conn,
                ctx,
                Some(id),
                "renamed",
                &format!("Renamed to “{title}”"),
                None,
                Some(json!(before.title)),
                Some(json!(title)),
                json!({}),
            )?;
            // keep mention labels pointing here fresh is the renderer's job; labels resolve live.
        }
    }
    if let Some(icon) = &patch.icon {
        conn.execute("UPDATE pages SET icon = ?1, updated_at = ?2 WHERE id = ?3", params![icon, t, id])?;
    }
    if let Some(cover) = &patch.cover {
        conn.execute("UPDATE pages SET cover = ?1, updated_at = ?2 WHERE id = ?3", params![cover, t, id])?;
    }
    if let Some(p) = patch.pinned {
        let order: Option<f64> = if p {
            let max: Option<f64> = conn.query_row("SELECT MAX(pin_order) FROM pages", [], |r| r.get(0))?;
            Some(max.unwrap_or(0.0) + 1.0)
        } else {
            None
        };
        conn.execute("UPDATE pages SET pinned = ?1, pin_order = ?2 WHERE id = ?3", params![p as i64, order, id])?;
    }
    if let Some(f) = patch.favorite {
        conn.execute("UPDATE pages SET favorite = ?1 WHERE id = ?2", params![f as i64, id])?;
    }
    if let Some(a) = patch.archived {
        conn.execute("UPDATE pages SET archived = ?1, updated_at = ?2 WHERE id = ?3", params![a as i64, t, id])?;
        record(
            conn,
            ctx,
            Some(id),
            if a { "archived" } else { "unarchived" },
            if a { "Archived" } else { "Restored from archive" },
            None,
            None,
            None,
            json!({}),
        )?;
    }
    if let Some(m) = &patch.metadata {
        conn.execute("UPDATE pages SET metadata = ?1, updated_at = ?2 WHERE id = ?3", params![m.to_string(), t, id])?;
    }
    if let Some(ins) = &patch.instructions {
        let old: String = conn.query_row("SELECT instructions FROM pages WHERE id = ?1", [id], |r| r.get(0))?;
        let new_s = serde_json::to_string(ins)?;
        if old != new_s {
            conn.execute("UPDATE pages SET instructions = ?1, updated_at = ?2 WHERE id = ?3", params![new_s, t, id])?;
            record(
                conn,
                ctx,
                Some(id),
                "instructions",
                "Updated assistant instructions",
                None,
                serde_json::from_str(&old).ok(),
                Some(json!(ins)),
                json!({}),
            )?;
        }
    }
    if let Some(cat) = &patch.template_category {
        conn.execute("UPDATE pages SET template_category = ?1 WHERE id = ?2", params![cat, id])?;
    }
    index_page(conn, id)?;
    mark_change(conn, Some(id), "page", &ctx.origin)?;
    require_page(conn, id)
}

pub fn touch_opened(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("UPDATE pages SET opened_at = ?1 WHERE id = ?2", params![now(), id])?;
    Ok(())
}

fn is_descendant(conn: &Connection, candidate: &str, ancestor: &str) -> Result<bool> {
    let mut cur = Some(candidate.to_string());
    let mut guard = 0;
    while let Some(c) = cur {
        if c == ancestor {
            return Ok(true);
        }
        guard += 1;
        if guard > 256 {
            return Ok(true);
        }
        cur = conn.query_row("SELECT parent_id FROM pages WHERE id = ?1", [&c], |r| r.get::<_, Option<String>>(0)).optional()?.flatten();
    }
    Ok(false)
}

/// Re-parent and/or reorder. `before_id` places the page directly before that sibling.
pub fn move_page(conn: &Connection, ctx: &Ctx, id: &str, parent_id: Option<&str>, before_id: Option<&str>) -> Result<PageMeta> {
    let page = require_page(conn, id)?;
    if let Some(p) = parent_id {
        if is_descendant(conn, p, id)? {
            bail!("a page cannot be moved inside itself");
        }
    }
    let sort = if let Some(b) = before_id {
        let k: f64 = conn.query_row("SELECT sort_key FROM pages WHERE id = ?1", [b], |r| r.get(0))?;
        let prev: Option<f64> = conn
            .query_row(
                "SELECT MAX(sort_key) FROM pages WHERE parent_id IS ?1 AND sort_key < ?2 AND id != ?3 AND deleted_at IS NULL",
                params![parent_id, k, id],
                |r| r.get(0),
            )
            .optional()?
            .flatten();
        match prev {
            Some(p) => (p + k) / 2.0,
            None => k - 1.0,
        }
    } else {
        let max: Option<f64> = conn
            .query_row("SELECT MAX(sort_key) FROM pages WHERE parent_id IS ?1 AND id != ?2", params![parent_id, id], |r| r.get(0))
            .optional()?
            .flatten();
        max.map(|m| m + 1.0).unwrap_or(0.0)
    };
    conn.execute("UPDATE pages SET parent_id = ?1, sort_key = ?2 WHERE id = ?3", params![parent_id, sort, id])?;
    if page.parent_id.as_deref() != parent_id {
        let dest = match parent_id {
            Some(p) => require_page(conn, p)?.title,
            None => "top level".into(),
        };
        record(
            conn,
            ctx,
            Some(id),
            "moved",
            &format!("Moved to {dest}"),
            None,
            Some(json!(page.parent_id)),
            Some(json!(parent_id)),
            json!({}),
        )?;
    }
    mark_change(conn, Some(id), "tree", &ctx.origin)?;
    require_page(conn, id)
}

/// Soft delete (to Trash): the page and its subtree.
pub fn delete_page(conn: &Connection, ctx: &Ctx, id: &str) -> Result<()> {
    require_page(conn, id)?;
    let t = now();
    for pid in subtree_ids(conn, id)? {
        conn.execute("UPDATE pages SET deleted_at = ?1 WHERE id = ?2 AND deleted_at IS NULL", params![t, pid])?;
    }
    record(conn, ctx, Some(id), "deleted", "Moved to Trash", None, None, None, json!({}))?;
    mark_change(conn, Some(id), "tree", &ctx.origin)?;
    Ok(())
}

pub fn restore_page(conn: &Connection, ctx: &Ctx, id: &str) -> Result<()> {
    let deleted_at: Option<i64> = conn.query_row("SELECT deleted_at FROM pages WHERE id = ?1", [id], |r| r.get(0))?;
    if let Some(t) = deleted_at {
        for pid in subtree_ids(conn, id)? {
            conn.execute("UPDATE pages SET deleted_at = NULL WHERE id = ?1 AND deleted_at = ?2", params![pid, t])?;
        }
        // If the parent is still in the trash, lift to top level.
        conn.execute(
            "UPDATE pages SET parent_id = NULL WHERE id = ?1 AND parent_id IN (SELECT id FROM pages WHERE deleted_at IS NOT NULL)",
            [id],
        )?;
        record(conn, ctx, Some(id), "restored", "Restored from Trash", None, None, None, json!({}))?;
        mark_change(conn, Some(id), "tree", &ctx.origin)?;
    }
    Ok(())
}

/// Permanently remove a trashed page (user-initiated from Trash only).
pub fn purge_page(conn: &Connection, id: &str) -> Result<()> {
    let deleted: Option<i64> = conn.query_row("SELECT deleted_at FROM pages WHERE id = ?1", [id], |r| r.get(0))?;
    if deleted.is_none() {
        bail!("only pages in Trash can be permanently deleted");
    }
    for pid in subtree_ids(conn, id)?.into_iter().rev() {
        conn.execute("DELETE FROM pages_fts WHERE page_id = ?1", [&pid])?;
        conn.execute("DELETE FROM refs WHERE source_page = ?1", [&pid])?;
        conn.execute("DELETE FROM versions WHERE page_id = ?1", [&pid])?;
        conn.execute("DELETE FROM pages WHERE id = ?1", [&pid])?;
    }
    mark_change(conn, Some(id), "tree", "ui")?;
    Ok(())
}

pub fn subtree_ids(conn: &Connection, root: &str) -> Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "WITH RECURSIVE t(id) AS (SELECT ?1 UNION ALL SELECT p.id FROM pages p JOIN t ON p.parent_id = t.id)
         SELECT id FROM t",
    )?;
    let ids = stmt.query_map([root], |r| r.get(0))?.collect::<rusqlite::Result<Vec<String>>>()?;
    Ok(ids)
}

/// Duplicate a page (optionally with its subpages). Block ids are regenerated.
pub fn duplicate_page(
    conn: &Connection,
    ctx: &Ctx,
    id: &str,
    deep: bool,
    as_kind: Option<&str>,
    new_parent: Option<Option<&str>>,
) -> Result<PageMeta> {
    let src = get_page(conn, id)?.ok_or_else(|| anyhow!("page not found"))?;
    let parent = match new_parent {
        Some(p) => p.map(str::to_string),
        None => src.meta.parent_id.clone(),
    };
    let kind = as_kind.unwrap_or(&src.meta.kind).to_string();
    let title = if as_kind.is_none() && kind == src.meta.kind && new_parent.is_none() {
        format!("{} (copy)", src.meta.title)
    } else {
        src.meta.title.clone()
    };
    let nodes: Vec<Value> = src.blocks.iter().map(|b| strip_bid(b.content.clone())).collect();
    let created = create_page(
        conn,
        ctx,
        NewPage {
            title: Some(title),
            icon: src.meta.icon.clone(),
            parent_id: parent,
            after_id: if new_parent.is_none() { Some(id.to_string()) } else { None },
            kind: Some(kind.clone()),
            template_category: src.meta.template_category.clone(),
            blocks: Some(nodes),
            instructions: Some(src.instructions.clone()),
            metadata: Some(src.metadata.clone()),
            ..Default::default()
        },
    )?;
    if deep {
        let kids: Vec<String> = conn
            .prepare("SELECT id FROM pages WHERE parent_id = ?1 AND deleted_at IS NULL ORDER BY sort_key")?
            .query_map([id], |r| r.get(0))?
            .collect::<rusqlite::Result<_>>()?;
        for kid in kids {
            duplicate_page(conn, ctx, &kid, true, Some(&kind), Some(Some(&created.id)))?;
        }
    }
    Ok(created)
}

fn strip_bid(mut node: Value) -> Value {
    if let Some(a) = node.get_mut("attrs").and_then(Value::as_object_mut) {
        a.remove("bid");
    }
    node
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

#[derive(Deserialize, Debug)]
pub struct BlockInput {
    pub id: String,
    pub content: Value,
}

/// Save the full ordered block list for a page (editor autosave path).
pub fn save_blocks(conn: &Connection, ctx: &Ctx, page_id: &str, input: Vec<BlockInput>) -> Result<SaveResult> {
    require_page(conn, page_id)?;
    let nodes: Vec<Value> = input
        .into_iter()
        .map(|b| {
            let mut c = b.content;
            content::set_block_id(&mut c, &b.id);
            c
        })
        .collect();
    let res = write_blocks(conn, ctx, page_id, nodes, true)?;
    index_page(conn, page_id)?;
    mark_change(conn, Some(page_id), "blocks", &ctx.origin)?;
    Ok(res)
}

/// Diff `nodes` against stored blocks; insert/update/delete/reorder.
fn write_blocks(conn: &Connection, ctx: &Ctx, page_id: &str, nodes: Vec<Value>, record_history: bool) -> Result<SaveResult> {
    let t = now();
    let existing: HashMap<String, (String, f64)> = conn
        .prepare("SELECT id, content, sort_key FROM blocks WHERE page_id = ?1")?
        .query_map([page_id], |r| Ok((r.get::<_, String>(0)?, (r.get::<_, String>(1)?, r.get::<_, f64>(2)?))))?
        .collect::<rusqlite::Result<_>>()?;

    let mut res = SaveResult::default();
    let mut seen: HashSet<String> = HashSet::new();
    let mut changes: Vec<(String, &'static str, Option<Value>, Option<Value>)> = Vec::new();

    if record_history && !ctx.is_user() {
        ensure_op_snapshot(conn, ctx, page_id)?;
    }

    for (i, mut node) in nodes.into_iter().enumerate() {
        let mut id = content::attr_str(&node, "bid").map(str::to_string).unwrap_or_default();
        if id.is_empty() || seen.contains(&id) {
            let fresh = new_id();
            if !id.is_empty() {
                res.remapped.push((id.clone(), fresh.clone()));
            }
            id = fresh;
            content::set_block_id(&mut node, &id);
        } else if !existing.contains_key(&id) {
            // id already used on another page? never steal it.
            let other: Option<String> = conn.query_row("SELECT page_id FROM blocks WHERE id = ?1", [&id], |r| r.get(0)).optional()?;
            if other.is_some() {
                let fresh = new_id();
                res.remapped.push((id.clone(), fresh.clone()));
                id = fresh;
                content::set_block_id(&mut node, &id);
            }
        }
        seen.insert(id.clone());
        let sort = i as f64;
        let block_type = content::node_type(&node).to_string();
        let text = content::plain_text(&node);
        let direction = match content::attr_str(&node, "dir") {
            Some(d @ ("ltr" | "rtl")) => d.to_string(),
            _ => content::detect_direction(&text).to_string(),
        };
        let serialized = node.to_string();
        match existing.get(&id) {
            Some((old, old_sort)) => {
                if *old != serialized {
                    conn.execute(
                        "UPDATE blocks SET type = ?1, sort_key = ?2, content = ?3, text = ?4, direction = ?5, updated_at = ?6 WHERE id = ?7",
                        params![block_type, sort, serialized, text, direction, t, id],
                    )?;
                    res.changed += 1;
                    changes.push((id.clone(), "block_changed", serde_json::from_str(old).ok(), Some(node.clone())));
                } else if (*old_sort - sort).abs() > f64::EPSILON {
                    conn.execute("UPDATE blocks SET sort_key = ?1 WHERE id = ?2", params![sort, id])?;
                }
            }
            None => {
                conn.execute(
                    "INSERT INTO blocks (id, page_id, type, sort_key, content, text, direction, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
                    params![id, page_id, block_type, sort, serialized, text, direction, t],
                )?;
                res.added += 1;
                changes.push((id.clone(), "block_added", None, Some(node.clone())));
            }
        }
    }
    for (id, (old, _)) in &existing {
        if !seen.contains(id) {
            conn.execute("DELETE FROM blocks WHERE id = ?1", [id])?;
            conn.execute("DELETE FROM refs WHERE source_block = ?1", [id])?;
            res.removed += 1;
            changes.push((id.clone(), "block_removed", serde_json::from_str(old).ok(), None));
        }
    }
    if res.added + res.changed + res.removed > 0 {
        conn.execute("UPDATE pages SET updated_at = ?1 WHERE id = ?2", params![t, page_id])?;
        if record_history {
            if ctx.is_user() {
                record_user_edit(conn, page_id, &res)?;
            } else {
                for (bid, kind, before, after) in changes {
                    let summary = match kind {
                        "block_added" => "Added a block",
                        "block_removed" => "Removed a block",
                        _ => "Changed a block",
                    };
                    record(conn, ctx, Some(page_id), kind, summary, Some(&bid), before, after, json!({}))?;
                }
            }
        }
    }
    res.updated_at = t;
    rebuild_refs(conn, page_id)?;
    Ok(res)
}

fn rebuild_refs(conn: &Connection, page_id: &str) -> Result<()> {
    conn.execute("DELETE FROM refs WHERE source_page = ?1", [page_id])?;
    let mut stmt = conn.prepare("SELECT id, content FROM blocks WHERE page_id = ?1")?;
    let rows: Vec<(String, String)> = stmt.query_map([page_id], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<rusqlite::Result<_>>()?;
    for (bid, c) in rows {
        let node: Value = serde_json::from_str(&c).unwrap_or(Value::Null);
        let mut refs = Vec::new();
        content::collect_refs(&node, &mut refs);
        for (target, kind) in refs {
            conn.execute(
                "INSERT OR IGNORE INTO refs (source_page, source_block, target_page, kind) VALUES (?1, ?2, ?3, ?4)",
                params![page_id, bid, target, kind],
            )?;
        }
    }
    Ok(())
}

/// Coalesce continuous user editing into one quiet history line per window,
/// with a restorable version captured at the start of each window.
fn record_user_edit(conn: &Connection, page_id: &str, res: &SaveResult) -> Result<()> {
    const WINDOW: i64 = 10 * 60 * 1000;
    let t = now();
    let last: Option<(i64, i64, String)> = conn
        .query_row("SELECT id, created_at, meta FROM history WHERE page_id = ?1 ORDER BY id DESC LIMIT 1", [page_id], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        })
        .optional()?;
    if let Some((hid, at, meta)) = &last {
        let m: Value = serde_json::from_str(meta).unwrap_or(json!({}));
        if t - at < WINDOW && m.get("edit").is_some() {
            let add = m["added"].as_u64().unwrap_or(0) + res.added as u64;
            let chg = m["changed"].as_u64().unwrap_or(0) + res.changed as u64;
            let rem = m["removed"].as_u64().unwrap_or(0) + res.removed as u64;
            conn.execute(
                "UPDATE history SET meta = ?1, summary = ?2 WHERE id = ?3",
                params![
                    json!({ "edit": true, "added": add, "changed": chg, "removed": rem, "until": t }).to_string(),
                    edit_summary(add, chg, rem),
                    hid
                ],
            )?;
            return Ok(());
        }
    }
    // New editing session: keep a restorable version of the state *before* it.
    // (The diff above already applied, so reconstruct from the previous version
    // is not possible here; the version is taken lazily on the next save via
    // `snapshot_before_user_edit`, called by the command layer pre-save.)
    conn.execute(
        "INSERT INTO history (page_id, actor, kind, summary, meta, created_at) VALUES (?1, 'user', 'edited', ?2, ?3, ?4)",
        params![
            page_id,
            edit_summary(res.added as u64, res.changed as u64, res.removed as u64),
            json!({ "edit": true, "added": res.added, "changed": res.changed, "removed": res.removed, "until": t }).to_string(),
            t
        ],
    )?;
    Ok(())
}

fn edit_summary(add: u64, chg: u64, rem: u64) -> String {
    let mut parts = Vec::new();
    if add > 0 {
        parts.push(format!("{add} added"));
    }
    if chg > 0 {
        parts.push(format!("{chg} changed"));
    }
    if rem > 0 {
        parts.push(format!("{rem} removed"));
    }
    if parts.is_empty() {
        "Edited".into()
    } else {
        format!("Edited · {}", parts.join(", "))
    }
}

/// Called before applying a user save: if no version exists within the
/// editing window, capture one so the prior state stays restorable.
pub fn snapshot_before_user_edit(conn: &Connection, page_id: &str) -> Result<()> {
    const WINDOW: i64 = 10 * 60 * 1000;
    let last: Option<i64> =
        conn.query_row("SELECT MAX(created_at) FROM versions WHERE page_id = ?1", [page_id], |r| r.get(0)).optional()?.flatten();
    let last_edit: Option<i64> = conn
        .query_row("SELECT MAX(created_at) FROM history WHERE page_id = ?1 AND kind = 'edited'", [page_id], |r| r.get(0))
        .optional()?
        .flatten();
    let t = now();
    let stale = last.map(|l| t - l > WINDOW).unwrap_or(true);
    let new_session = last_edit.map(|l| t - l > WINDOW).unwrap_or(true);
    if stale && new_session {
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM blocks WHERE page_id = ?1", [page_id], |r| r.get(0))?;
        if count > 0 {
            snapshot(conn, page_id, "user", None, None)?;
        }
    }
    Ok(())
}

fn ensure_op_snapshot(conn: &Connection, ctx: &Ctx, page_id: &str) -> Result<()> {
    let Some(op) = &ctx.op_id else {
        snapshot(conn, page_id, &ctx.actor, None, Some("Before automated change"))?;
        return Ok(());
    };
    let exists: bool = conn
        .query_row("SELECT 1 FROM versions WHERE page_id = ?1 AND op_id = ?2", params![page_id, op], |_| Ok(true))
        .optional()?
        .unwrap_or(false);
    if !exists {
        let label = if ctx.actor == "ai" { "Before Claude’s changes" } else { "Before automation" };
        snapshot(conn, page_id, &ctx.actor, Some(op), Some(label))?;
    }
    Ok(())
}

pub fn snapshot(conn: &Connection, page_id: &str, actor: &str, op_id: Option<&str>, label: Option<&str>) -> Result<String> {
    let page = get_page(conn, page_id)?.ok_or_else(|| anyhow!("page not found"))?;
    let snap = json!({
        "title": page.meta.title,
        "icon": page.meta.icon,
        "cover": page.meta.cover,
        "instructions": page.instructions,
        "metadata": page.metadata,
        "blocks": page.blocks.iter().map(|b| b.content.clone()).collect::<Vec<_>>(),
    });
    let id = new_id();
    conn.execute(
        "INSERT INTO versions (id, page_id, created_at, actor, op_id, label, snapshot) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![id, page_id, now(), actor, op_id, label, snap.to_string()],
    )?;
    Ok(id)
}

pub fn version_snapshot(conn: &Connection, version_id: &str) -> Result<(String, Value)> {
    let (page_id, snap): (String, String) =
        conn.query_row("SELECT page_id, snapshot FROM versions WHERE id = ?1", [version_id], |r| Ok((r.get(0)?, r.get(1)?)))?;
    Ok((page_id, serde_json::from_str(&snap)?))
}

pub fn list_versions(conn: &Connection, page_id: &str) -> Result<Vec<Version>> {
    let mut stmt = conn.prepare(
        "SELECT id, page_id, created_at, actor, op_id, label, json_array_length(snapshot, '$.blocks')
         FROM versions WHERE page_id = ?1 ORDER BY created_at DESC LIMIT 200",
    )?;
    let rows = stmt
        .query_map([page_id], |r| {
            Ok(Version {
                id: r.get(0)?,
                page_id: r.get(1)?,
                created_at: r.get(2)?,
                actor: r.get(3)?,
                op_id: r.get(4)?,
                label: r.get(5)?,
                block_count: r.get::<_, Option<i64>>(6)?.unwrap_or(0),
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    Ok(rows)
}

pub fn restore_version(conn: &Connection, ctx: &Ctx, version_id: &str) -> Result<PageMeta> {
    let (page_id, snap) = version_snapshot(conn, version_id)?;
    snapshot(conn, &page_id, &ctx.actor, None, Some("Before restore"))?;
    let blocks: Vec<Value> = snap["blocks"].as_array().cloned().unwrap_or_default();
    let quiet = Ctx { actor: ctx.actor.clone(), op_id: None, origin: ctx.origin.clone() };
    write_blocks(conn, &quiet, &page_id, blocks, false)?;
    let t = now();
    conn.execute(
        "UPDATE pages SET title = ?1, icon = ?2, instructions = ?3, updated_at = ?4 WHERE id = ?5",
        params![snap["title"].as_str().unwrap_or(""), snap["icon"].as_str(), snap["instructions"].to_string(), t, page_id],
    )?;
    // Cover and metadata (properties, look) are part of the page too. Older
    // snapshots may lack them; leave the current values in that case.
    if let Some(cover) = snap.get("cover") {
        conn.execute("UPDATE pages SET cover = ?1 WHERE id = ?2", params![cover.as_str(), page_id])?;
    }
    if let Some(meta) = snap.get("metadata").filter(|m| m.is_object()) {
        conn.execute("UPDATE pages SET metadata = ?1 WHERE id = ?2", params![meta.to_string(), page_id])?;
    }
    record(
        conn,
        ctx,
        Some(&page_id),
        "restored_version",
        "Restored an earlier version",
        None,
        None,
        None,
        json!({ "version": version_id }),
    )?;
    index_page(conn, &page_id)?;
    mark_change(conn, Some(&page_id), "blocks", &ctx.origin)?;
    require_page(conn, &page_id)
}

/// Undo every page change made by one AI / automation operation.
pub fn undo_op(conn: &Connection, ctx: &Ctx, op_id: &str) -> Result<Vec<String>> {
    let mut stmt = conn.prepare("SELECT id, page_id FROM versions WHERE op_id = ?1")?;
    let rows: Vec<(String, String)> = stmt.query_map([op_id], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<rusqlite::Result<_>>()?;
    let mut pages = Vec::new();
    for (vid, pid) in rows {
        restore_version(conn, ctx, &vid)?;
        pages.push(pid);
    }
    conn.execute("UPDATE history SET meta = json_set(meta, '$.undone', 1) WHERE op_id = ?1", [op_id])?;
    Ok(pages)
}

/// Insert blocks (AI / tools). `after` = block id to insert after; None = end.
pub fn insert_blocks(conn: &Connection, ctx: &Ctx, page_id: &str, after: Option<&str>, nodes: Vec<Value>) -> Result<Vec<String>> {
    let current = blocks_of(conn, page_id)?;
    let mut list: Vec<Value> = current.iter().map(|b| b.content.clone()).collect();
    let pos = match after {
        Some(a) => current.iter().position(|b| b.id == a).map(|p| p + 1).ok_or_else(|| anyhow!("block not found: {a}"))?,
        None => list.len(),
    };
    let mut ids = Vec::new();
    for (k, mut n) in nodes.into_iter().enumerate() {
        let id = new_id();
        content::set_block_id(&mut n, &id);
        ids.push(id);
        list.insert(pos + k, n);
    }
    write_blocks(conn, ctx, page_id, list, true)?;
    index_page(conn, page_id)?;
    mark_change(conn, Some(page_id), "blocks", &ctx.origin)?;
    Ok(ids)
}

/// Replace a page's whole content (snapshotted first for non-user actors, so it stays undoable).
pub fn replace_blocks(conn: &Connection, ctx: &Ctx, page_id: &str, nodes: Vec<Value>) -> Result<SaveResult> {
    require_page(conn, page_id)?;
    let r = write_blocks(conn, ctx, page_id, nodes, true)?;
    index_page(conn, page_id)?;
    mark_change(conn, Some(page_id), "blocks", &ctx.origin)?;
    Ok(r)
}

pub fn update_block(conn: &Connection, ctx: &Ctx, block_id: &str, mut node: Value) -> Result<()> {
    let b = block_by_id(conn, block_id)?.ok_or_else(|| anyhow!("block not found: {block_id}"))?;
    content::set_block_id(&mut node, block_id);
    let list: Vec<Value> =
        blocks_of(conn, &b.page_id)?.into_iter().map(|x| if x.id == block_id { node.clone() } else { x.content }).collect();
    write_blocks(conn, ctx, &b.page_id, list, true)?;
    index_page(conn, &b.page_id)?;
    mark_change(conn, Some(&b.page_id), "blocks", &ctx.origin)?;
    Ok(())
}

pub fn delete_block(conn: &Connection, ctx: &Ctx, block_id: &str) -> Result<()> {
    let b = block_by_id(conn, block_id)?.ok_or_else(|| anyhow!("block not found: {block_id}"))?;
    let list: Vec<Value> = blocks_of(conn, &b.page_id)?.into_iter().filter(|x| x.id != block_id).map(|x| x.content).collect();
    write_blocks(conn, ctx, &b.page_id, list, true)?;
    index_page(conn, &b.page_id)?;
    mark_change(conn, Some(&b.page_id), "blocks", &ctx.origin)?;
    Ok(())
}

pub fn move_block(conn: &Connection, ctx: &Ctx, block_id: &str, after: Option<&str>) -> Result<()> {
    let b = block_by_id(conn, block_id)?.ok_or_else(|| anyhow!("block not found: {block_id}"))?;
    let mut list = blocks_of(conn, &b.page_id)?;
    let idx = list.iter().position(|x| x.id == block_id).unwrap();
    let moved = list.remove(idx);
    let pos = match after {
        Some(a) => list.iter().position(|x| x.id == a).map(|p| p + 1).ok_or_else(|| anyhow!("block not found: {a}"))?,
        None => 0,
    };
    list.insert(pos, moved);
    write_blocks(conn, ctx, &b.page_id, list.into_iter().map(|x| x.content).collect(), true)?;
    mark_change(conn, Some(&b.page_id), "blocks", &ctx.origin)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

#[allow(clippy::too_many_arguments)]
pub fn record(
    conn: &Connection,
    ctx: &Ctx,
    page_id: Option<&str>,
    kind: &str,
    summary: &str,
    block_id: Option<&str>,
    before: Option<Value>,
    after: Option<Value>,
    meta: Value,
) -> Result<()> {
    conn.execute(
        "INSERT INTO history (page_id, op_id, actor, kind, summary, block_id, before, after, meta, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            page_id,
            ctx.op_id,
            ctx.actor,
            kind,
            summary,
            block_id,
            before.map(|v| v.to_string()),
            after.map(|v| v.to_string()),
            meta.to_string(),
            now()
        ],
    )?;
    Ok(())
}

pub fn list_history(conn: &Connection, page_id: Option<&str>, op_id: Option<&str>, limit: i64) -> Result<Vec<HistoryEntry>> {
    let mut sql = String::from(
        "SELECT h.id, h.page_id, p.title, h.op_id, h.actor, h.kind, h.summary, h.block_id, h.before, h.after, h.meta, h.created_at
         FROM history h LEFT JOIN pages p ON p.id = h.page_id WHERE 1=1",
    );
    let mut vals: Vec<rusqlite::types::Value> = Vec::new();
    if let Some(p) = page_id {
        vals.push(p.to_string().into());
        sql.push_str(&format!(" AND h.page_id = ?{}", vals.len()));
    }
    if let Some(o) = op_id {
        vals.push(o.to_string().into());
        sql.push_str(&format!(" AND h.op_id = ?{}", vals.len()));
    }
    sql.push_str(&format!(" ORDER BY h.id DESC LIMIT {}", limit.clamp(1, 1000)));
    let mut stmt = conn.prepare(&sql)?;
    let parse = |s: Option<String>| s.and_then(|x| serde_json::from_str(&x).ok());
    let rows = stmt
        .query_map(rusqlite::params_from_iter(vals), |r| {
            Ok(HistoryEntry {
                id: r.get(0)?,
                page_id: r.get(1)?,
                page_title: r.get(2)?,
                op_id: r.get(3)?,
                actor: r.get(4)?,
                kind: r.get(5)?,
                summary: r.get(6)?,
                block_id: r.get(7)?,
                before: parse(r.get(8)?),
                after: parse(r.get(9)?),
                meta: parse(r.get(10)?).unwrap_or(json!({})),
                created_at: r.get(11)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    Ok(rows)
}

// ---------------------------------------------------------------------------
// Search (FTS5 trigram: substring matching that works for Arabic)
// ---------------------------------------------------------------------------

pub fn index_page(conn: &Connection, page_id: &str) -> Result<()> {
    let (title, deleted): (String, Option<i64>) =
        conn.query_row("SELECT title, deleted_at FROM pages WHERE id = ?1", [page_id], |r| Ok((r.get(0)?, r.get(1)?)))?;
    let texts: Vec<(String, String)> = conn
        .prepare("SELECT type, text FROM blocks WHERE page_id = ?1 ORDER BY sort_key")?
        .query_map([page_id], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<rusqlite::Result<_>>()?;
    let att: Vec<String> = conn
        .prepare("SELECT file_name FROM attachments WHERE page_id = ?1")?
        .query_map([page_id], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    let mut body: Vec<&str> = texts.iter().map(|(_, t)| t.as_str()).collect();
    body.extend(att.iter().map(String::as_str));
    let body = body.join("\n");
    let preview: String = texts
        .iter()
        .filter(|(ty, t)| ty != "heading" && !t.is_empty())
        .map(|(_, t)| t.replace('\n', " "))
        .collect::<Vec<_>>()
        .join(" · ")
        .chars()
        .take(220)
        .collect();
    conn.execute("UPDATE pages SET preview = ?1 WHERE id = ?2", params![preview, page_id])?;
    conn.execute("DELETE FROM pages_fts WHERE page_id = ?1", [page_id])?;
    if deleted.is_none() {
        conn.execute("INSERT INTO pages_fts (page_id, title, body) VALUES (?1, ?2, ?3)", params![page_id, title, body])?;
    }
    Ok(())
}

pub fn search(conn: &Connection, query: &str, limit: i64, include_templates: bool) -> Result<Vec<SearchHit>> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(Vec::new());
    }
    let kind_filter = if include_templates { "" } else { "AND p.kind = 'page'" };
    let mut hits: Vec<SearchHit> = Vec::new();
    let map = |r: &Row| -> rusqlite::Result<SearchHit> {
        Ok(SearchHit {
            page_id: r.get(0)?,
            title: r.get(1)?,
            icon: r.get(2)?,
            kind: r.get(3)?,
            snippet: r.get(4)?,
            parent_title: r.get(5)?,
            updated_at: r.get(6)?,
        })
    };
    if q.chars().count() >= 3 {
        // Each whitespace-separated term must appear (trigram substring match).
        let fts_q = q
            .split_whitespace()
            .filter(|t| t.chars().count() >= 3)
            .map(|t| format!("\"{}\"", t.replace('"', "\"\"")))
            .collect::<Vec<_>>()
            .join(" AND ");
        if !fts_q.is_empty() {
            let sql = format!(
                "SELECT p.id, p.title, p.icon, p.kind,
                        snippet(pages_fts, 2, '\u{E000}', '\u{E001}', '…', 12),
                        (SELECT title FROM pages pp WHERE pp.id = p.parent_id), p.updated_at
                 FROM pages_fts f JOIN pages p ON p.id = f.page_id
                 WHERE pages_fts MATCH ?1 AND p.deleted_at IS NULL {kind_filter}
                 ORDER BY bm25(pages_fts, 0.0, 8.0, 1.0) LIMIT ?2"
            );
            let mut stmt = conn.prepare(&sql)?;
            hits = stmt.query_map(params![fts_q, limit], map)?.collect::<rusqlite::Result<_>>()?;
        }
    }
    if hits.len() < limit as usize {
        // Short queries / fallback: title substring.
        let like = format!("%{}%", q.replace('%', "\\%").replace('_', "\\_"));
        let sql = format!(
            "SELECT p.id, p.title, p.icon, p.kind, p.preview,
                    (SELECT title FROM pages pp WHERE pp.id = p.parent_id), p.updated_at
             FROM pages p WHERE p.title LIKE ?1 ESCAPE '\\' AND p.deleted_at IS NULL {kind_filter}
             ORDER BY p.updated_at DESC LIMIT ?2"
        );
        let mut stmt = conn.prepare(&sql)?;
        let extra: Vec<SearchHit> = stmt.query_map(params![like, limit], map)?.collect::<rusqlite::Result<_>>()?;
        for h in extra {
            if !hits.iter().any(|x| x.page_id == h.page_id) {
                hits.push(h);
            }
        }
    }
    hits.truncate(limit as usize);
    Ok(hits)
}

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

pub fn kind_for_mime(mime: &str) -> &'static str {
    if mime == "image/gif" {
        "gif"
    } else if mime.starts_with("image/") {
        "image"
    } else if mime.starts_with("video/") {
        "video"
    } else {
        "file"
    }
}

pub fn add_attachment_bytes(conn: &Connection, page_id: Option<&str>, file_name: &str, bytes: &[u8]) -> Result<Attachment> {
    let id = new_id();
    let mime = mime_guess::from_path(file_name).first_or_octet_stream().essence_str().to_string();
    let ext =
        std::path::Path::new(file_name).extension().and_then(|e| e.to_str()).map(|e| format!(".{}", e.to_lowercase())).unwrap_or_default();
    let month = chrono::Local::now().format("%Y-%m").to_string();
    let rel = format!("{month}/{id}{ext}");
    let abs = db::attachments_dir().join(&rel);
    std::fs::create_dir_all(abs.parent().unwrap())?;
    std::fs::write(&abs, bytes)?;
    let (w, h) = match imagesize::blob_size(bytes) {
        Ok(s) if mime.starts_with("image/") => (Some(s.width as i64), Some(s.height as i64)),
        _ => (None, None),
    };
    let kind = kind_for_mime(&mime);
    conn.execute(
        "INSERT INTO attachments (id, page_id, kind, file_name, mime, size, rel_path, width, height, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![id, page_id, kind, file_name, mime, bytes.len() as i64, rel, w, h, now()],
    )?;
    if let Some(p) = page_id {
        index_page(conn, p).ok();
    }
    get_attachment(conn, &id)?.ok_or_else(|| anyhow!("attachment vanished"))
}

pub fn add_attachment_path(conn: &Connection, page_id: Option<&str>, path: &std::path::Path) -> Result<Attachment> {
    let bytes = std::fs::read(path)?;
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("file");
    add_attachment_bytes(conn, page_id, name, &bytes)
}

pub fn get_attachment(conn: &Connection, id: &str) -> Result<Option<Attachment>> {
    Ok(conn.query_row(&format!("SELECT {ATTACHMENT_COLS} FROM attachments WHERE id = ?1"), [id], attachment_row).optional()?)
}

/// Recent images, GIFs and videos across all live pages (and the profile), newest first.
pub fn recent_media(conn: &Connection, limit: i64) -> Result<Vec<Attachment>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {ATTACHMENT_COLS} FROM attachments
         WHERE kind IN ('image', 'gif', 'video')
           AND (page_id IS NULL OR page_id IN (SELECT id FROM pages WHERE deleted_at IS NULL))
         ORDER BY created_at DESC LIMIT ?1"
    ))?;
    let rows = stmt.query_map([limit.clamp(1, 200)], attachment_row)?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn attachment_abs_path(a: &Attachment) -> std::path::PathBuf {
    // Stored paths are always plain relative names inside the attachments
    // folder; anything else (.., absolute, drive prefixes) resolves nowhere.
    let rel = std::path::Path::new(&a.rel_path);
    if rel.components().all(|c| matches!(c, std::path::Component::Normal(_))) {
        db::attachments_dir().join(rel)
    } else {
        db::attachments_dir().join("_invalid_")
    }
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

/// Create a new page from a template (deep: includes template subpages).
pub fn instantiate_template(
    conn: &Connection,
    ctx: &Ctx,
    template_id: &str,
    parent_id: Option<&str>,
    title: Option<&str>,
) -> Result<PageMeta> {
    let t = require_page(conn, template_id)?;
    if t.kind != "template" {
        bail!("not a template");
    }
    let page = duplicate_page(conn, ctx, template_id, true, Some("page"), Some(parent_id))?;
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let final_title = title.map(str::to_string).unwrap_or_else(|| t.title.replace("{{date}}", &today));
    // Fill {{date}} tokens in blocks.
    let blocks = blocks_of(conn, &page.id)?;
    let nodes: Vec<Value> = blocks
        .into_iter()
        .map(|b| {
            let s = b.content.to_string().replace("{{date}}", &today);
            serde_json::from_str(&s).unwrap_or(b.content)
        })
        .collect();
    let quiet = Ctx { actor: ctx.actor.clone(), op_id: ctx.op_id.clone(), origin: ctx.origin.clone() };
    write_blocks(conn, &quiet, &page.id, nodes, false)?;
    conn.execute(
        "UPDATE pages SET title = ?1, template_category = NULL, metadata = json_set(metadata, '$.fromTemplate', ?2) WHERE id = ?3",
        params![final_title, template_id, page.id],
    )?;
    index_page(conn, &page.id)?;
    mark_change(conn, Some(&page.id), "tree", &ctx.origin)?;
    require_page(conn, &page.id)
}

pub fn save_as_template(conn: &Connection, ctx: &Ctx, page_id: &str) -> Result<PageMeta> {
    let t = duplicate_page(conn, ctx, page_id, true, Some("template"), Some(None))?;
    conn.execute("UPDATE pages SET template_category = 'Custom' WHERE id = ?1", [&t.id])?;
    require_page(conn, &t.id)
}

pub fn ensure_builtin_templates(conn: &Connection) -> Result<()> {
    let seeded: Option<String> = conn.query_row("SELECT value FROM meta WHERE key = 'templates_v1'", [], |r| r.get(0)).optional()?;
    if seeded.is_some() {
        return Ok(());
    }
    let ctx = Ctx { actor: "system".into(), op_id: None, origin: "ui".into() };
    for t in crate::templates::BUILTIN {
        create_page(
            conn,
            &ctx,
            NewPage {
                title: Some(t.title.to_string()),
                icon: Some(t.icon.to_string()),
                kind: Some("template".into()),
                template_category: Some(t.category.to_string()),
                markdown: Some(t.markdown.to_string()),
                metadata: Some(json!({ "builtin": t.key, "description": t.description })),
                ..Default::default()
            },
        )?;
    }
    conn.execute("INSERT INTO meta (key, value) VALUES ('templates_v1', '1')", [])?;
    // seeding is not user activity
    conn.execute("DELETE FROM history WHERE actor = 'system'", [])?;
    Ok(())
}
