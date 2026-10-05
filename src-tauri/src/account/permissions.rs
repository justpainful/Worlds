//! The single local permission check.
//!
//! Personal pages (`workspace_id IS NULL`) are unrestricted. Pages in a Team
//! workspace resolve against the rights cached from the identity service:
//! the page's own cached level, else the nearest cached ancestor in the same
//! workspace (a page created here and not mirrored yet), else the role default
//! (Owner/Admin full, Member the workspace default, Guest nothing). Signed out,
//! or no longer a member: nothing.

use anyhow::{anyhow, bail, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;
use std::collections::{HashMap, HashSet};

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Level {
    None,
    View,
    Comment,
    Edit,
    Full,
}

impl Level {
    pub fn parse(s: &str) -> Level {
        match s {
            "full" => Level::Full,
            "edit" => Level::Edit,
            "comment" => Level::Comment,
            "view" => Level::View,
            _ => Level::None,
        }
    }
    pub fn as_str(self) -> &'static str {
        match self {
            Level::Full => "full",
            Level::Edit => "edit",
            Level::Comment => "comment",
            Level::View => "view",
            Level::None => "none",
        }
    }
    fn phrase(self) -> &'static str {
        match self {
            Level::Full | Level::Edit => "edit",
            Level::Comment => "comment on",
            Level::View => "view",
            Level::None => "not open",
        }
    }
}

/// The signed-in user's level on a page. Unknown pages and Personal pages are `Full`.
pub fn page_level(conn: &Connection, page_id: &str) -> Result<Level> {
    let row: Option<Option<String>> = conn.query_row("SELECT workspace_id FROM pages WHERE id = ?1", [page_id], |r| r.get(0)).optional()?;
    let Some(Some(ws)) = row else { return Ok(Level::Full) };
    workspace_page_level(conn, &ws, page_id)
}

fn workspace_page_level(conn: &Connection, ws: &str, page_id: &str) -> Result<Level> {
    let signed_in: bool = conn.query_row("SELECT EXISTS (SELECT 1 FROM account WHERE id = 1 AND status = 'active')", [], |r| r.get(0))?;
    if !signed_in {
        return Ok(Level::None);
    }
    let member: Option<(String, String)> = conn
        .query_row("SELECT role, default_level FROM account_workspaces WHERE id = ?1", [ws], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional()?;
    let Some((role, default_level)) = member else { return Ok(Level::None) };
    if role == "owner" || role == "admin" {
        return Ok(Level::Full);
    }
    let mut cur = Some(page_id.to_string());
    let mut seen = HashSet::new();
    while let Some(id) = cur {
        if !seen.insert(id.clone()) || seen.len() > 128 {
            break;
        }
        let cached: Option<String> = conn
            .query_row("SELECT level FROM account_page_access WHERE workspace_id = ?1 AND page_id = ?2", params![ws, id], |r| r.get(0))
            .optional()?;
        if let Some(l) = cached {
            return Ok(Level::parse(&l));
        }
        cur = conn
            .query_row("SELECT parent_id FROM pages WHERE id = ?1 AND workspace_id = ?2", params![id, ws], |r| {
                r.get::<_, Option<String>>(0)
            })
            .optional()?
            .flatten();
    }
    Ok(if role == "member" { Level::parse(&default_level) } else { Level::None })
}

/// Fail with a message Claude can relay when the user lacks `need` on the page.
pub fn require(conn: &Connection, page_id: &str, need: Level) -> Result<()> {
    let have = page_level(conn, page_id)?;
    if have >= need {
        return Ok(());
    }
    let (title, ws): (String, Option<String>) = conn
        .query_row(
            "SELECT p.title, w.name FROM pages p LEFT JOIN account_workspaces w ON w.id = p.workspace_id WHERE p.id = ?1",
            [page_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap_or_default();
    let place = ws.map(|w| format!(" in the {w} workspace")).unwrap_or_else(|| " in a Team workspace".into());
    if have == Level::None {
        bail!("Permission denied: the user has no access to this page{place}. Claude acts with the user's rights, so it cannot open it.");
    }
    let title = if title.is_empty() { "Untitled".to_string() } else { title };
    bail!(
        "Permission denied: the user can only {} “{title}”{place}. Claude acts with the user's rights, so it cannot change it. Ask someone with full access to share it with edit rights.",
        have.phrase()
    )
}

// ---------------------------------------------------------------------------
// Claude (MCP tools and in-app runs)
// ---------------------------------------------------------------------------

/// Tools that only read. Everything else is treated as a write.
const READ_TOOLS: &[&str] = &[
    "pages_search",
    "pages_list",
    "pages_read",
    "blocks_read",
    "references_search",
    "references_resolve",
    "attachments_read_metadata",
    "templates_list",
    "automations_list",
    "discord_inspect",
    "discord_preview",
    "discord_send",
    "discord_edit",
    "profile_read",
    "history_read",
    "instructions_read",
    "trash_list",
    "chats_search",
    "chats_read",
    "workspace_overview",
    "time_now",
    "pages_query",
    "pages_tree",
    "pages_export_markdown",
    "pages_outline",
    "pages_find_text",
    "pages_backlinks",
    "pages_stats",
    "pages_links",
    "pages_recent",
    "pages_stale",
    "archive_list",
    "properties_schema",
    "collections_list",
    "versions_diff",
    "versions_list",
    "templates_read",
    "automations_read",
    "automations_upcoming",
    "automations_runs",
    "chats_list",
    "attachments_list",
    "attachments_find",
    "profile_blocks_list",
    "search_everything",
    "activity_summary",
    "discord_pending",
    "discord_sent",
    "settings_read",
    "tasks_list",
    "tables_read",
    "tables_to_csv",
    "blocks_list_by_type",
    "resources_list",
    "presentations_read",
];

/// Destructive page operations need full access in a Team workspace.
const FULL_TOOLS: &[&str] = &["pages_delete"];

/// Tools that may create a top-level page in the active workspace.
const CREATES_TOP_LEVEL: &[&str] = &["pages_create", "pages_create_many", "templates_instantiate", "pages_split_by_headings"];

fn push_str(out: &mut Vec<String>, v: Option<&Value>) {
    match v {
        Some(Value::String(s)) if !s.is_empty() => out.push(s.clone()),
        Some(Value::Array(items)) => {
            for i in items {
                if let Value::String(s) = i {
                    out.push(s.clone());
                }
            }
        }
        _ => {}
    }
}

/// Every page a tool call names, directly or through a block, version or op id.
fn pages_named(conn: &Connection, a: &Value) -> Result<Vec<String>> {
    let mut pages = Vec::new();
    for k in ["pageId", "parentId", "targetPageId", "templateId", "pageIds", "sourcePageIds", "orderedIds"] {
        push_str(&mut pages, a.get(k));
    }
    if let Some(items) = a.get("items").and_then(Value::as_array) {
        for i in items {
            push_str(&mut pages, i.get("parentId"));
        }
    }
    // Generic ids name a page only when such a page exists (automations and chats use "id" too).
    let mut maybe = Vec::new();
    for k in ["id", "resourceId"] {
        push_str(&mut maybe, a.get(k));
    }
    for id in maybe {
        if conn.query_row("SELECT 1 FROM pages WHERE id = ?1", [&id], |_| Ok(())).optional()?.is_some() {
            pages.push(id);
        }
    }
    let mut blocks = Vec::new();
    for k in ["blockId", "afterBlockId", "blockIds", "slideId"] {
        push_str(&mut blocks, a.get(k));
    }
    for b in blocks.iter().filter(|b| b.as_str() != "start") {
        if let Some(p) = conn.query_row("SELECT page_id FROM blocks WHERE id = ?1", [b], |r| r.get::<_, String>(0)).optional()? {
            pages.push(p);
        }
    }
    if let Some(v) = a.get("versionId").and_then(Value::as_str) {
        if let Some(p) = conn.query_row("SELECT page_id FROM versions WHERE id = ?1", [v], |r| r.get::<_, String>(0)).optional()? {
            pages.push(p);
        }
    }
    if let Some(op) = a.get("opId").and_then(Value::as_str) {
        let mut stmt = conn.prepare("SELECT DISTINCT page_id FROM history WHERE op_id = ?1 AND page_id IS NOT NULL")?;
        let rows = stmt.query_map([op], |r| r.get::<_, String>(0))?;
        for r in rows {
            pages.push(r?);
        }
    }
    pages.sort();
    pages.dedup();
    Ok(pages)
}

fn active_team_role(conn: &Connection) -> Result<Option<String>> {
    let active = crate::db::get_setting(conn, "account.activeWorkspace")?;
    let Some(id) = active.as_ref().and_then(Value::as_str) else { return Ok(None) };
    Ok(conn.query_row("SELECT role FROM account_workspaces WHERE id = ?1", [id], |r| r.get(0)).optional()?)
}

fn last_change(conn: &Connection) -> Result<i64> {
    Ok(conn.query_row("SELECT COALESCE(MAX(seq), 0) FROM changes", [], |r| r.get(0))?)
}

/// Run one Claude tool call inside the signed-in user's rights:
/// 1. every page the call names needs view (reads), edit (writes) or full;
/// 2. after a write, every page it actually touched must be editable, else
///    the error rolls the caller's transaction back;
/// 3. results never mention pages the user cannot view.
pub fn guarded_tool_call(conn: &Connection, tool: &str, args: &Value, run: impl FnOnce(&Connection) -> Result<Value>) -> Result<Value> {
    let read = READ_TOOLS.contains(&tool);
    let need = if read {
        Level::View
    } else if FULL_TOOLS.contains(&tool) {
        Level::Full
    } else {
        Level::Edit
    };
    let named = pages_named(conn, args)?;
    for p in &named {
        require(conn, p, need)?;
    }
    if !read && CREATES_TOP_LEVEL.contains(&tool) && args.get("parentId").and_then(Value::as_str).is_none() {
        if let Some(role) = active_team_role(conn)? {
            if role == "guest" {
                bail!("Permission denied: guests cannot add top-level pages to this workspace. Pick a page shared with the user as the parent.");
            }
        }
    }
    if tool == "pages_move" {
        let from: Option<Option<String>> = conn
            .query_row("SELECT workspace_id FROM pages WHERE id = ?1", [args.get("pageId").and_then(Value::as_str).unwrap_or("")], |r| {
                r.get(0)
            })
            .optional()?;
        let to: Option<Option<String>> = match args.get("parentId").and_then(Value::as_str) {
            Some(p) => conn.query_row("SELECT workspace_id FROM pages WHERE id = ?1", [p], |r| r.get(0)).optional()?,
            None => from.clone(),
        };
        if let (Some(f), Some(t)) = (from, to) {
            if f != t {
                bail!("Pages move between workspaces from the Share sheet in Worlds, not with pages_move.");
            }
        }
    }
    let start = last_change(conn)?;
    let out = run(conn)?;
    if !read {
        let mut stmt = conn.prepare("SELECT DISTINCT page_id FROM changes WHERE seq > ?1 AND page_id IS NOT NULL")?;
        let touched: Vec<String> = stmt.query_map([start], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
        for p in touched {
            require(conn, &p, Level::Edit).map_err(|e| anyhow!("{e:#} (nothing was changed)"))?;
        }
    }
    filter_result(conn, out)
}

/// Remove every object in a list that names a page the user cannot view.
pub fn filter_result(conn: &Connection, v: Value) -> Result<Value> {
    let mut cache: HashMap<String, bool> = HashMap::new();
    let mut visible = |id: &str| -> Result<bool> {
        if let Some(v) = cache.get(id) {
            return Ok(*v);
        }
        let ok = page_level(conn, id)? > Level::None;
        cache.insert(id.to_string(), ok);
        Ok(ok)
    };
    fn walk(v: Value, visible: &mut dyn FnMut(&str) -> Result<bool>) -> Result<Value> {
        Ok(match v {
            Value::Array(items) => {
                let mut out = Vec::with_capacity(items.len());
                for item in items {
                    let hidden = match &item {
                        Value::Object(o) => {
                            let mut h = false;
                            for k in ["pageId", "id", "templateId"] {
                                if let Some(Value::String(id)) = o.get(k) {
                                    if !visible(id)? {
                                        h = true;
                                    }
                                }
                            }
                            h
                        }
                        _ => false,
                    };
                    if !hidden {
                        out.push(walk(item, visible)?);
                    }
                }
                Value::Array(out)
            }
            Value::Object(o) => {
                let mut out = serde_json::Map::with_capacity(o.len());
                for (k, x) in o {
                    out.insert(k, walk(x, visible)?);
                }
                Value::Object(out)
            }
            other => other,
        })
    }
    walk(v, &mut visible)
}
