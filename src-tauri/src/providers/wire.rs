//! Wire formats: one neutral conversation shape, the two request dialects
//! (Anthropic Messages and OpenAI chat completions), Server-Sent Events, and
//! stream accumulators that turn either dialect's stream into text deltas plus
//! the finished assistant turn (text and tool calls).

use anyhow::{bail, Result};
use serde_json::{json, Value};
use std::collections::BTreeMap;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Dialect {
    Anthropic,
    OpenAi,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Role {
    User,
    Assistant,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Part {
    Text(String),
    /// Base64 image.
    Image { mime: String, data: String },
    /// Base64 PDF.
    Document { name: String, data: String },
    ToolCall { id: String, name: String, input: Value },
    ToolResult { id: String, output: String, is_error: bool },
}

#[derive(Clone, Debug, PartialEq)]
pub struct Msg {
    pub role: Role,
    pub parts: Vec<Part>,
}

impl Msg {
    pub fn user_text(text: impl Into<String>) -> Self {
        Msg { role: Role::User, parts: vec![Part::Text(text.into())] }
    }
    pub fn assistant_text(text: impl Into<String>) -> Self {
        Msg { role: Role::Assistant, parts: vec![Part::Text(text.into())] }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct ToolDef {
    pub name: String,
    pub description: String,
    pub schema: Value,
}

impl ToolDef {
    /// From an MCP tool definition (`name`, `description`, `inputSchema`).
    pub fn from_mcp(v: &Value) -> Option<Self> {
        let name = v.get("name")?.as_str()?.to_string();
        let description = v.get("description").and_then(Value::as_str).unwrap_or("").to_string();
        let mut schema = v.get("inputSchema").cloned().unwrap_or_else(|| json!({ "type": "object" }));
        if let Some(o) = schema.as_object_mut() {
            o.entry("type").or_insert_with(|| json!("object"));
            o.entry("properties").or_insert_with(|| json!({}));
        }
        Some(ToolDef { name, description, schema })
    }
}

/// Parts from the Anthropic-shaped content Worlds already builds for Claude
/// Code (text, base64 images, base64 PDF documents).
pub fn parts_from_content(content: &Value) -> Vec<Part> {
    let mut out = Vec::new();
    for b in content.as_array().into_iter().flatten() {
        match b.get("type").and_then(Value::as_str) {
            Some("text") => {
                let t = b.get("text").and_then(Value::as_str).unwrap_or("");
                if !t.is_empty() {
                    out.push(Part::Text(t.to_string()));
                }
            }
            Some("image") => {
                let src = &b["source"];
                if let (Some(mime), Some(data)) = (src["media_type"].as_str(), src["data"].as_str()) {
                    out.push(Part::Image { mime: mime.into(), data: data.into() });
                }
            }
            Some("document") => {
                if let Some(data) = b["source"]["data"].as_str() {
                    out.push(Part::Document { name: b["title"].as_str().unwrap_or("document.pdf").into(), data: data.into() });
                }
            }
            _ => {}
        }
    }
    out
}

/// Consecutive messages of the same role merged, empty ones dropped, and the
/// conversation starting with the user.
fn normalized(msgs: &[Msg]) -> Vec<Msg> {
    let mut out: Vec<Msg> = Vec::new();
    for m in msgs {
        let parts: Vec<Part> = m.parts.iter().filter(|p| !matches!(p, Part::Text(t) if t.trim().is_empty())).cloned().collect();
        if parts.is_empty() {
            continue;
        }
        if out.is_empty() && m.role == Role::Assistant {
            continue;
        }
        match out.last_mut() {
            Some(last) if last.role == m.role => last.parts.extend(parts),
            _ => out.push(Msg { role: m.role, parts }),
        }
    }
    out
}

// ---------------------------------------------------------------------------
// Anthropic Messages API
// ---------------------------------------------------------------------------

pub fn anthropic_request(model: &str, system: &str, msgs: &[Msg], tools: &[ToolDef], max_tokens: u32) -> Value {
    let messages: Vec<Value> = normalized(msgs)
        .into_iter()
        .map(|m| {
            let content: Vec<Value> = m
                .parts
                .iter()
                .map(|p| match p {
                    Part::Text(t) => json!({ "type": "text", "text": t }),
                    Part::Image { mime, data } => json!({ "type": "image", "source": { "type": "base64", "media_type": mime, "data": data } }),
                    Part::Document { name, data } => json!({
                        "type": "document",
                        "source": { "type": "base64", "media_type": "application/pdf", "data": data },
                        "title": name
                    }),
                    Part::ToolCall { id, name, input } => json!({ "type": "tool_use", "id": id, "name": name, "input": input }),
                    Part::ToolResult { id, output, is_error } => {
                        json!({ "type": "tool_result", "tool_use_id": id, "content": output, "is_error": is_error })
                    }
                })
                .collect();
            json!({ "role": if m.role == Role::User { "user" } else { "assistant" }, "content": content })
        })
        .collect();
    let mut body = json!({ "model": model, "max_tokens": max_tokens, "system": system, "messages": messages, "stream": true });
    if !tools.is_empty() {
        body["tools"] =
            Value::Array(tools.iter().map(|t| json!({ "name": t.name, "description": t.description, "input_schema": t.schema })).collect());
    }
    body
}

// ---------------------------------------------------------------------------
// OpenAI chat completions (OpenAI, Gemini, Groq, DeepSeek, Mistral, xAI,
// OpenRouter, LiteLLM, Ollama, LM Studio, llama.cpp)
// ---------------------------------------------------------------------------

pub fn openai_request(model: &str, system: &str, msgs: &[Msg], tools: &[ToolDef]) -> Value {
    let mut messages = vec![json!({ "role": "system", "content": system })];
    for m in normalized(msgs) {
        match m.role {
            Role::User => {
                // Tool results become `tool` messages, which must directly
                // follow the assistant message that asked for them.
                let mut content: Vec<Value> = Vec::new();
                for p in &m.parts {
                    match p {
                        Part::ToolResult { id, output, is_error } => {
                            let text = if *is_error && !output.starts_with("Error") { format!("Error: {output}") } else { output.clone() };
                            messages.push(json!({ "role": "tool", "tool_call_id": id, "content": text }));
                        }
                        Part::Text(t) => content.push(json!({ "type": "text", "text": t })),
                        Part::Image { mime, data } => {
                            content.push(json!({ "type": "image_url", "image_url": { "url": format!("data:{mime};base64,{data}") } }))
                        }
                        Part::Document { name, .. } => content
                            .push(json!({ "type": "text", "text": format!("[{name} is a PDF; this model cannot read PDFs, so ask the user to paste the text]") })),
                        Part::ToolCall { .. } => {}
                    }
                }
                if content.is_empty() {
                    continue;
                }
                let only_text = content.iter().all(|c| c["type"] == "text");
                let value = if only_text {
                    json!(content.iter().filter_map(|c| c["text"].as_str()).collect::<Vec<_>>().join("\n\n"))
                } else {
                    Value::Array(content)
                };
                messages.push(json!({ "role": "user", "content": value }));
            }
            Role::Assistant => {
                let text: String = m
                    .parts
                    .iter()
                    .filter_map(|p| if let Part::Text(t) = p { Some(t.as_str()) } else { None })
                    .collect::<Vec<_>>()
                    .join("\n\n");
                let calls: Vec<Value> = m
                    .parts
                    .iter()
                    .filter_map(|p| match p {
                        Part::ToolCall { id, name, input } => {
                            Some(json!({ "id": id, "type": "function", "function": { "name": name, "arguments": input.to_string() } }))
                        }
                        _ => None,
                    })
                    .collect();
                let mut msg = json!({ "role": "assistant", "content": if text.is_empty() { Value::Null } else { json!(text) } });
                if !calls.is_empty() {
                    msg["tool_calls"] = Value::Array(calls);
                }
                messages.push(msg);
            }
        }
    }
    let mut body = json!({ "model": model, "messages": messages, "stream": true });
    if !tools.is_empty() {
        body["tools"] = Value::Array(
            tools
                .iter()
                .map(|t| json!({ "type": "function", "function": { "name": t.name, "description": t.description, "parameters": t.schema } }))
                .collect(),
        );
    }
    body
}

// ---------------------------------------------------------------------------
// Server-Sent Events
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, PartialEq)]
pub struct SseEvent {
    pub event: Option<String>,
    pub data: String,
}

/// Incremental SSE parser. Network chunks may split lines and even UTF-8
/// characters anywhere; only complete lines are decoded.
#[derive(Default)]
pub struct SseParser {
    buf: Vec<u8>,
    event: Option<String>,
    data: Vec<String>,
}

impl SseParser {
    pub fn push(&mut self, bytes: &[u8]) -> Vec<SseEvent> {
        self.buf.extend_from_slice(bytes);
        let mut out = Vec::new();
        while let Some(nl) = self.buf.iter().position(|b| *b == b'\n') {
            let line: Vec<u8> = self.buf.drain(..=nl).collect();
            let line = String::from_utf8_lossy(&line);
            self.line(line.trim_end_matches(['\n', '\r']), &mut out);
        }
        out
    }

    /// Flush whatever is left when the stream ends.
    pub fn finish(&mut self) -> Vec<SseEvent> {
        let mut out = Vec::new();
        if !self.buf.is_empty() {
            let rest = String::from_utf8_lossy(&std::mem::take(&mut self.buf)).to_string();
            self.line(rest.trim_end_matches(['\n', '\r']), &mut out);
        }
        self.line("", &mut out);
        out
    }

    fn line(&mut self, line: &str, out: &mut Vec<SseEvent>) {
        if line.is_empty() {
            if !self.data.is_empty() {
                out.push(SseEvent { event: self.event.take(), data: self.data.join("\n") });
                self.data.clear();
            }
            self.event = None;
            return;
        }
        if line.starts_with(':') {
            return;
        }
        let (field, value) = match line.split_once(':') {
            Some((f, v)) => (f, v.strip_prefix(' ').unwrap_or(v)),
            None => (line, ""),
        };
        match field {
            "event" => self.event = Some(value.to_string()),
            "data" => self.data.push(value.to_string()),
            _ => {}
        }
    }
}

// ---------------------------------------------------------------------------
// Stream accumulators
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, PartialEq)]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub input: Value,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Turn {
    pub text: String,
    pub calls: Vec<ToolCall>,
    pub stop: Option<String>,
}

impl Turn {
    pub fn to_msg(&self) -> Msg {
        let mut parts = Vec::new();
        if !self.text.trim().is_empty() {
            parts.push(Part::Text(self.text.clone()));
        }
        for c in &self.calls {
            parts.push(Part::ToolCall { id: c.id.clone(), name: c.name.clone(), input: c.input.clone() });
        }
        Msg { role: Role::Assistant, parts }
    }
}

fn parse_args(raw: &str) -> Value {
    let raw = raw.trim();
    if raw.is_empty() {
        return json!({});
    }
    match serde_json::from_str::<Value>(raw) {
        Ok(Value::Object(o)) => Value::Object(o),
        // Some servers double-encode the arguments as a JSON string.
        Ok(Value::String(s)) => serde_json::from_str::<Value>(&s).ok().filter(Value::is_object).unwrap_or_else(|| json!({})),
        _ => json!({}),
    }
}

fn error_text(v: &Value) -> Option<String> {
    let e = v.get("error")?;
    Some(e.get("message").and_then(Value::as_str).map(str::to_string).unwrap_or_else(|| e.to_string()))
}

#[derive(Default)]
struct AnthropicBlock {
    kind: String,
    text: String,
    id: String,
    name: String,
    json: String,
}

#[derive(Default)]
pub struct AnthropicStream {
    blocks: BTreeMap<u64, AnthropicBlock>,
    stop: Option<String>,
}

impl AnthropicStream {
    /// Feeds one event; returns the text it adds.
    pub fn feed(&mut self, ev: &SseEvent) -> Result<Option<String>> {
        let Ok(v) = serde_json::from_str::<Value>(&ev.data) else { return Ok(None) };
        let index = v.get("index").and_then(Value::as_u64).unwrap_or(0);
        match v.get("type").and_then(Value::as_str).or(ev.event.as_deref()) {
            Some("content_block_start") => {
                let b = &v["content_block"];
                let block = AnthropicBlock {
                    kind: b["type"].as_str().unwrap_or("").to_string(),
                    text: b["text"].as_str().unwrap_or("").to_string(),
                    id: b["id"].as_str().unwrap_or("").to_string(),
                    name: b["name"].as_str().unwrap_or("").to_string(),
                    json: String::new(),
                };
                let first = (!block.text.is_empty()).then(|| block.text.clone());
                self.blocks.insert(index, block);
                Ok(first)
            }
            Some("content_block_delta") => {
                let d = &v["delta"];
                let block = self.blocks.entry(index).or_default();
                match d["type"].as_str() {
                    Some("text_delta") => {
                        let t = d["text"].as_str().unwrap_or("");
                        block.text.push_str(t);
                        Ok((!t.is_empty()).then(|| t.to_string()))
                    }
                    Some("input_json_delta") => {
                        block.json.push_str(d["partial_json"].as_str().unwrap_or(""));
                        Ok(None)
                    }
                    _ => Ok(None),
                }
            }
            Some("message_delta") => {
                if let Some(s) = v["delta"]["stop_reason"].as_str() {
                    self.stop = Some(s.to_string());
                }
                Ok(None)
            }
            Some("error") => bail!("{}", error_text(&v).unwrap_or_else(|| "the provider reported an error".into())),
            _ => Ok(None),
        }
    }

    /// A whole (non-streamed) Messages response.
    pub fn feed_whole(&mut self, v: &Value) -> Result<Option<String>> {
        if let Some(e) = error_text(v) {
            bail!("{e}");
        }
        for (i, b) in v["content"].as_array().into_iter().flatten().enumerate() {
            self.blocks.insert(
                i as u64,
                AnthropicBlock {
                    kind: b["type"].as_str().unwrap_or("").into(),
                    text: b["text"].as_str().unwrap_or("").into(),
                    id: b["id"].as_str().unwrap_or("").into(),
                    name: b["name"].as_str().unwrap_or("").into(),
                    json: if b["type"] == "tool_use" { b["input"].to_string() } else { String::new() },
                },
            );
        }
        self.stop = v["stop_reason"].as_str().map(str::to_string);
        let text: String = self.blocks.values().filter(|b| b.kind == "text").map(|b| b.text.as_str()).collect();
        Ok((!text.is_empty()).then_some(text))
    }

    pub fn finish(self) -> Turn {
        let mut turn = Turn { stop: self.stop, ..Default::default() };
        for b in self.blocks.into_values() {
            match b.kind.as_str() {
                "text" => turn.text.push_str(&b.text),
                "tool_use" => turn.calls.push(ToolCall { id: b.id, name: b.name, input: parse_args(&b.json) }),
                _ => {}
            }
        }
        turn
    }
}

#[derive(Default)]
struct OpenAiCall {
    id: String,
    name: String,
    args: String,
}

#[derive(Default)]
pub struct OpenAiStream {
    text: String,
    calls: Vec<OpenAiCall>,
    stop: Option<String>,
}

impl OpenAiStream {
    pub fn feed(&mut self, ev: &SseEvent) -> Result<Option<String>> {
        let data = ev.data.trim();
        if data.is_empty() || data == "[DONE]" {
            return Ok(None);
        }
        let Ok(v) = serde_json::from_str::<Value>(data) else { return Ok(None) };
        if let Some(e) = error_text(&v) {
            bail!("{e}");
        }
        let Some(choice) = v["choices"].as_array().and_then(|c| c.first()) else { return Ok(None) };
        if let Some(s) = choice["finish_reason"].as_str() {
            self.stop = Some(s.to_string());
        }
        let delta = if choice.get("delta").is_some() { &choice["delta"] } else { &choice["message"] };
        for tc in delta["tool_calls"].as_array().into_iter().flatten() {
            self.tool_delta(tc);
        }
        let t = delta["content"].as_str().unwrap_or("");
        if t.is_empty() {
            return Ok(None);
        }
        self.text.push_str(t);
        Ok(Some(t.to_string()))
    }

    fn tool_delta(&mut self, tc: &Value) {
        let id = tc["id"].as_str().unwrap_or("");
        let idx = match tc["index"].as_u64() {
            Some(i) => i as usize,
            None => self.calls.iter().position(|c| !id.is_empty() && c.id == id).unwrap_or(self.calls.len()),
        };
        while self.calls.len() <= idx {
            self.calls.push(OpenAiCall::default());
        }
        let call = &mut self.calls[idx];
        if !id.is_empty() {
            call.id = id.to_string();
        }
        let f = &tc["function"];
        if let Some(n) = f["name"].as_str() {
            if call.name.is_empty() {
                call.name = n.to_string();
            }
        }
        match &f["arguments"] {
            Value::String(s) => call.args.push_str(s),
            Value::Null => {}
            other => call.args.push_str(&other.to_string()),
        }
    }

    /// A whole (non-streamed) chat completion.
    pub fn feed_whole(&mut self, v: &Value) -> Result<Option<String>> {
        let ev = SseEvent { event: None, data: v.to_string() };
        self.feed(&ev)
    }

    pub fn finish(self) -> Turn {
        let calls = self
            .calls
            .into_iter()
            .enumerate()
            .filter(|(_, c)| !c.name.is_empty())
            .map(|(i, c)| ToolCall {
                id: if c.id.is_empty() { format!("call_{i}") } else { c.id },
                name: c.name,
                input: parse_args(&c.args),
            })
            .collect();
        Turn { text: self.text, calls, stop: self.stop }
    }
}

/// Either dialect's accumulator.
pub enum Stream {
    Anthropic(AnthropicStream),
    OpenAi(OpenAiStream),
}

impl Stream {
    pub fn new(d: Dialect) -> Self {
        match d {
            Dialect::Anthropic => Stream::Anthropic(AnthropicStream::default()),
            Dialect::OpenAi => Stream::OpenAi(OpenAiStream::default()),
        }
    }
    pub fn feed(&mut self, ev: &SseEvent) -> Result<Option<String>> {
        match self {
            Stream::Anthropic(s) => s.feed(ev),
            Stream::OpenAi(s) => s.feed(ev),
        }
    }
    pub fn feed_whole(&mut self, v: &Value) -> Result<Option<String>> {
        match self {
            Stream::Anthropic(s) => s.feed_whole(v),
            Stream::OpenAi(s) => s.feed_whole(v),
        }
    }
    pub fn finish(self) -> Turn {
        match self {
            Stream::Anthropic(s) => s.finish(),
            Stream::OpenAi(s) => s.finish(),
        }
    }
}

/// A short, readable message from an error body (never echoes headers).
pub fn error_message(body: &str) -> String {
    let msg = serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|v| {
            error_text(&v).or_else(|| v.get("message").and_then(Value::as_str).map(str::to_string)).or_else(|| {
                // Some servers wrap errors in an array.
                v.as_array().and_then(|a| a.first()).and_then(error_text)
            })
        })
        .unwrap_or_else(|| body.trim().to_string());
    let mut m: String = msg.chars().take(300).collect();
    if msg.chars().count() > 300 {
        m.push('\u{2026}');
    }
    m
}
