use anyhow::{bail,Result};
use rusqlite::Connection;
use serde_json::json;
use worlds_mcp_authorization::{CurrentAuthority,HostGate,RunBinding,ToolRequest,permissions::Level};

struct Authority { user: &'static str, workspace: Option<&'static str>, level: Level }
impl CurrentAuthority for Authority {
    fn require(&self, binding:&RunBinding, workspace:Option<&str>, needed:Level)->Result<()> {
        if binding.user_id!=self.user || workspace!=self.workspace || self.level<needed { bail!("denied") } Ok(())
    }
}
fn fixture()->(std::path::PathBuf,Connection,RunBinding) {
    let path=std::env::temp_dir().join(format!("worlds-mcp-gate-{}.db",uuid::Uuid::new_v4()));
    std::fs::copy(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../RustStore/tests/fixtures/worlds-v11.db"),&path).unwrap();
    let c=Connection::open(&path).unwrap();
    c.execute_batch("INSERT INTO account(id,user_id,email,device_id,server_url,status,signed_in_at) VALUES(1,'u','fixture@example.test','d','https://identity.invalid','active',1); INSERT INTO account_workspaces(id,name,role,default_level,synced_at) VALUES('w','Fixture','member','edit',1); INSERT INTO pages(id,title,kind,metadata,workspace_id,created_at,updated_at) VALUES('shared','Shared','page','{}','w',1,1); INSERT INTO account_page_access(workspace_id,page_id,level) VALUES('w','shared','edit');").unwrap();
    let b=RunBinding { run_id:"run".into(),user_id:"u".into(),copy_id:"copy".into(),server_id:"server".into(),page_id:"shared".into() };
    (path,c,b)
}
fn rename(title:&str)->ToolRequest { ToolRequest { name:"pages_rename".into(),arguments:json!({"pageId":"shared","title":title}) } }
fn update(c:&Connection,title:&str)->Result<serde_json::Value> {
    c.execute("UPDATE pages SET title=?1 WHERE id='shared'",[title])?;
    c.execute("INSERT INTO changes(page_id,kind,origin,at) VALUES('shared','page','mcp',1)",[])?;
    Ok(json!({"id":"shared"}))
}
#[test]
fn write_requires_exact_single_use_approval_and_current_rights() {
    let (path,mut db,binding)=fixture(); let mut gate=HostGate::new(binding.clone()).unwrap();
    let edit=Authority{user:"u",workspace:Some("w"),level:Level::Edit};
    let view=Authority{user:"u",workspace:Some("w"),level:Level::View};
    let request=rename("new");
    assert!(gate.execute(&mut db,&binding,&request,None,&edit,|c|update(c,"new")).is_err());
    let approval=gate.approve_write(&binding,&request).unwrap();
    assert!(gate.execute(&mut db,&binding,&rename("different"),Some(&approval),&edit,|c|update(c,"different")).is_err());
    assert!(gate.execute(&mut db,&binding,&request,Some(&approval),&edit,|c|update(c,"new")).is_err());
    let approval=gate.approve_write(&binding,&request).unwrap();
    assert!(gate.execute(&mut db,&binding,&request,Some(&approval),&view,|c|update(c,"new")).is_err());
    let approval=gate.approve_write(&binding,&request).unwrap();
    assert!(gate.execute(&mut db,&binding,&request,Some(&approval),&edit,|c|update(c,"new")).is_ok());
    assert!(gate.execute(&mut db,&binding,&request,Some(&approval),&edit,|c|update(c,"again")).is_err());
    let title:String=db.query_row("SELECT title FROM pages WHERE id='shared'",[],|r|r.get(0)).unwrap(); assert_eq!(title,"new");
    drop(db);std::fs::remove_file(path).unwrap();
}
#[test]
fn account_binding_cancellation_and_local_revocation_fail_closed() {
    let (path,mut db,binding)=fixture(); let mut gate=HostGate::new(binding.clone()).unwrap();
    let authority=Authority{user:"u",workspace:Some("w"),level:Level::Edit}; let request=rename("new");
    let mut other=binding.clone();other.copy_id="other".into();
    assert!(gate.approve_write(&other,&request).is_err());
    let mut other_server=binding.clone();other_server.server_id="other-server".into();
    assert!(gate.approve_write(&other_server,&request).is_err());
    let token=gate.approve_write(&binding,&request).unwrap();
    db.execute("UPDATE account SET user_id='other' WHERE id=1",[]).unwrap();
    assert!(gate.execute(&mut db,&binding,&request,Some(&token),&authority,|c|update(c,"new")).is_err());
    db.execute("UPDATE account SET user_id='u' WHERE id=1",[]).unwrap();
    let token=gate.approve_write(&binding,&request).unwrap();
    db.execute("UPDATE account_page_access SET level='view' WHERE page_id='shared'",[]).unwrap();
    assert!(gate.execute(&mut db,&binding,&request,Some(&token),&authority,|c|update(c,"new")).is_err());
    let pending=gate.approve_write(&binding,&request).unwrap();
    gate.cancel(); assert!(gate.approve_write(&binding,&request).is_err());
    assert!(gate.execute(&mut db,&binding,&request,Some(&pending),&authority,|c|update(c,"new")).is_err());
    let title:String=db.query_row("SELECT title FROM pages WHERE id='shared'",[],|r|r.get(0)).unwrap(); assert_eq!(title,"Shared");
    drop(db);std::fs::remove_file(path).unwrap();
}
#[test]
fn personal_page_needs_attested_copy_and_rejects_ambiguous_metadata() {
    let (path,mut db,mut binding)=fixture(); binding.page_id="fixture-page".into();
    let mut gate=HostGate::new(binding.clone()).unwrap();
    let request=ToolRequest { name:"blocks_read".into(),arguments:json!({"pageId":"fixture-page"}) };
    let allowed=Authority{user:"u",workspace:None,level:Level::View};
    let wrong=Authority{user:"other",workspace:None,level:Level::Full};
    assert!(gate.execute(&mut db,&binding,&request,None,&wrong,|_|Ok(json!({"ok":true}))).is_err());
    assert!(gate.execute(&mut db,&binding,&request,None,&allowed,|_|Ok(json!({"ok":true}))).is_ok());
    db.execute("UPDATE pages SET metadata='{\"future\":{\"x\":1,\"x\":2}}' WHERE id='fixture-page'",[]).unwrap();
    assert!(gate.execute(&mut db,&binding,&request,None,&allowed,|_|Ok(json!({"ok":true}))).is_err());
    drop(db);std::fs::remove_file(path).unwrap();
}
#[test]
fn unexpected_touched_page_rolls_back_original_guarded_operation() {
    let (path,mut db,binding)=fixture(); let mut gate=HostGate::new(binding.clone()).unwrap();
    let authority=Authority{user:"u",workspace:Some("w"),level:Level::Edit};
    db.execute("INSERT INTO pages(id,title,kind,metadata,workspace_id,created_at,updated_at) VALUES('hidden','Hidden','page','{}','w',1,1)",[]).unwrap();
    db.execute("INSERT INTO account_page_access(workspace_id,page_id,level) VALUES('w','hidden','view')",[]).unwrap();
    let request=rename("new"); let approval=gate.approve_write(&binding,&request).unwrap();
    let result=gate.execute(&mut db,&binding,&request,Some(&approval),&authority,|c| {
        c.execute("UPDATE pages SET title='changed' WHERE id='hidden'",[])?;
        c.execute("INSERT INTO changes(page_id,kind,origin,at) VALUES('hidden','page','mcp',1)",[])?;
        Ok(json!({"id":"shared"}))
    });
    assert!(result.is_err());
    let title:String=db.query_row("SELECT title FROM pages WHERE id='hidden'",[],|r|r.get(0)).unwrap(); assert_eq!(title,"Hidden");
    drop(db);std::fs::remove_file(path).unwrap();
}
#[test]
fn cancellation_during_write_rolls_back_and_invalidates_run() {
    let (path,mut db,binding)=fixture(); let mut gate=HostGate::new(binding.clone()).unwrap();
    let authority=Authority{user:"u",workspace:Some("w"),level:Level::Edit}; let request=rename("new");
    let approval=gate.approve_write(&binding,&request).unwrap(); let cancellation=gate.cancellation();
    let result=gate.execute(&mut db,&binding,&request,Some(&approval),&authority,|c| {
        let result=update(c,"new")?; cancellation.cancel(); Ok(result)
    });
    assert!(result.is_err());
    let title:String=db.query_row("SELECT title FROM pages WHERE id='shared'",[],|r|r.get(0)).unwrap(); assert_eq!(title,"Shared");
    assert!(gate.approve_write(&binding,&request).is_err());
    drop(db);std::fs::remove_file(path).unwrap();
}
