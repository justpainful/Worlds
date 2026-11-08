use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};
use serde_json::{json, Value};

#[test]
fn original_protocol_only_reads_selected_synthetic_page() {
    let mut child=Command::new(env!("CARGO_BIN_EXE_worlds_mcp_fixture"))
        .args(["--mcp","--actor","ai","--op","fixture-run"])
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().unwrap();
    let mut input=child.stdin.take().unwrap(); let mut output=BufReader::new(child.stdout.take().unwrap());
    let mut exchange=|request:Value| -> Value {
        writeln!(input,"{request}").unwrap(); input.flush().unwrap();
        let mut line=String::new(); output.read_line(&mut line).unwrap(); serde_json::from_str(&line).unwrap()
    };
    assert_eq!(exchange(json!({"jsonrpc":"2.0","id":1,"method":"initialize"}))["result"]["serverInfo"]["name"],"worlds");
    let tools=exchange(json!({"jsonrpc":"2.0","id":2,"method":"tools/list"}));
    assert_eq!(tools["result"]["tools"].as_array().unwrap().len(),1);
    let read=exchange(json!({"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"blocks_read","arguments":{"pageId":"fixture-page"}}}));
    assert_ne!(read["result"]["isError"],true);
    let denied=exchange(json!({"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"blocks_read","arguments":{"pageId":"other-page"}}}));
    assert_eq!(denied["result"]["isError"],true);
    let denied=exchange(json!({"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"blocks_delete","arguments":{"pageId":"fixture-page"}}}));
    assert_eq!(denied["result"]["isError"],true);
    drop(exchange); drop(input);
    assert!(child.wait().unwrap().success());
}
