//! Experimental read-only MCP subset for one explicitly selected personal page.
//! This is not the production MCP server and grants no access to shared pages.
use anyhow::{bail, Result};
use rusqlite::{Connection, OptionalExtension};
use serde_json::{json, Value};

pub fn tools() -> Vec<Value> {
    vec![json!({"name":"blocks_read", "description":"Read blocks of the selected personal page.",
        "inputSchema":{"type":"object","properties":{"pageId":{"type":"string"}},"required":["pageId"],"additionalProperties":false}})]
}

/// The caller must bind the connection to an independently verified private copy.
/// This function never opens a path, creates a credential or grants write access.
pub fn call(connection: &mut Connection, selected_page: &str, name: &str, args: &Value) -> Result<Value> {
    if name != "blocks_read" || selected_page.is_empty() || selected_page.len()>1024 { bail!("tool unavailable") }
    let Some(object)=args.as_object() else { bail!("invalid arguments") };
    if object.len()!=1 || object.get("pageId").and_then(Value::as_str)!=Some(selected_page) { bail!("page unavailable") }
    let tx=connection.transaction_with_behavior(rusqlite::TransactionBehavior::Deferred)?;
    let row: Option<(Option<String>,String,Option<i64>)>=tx.query_row("SELECT workspace_id,metadata,deleted_at FROM pages WHERE id=?1",[selected_page],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional()?;
    let Some((workspace,metadata,deleted))=row else { bail!("page unavailable") };
    if workspace.is_some() || deleted.is_some() { bail!("page unavailable") }
    let clean: i64=tx.query_row("SELECT CASE WHEN json_valid(?1) THEN json_type(?1)='object' AND NOT EXISTS(SELECT 1 FROM json_tree(?1) WHERE typeof(key)='text' GROUP BY parent,key HAVING COUNT(*)>1) ELSE 0 END",[&metadata],|r|r.get(0))?;
    if clean!=1 { bail!("page unavailable") }
    let meta: Value=serde_json::from_str(&metadata)?;
    if let Some(sync)=meta.get("sync") {
        if !sync.is_object() || sync.get("shared").is_some_and(|shared|shared.as_bool()!=Some(false)) { bail!("page unavailable") }
    }
    let result=crate::permissions::guarded_tool_call(&tx,name,args,|c| {
        let mut statement=c.prepare("SELECT id,type,direction,content FROM blocks WHERE page_id=?1 ORDER BY sort_key LIMIT 5001")?;
        let rows=statement.query_map([selected_page],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,Option<String>>(2)?,r.get::<_,String>(3)?)))?;
        let mut blocks=Vec::new(); let mut total=0usize;
        for row in rows {
            let (id,kind,direction,raw)=row?;
            total=total.checked_add(raw.len()).ok_or_else(||anyhow::anyhow!("content too large"))?;
            if blocks.len()>=5000 || total>8*1024*1024 { bail!("content too large") }
            let value: Value=serde_json::from_str(&raw)?;
            blocks.push(json!({"id":id,"type":kind,"direction":direction,"markdown":crate::content::to_markdown(&value)}));
        }
        Ok(Value::Array(blocks))
    })?;
    tx.commit()?;
    Ok(result)
}
