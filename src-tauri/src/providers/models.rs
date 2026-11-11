//! Model lists and local model servers.
//!
//! Cloud providers list models from `/v1/models` (Anthropic) or `/models`
//! (OpenAI compatible). Ollama lists installed models with `/api/tags` and
//! reports tool support per model with `/api/show`; LM Studio reports it with
//! `/api/v0/models`. llama.cpp does not say, so its tool support is learned
//! on the first request.

use super::agent::{connect_error, http_error, trim_base, Endpoint};
use super::wire::Dialect;
use super::Preset;
use anyhow::Result;
use serde::Serialize;
use serde_json::{json, Value};
use std::time::Duration;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub id: String,
    pub name: String,
    /// Whether the model can call tools; None when the server does not say.
    pub tools: Option<bool>,
}

fn model(id: &str, name: Option<&str>, tools: Option<bool>) -> ModelInfo {
    ModelInfo { id: id.to_string(), name: name.filter(|n| !n.is_empty()).unwrap_or(id).to_string(), tools }
}

fn data_array(v: &Value) -> Vec<Value> {
    v.get("data").or_else(|| v.get("models")).unwrap_or(v).as_array().cloned().unwrap_or_default()
}

pub fn parse_anthropic(v: &Value) -> Vec<ModelInfo> {
    data_array(v).iter().filter_map(|m| Some(model(m["id"].as_str()?, m["display_name"].as_str(), Some(true)))).collect()
}

/// Ids that are clearly not chat models.
fn not_chat(id: &str) -> bool {
    let id = id.to_lowercase();
    ["embed", "whisper", "tts", "dall-e", "moderation", "transcribe", "realtime", "audio", "image", "rerank", "guard"].iter().any(|k| id.contains(k))
}

pub fn parse_openai(v: &Value) -> Vec<ModelInfo> {
    let mut out: Vec<ModelInfo> = data_array(v)
        .iter()
        .filter_map(|m| {
            let raw = m["id"].as_str()?;
            let id = raw.strip_prefix("models/").unwrap_or(raw);
            if not_chat(id) {
                return None;
            }
            let tools = m["supported_parameters"].as_array().map(|p| p.iter().any(|x| x == "tools"));
            Some(model(id, m["name"].as_str().or(m["display_name"].as_str()), tools))
        })
        .collect();
    out.sort_by(|a, b| a.id.cmp(&b.id));
    out.dedup_by(|a, b| a.id == b.id);
    out
}

pub fn parse_ollama_tags(v: &Value) -> Vec<String> {
    data_array(v).iter().filter_map(|m| m["name"].as_str().or(m["model"].as_str()).map(str::to_string)).collect()
}

/// Ollama `/api/show` capabilities: Some(true) when "tools" is listed.
pub fn parse_ollama_show(v: &Value) -> Option<bool> {
    v["capabilities"].as_array().map(|c| c.iter().any(|x| x == "tools"))
}

pub fn parse_lmstudio(v: &Value) -> Vec<ModelInfo> {
    data_array(v)
        .iter()
        .filter(|m| m["type"].as_str() != Some("embeddings"))
        .filter_map(|m| {
            let tools = m["capabilities"].as_array().map(|c| c.iter().any(|x| x == "tool_use"));
            Some(model(m["id"].as_str()?, None, tools))
        })
        .collect()
}

/// `http://localhost:11434/v1` becomes `http://localhost:11434`.
pub fn server_root(base: &str) -> String {
    let b = trim_base(base);
    b.strip_suffix("/v1").map(str::to_string).unwrap_or(b)
}

async fn get_json(client: &reqwest::Client, ep: &Endpoint, url: &str, timeout: Duration) -> Result<Value> {
    let resp = ep.authorize(client.get(url)).timeout(timeout).send().await.map_err(|e| connect_error(&ep.label, e))?;
    let status = resp.status().as_u16();
    let text = resp.text().await.map_err(|e| connect_error(&ep.label, e))?;
    if !(200..300).contains(&status) {
        return Err(http_error(&ep.label, status, &text));
    }
    serde_json::from_str(&text).map_err(|_| anyhow::anyhow!("{} sent a model list Worlds cannot read.", ep.label))
}

/// Tool support of one Ollama model (None when unknown).
pub async fn ollama_tools(client: &reqwest::Client, base: &str, model_id: &str) -> Option<bool> {
    let url = format!("{}/api/show", server_root(base));
    let resp = client.post(url).json(&json!({ "model": model_id })).timeout(Duration::from_secs(3)).send().await.ok()?;
    let v: Value = resp.json().await.ok()?;
    parse_ollama_show(&v)
}

pub async fn list(client: &reqwest::Client, preset: &Preset, base: &str, key: Option<String>, timeout: Duration) -> Result<Vec<ModelInfo>> {
    let ep = Endpoint { dialect: preset.dialect(), base: base.to_string(), key, model: String::new(), provider: preset.id.clone(), label: preset.name.clone() };
    let base = trim_base(base);
    match (preset.dialect(), preset.id.as_str()) {
        (Dialect::Anthropic, _) => {
            let url = if base.ends_with("/v1") { format!("{base}/models?limit=100") } else { format!("{base}/v1/models?limit=100") };
            Ok(parse_anthropic(&get_json(client, &ep, &url, timeout).await?))
        }
        (_, "ollama") => {
            let names = parse_ollama_tags(&get_json(client, &ep, &format!("{}/api/tags", server_root(&base)), timeout).await?);
            let mut out = Vec::new();
            for n in names.into_iter().take(60) {
                let tools = ollama_tools(client, &base, &n).await;
                out.push(model(&n, None, tools));
            }
            Ok(out)
        }
        (_, "lmstudio") => match get_json(client, &ep, &format!("{}/api/v0/models", server_root(&base)), timeout).await {
            Ok(v) => Ok(parse_lmstudio(&v)),
            Err(_) => Ok(parse_openai(&get_json(client, &ep, &format!("{base}/models"), timeout).await?)),
        },
        _ => Ok(parse_openai(&get_json(client, &ep, &format!("{base}/models"), timeout).await?)),
    }
}
