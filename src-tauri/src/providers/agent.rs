//! Worlds' own tool loop for API providers: send the conversation and the
//! Worlds tool definitions, run the tool calls the model asks for, send the
//! results back, and repeat until the model answers.

use super::wire::{self, Dialect, Msg, Part, Role, SseParser, Stream, ToolDef, Turn};
use anyhow::{anyhow, bail, Result};
use serde_json::{json, Value};
use std::future::Future;
use std::pin::Pin;

/// Most model turns one request may take before Worlds stops it.
pub const MAX_TURNS: usize = 24;
const ANTHROPIC_MAX_TOKENS: u32 = 8192;

/// Where and how to send a request. The key is only ever put in a header.
#[derive(Clone)]
pub struct Endpoint {
    pub dialect: Dialect,
    pub base: String,
    pub key: Option<String>,
    pub model: String,
    /// Provider id (for provider specific headers).
    pub provider: String,
    /// Provider name shown in messages.
    pub label: String,
}

impl std::fmt::Debug for Endpoint {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Endpoint")
            .field("dialect", &self.dialect)
            .field("base", &self.base)
            .field("key", &self.key.as_ref().map(|_| "<set>"))
            .field("model", &self.model)
            .finish()
    }
}

pub fn trim_base(base: &str) -> String {
    base.trim().trim_end_matches('/').to_string()
}

impl Endpoint {
    pub fn chat_url(&self) -> String {
        let base = trim_base(&self.base);
        match self.dialect {
            Dialect::Anthropic if base.ends_with("/v1") => format!("{base}/messages"),
            Dialect::Anthropic => format!("{base}/v1/messages"),
            Dialect::OpenAi => format!("{base}/chat/completions"),
        }
    }

    pub fn body(&self, system: &str, msgs: &[Msg], tools: &[ToolDef]) -> Value {
        match self.dialect {
            Dialect::Anthropic => wire::anthropic_request(&self.model, system, msgs, tools, ANTHROPIC_MAX_TOKENS),
            Dialect::OpenAi => wire::openai_request(&self.model, system, msgs, tools),
        }
    }

    /// Adds the provider's auth headers.
    pub fn authorize(&self, req: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        let key = self.key.as_deref().filter(|k| !k.is_empty());
        let req = match self.dialect {
            Dialect::Anthropic => {
                let r = req.header("anthropic-version", "2023-06-01");
                match key {
                    Some(k) => r.header("x-api-key", k),
                    None => r,
                }
            }
            Dialect::OpenAi => match key {
                Some(k) => req.bearer_auth(k),
                None => req,
            },
        };
        if self.provider == "openrouter" {
            req.header("X-Title", "Worlds")
        } else {
            req
        }
    }
}

/// What the loop reports while it runs.
#[derive(Clone, Debug, PartialEq)]
pub enum LoopEvent {
    /// Streamed answer text.
    Delta(String),
    /// A tool call is about to run.
    Tool { name: String, input: Value },
    ToolResult { name: String, error: bool },
    /// Something the user should know (for example: chat only).
    Note(String),
}

pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// Runs Worlds tools. Returns the tool's text output and whether it failed.
pub trait ToolHost: Send {
    fn call<'a>(&'a mut self, name: &'a str, input: &'a Value) -> BoxFuture<'a, (String, bool)>;
}

#[derive(Debug, Default)]
pub struct Outcome {
    pub text: String,
    pub steps: Vec<Value>,
    pub turns: usize,
    pub chat_only: bool,
}

pub const CHAT_ONLY_NOTE: &str = "This model cannot use Worlds tools, so it can chat but cannot read or change your pages.";

/// The server rejected the request because the model has no tool support.
pub fn no_tool_support(status: u16, body: &str) -> bool {
    if !(400..=500).contains(&status) {
        return false;
    }
    let b = body.to_lowercase();
    (b.contains("tool") || b.contains("function"))
        && ["not support", "unsupported", "--jinja", "not enabled", "not available", "does not have"].iter().any(|k| b.contains(k))
}

/// A readable error for a failed provider request. Never includes the key.
pub fn http_error(provider: &str, status: u16, body: &str) -> anyhow::Error {
    let detail = wire::error_message(body);
    match status {
        401 | 403 => anyhow!("provider_auth: {provider} did not accept the API key ({status}). Check it in Settings, Providers. {detail}"),
        404 => anyhow!("{provider} could not find that model or address (404). {detail}"),
        429 => anyhow!("{provider} is rate limiting or out of credit (429). {detail}"),
        _ => anyhow!("{provider} returned an error ({status}). {detail}"),
    }
}

pub fn connect_error(provider: &str, e: reqwest::Error) -> anyhow::Error {
    if e.is_connect() {
        anyhow!("Could not reach {provider}. Check that it is running and the address in Settings, Providers is right.")
    } else if e.is_timeout() {
        anyhow!("{provider} did not answer in time.")
    } else {
        // reqwest's text includes the URL, never headers.
        anyhow!("Could not talk to {provider}: {}", e.without_url())
    }
}

/// One model turn: send, stream deltas to `sink`, return the finished turn.
/// `Ok(None)` means the model refused the tools (the caller retries without).
async fn one_turn(
    client: &reqwest::Client,
    ep: &Endpoint,
    body: &Value,
    with_tools: bool,
    sink: &mut (dyn FnMut(LoopEvent) + Send),
) -> Result<Option<Turn>> {
    let req = ep.authorize(client.post(ep.chat_url()).json(body));
    let mut resp = req.send().await.map_err(|e| connect_error(&ep.label, e))?;
    let status = resp.status().as_u16();
    if !(200..300).contains(&status) {
        let text = resp.text().await.unwrap_or_default();
        if with_tools && no_tool_support(status, &text) {
            return Ok(None);
        }
        return Err(http_error(&ep.label, status, &text));
    }
    let mut stream = Stream::new(ep.dialect);
    let is_json = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.contains("application/json"));
    if is_json {
        // A server that ignored `stream: true`.
        let v: Value = resp.json().await.map_err(|e| anyhow!("{} sent an unreadable answer: {}", ep.label, e.without_url()))?;
        if let Some(t) = stream.feed_whole(&v)? {
            sink(LoopEvent::Delta(t));
        }
        return Ok(Some(stream.finish()));
    }
    let mut sse = SseParser::default();
    while let Some(chunk) = resp.chunk().await.map_err(|e| connect_error(&ep.label, e))? {
        for ev in sse.push(&chunk) {
            if let Some(t) = stream.feed(&ev)? {
                sink(LoopEvent::Delta(t));
            }
        }
    }
    for ev in sse.finish() {
        if let Some(t) = stream.feed(&ev)? {
            sink(LoopEvent::Delta(t));
        }
    }
    Ok(Some(stream.finish()))
}

/// The tool loop. `tools_supported` is what the model list said (None when
/// unknown); a model that turns out not to support tools continues as chat.
pub struct Job<'a> {
    pub system: &'a str,
    /// Earlier turns plus the new user message, oldest first.
    pub messages: Vec<Msg>,
    pub tools: &'a [ToolDef],
    pub tools_supported: Option<bool>,
}

pub async fn run(
    client: &reqwest::Client,
    ep: &Endpoint,
    job: Job<'_>,
    host: &mut dyn ToolHost,
    sink: &mut (dyn FnMut(LoopEvent) + Send),
) -> Result<Outcome> {
    let Job { system, messages: mut msgs, tools, tools_supported } = job;
    let mut out = Outcome::default();
    let mut use_tools = !tools.is_empty() && tools_supported != Some(false);
    if !tools.is_empty() && !use_tools {
        out.chat_only = true;
        sink(LoopEvent::Note(CHAT_ONLY_NOTE.into()));
    }
    let mut texts: Vec<String> = Vec::new();
    let mut said_anything = false;
    while out.turns < MAX_TURNS {
        let offered: &[ToolDef] = if use_tools { tools } else { &[] };
        let body = ep.body(system, &msgs, offered);
        let Some(turn) = one_turn(client, ep, &body, use_tools, &mut *sink).await? else {
            use_tools = false;
            out.chat_only = true;
            sink(LoopEvent::Note(CHAT_ONLY_NOTE.into()));
            continue;
        };
        out.turns += 1;
        if !turn.text.trim().is_empty() {
            said_anything = true;
            texts.push(turn.text.trim().to_string());
        }
        msgs.push(turn.to_msg());
        if turn.calls.is_empty() {
            break;
        }
        let mut results = Vec::new();
        for call in &turn.calls {
            sink(LoopEvent::Tool { name: call.name.clone(), input: call.input.clone() });
            let (output, error) = if tools.iter().any(|t| t.name == call.name) {
                host.call(&call.name, &call.input).await
            } else {
                (format!("Error: there is no tool named {}", call.name), true)
            };
            out.steps.push(json!({ "tool": call.name, "ok": !error }));
            sink(LoopEvent::ToolResult { name: call.name.clone(), error });
            results.push(Part::ToolResult { id: call.id.clone(), output, is_error: error });
        }
        msgs.push(Msg { role: Role::User, parts: results });
        if said_anything {
            sink(LoopEvent::Delta("\n\n".into()));
        }
        if out.turns >= MAX_TURNS {
            bail!("Stopped after {MAX_TURNS} steps without a final answer. Ask again with a smaller request.");
        }
    }
    // The last thing the model said is the answer; earlier narration is kept
    // only when the last turn said nothing.
    out.text = texts.last().cloned().unwrap_or_default();
    if out.text.is_empty() && !texts.is_empty() {
        out.text = texts.join("\n\n");
    }
    Ok(out)
}

/// Tools every provider gets first when a provider limits how many tools it
/// accepts (OpenAI style servers take at most 128; small local models do
/// better with fewer).
pub const CORE_TOOLS: &[&str] = &[
    "workspace_overview",
    "time_now",
    "search_everything",
    "pages_search",
    "pages_list",
    "pages_tree",
    "pages_read",
    "pages_export_markdown",
    "pages_create",
    "pages_rename",
    "pages_move",
    "pages_replace_content",
    "pages_append_markdown",
    "pages_delete",
    "blocks_read",
    "blocks_insert",
    "blocks_update",
    "blocks_delete",
    "tasks_list",
    "tasks_add",
    "tasks_set",
    "tables_read",
    "tables_append_row",
    "references_resolve",
    "pages_set_properties",
    "pages_set_icon",
    "templates_list",
    "templates_instantiate",
    "chats_search",
    "chats_read",
    "history_read",
    "history_undo",
];

/// Picked tools first, then the core set, then the rest, up to `limit`.
pub fn select_tools(all: &[ToolDef], picked: &[String], limit: usize) -> Vec<ToolDef> {
    if all.len() <= limit {
        return all.to_vec();
    }
    let mut out: Vec<ToolDef> = Vec::new();
    let add = |t: &ToolDef, out: &mut Vec<ToolDef>| {
        if out.len() < limit && !out.iter().any(|o| o.name == t.name) {
            out.push(t.clone());
        }
    };
    for name in picked {
        if let Some(t) = all.iter().find(|t| &t.name == name) {
            add(t, &mut out);
        }
    }
    for name in CORE_TOOLS {
        if let Some(t) = all.iter().find(|t| t.name == *name) {
            add(t, &mut out);
        }
    }
    for t in all {
        add(t, &mut out);
    }
    out
}

/// Earlier messages of a chat as plain text turns, newest kept within budget.
pub fn history_from_rows(rows: &[(String, String, bool)], max_messages: usize, max_chars: usize) -> Vec<Msg> {
    let mut msgs: Vec<Msg> = rows
        .iter()
        .filter(|(_, content, is_error)| !is_error && !content.trim().is_empty())
        .map(|(role, content, _)| if role == "user" { Msg::user_text(content.clone()) } else { Msg::assistant_text(content.clone()) })
        .collect();
    if msgs.len() > max_messages {
        msgs.drain(..msgs.len() - max_messages);
    }
    let size = |m: &Msg| m.parts.iter().map(|p| if let Part::Text(t) = p { t.chars().count() } else { 0 }).sum::<usize>();
    let mut total: usize = msgs.iter().map(size).sum();
    while total > max_chars && msgs.len() > 1 {
        total -= size(&msgs[0]);
        msgs.remove(0);
    }
    msgs
}
