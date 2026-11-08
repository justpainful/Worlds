//! Experimental host-side gate. Not an identity provider or a production server.
use anyhow::{bail, Result};
use rusqlite::{Connection, OptionalExtension, TransactionBehavior};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::{Arc,atomic::{AtomicU8,Ordering}};

#[path = "../../../src-tauri/src/account/permissions.rs"]
pub mod permissions;
mod db {
    use anyhow::Result;
    use rusqlite::{Connection, OptionalExtension};
    pub fn get_setting(c: &Connection, key: &str) -> Result<Option<serde_json::Value>> {
        let raw: Option<String> = c.query_row("SELECT value FROM settings WHERE key=?1",[key],|r|r.get(0)).optional()?;
        Ok(raw.and_then(|s|serde_json::from_str(&s).ok()))
    }
}

/// These values are identifiers supplied by the trusted host, not proof of
/// executable or file identity. The transport must independently verify them.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RunBinding {
    pub run_id: String,
    pub user_id: String,
    pub copy_id: String,
    pub server_id: String,
    pub page_id: String,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ToolRequest { pub name: String, pub arguments: Value }
#[derive(Clone, Debug)]
struct Approval { binding: RunBinding, request: ToolRequest }

/// Host must implement this with a current authenticated service response for
/// shared pages and with verified local-copy ownership for personal pages.
/// A cached level by itself is not an implementation of this contract.
pub trait CurrentAuthority {
    fn require(&self, binding: &RunBinding, workspace: Option<&str>, needed: permissions::Level) -> Result<()>;
}

/// A cancel can race a commit. Once commit wins, the actual commit outcome is
/// returned and the cancellation takes effect for subsequent calls.
#[derive(Clone)]
pub struct RunCancellation(Arc<AtomicU8>);
impl RunCancellation {
    pub fn cancel(&self) {
        loop {
            let current=self.0.load(Ordering::Acquire);
            let next=match current { 0=>1, 2=>3, _=>return };
            if self.0.compare_exchange(current,next,Ordering::AcqRel,Ordering::Acquire).is_ok() { return }
        }
    }
    fn check(&self)->Result<()> { if self.0.load(Ordering::Acquire)!=0 { bail!("session unavailable") } Ok(()) }
    fn begin_commit(&self)->Result<()> { self.0.compare_exchange(0,2,Ordering::AcqRel,Ordering::Acquire).map(|_|()).map_err(|_|anyhow::anyhow!("session unavailable")) }
    fn end_commit(&self) {
        if self.0.compare_exchange(2,0,Ordering::AcqRel,Ordering::Acquire).is_err() { self.0.store(1,Ordering::Release); }
    }
}

pub struct HostGate { binding: RunBinding, cancellation: RunCancellation, pending: HashMap<String,Approval> }
impl HostGate {
    pub fn new(binding: RunBinding) -> Result<Self> {
        for value in [&binding.run_id,&binding.user_id,&binding.copy_id,&binding.server_id,&binding.page_id] {
            if value.is_empty() || value.len()>1024 || value.bytes().any(|b|b==0) { bail!("invalid binding") }
        }
        Ok(Self { binding, cancellation:RunCancellation(Arc::new(AtomicU8::new(0))), pending:HashMap::new() })
    }
    pub fn cancellation(&self) -> RunCancellation { self.cancellation.clone() }
    pub fn cancel(&mut self) { self.cancellation.cancel(); self.pending.clear(); }
    /// Invoke only after an explicit human approval of this exact request.
    pub fn approve_write(&mut self, binding: &RunBinding, request: &ToolRequest) -> Result<String> {
        self.validate(binding,request)?;
        if request.name!="pages_rename" { bail!("approval unavailable") }
        if self.pending.len()>=64 { bail!("too many pending approvals") }
        let id=uuid::Uuid::new_v4().to_string();
        self.pending.insert(id.clone(),Approval { binding:binding.clone(),request:request.clone() });
        Ok(id)
    }
    fn validate(&self, binding: &RunBinding, request: &ToolRequest) -> Result<permissions::Level> {
        self.cancellation.check()?;
        if &self.binding!=binding { bail!("session unavailable") }
        let args=request.arguments.as_object().ok_or_else(||anyhow::anyhow!("invalid arguments"))?;
        if args.get("pageId").and_then(Value::as_str)!=Some(binding.page_id.as_str()) { bail!("page unavailable") }
        match request.name.as_str() {
            "blocks_read" if args.len()==1 => Ok(permissions::Level::View),
            "pages_rename" if args.len()==2 && args.get("title").and_then(Value::as_str).is_some_and(|s|!s.is_empty() && s.len()<=4096) => Ok(permissions::Level::Edit),
            _ => bail!("tool unavailable"),
        }
    }
    /// Permission and account checks and the actual operation share a database
    /// transaction. A one-use approval is consumed even if the operation fails.
    /// The external authority and operation must themselves enforce the bound
    /// service, file and process identity; this gate cannot establish them.
    pub fn execute(&mut self, c: &mut Connection, binding: &RunBinding, request: &ToolRequest,
                   approval: Option<&str>, authority: &dyn CurrentAuthority,
                   operation: impl FnOnce(&Connection) -> Result<Value>) -> Result<Value> {
        let needed=self.validate(binding,request)?;
        if needed>=permissions::Level::Edit {
            let token=approval.ok_or_else(||anyhow::anyhow!("approval required"))?;
            let approved=self.pending.remove(token).ok_or_else(||anyhow::anyhow!("approval unavailable"))?;
            if approved.binding!=*binding || approved.request!=*request { bail!("approval mismatch") }
        } else if approval.is_some() { bail!("unexpected approval") }
        let mode=if needed>=permissions::Level::Edit { TransactionBehavior::Immediate } else { TransactionBehavior::Deferred };
        let tx=c.transaction_with_behavior(mode)?;
        let user: Option<String>=tx.query_row("SELECT user_id FROM account WHERE id=1 AND status='active'",[],|r|r.get(0)).optional()?;
        if user.as_deref()!=Some(binding.user_id.as_str()) { bail!("account unavailable") }
        let page: Option<(Option<String>,String,Option<i64>)>=tx.query_row("SELECT workspace_id,metadata,deleted_at FROM pages WHERE id=?1",[&binding.page_id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional()?;
        let Some((workspace,metadata,deleted))=page else { bail!("page unavailable") };
        if deleted.is_some() { bail!("page unavailable") }
        let valid:i64=tx.query_row("SELECT CASE WHEN json_valid(?1) THEN json_type(?1)='object' AND NOT EXISTS(SELECT 1 FROM json_tree(?1) WHERE typeof(key)='text' GROUP BY parent,key HAVING COUNT(*)>1) ELSE 0 END",[&metadata],|r|r.get(0))?;
        if valid!=1 { bail!("page unavailable") }
        let parsed:Value=serde_json::from_str(&metadata)?;
        if workspace.is_none() {
            if let Some(sync)=parsed.get("sync") {
                if !sync.is_object() || sync.get("shared").is_some_and(|s|s.as_bool()!=Some(false)) { bail!("page unavailable") }
            }
        }
        authority.require(binding,workspace.as_deref(),needed)?;
        self.cancellation.check()?;
        let value=permissions::guarded_tool_call(&tx,&request.name,&request.arguments,operation)?;
        self.cancellation.begin_commit()?;
        let committed=tx.commit();
        self.cancellation.end_commit();
        committed?; Ok(value)
    }
}
