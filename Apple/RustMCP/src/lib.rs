//! Test harness for the original MCP protocol and account permission gate.
//! No server binary, user data access, or tool implementation is exposed.
#[path = "../../../src-tauri/src/mcp/protocol.rs"]
pub mod protocol;
#[path = "../../../src-tauri/src/account/permissions.rs"]
pub mod permissions;
#[path = "../../../src-tauri/src/content.rs"]
mod content;
pub mod scoped_read;

// The only database helper used by the original permissions module. This has
// the same SQL and decoding as src-tauri/src/db.rs::get_setting.
mod db {
    use anyhow::Result;
    use rusqlite::{Connection, OptionalExtension};
    pub fn get_setting(conn: &Connection, key: &str) -> Result<Option<serde_json::Value>> {
        let raw: Option<String> = conn.query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| r.get(0)).optional()?;
        Ok(raw.and_then(|s| serde_json::from_str(&s).ok()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use anyhow::{bail, Result};
    use rusqlite::{params, Connection};
    use serde_json::{json, Value};
    use std::cell::Cell;
    use std::path::PathBuf;

    fn dispatch(line: &str, call: impl FnOnce(&str, &Value) -> Result<Value>) -> Option<Value> {
        protocol::dispatch(line, "0.1.0", || vec![json!({"name":"fixture"})], call).unwrap()
    }
    fn fixture() -> (PathBuf, Connection) {
        let path = std::env::temp_dir().join(format!("worlds-mcp-test-{}.db", uuid::Uuid::new_v4()));
        std::fs::copy(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../RustStore/tests/fixtures/worlds-v11.db"), &path).unwrap();
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch("INSERT INTO account(id,user_id,email,device_id,server_url,status,signed_in_at) VALUES(1,'u','a@example.invalid','d','https://invalid.example','active',1); INSERT INTO account_workspaces(id,name,role,default_level,synced_at) VALUES('ws','Team','guest','view',1); INSERT INTO pages(id,title,kind,metadata,workspace_id,created_at,updated_at) VALUES('shared','Shared','page','{}','ws',1,1),('hidden','Hidden','page','{}','ws',1,1); INSERT INTO account_page_access(workspace_id,page_id,level) VALUES('ws','shared','view');").unwrap();
        (path, conn)
    }
    #[test]
    fn preserves_initialize_ping_and_unknown_method() {
        let init=dispatch(r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}"#,|_,_|unreachable!()).unwrap();
        assert_eq!(init["result"]["protocolVersion"],"2025-06-18");
        assert_eq!(init["result"]["serverInfo"]["name"],"worlds");
        assert_eq!(dispatch(r#"{"id":2,"method":"ping"}"#,|_,_|unreachable!()).unwrap()["result"],json!({}));
        assert_eq!(dispatch(r#"{"id":3,"method":"unknown"}"#,|_,_|unreachable!()).unwrap()["error"]["code"],-32601);
    }
    #[test]
    fn preserves_notifications_tool_results_and_errors() {
        assert!(dispatch("not json",|_,_|unreachable!()).is_none());
        assert!(dispatch(r#"{"method":"tools/call"}"#,|_,_|unreachable!()).is_none());
        let list=dispatch(r#"{"id":1,"method":"tools/list"}"#,|_,_|unreachable!()).unwrap();
        assert_eq!(list["result"]["tools"][0]["name"],"fixture");
        let call=r#"{"id":9,"method":"tools/call","params":{"name":"read","arguments":{"id":"x"}}}"#;
        let ok=dispatch(call,|name,args| { assert_eq!(name,"read"); assert_eq!(args["id"],"x"); Ok(json!({"data":1})) }).unwrap();
        assert_eq!(ok["result"]["content"][0]["text"],"{\n  \"data\": 1\n}");
        let denied=dispatch(call,|_,_|bail!("Permission denied" )).unwrap();
        assert_eq!(denied["result"]["isError"],true);
        assert_eq!(denied["result"]["content"][0]["text"],"Error: Permission denied");
    }
    #[test]
    fn actual_permission_gate_denies_hidden_and_write_before_dispatch() {
        let (path,conn)=fixture();
        let called=Cell::new(false);
        let hidden=permissions::guarded_tool_call(&conn,"pages_read",&json!({"pageId":"hidden"}), |_| { called.set(true); Ok(json!({})) });
        assert!(hidden.is_err()); assert!(!called.get());
        let read=permissions::guarded_tool_call(&conn,"pages_read",&json!({"pageId":"shared"}), |_| Ok(json!({"id":"shared"})));
        assert!(read.is_ok());
        let write=permissions::guarded_tool_call(&conn,"pages_rename",&json!({"pageId":"shared"}), |_| { called.set(true); Ok(json!({})) });
        assert!(write.is_err()); assert!(!called.get());
        drop(conn); std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn actual_permission_gate_rejects_unexpected_touched_page_and_rolls_back() {
        let (path,conn)=fixture();
        {
            let tx=conn.unchecked_transaction().unwrap();
            let result=permissions::guarded_tool_call(&tx,"pages_rename",&json!({"pageId":"fixture-page"}), |c| {
                c.execute("UPDATE pages SET title='unauthorized' WHERE id='shared'", [])?;
                c.execute("INSERT INTO changes(page_id,kind,origin,at) VALUES(?1,'page','mcp',1)", params!["shared"])?;
                Ok(json!({"id":"shared"}))
            });
            assert!(result.is_err());
            // Drop transaction without commit, as run_stdio does on an error.
        }
        let title:String=conn.query_row("SELECT title FROM pages WHERE id='shared'",[],|r|r.get(0)).unwrap();
        assert_eq!(title,"Shared");
        drop(conn); std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn actual_result_filter_removes_hidden_page() {
        let (path,conn)=fixture();
        let result=permissions::guarded_tool_call(&conn,"pages_list",&json!({}), |_| Ok(json!([{"id":"shared"},{"id":"hidden"}]))).unwrap();
        assert_eq!(result,json!([{"id":"shared"}]));
        drop(conn); std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn scoped_original_blocks_read_denies_other_or_shared_pages() {
        let (path,mut conn)=fixture();
        conn.execute("INSERT INTO blocks(id,page_id,type,sort_key,content,properties,direction,created_at,updated_at) VALUES('block','fixture-page','paragraph','a',?1,'{}','ltr',1,1)",
            [json!({"type":"paragraph","content":[{"type":"text","text":"Fixture content"}]}).to_string()]).unwrap();
        let result=scoped_read::call(&mut conn,"fixture-page","blocks_read",&json!({"pageId":"fixture-page"})).unwrap();
        let found=result.as_array().unwrap().iter().find(|item|item["id"]=="block").unwrap();
        assert_eq!(found["markdown"],"Fixture content");
        assert!(scoped_read::call(&mut conn,"fixture-page","blocks_read",&json!({"pageId":"shared"})).is_err());
        assert!(scoped_read::call(&mut conn,"shared","blocks_read",&json!({"pageId":"shared"})).is_err());
        assert!(scoped_read::call(&mut conn,"fixture-page","blocks_delete",&json!({"pageId":"fixture-page"})).is_err());
        conn.execute("UPDATE pages SET metadata='{\"sync\":{\"shared\":false,\"shared\":true}}' WHERE id='fixture-page'",[]).unwrap();
        assert!(scoped_read::call(&mut conn,"fixture-page","blocks_read",&json!({"pageId":"fixture-page"})).is_err());
        drop(conn);std::fs::remove_file(path).unwrap();
    }
}
