//! Shared JSON-RPC dispatch used by the existing stdio server.
//! Tool execution, permission checks and transactions remain in the caller.
use anyhow::Result;
use serde_json::{json, Value};

pub fn dispatch(
    line: &str,
    server_version: &str,
    tools: impl FnOnce() -> Vec<Value>,
    call: impl FnOnce(&str, &Value) -> Result<Value>,
) -> Result<Option<Value>> {
    if line.trim().is_empty() { return Ok(None) }
    let msg: Value = match serde_json::from_str(line) { Ok(value) => value, Err(_) => return Ok(None) };
    let id = msg.get("id").cloned();
    let method = msg.get("method").and_then(Value::as_str).unwrap_or("");
    let params = msg.get("params").cloned().unwrap_or(json!({}));
    let Some(id) = id else { return Ok(None) };
    let response = match method {
        "initialize" => {
            let version = params.get("protocolVersion").and_then(Value::as_str).unwrap_or("2025-06-18");
            json!({ "jsonrpc": "2.0", "id": id, "result": {
                "protocolVersion": version,
                "capabilities": { "tools": {} },
                "serverInfo": { "name": "worlds", "version": server_version },
                "instructions": "Tools for the user's local Worlds workspace (pages made of blocks). Read before writing; change the smallest set of blocks; Discord sends are queued for the user's approval."
            }})
        }
        "ping" => json!({ "jsonrpc": "2.0", "id": id, "result": {} }),
        "tools/list" => json!({ "jsonrpc": "2.0", "id": id, "result": { "tools": tools() } }),
        "tools/call" => {
            let name = params.get("name").and_then(Value::as_str).unwrap_or("");
            let args = params.get("arguments").cloned().unwrap_or(json!({}));
            match call(name, &args) {
                Ok(value) => {
                    let text = if value.is_string() { value.as_str().unwrap().to_string() } else { serde_json::to_string_pretty(&value)? };
                    json!({ "jsonrpc": "2.0", "id": id, "result": { "content": [{ "type": "text", "text": text }] } })
                }
                Err(error) => json!({ "jsonrpc": "2.0", "id": id, "result": {
                    "content": [{ "type": "text", "text": format!("Error: {error:#}") }], "isError": true
                }}),
            }
        }
        _ => json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -32601, "message": format!("unknown method {method}") } }),
    };
    Ok(Some(response))
}
