use super::*;

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

pub(crate) fn profile_row(r: &Row) -> rusqlite::Result<Profile> {
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

pub(crate) const PROFILE_COLS: &str = "id, display_name, handle, avatar, banner, bio, status, accent, theme, language, text_direction, created_at, updated_at, location, links, blocks, banner_focus, avatar_crop";

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
