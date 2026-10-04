use super::*;

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
