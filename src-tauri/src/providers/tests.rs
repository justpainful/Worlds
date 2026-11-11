//! Provider tests: presets, key and address checks, both request dialects,
//! SSE stream parsing, model lists, the tool loop against a local fake
//! server, and Codex's JSON events. Nothing here talks to a real provider.

use super::agent::{self, BoxFuture, Endpoint, Job, LoopEvent, ToolHost};
use super::codex::{self, CodexEvent, CodexParser, CodexRun};
use super::models;
use super::wire::{self, AnthropicStream, Dialect, Msg, OpenAiStream, Part, Role, SseEvent, SseParser, ToolDef};
use super::*;
use crate::account::secrets::{MemoryStore, SecretStore};
use serde_json::json;
use std::path::{Path, PathBuf};

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

#[test]
fn presets_parse_with_unique_ids() {
    let all = presets();
    assert!(all.len() >= 15, "{} presets", all.len());
    let mut ids: Vec<&str> = all.iter().map(|p| p.id.as_str()).collect();
    ids.sort();
    ids.dedup();
    assert_eq!(ids.len(), all.len(), "duplicate provider ids");
    for id in [
        "claude-code",
        "codex",
        "anthropic",
        "openai",
        "gemini",
        "groq",
        "deepseek",
        "mistral",
        "xai",
        "openrouter",
        "litellm",
        "custom",
        "ollama",
        "lmstudio",
        "llamacpp",
    ] {
        assert!(preset(id).is_ok(), "missing preset {id}");
    }
    assert!(preset("nope").is_err());
}

#[test]
fn preset_kinds_and_dialects() {
    for p in presets() {
        assert!(matches!(p.kind.as_str(), "runner" | "cloud" | "local"), "{} kind {}", p.id, p.kind);
        assert!(matches!(p.key.as_str(), "none" | "required" | "optional"), "{} key {}", p.id, p.key);
        if p.is_runner() {
            assert_eq!(p.key, "none", "{} runner with a key", p.id);
            assert!(p.base_url.is_empty() && !p.editable_base_url, "{} runner with an address", p.id);
        }
        if p.is_local() {
            assert_eq!(p.key, "none");
            assert!(p.base_url.starts_with("http://localhost:"), "{} {}", p.id, p.base_url);
        }
        if p.kind == "cloud" && p.key_required() {
            assert!(p.base_url.starts_with("https://"), "{} must use https", p.id);
        }
        if !p.base_url.is_empty() {
            assert_eq!(check_base_url(&p.base_url).unwrap(), p.base_url, "{} default address", p.id);
        }
    }
    assert_eq!(preset("anthropic").unwrap().dialect(), Dialect::Anthropic);
    assert_eq!(preset("openai").unwrap().dialect(), Dialect::OpenAi);
    assert_eq!(preset("ollama").unwrap().dialect(), Dialect::OpenAi);
    assert_eq!(preset("ollama").unwrap().max_tools, Some(32));
    assert!(preset(CLAUDE_CODE).unwrap().is_runner() && preset(CODEX).unwrap().is_runner());
}

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

#[test]
fn keys_are_stored_and_removed() {
    let store = MemoryStore::default();
    save_key(&store, "openai", "  sk-proj-abc123  ").unwrap();
    assert_eq!(load_key(&store, "openai").as_deref(), Some("sk-proj-abc123"));
    assert_eq!(store.get("ai.key.openai").unwrap().as_deref(), Some("sk-proj-abc123"));
    // Each provider has its own entry.
    assert!(load_key(&store, "groq").is_none());
    // An empty key removes it.
    save_key(&store, "openai", "").unwrap();
    assert!(load_key(&store, "openai").is_none());
    save_key(&store, "openai", "   ").unwrap();
    assert!(load_key(&store, "openai").is_none());
}

#[test]
fn claude_subscription_tokens_are_refused() {
    let store = MemoryStore::default();
    let err = save_key(&store, "anthropic", "sk-ant-oat01-AbCdEf0123456789").unwrap_err().to_string();
    assert!(err.contains("subscription"), "{err}");
    // Refused for every provider, not only Anthropic.
    assert!(save_key(&store, "openrouter", "sk-ant-oat01-xyz").is_err());
    assert!(save_key(&store, "custom", " sk-ant-oat02-xyz ").is_err());
    assert!(store.get("ai.key.anthropic").unwrap().is_none());
    assert!(store.get("ai.key.openrouter").unwrap().is_none());
    // A Console API key is fine.
    save_key(&store, "anthropic", "sk-ant-api03-AbCdEf0123456789").unwrap();
    assert!(load_key(&store, "anthropic").is_some());
}

#[test]
fn bad_keys_and_runner_keys_are_refused() {
    let store = MemoryStore::default();
    assert!(save_key(&store, "openai", "sk abc").is_err());
    assert!(save_key(&store, "openai", "sk-abc\ndef").is_err());
    assert!(save_key(&store, "openai", &"a".repeat(5000)).is_err());
    assert!(save_key(&store, "claude-code", "sk-ant-api03-x").is_err());
    assert!(save_key(&store, "codex", "sk-x").is_err());
    assert!(save_key(&store, "unknown", "sk-x").is_err());
    assert!(store.get("ai.key.claude-code").unwrap().is_none());
}

#[test]
fn failed_saves_never_echo_the_key() {
    let store = MemoryStore::default();
    let secret = "sk-ant-oat01-SECRETVALUE";
    let err = save_key(&store, "anthropic", secret).unwrap_err();
    assert!(!format!("{err:#}").contains("SECRETVALUE"));
    let err = save_key(&store, "openai", "sk SECRETVALUE").unwrap_err();
    assert!(!format!("{err:#}").contains("SECRETVALUE"));
}

// ---------------------------------------------------------------------------
// Base URLs
// ---------------------------------------------------------------------------

#[test]
fn base_urls_are_checked_and_trimmed() {
    assert_eq!(check_base_url(" https://api.example.com/v1/ ").unwrap(), "https://api.example.com/v1");
    assert_eq!(check_base_url("http://localhost:11434/v1").unwrap(), "http://localhost:11434/v1");
    assert_eq!(check_base_url("http://192.168.1.20:8080/v1//").unwrap(), "http://192.168.1.20:8080/v1");
    assert_eq!(check_base_url("").unwrap(), "");
    assert_eq!(check_base_url("   ").unwrap(), "");
    assert!(check_base_url("api.example.com/v1").is_err());
    assert!(check_base_url("ftp://example.com").is_err());
    assert!(check_base_url("file:///C:/x").is_err());
    assert!(check_base_url("javascript:alert(1)").is_err());
    let err = check_base_url("https://me:sk-secret@example.com/v1").unwrap_err().to_string();
    assert!(err.contains("key field") && !err.contains("sk-secret"), "{err}");
    assert!(check_base_url("https://token@example.com").is_err());
}

#[test]
fn chat_urls_per_dialect() {
    let ep = |d: Dialect, base: &str| Endpoint {
        dialect: d,
        base: base.into(),
        key: None,
        model: "m".into(),
        provider: "p".into(),
        label: "P".into(),
    };
    assert_eq!(ep(Dialect::Anthropic, "https://api.anthropic.com").chat_url(), "https://api.anthropic.com/v1/messages");
    assert_eq!(ep(Dialect::Anthropic, "https://proxy.test/v1/").chat_url(), "https://proxy.test/v1/messages");
    assert_eq!(ep(Dialect::OpenAi, "https://api.openai.com/v1").chat_url(), "https://api.openai.com/v1/chat/completions");
    assert_eq!(ep(Dialect::OpenAi, "http://localhost:1234/v1/").chat_url(), "http://localhost:1234/v1/chat/completions");
    assert_eq!(models::server_root("http://localhost:11434/v1/"), "http://localhost:11434");
    assert_eq!(models::server_root("http://localhost:11434"), "http://localhost:11434");
}

// ---------------------------------------------------------------------------
// Auth headers
// ---------------------------------------------------------------------------

fn endpoint(d: Dialect, key: Option<&str>, provider: &str) -> Endpoint {
    Endpoint {
        dialect: d,
        base: "https://example.test".into(),
        key: key.map(str::to_string),
        model: "model-1".into(),
        provider: provider.into(),
        label: "Example".into(),
    }
}

#[test]
fn auth_headers_per_dialect() {
    let client = reqwest::Client::new();
    let r =
        endpoint(Dialect::Anthropic, Some("sk-ant-api03-k"), "anthropic").authorize(client.post("https://example.test")).build().unwrap();
    assert_eq!(r.headers()["x-api-key"], "sk-ant-api03-k");
    assert_eq!(r.headers()["anthropic-version"], "2023-06-01");
    assert!(r.headers().get("authorization").is_none());

    let r = endpoint(Dialect::OpenAi, Some("sk-k"), "openai").authorize(client.post("https://example.test")).build().unwrap();
    assert_eq!(r.headers()["authorization"], "Bearer sk-k");
    assert!(r.headers().get("x-api-key").is_none());

    // Local servers without a key send no auth at all.
    let r = endpoint(Dialect::OpenAi, None, "ollama").authorize(client.post("https://example.test")).build().unwrap();
    assert!(r.headers().get("authorization").is_none());
    let r = endpoint(Dialect::OpenAi, Some(""), "lmstudio").authorize(client.post("https://example.test")).build().unwrap();
    assert!(r.headers().get("authorization").is_none());

    let r = endpoint(Dialect::OpenAi, Some("k"), "openrouter").authorize(client.post("https://example.test")).build().unwrap();
    assert_eq!(r.headers()["x-title"], "Worlds");
}

#[test]
fn endpoint_debug_hides_the_key() {
    let text = format!("{:?}", endpoint(Dialect::OpenAi, Some("sk-very-secret"), "openai"));
    assert!(!text.contains("sk-very-secret"), "{text}");
    assert!(text.contains("<set>"));
}

// ---------------------------------------------------------------------------
// Request shapes
// ---------------------------------------------------------------------------

fn sample_tools() -> Vec<ToolDef> {
    vec![
        ToolDef::from_mcp(&json!({
            "name": "pages_read",
            "description": "Read a page",
            "inputSchema": { "type": "object", "properties": { "pageId": { "type": "string" } }, "required": ["pageId"] }
        }))
        .unwrap(),
        // A schema without type or properties gets both.
        ToolDef::from_mcp(&json!({ "name": "time_now" })).unwrap(),
    ]
}

fn sample_conversation() -> Vec<Msg> {
    vec![
        // A leading assistant turn is dropped: conversations start with the user.
        Msg::assistant_text("stale"),
        Msg::user_text("Hello"),
        Msg { role: Role::User, parts: vec![Part::Image { mime: "image/png".into(), data: "iVBOR".into() }] },
        Msg {
            role: Role::Assistant,
            parts: vec![
                Part::Text("Let me look.".into()),
                Part::ToolCall { id: "call_1".into(), name: "pages_read".into(), input: json!({ "pageId": "p1" }) },
            ],
        },
        Msg { role: Role::User, parts: vec![Part::ToolResult { id: "call_1".into(), output: "not found".into(), is_error: true }] },
        Msg { role: Role::Assistant, parts: vec![Part::Text("   ".into())] },
    ]
}

#[test]
fn tool_definitions_from_mcp() {
    let t = sample_tools();
    assert_eq!(t[0].name, "pages_read");
    assert_eq!(t[0].schema["required"], json!(["pageId"]));
    assert_eq!(t[1].schema, json!({ "type": "object", "properties": {} }));
    assert!(ToolDef::from_mcp(&json!({ "description": "no name" })).is_none());
}

#[test]
fn every_mcp_tool_converts() {
    let defs = crate::mcp::tool_definitions();
    assert!(defs.len() > 40, "{} tools", defs.len());
    let tools: Vec<ToolDef> = defs.iter().filter_map(ToolDef::from_mcp).collect();
    assert_eq!(tools.len(), defs.len());
    for t in &tools {
        assert_eq!(t.schema["type"], "object", "{}", t.name);
        assert!(t.schema["properties"].is_object(), "{}", t.name);
    }
    // The core set names tools that exist.
    for name in agent::CORE_TOOLS {
        assert!(tools.iter().any(|t| t.name == *name), "core tool {name} does not exist");
    }
}

#[test]
fn anthropic_request_shape() {
    let body = wire::anthropic_request("claude-x", "Be brief.", &sample_conversation(), &sample_tools(), 8192);
    assert_eq!(body["model"], "claude-x");
    assert_eq!(body["system"], "Be brief.");
    assert_eq!(body["max_tokens"], 8192);
    assert_eq!(body["stream"], true);
    let msgs = body["messages"].as_array().unwrap();
    // user (text + image merged), assistant, user (tool result); blanks and the leading assistant dropped.
    assert_eq!(msgs.len(), 3, "{msgs:#?}");
    assert_eq!(msgs[0]["role"], "user");
    assert_eq!(msgs[0]["content"][0], json!({ "type": "text", "text": "Hello" }));
    assert_eq!(msgs[0]["content"][1]["type"], "image");
    assert_eq!(msgs[0]["content"][1]["source"], json!({ "type": "base64", "media_type": "image/png", "data": "iVBOR" }));
    assert_eq!(msgs[1]["role"], "assistant");
    assert_eq!(msgs[1]["content"][1], json!({ "type": "tool_use", "id": "call_1", "name": "pages_read", "input": { "pageId": "p1" } }));
    assert_eq!(msgs[2]["content"][0], json!({ "type": "tool_result", "tool_use_id": "call_1", "content": "not found", "is_error": true }));
    let tools = body["tools"].as_array().unwrap();
    assert_eq!(tools[0]["name"], "pages_read");
    assert!(tools[0].get("input_schema").is_some() && tools[0].get("parameters").is_none());
    // No tools: no tools field.
    let body = wire::anthropic_request("m", "s", &[Msg::user_text("hi")], &[], 100);
    assert!(body.get("tools").is_none());
}

#[test]
fn openai_request_shape() {
    let body = wire::openai_request("gpt-x", "Be brief.", &sample_conversation(), &sample_tools());
    assert_eq!(body["model"], "gpt-x");
    assert_eq!(body["stream"], true);
    let msgs = body["messages"].as_array().unwrap();
    assert_eq!(msgs[0], json!({ "role": "system", "content": "Be brief." }));
    // Mixed text and image content stays an array with a data URL.
    assert_eq!(msgs[1]["role"], "user");
    assert_eq!(msgs[1]["content"][0], json!({ "type": "text", "text": "Hello" }));
    assert_eq!(msgs[1]["content"][1]["image_url"]["url"], "data:image/png;base64,iVBOR");
    // Assistant tool calls carry their arguments as a JSON string.
    assert_eq!(msgs[2]["role"], "assistant");
    assert_eq!(msgs[2]["content"], "Let me look.");
    let call = &msgs[2]["tool_calls"][0];
    assert_eq!(call["id"], "call_1");
    assert_eq!(call["type"], "function");
    assert_eq!(call["function"]["name"], "pages_read");
    let args: Value = serde_json::from_str(call["function"]["arguments"].as_str().unwrap()).unwrap();
    assert_eq!(args, json!({ "pageId": "p1" }));
    // Tool results become tool messages right after, marked as errors.
    assert_eq!(msgs[3], json!({ "role": "tool", "tool_call_id": "call_1", "content": "Error: not found" }));
    assert_eq!(msgs.len(), 4);
    let tools = body["tools"].as_array().unwrap();
    assert_eq!(tools[0]["type"], "function");
    assert_eq!(tools[0]["function"]["name"], "pages_read");
    assert_eq!(tools[0]["function"]["parameters"]["required"], json!(["pageId"]));
}

#[test]
fn openai_text_only_content_is_a_string_and_pdfs_become_a_note() {
    let msgs = vec![Msg {
        role: Role::User,
        parts: vec![Part::Text("Read this".into()), Part::Document { name: "a.pdf".into(), data: "JVBER".into() }],
    }];
    let body = wire::openai_request("m", "s", &msgs, &[]);
    let content = body["messages"][1]["content"].as_str().unwrap();
    assert!(content.starts_with("Read this\n\n[a.pdf is a PDF"), "{content}");
    assert!(!content.contains("JVBER"));
    assert!(body.get("tools").is_none());
    // Anthropic reads PDFs natively.
    let body = wire::anthropic_request("m", "s", &msgs, &[], 10);
    assert_eq!(body["messages"][0]["content"][1]["type"], "document");
    assert_eq!(body["messages"][0]["content"][1]["source"]["media_type"], "application/pdf");
}

#[test]
fn parts_from_worlds_content() {
    let content = json!([
        { "type": "text", "text": "Hi" },
        { "type": "text", "text": "" },
        { "type": "image", "source": { "type": "base64", "media_type": "image/jpeg", "data": "abc" } },
        { "type": "document", "source": { "type": "base64", "media_type": "application/pdf", "data": "pdf" }, "title": "x.pdf" },
        { "type": "unknown" }
    ]);
    let parts = wire::parts_from_content(&content);
    assert_eq!(
        parts,
        vec![
            Part::Text("Hi".into()),
            Part::Image { mime: "image/jpeg".into(), data: "abc".into() },
            Part::Document { name: "x.pdf".into(), data: "pdf".into() },
        ]
    );
}

// ---------------------------------------------------------------------------
// Server-Sent Events
// ---------------------------------------------------------------------------

#[test]
fn sse_parser_handles_split_chunks() {
    let raw = "event: message_start\ndata: {\"a\":1}\n\n: keep-alive comment\n\ndata: first\r\ndata: second\r\n\r\ndata:no-space\n\n";
    let bytes = raw.as_bytes();
    // Feed one byte at a time: the worst possible split.
    let mut p = SseParser::default();
    let mut events = Vec::new();
    for b in bytes {
        events.extend(p.push(std::slice::from_ref(b)));
    }
    events.extend(p.finish());
    assert_eq!(
        events,
        vec![
            SseEvent { event: Some("message_start".into()), data: "{\"a\":1}".into() },
            SseEvent { event: None, data: "first\nsecond".into() },
            SseEvent { event: None, data: "no-space".into() },
        ]
    );
}

#[test]
fn sse_parser_keeps_utf8_split_across_chunks() {
    let raw = "data: {\"t\":\"مرحبا بالعالم\"}\n\n".as_bytes();
    // Split inside a two byte Arabic letter.
    let cut = raw.iter().position(|b| *b >= 0x80).unwrap() + 1;
    let mut p = SseParser::default();
    let mut events = p.push(&raw[..cut]);
    assert!(events.is_empty());
    events.extend(p.push(&raw[cut..]));
    assert_eq!(events.len(), 1);
    let v: Value = serde_json::from_str(&events[0].data).unwrap();
    assert_eq!(v["t"], "مرحبا بالعالم");
}

#[test]
fn sse_parser_flushes_an_unterminated_event() {
    let mut p = SseParser::default();
    assert!(p.push(b"data: [DONE]").is_empty());
    assert_eq!(p.finish(), vec![SseEvent { event: None, data: "[DONE]".into() }]);
    assert!(p.finish().is_empty());
}

fn sse(events: &[(&str, Value)]) -> Vec<SseEvent> {
    events.iter().map(|(e, d)| SseEvent { event: (!e.is_empty()).then(|| e.to_string()), data: d.to_string() }).collect()
}

#[test]
fn anthropic_stream_text_and_tool_calls() {
    let events = sse(&[
        ("message_start", json!({ "type": "message_start", "message": { "id": "msg_1" } })),
        ("content_block_start", json!({ "type": "content_block_start", "index": 0, "content_block": { "type": "text", "text": "" } })),
        (
            "content_block_delta",
            json!({ "type": "content_block_delta", "index": 0, "delta": { "type": "text_delta", "text": "Reading " } }),
        ),
        ("content_block_delta", json!({ "type": "content_block_delta", "index": 0, "delta": { "type": "text_delta", "text": "it." } })),
        ("content_block_stop", json!({ "type": "content_block_stop", "index": 0 })),
        (
            "content_block_start",
            json!({ "type": "content_block_start", "index": 1, "content_block": { "type": "tool_use", "id": "toolu_1", "name": "pages_read", "input": {} } }),
        ),
        (
            "content_block_delta",
            json!({ "type": "content_block_delta", "index": 1, "delta": { "type": "input_json_delta", "partial_json": "{\"page" } }),
        ),
        (
            "content_block_delta",
            json!({ "type": "content_block_delta", "index": 1, "delta": { "type": "input_json_delta", "partial_json": "Id\": \"p1\"}" } }),
        ),
        ("content_block_stop", json!({ "type": "content_block_stop", "index": 1 })),
        ("message_delta", json!({ "type": "message_delta", "delta": { "stop_reason": "tool_use" } })),
        ("message_stop", json!({ "type": "message_stop" })),
        ("ping", json!({ "type": "ping" })),
    ]);
    let mut s = AnthropicStream::default();
    let mut deltas = Vec::new();
    for e in &events {
        if let Some(t) = s.feed(e).unwrap() {
            deltas.push(t);
        }
    }
    assert_eq!(deltas, vec!["Reading ", "it."]);
    let turn = s.finish();
    assert_eq!(turn.text, "Reading it.");
    assert_eq!(turn.stop.as_deref(), Some("tool_use"));
    assert_eq!(turn.calls.len(), 1);
    assert_eq!(turn.calls[0].id, "toolu_1");
    assert_eq!(turn.calls[0].name, "pages_read");
    assert_eq!(turn.calls[0].input, json!({ "pageId": "p1" }));
    // The turn goes back into the conversation as an assistant message.
    let msg = turn.to_msg();
    assert_eq!(msg.role, Role::Assistant);
    assert_eq!(msg.parts.len(), 2);
}

#[test]
fn anthropic_stream_tool_without_input_and_errors() {
    let mut s = AnthropicStream::default();
    s.feed(
        &sse(&[(
            "",
            json!({ "type": "content_block_start", "index": 0, "content_block": { "type": "tool_use", "id": "t", "name": "time_now" } }),
        )])[0],
    )
    .unwrap();
    assert_eq!(s.finish().calls[0].input, json!({}));
    let mut s = AnthropicStream::default();
    let err = s
        .feed(&sse(&[("error", json!({ "type": "error", "error": { "type": "overloaded_error", "message": "Overloaded" } }))])[0])
        .unwrap_err();
    assert_eq!(err.to_string(), "Overloaded");
    // Lines that are not JSON are skipped.
    assert_eq!(s.feed(&SseEvent { event: None, data: "garbage".into() }).unwrap(), None);
}

#[test]
fn anthropic_whole_response() {
    let mut s = AnthropicStream::default();
    let v = json!({
        "content": [
            { "type": "text", "text": "Done." },
            { "type": "tool_use", "id": "t1", "name": "pages_create", "input": { "title": "صفحة" } }
        ],
        "stop_reason": "tool_use"
    });
    assert_eq!(s.feed_whole(&v).unwrap().as_deref(), Some("Done."));
    let turn = s.finish();
    assert_eq!(turn.calls[0].input, json!({ "title": "صفحة" }));
    assert!(AnthropicStream::default().feed_whole(&json!({ "error": { "message": "bad" } })).is_err());
}

#[test]
fn openai_stream_text_and_split_tool_calls() {
    let events = sse(&[
        ("", json!({ "choices": [{ "index": 0, "delta": { "role": "assistant", "content": "" } }] })),
        ("", json!({ "choices": [{ "index": 0, "delta": { "content": "Hel" } }] })),
        ("", json!({ "choices": [{ "index": 0, "delta": { "content": "lo" } }] })),
        (
            "",
            json!({ "choices": [{ "index": 0, "delta": { "tool_calls": [
                { "index": 0, "id": "call_a", "type": "function", "function": { "name": "pages_read", "arguments": "" } }
            ] } }] }),
        ),
        (
            "",
            json!({ "choices": [{ "index": 0, "delta": { "tool_calls": [{ "index": 0, "function": { "arguments": "{\"pageId\":" } }] } }] }),
        ),
        (
            "",
            json!({ "choices": [{ "index": 0, "delta": { "tool_calls": [
                { "index": 0, "function": { "arguments": "\"p1\"}" } },
                { "index": 1, "id": "call_b", "function": { "name": "time_now", "arguments": "{}" } }
            ] } }] }),
        ),
        ("", json!({ "choices": [{ "index": 0, "delta": {}, "finish_reason": "tool_calls" }] })),
        ("", json!({ "choices": [], "usage": { "total_tokens": 10 } })),
    ]);
    let mut s = OpenAiStream::default();
    let mut deltas = Vec::new();
    for e in &events {
        if let Some(t) = s.feed(e).unwrap() {
            deltas.push(t);
        }
    }
    assert_eq!(s.feed(&SseEvent { event: None, data: "[DONE]".into() }).unwrap(), None);
    assert_eq!(deltas, vec!["Hel", "lo"]);
    let turn = s.finish();
    assert_eq!(turn.text, "Hello");
    assert_eq!(turn.stop.as_deref(), Some("tool_calls"));
    assert_eq!(turn.calls.len(), 2);
    assert_eq!((turn.calls[0].id.as_str(), turn.calls[0].name.as_str()), ("call_a", "pages_read"));
    assert_eq!(turn.calls[0].input, json!({ "pageId": "p1" }));
    assert_eq!((turn.calls[1].id.as_str(), turn.calls[1].name.as_str()), ("call_b", "time_now"));
    assert_eq!(turn.calls[1].input, json!({}));
}

#[test]
fn openai_stream_quirks_of_local_servers() {
    // No index, no id, arguments as an object or a double encoded string.
    let mut s = OpenAiStream::default();
    s.feed(&sse(&[("", json!({ "choices": [{ "delta": { "tool_calls": [{ "function": { "name": "pages_search", "arguments": { "query": "x" } } }] } }] }))])[0])
        .unwrap();
    let turn = s.finish();
    assert_eq!(turn.calls[0].id, "call_0");
    assert_eq!(turn.calls[0].input, json!({ "query": "x" }));

    let mut s = OpenAiStream::default();
    let encoded = json!("{\"query\":\"y\"}").to_string();
    s.feed(&sse(&[("", json!({ "choices": [{ "delta": { "tool_calls": [{ "index": 0, "id": "c", "function": { "name": "pages_search", "arguments": encoded } }] } }] }))])[0])
        .unwrap();
    assert_eq!(s.finish().calls[0].input, json!({ "query": "y" }));

    // Broken arguments become an empty object rather than failing the run.
    let mut s = OpenAiStream::default();
    s.feed(&sse(&[("", json!({ "choices": [{ "delta": { "tool_calls": [{ "index": 0, "id": "c", "function": { "name": "time_now", "arguments": "{oops" } }] } }] }))])[0])
        .unwrap();
    assert_eq!(s.finish().calls[0].input, json!({}));

    // A call that never got a name is dropped.
    let mut s = OpenAiStream::default();
    s.feed(&sse(&[("", json!({ "choices": [{ "delta": { "tool_calls": [{ "index": 0, "function": { "arguments": "{}" } }] } }] }))])[0])
        .unwrap();
    assert!(s.finish().calls.is_empty());

    // An error inside the stream fails the turn.
    let mut s = OpenAiStream::default();
    let err = s.feed(&sse(&[("", json!({ "error": { "message": "context too long" } }))])[0]).unwrap_err();
    assert_eq!(err.to_string(), "context too long");
}

#[test]
fn openai_whole_response() {
    let mut s = OpenAiStream::default();
    let v = json!({ "choices": [{ "message": { "role": "assistant", "content": "Hi there", "tool_calls": [
        { "id": "c1", "type": "function", "function": { "name": "time_now", "arguments": "{}" } }
    ] }, "finish_reason": "tool_calls" }] });
    assert_eq!(s.feed_whole(&v).unwrap().as_deref(), Some("Hi there"));
    let turn = s.finish();
    assert_eq!(turn.calls.len(), 1);
    assert_eq!(turn.stop.as_deref(), Some("tool_calls"));
}

#[test]
fn either_stream_by_dialect() {
    let mut s = wire::Stream::new(Dialect::OpenAi);
    let ev = SseEvent { event: None, data: json!({ "choices": [{ "delta": { "content": "x" } }] }).to_string() };
    assert_eq!(s.feed(&ev).unwrap().as_deref(), Some("x"));
    assert_eq!(s.finish().text, "x");
    let mut s = wire::Stream::new(Dialect::Anthropic);
    // An OpenAI chunk means nothing to the Anthropic reader.
    assert_eq!(s.feed(&ev).unwrap(), None);
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[test]
fn readable_error_messages() {
    assert_eq!(wire::error_message(r#"{"error":{"message":"Invalid model","type":"x"}}"#), "Invalid model");
    assert_eq!(wire::error_message(r#"{"message":"Not found"}"#), "Not found");
    assert_eq!(wire::error_message(r#"[{"error":{"message":"Quota"}}]"#), "Quota");
    assert_eq!(wire::error_message("  plain text  "), "plain text");
    let long = "x".repeat(1000);
    assert_eq!(wire::error_message(&long).chars().count(), 301);

    let e = agent::http_error("OpenAI", 401, r#"{"error":{"message":"Incorrect API key provided"}}"#).to_string();
    assert!(e.starts_with("provider_auth: OpenAI did not accept the API key (401)"), "{e}");
    assert!(agent::http_error("Groq", 429, "{}").to_string().contains("rate limiting"));
    assert!(agent::http_error("X", 404, "").to_string().contains("404"));
    assert!(agent::http_error("X", 500, "boom").to_string().contains("boom"));
}

#[test]
fn tool_support_refusals_are_recognised() {
    assert!(agent::no_tool_support(400, r#"{"error":{"message":"registry.ollama.ai/library/gemma:2b does not support tools"}}"#));
    assert!(agent::no_tool_support(500, "tools param requires --jinja flag"));
    assert!(agent::no_tool_support(400, "This model does not support function calling"));
    assert!(agent::no_tool_support(422, "Tool use is not enabled for this model"));
    assert!(!agent::no_tool_support(400, "Invalid model name"));
    assert!(!agent::no_tool_support(401, "invalid key"));
    assert!(!agent::no_tool_support(200, "tools not supported"));
    assert!(!agent::no_tool_support(503, "tools not supported"));
}

// ---------------------------------------------------------------------------
// Model lists
// ---------------------------------------------------------------------------

#[test]
fn model_lists_parse() {
    let a = models::parse_anthropic(&json!({ "data": [
        { "id": "claude-sonnet-4-5", "display_name": "Claude Sonnet 4.5", "type": "model" },
        { "id": "claude-haiku-4-5" }
    ] }));
    assert_eq!(a.len(), 2);
    assert_eq!(a[0].name, "Claude Sonnet 4.5");
    assert_eq!(a[1].name, "claude-haiku-4-5");
    assert!(a.iter().all(|m| m.tools == Some(true)));

    let o = models::parse_openai(&json!({ "data": [
        { "id": "gpt-5" },
        { "id": "text-embedding-3-small" },
        { "id": "whisper-1" },
        { "id": "models/gemini-2.5-flash", "display_name": "Gemini 2.5 Flash" },
        { "id": "gpt-5" },
        { "id": "meta/llama", "supported_parameters": ["temperature", "tools"] },
        { "id": "tiny", "supported_parameters": ["temperature"] }
    ] }));
    let ids: Vec<&str> = o.iter().map(|m| m.id.as_str()).collect();
    assert_eq!(ids, vec!["gemini-2.5-flash", "gpt-5", "meta/llama", "tiny"]);
    assert_eq!(o[0].name, "Gemini 2.5 Flash");
    assert_eq!(o[1].tools, None);
    assert_eq!(o[2].tools, Some(true));
    assert_eq!(o[3].tools, Some(false));

    assert_eq!(
        models::parse_ollama_tags(&json!({ "models": [{ "name": "llama3.2:3b" }, { "model": "qwen3:8b" }] })),
        vec!["llama3.2:3b", "qwen3:8b"]
    );
    assert_eq!(models::parse_ollama_show(&json!({ "capabilities": ["completion", "tools"] })), Some(true));
    assert_eq!(models::parse_ollama_show(&json!({ "capabilities": ["completion"] })), Some(false));
    assert_eq!(models::parse_ollama_show(&json!({})), None);

    let l = models::parse_lmstudio(&json!({ "data": [
        { "id": "qwen2.5-7b-instruct", "type": "llm", "capabilities": ["tool_use"] },
        { "id": "nomic-embed", "type": "embeddings" },
        { "id": "phi", "type": "llm" }
    ] }));
    assert_eq!(l.len(), 2);
    assert_eq!(l[0].tools, Some(true));
    assert_eq!(l[1].tools, None);
}

#[test]
fn model_info_serialises_for_the_ui() {
    let m = models::ModelInfo { id: "a".into(), name: "A".into(), tools: None };
    assert_eq!(serde_json::to_value(&m).unwrap(), json!({ "id": "a", "name": "A", "tools": null }));
}

// ---------------------------------------------------------------------------
// Tool selection and history
// ---------------------------------------------------------------------------

fn named(n: &str) -> ToolDef {
    ToolDef { name: n.into(), description: String::new(), schema: json!({ "type": "object", "properties": {} }) }
}

#[test]
fn tool_selection_respects_limits() {
    let mut all: Vec<ToolDef> = (0..50).map(|i| named(&format!("extra_{i}"))).collect();
    all.extend(["pages_read", "pages_search", "time_now", "discord_send"].iter().map(|n| named(n)));
    // Under the limit: everything, in order.
    assert_eq!(agent::select_tools(&all, &[], 1000).len(), all.len());
    // Over: picked first, then core tools, then the rest.
    let picked = vec!["discord_send".to_string(), "missing_tool".to_string()];
    let got = agent::select_tools(&all, &picked, 4);
    let names: Vec<&str> = got.iter().map(|t| t.name.as_str()).collect();
    assert_eq!(names, vec!["discord_send", "time_now", "pages_search", "pages_read"]);
    let got = agent::select_tools(&all, &[], 10);
    assert_eq!(got.len(), 10);
    let mut uniq: Vec<&str> = got.iter().map(|t| t.name.as_str()).collect();
    uniq.sort();
    uniq.dedup();
    assert_eq!(uniq.len(), 10);
}

#[test]
fn history_keeps_recent_good_turns() {
    let rows: Vec<(String, String, bool)> = vec![
        ("user".into(), "one".into(), false),
        ("assistant".into(), "Error: failed".into(), true),
        ("user".into(), "two".into(), false),
        ("assistant".into(), "answer two".into(), false),
        ("user".into(), "   ".into(), false),
        ("user".into(), "three".into(), false),
    ];
    let h = agent::history_from_rows(&rows, 10, 10_000);
    let texts: Vec<String> = h.iter().map(|m| if let Part::Text(t) = &m.parts[0] { t.clone() } else { String::new() }).collect();
    assert_eq!(texts, vec!["one", "two", "answer two", "three"]);
    assert_eq!(h[2].role, Role::Assistant);
    assert_eq!(agent::history_from_rows(&rows, 2, 10_000).len(), 2);
    // A character budget drops the oldest first, keeping at least one.
    let h = agent::history_from_rows(&rows, 10, 15);
    assert_eq!(h.len(), 2);
    assert_eq!(h[0].parts[0], Part::Text("answer two".into()));
    assert_eq!(agent::history_from_rows(&rows, 10, 1).len(), 1);
}

// ---------------------------------------------------------------------------
// The tool loop against a local fake server
// ---------------------------------------------------------------------------

/// Serves one canned HTTP response per connection, in order, and returns
/// what each request looked like (headers and body).
async fn fake_server(responses: Vec<(u16, &'static str, String)>) -> (String, tokio::task::JoinHandle<Vec<(String, Value)>>) {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let handle = tokio::spawn(async move {
        let mut seen = Vec::new();
        for (status, kind, body) in responses {
            let (mut sock, _) = listener.accept().await.unwrap();
            let mut buf: Vec<u8> = Vec::new();
            let mut tmp = [0u8; 4096];
            let (head, body_start) = loop {
                let n = sock.read(&mut tmp).await.unwrap();
                assert!(n > 0, "client closed early");
                buf.extend_from_slice(&tmp[..n]);
                if let Some(i) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
                    break (String::from_utf8_lossy(&buf[..i]).to_string(), i + 4);
                }
            };
            let len: usize = head
                .lines()
                .find_map(|l| l.to_ascii_lowercase().strip_prefix("content-length:").map(|v| v.trim().parse().unwrap()))
                .unwrap_or(0);
            while buf.len() < body_start + len {
                let n = sock.read(&mut tmp).await.unwrap();
                buf.extend_from_slice(&tmp[..n]);
            }
            let req_body: Value = serde_json::from_slice(&buf[body_start..body_start + len]).unwrap_or(Value::Null);
            seen.push((head, req_body));
            let reply =
                format!("HTTP/1.1 {status} X\r\nContent-Type: {kind}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
            sock.write_all(reply.as_bytes()).await.unwrap();
            sock.shutdown().await.ok();
        }
        seen
    });
    (format!("http://{addr}"), handle)
}

fn sse_body(events: &[Value]) -> String {
    events.iter().map(|e| format!("data: {e}\n\n")).collect()
}

#[derive(Default)]
struct RecordingTools {
    calls: Vec<(String, Value)>,
}

impl ToolHost for RecordingTools {
    fn call<'a>(&'a mut self, name: &'a str, input: &'a Value) -> BoxFuture<'a, (String, bool)> {
        self.calls.push((name.to_string(), input.clone()));
        Box::pin(async move { (format!("{{\"title\":\"Groceries\",\"tool\":\"{name}\"}}"), false) })
    }
}

#[tokio::test]
async fn tool_loop_openai_runs_tools_and_answers() {
    let first = sse_body(&[
        json!({ "choices": [{ "delta": { "tool_calls": [{ "index": 0, "id": "c1", "function": { "name": "pages_read", "arguments": "{\"pageId\":\"p1\"}" } }] } }] }),
        json!({ "choices": [{ "delta": {}, "finish_reason": "tool_calls" }] }),
    ]) + "data: [DONE]\n\n";
    let second = sse_body(&[
        json!({ "choices": [{ "delta": { "content": "The page is " } }] }),
        json!({ "choices": [{ "delta": { "content": "Groceries." } }] }),
    ]) + "data: [DONE]\n\n";
    let (base, server) = fake_server(vec![(200, "text/event-stream", first), (200, "text/event-stream", second)]).await;
    let ep = Endpoint {
        dialect: Dialect::OpenAi,
        base: format!("{base}/v1"),
        key: Some("sk-test-key".into()),
        model: "gpt-test".into(),
        provider: "openai".into(),
        label: "OpenAI".into(),
    };
    let tools = sample_tools();
    let mut host = RecordingTools::default();
    let mut events = Vec::new();
    let job = Job { system: "sys", messages: vec![Msg::user_text("What is p1?")], tools: &tools, tools_supported: None };
    let out = agent::run(&reqwest::Client::new(), &ep, job, &mut host, &mut |e| events.push(e)).await.unwrap();
    assert_eq!(out.text, "The page is Groceries.");
    assert_eq!(out.turns, 2);
    assert!(!out.chat_only);
    assert_eq!(out.steps, vec![json!({ "tool": "pages_read", "ok": true })]);
    assert_eq!(host.calls, vec![("pages_read".to_string(), json!({ "pageId": "p1" }))]);
    assert!(events.contains(&LoopEvent::Tool { name: "pages_read".into(), input: json!({ "pageId": "p1" }) }));
    assert!(events.contains(&LoopEvent::Delta("Groceries.".into())));

    let seen = server.await.unwrap();
    assert_eq!(seen.len(), 2);
    let (head, body) = &seen[0];
    assert!(head.starts_with("POST /v1/chat/completions "), "{head}");
    assert!(head.to_ascii_lowercase().contains("authorization: bearer sk-test-key"));
    assert_eq!(body["model"], "gpt-test");
    assert_eq!(body["tools"].as_array().unwrap().len(), 2);
    // The second request carries the tool call and its result.
    let msgs = seen[1].1["messages"].as_array().unwrap();
    assert_eq!(msgs[2]["tool_calls"][0]["id"], "c1");
    assert_eq!(msgs[3]["role"], "tool");
    assert_eq!(msgs[3]["tool_call_id"], "c1");
}

#[tokio::test]
async fn tool_loop_anthropic_refuses_unknown_tools() {
    let first = sse_body(&[
        json!({ "type": "content_block_start", "index": 0, "content_block": { "type": "tool_use", "id": "t1", "name": "shell", "input": {} } }),
        json!({ "type": "content_block_delta", "index": 0, "delta": { "type": "input_json_delta", "partial_json": "{\"cmd\":\"dir\"}" } }),
        json!({ "type": "message_delta", "delta": { "stop_reason": "tool_use" } }),
    ]);
    let second = sse_body(&[
        json!({ "type": "content_block_start", "index": 0, "content_block": { "type": "text", "text": "" } }),
        json!({ "type": "content_block_delta", "index": 0, "delta": { "type": "text_delta", "text": "I cannot do that." } }),
        json!({ "type": "message_delta", "delta": { "stop_reason": "end_turn" } }),
    ]);
    let (base, server) = fake_server(vec![(200, "text/event-stream", first), (200, "text/event-stream", second)]).await;
    let ep = Endpoint {
        dialect: Dialect::Anthropic,
        base,
        key: Some("sk-ant-api03-test".into()),
        model: "claude-test".into(),
        provider: "anthropic".into(),
        label: "Anthropic".into(),
    };
    let tools = sample_tools();
    let mut host = RecordingTools::default();
    let job = Job { system: "sys", messages: vec![Msg::user_text("Run dir")], tools: &tools, tools_supported: Some(true) };
    let out = agent::run(&reqwest::Client::new(), &ep, job, &mut host, &mut |_| {}).await.unwrap();
    assert_eq!(out.text, "I cannot do that.");
    // Only offered tools ever run.
    assert!(host.calls.is_empty());
    assert_eq!(out.steps, vec![json!({ "tool": "shell", "ok": false })]);
    let seen = server.await.unwrap();
    let head = seen[0].0.to_ascii_lowercase();
    assert!(head.starts_with("post /v1/messages "), "{head}");
    assert!(head.contains("x-api-key: sk-ant-api03-test"));
    assert!(head.contains("anthropic-version: 2023-06-01"));
    let result = &seen[1].1["messages"][2]["content"][0];
    assert_eq!(result["type"], "tool_result");
    assert_eq!(result["is_error"], true);
    assert!(result["content"].as_str().unwrap().contains("no tool named shell"));
}

#[tokio::test]
async fn tool_loop_falls_back_to_chat_when_tools_are_refused() {
    let refusal = r#"{"error":{"message":"llama3:8b does not support tools"}}"#.to_string();
    let answer = r#"{"choices":[{"message":{"role":"assistant","content":"Hi!"},"finish_reason":"stop"}]}"#.to_string();
    let (base, server) = fake_server(vec![(400, "application/json", refusal), (200, "application/json", answer)]).await;
    let ep = Endpoint {
        dialect: Dialect::OpenAi,
        base: format!("{base}/v1"),
        key: None,
        model: "llama3:8b".into(),
        provider: "ollama".into(),
        label: "Ollama".into(),
    };
    let tools = sample_tools();
    let mut events = Vec::new();
    let job = Job { system: "sys", messages: vec![Msg::user_text("Hi")], tools: &tools, tools_supported: None };
    let out = agent::run(&reqwest::Client::new(), &ep, job, &mut RecordingTools::default(), &mut |e| events.push(e)).await.unwrap();
    assert_eq!(out.text, "Hi!");
    assert!(out.chat_only);
    assert!(events.contains(&LoopEvent::Note(agent::CHAT_ONLY_NOTE.into())));
    let seen = server.await.unwrap();
    assert!(seen[0].1.get("tools").is_some());
    assert!(seen[1].1.get("tools").is_none());
    assert!(!seen[0].0.to_ascii_lowercase().contains("authorization"));
}

#[tokio::test]
async fn tool_loop_reports_auth_errors_without_the_key() {
    let (base, server) = fake_server(vec![(401, "application/json", r#"{"error":{"message":"Invalid API Key"}}"#.into())]).await;
    let ep = Endpoint {
        dialect: Dialect::OpenAi,
        base,
        key: Some("gsk_secret_value".into()),
        model: "m".into(),
        provider: "groq".into(),
        label: "Groq".into(),
    };
    let job = Job { system: "s", messages: vec![Msg::user_text("x")], tools: &[], tools_supported: Some(false) };
    let err = agent::run(&reqwest::Client::new(), &ep, job, &mut RecordingTools::default(), &mut |_| {}).await.unwrap_err();
    let text = format!("{err:#}");
    assert!(text.starts_with("provider_auth: Groq"), "{text}");
    assert!(!text.contains("gsk_secret_value"));
    server.await.unwrap();
}

#[tokio::test]
async fn unreachable_servers_give_a_clear_error() {
    // Bind and drop to get a port nothing listens on.
    let port = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap().local_addr().unwrap().port();
    let ep = Endpoint {
        dialect: Dialect::OpenAi,
        base: format!("http://127.0.0.1:{port}/v1"),
        key: Some("sk-hidden".into()),
        model: "m".into(),
        provider: "lmstudio".into(),
        label: "LM Studio".into(),
    };
    let job = Job { system: "s", messages: vec![Msg::user_text("x")], tools: &[], tools_supported: None };
    let err = agent::run(&reqwest::Client::new(), &ep, job, &mut RecordingTools::default(), &mut |_| {}).await.unwrap_err().to_string();
    assert!(err.contains("Could not reach LM Studio"), "{err}");
    assert!(!err.contains("sk-hidden"));
}

#[tokio::test]
async fn model_list_from_a_local_server() {
    let body = json!({ "data": [{ "id": "qwen2.5-7b", "type": "llm", "capabilities": ["tool_use"] }] }).to_string();
    let (base, server) = fake_server(vec![(200, "application/json", body)]).await;
    let p = preset("lmstudio").unwrap();
    let list = models::list(&reqwest::Client::new(), p, &format!("{base}/v1"), None, std::time::Duration::from_secs(5)).await.unwrap();
    assert_eq!(list, vec![models::ModelInfo { id: "qwen2.5-7b".into(), name: "qwen2.5-7b".into(), tools: Some(true) }]);
    let seen = server.await.unwrap();
    assert!(seen[0].0.starts_with("GET /api/v0/models "), "{}", seen[0].0);
}

// ---------------------------------------------------------------------------
// Codex
// ---------------------------------------------------------------------------

#[test]
fn codex_arguments() {
    let exe = PathBuf::from("codex.exe");
    let worlds = PathBuf::from(r"C:\Program Files\Worlds\worlds.exe");
    let images = vec![PathBuf::from(r"C:\data\a.png")];
    let r = CodexRun {
        exe: &exe,
        worlds_exe: &worlds,
        run_id: "run1",
        dir: Path::new("."),
        model: Some("gpt-5-codex"),
        thread: None,
        images: &images,
    };
    let a = codex::args(&r);
    assert_eq!(a[0], "exec");
    assert_ne!(a[1], "resume");
    for flag in ["--json", "--skip-git-repo-check", "--ignore-user-config"] {
        assert!(a.iter().any(|x| x == flag), "missing {flag}");
    }
    assert!(a.iter().any(|x| x == "sandbox_mode=\"read-only\""));
    assert!(a.iter().any(|x| x == "approval_policy=\"never\""));
    for feature in ["shell_tool", "browser_use", "computer_use", "apps", "plugins", "hooks"] {
        assert!(a.windows(2).any(|w| w[0] == "--disable" && w[1] == feature), "{feature} stays on");
    }
    // The Worlds MCP server, with a Windows path escaped as a TOML string.
    assert!(a.iter().any(|x| x == r#"mcp_servers.worlds.command="C:\\Program Files\\Worlds\\worlds.exe""#), "{a:?}");
    assert!(a.iter().any(|x| x == r#"mcp_servers.worlds.args=["--mcp","--actor","ai","--op","run1"]"#), "{a:?}");
    assert!(a.windows(2).any(|w| w[0] == "-m" && w[1] == "gpt-5-codex"));
    assert!(a.windows(2).any(|w| w[0] == "-i" && w[1] == r"C:\data\a.png"));
    assert_eq!(a.last().unwrap(), "-");
    // The prompt never goes on the command line.
    assert!(!a.iter().any(|x| x.contains("sandbox_mode=\"danger")));

    let r = CodexRun {
        exe: &exe,
        worlds_exe: &worlds,
        run_id: "run2",
        dir: Path::new("."),
        model: Some(""),
        thread: Some("th_9"),
        images: &[],
    };
    let a = codex::args(&r);
    assert_eq!(&a[..3], &["exec", "resume", "th_9"]);
    assert!(!a.iter().any(|x| x == "-m" || x == "-i"));
    assert!(!a.iter().any(|x| x == "--sandbox" || x == "-C"));
}

#[test]
fn codex_events_parse() {
    let mut p = CodexParser::default();
    let lines = [
        r#"{"type":"thread.started","thread_id":"th_1"}"#,
        r#"{"type":"turn.started"}"#,
        r#"{"type":"item.started","item":{"id":"i1","type":"mcp_tool_call","server":"worlds","tool":"pages_search","arguments":{"query":"x"},"status":"in_progress"}}"#,
        r#"{"type":"item.completed","item":{"id":"i1","type":"mcp_tool_call","server":"worlds","tool":"pages_search","arguments":{"query":"x"},"status":"completed","result":{"content":[]}}}"#,
        r#"{"type":"item.completed","item":{"id":"i2","type":"mcp_tool_call","tool":"pages_read","arguments":{},"status":"failed","error":{"message":"page not found"}}}"#,
        r#"{"type":"item.completed","item":{"id":"i3","type":"reasoning","text":"thinking"}}"#,
        r#"{"type":"item.completed","item":{"id":"i4","type":"agent_message","text":"Found it."}}"#,
        r#"{"type":"item.completed","item":{"id":"i5","type":"agent_message","text":""}}"#,
        r#"{"type":"turn.completed","usage":{"input_tokens":10}}"#,
        "not json",
    ];
    let events: Vec<CodexEvent> = lines.iter().flat_map(|l| p.feed(l)).collect();
    assert_eq!(
        events,
        vec![
            CodexEvent::Thread("th_1".into()),
            CodexEvent::Tool { name: "pages_search".into(), input: json!({ "query": "x" }) },
            CodexEvent::ToolResult { error: false },
            // Completed without a start: the tool is reported, then its result.
            CodexEvent::Tool { name: "pages_read".into(), input: json!({}) },
            CodexEvent::ToolResult { error: true },
            CodexEvent::Text("Found it.".into()),
        ]
    );
}

#[test]
fn codex_failures_and_other_tools() {
    let mut p = CodexParser::default();
    assert_eq!(
        p.feed(r#"{"type":"item.started","item":{"id":"c","type":"command_execution","command":"dir"}}"#),
        vec![CodexEvent::Tool { name: "shell".into(), input: json!({ "command": "dir" }) }]
    );
    assert_eq!(
        p.feed(r#"{"type":"item.completed","item":{"id":"m","type":"mcp_tool_call","tool":"x","result":{"isError":true}}}"#)[1],
        CodexEvent::ToolResult { error: true }
    );
    assert_eq!(
        p.feed(r#"{"type":"turn.failed","error":{"message":"You are not logged in"}}"#),
        vec![CodexEvent::Failed("You are not logged in".into())]
    );
    assert_eq!(p.feed(r#"{"type":"error","message":"stream disconnected"}"#), vec![CodexEvent::Failed("stream disconnected".into())]);
    assert!(codex::is_signed_out("You are not logged in. Run codex login"));
    assert!(codex::is_signed_out("401 Unauthorized"));
    assert!(!codex::is_signed_out("model overloaded"));
}
