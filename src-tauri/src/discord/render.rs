//! Page blocks → Discord Components V2 message.
//!
//! The renderer understands block semantics: headings become Discord
//! headings, dividers become Separators, media become Media Galleries /
//! File components, a lone `[Label]` paragraph becomes a button, and
//! consecutive text blocks are grouped into one Text Display so the
//! 40-component budget is spent on structure, not prose.
//!
//! Component types (discord.com/developers/docs/components/reference):
//! 1 ActionRow · 2 Button · 9 Section · 10 TextDisplay · 11 Thumbnail ·
//! 12 MediaGallery · 13 File · 14 Separator · 17 Container.
//! Message flag IS_COMPONENTS_V2 = 1 << 15.

use super::bidi::{self, Dir};
use crate::content::{attr, attr_str, children, node_type};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

pub const IS_COMPONENTS_V2: u64 = 1 << 15;
pub const MAX_COMPONENTS: usize = 40;
pub const MAX_TEXT_CHARS: usize = 4000;
pub const MAX_FILE_BYTES: i64 = 10 * 1024 * 1024;

#[derive(Deserialize, Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct RenderOptions {
    /// Wrap in a Container (with accent bar).
    pub container: Option<bool>,
    /// 0xRRGGBB accent for the container.
    pub accent_color: Option<u32>,
    /// Container without an accent bar (overrides the profile default).
    pub no_accent: Option<bool>,
    /// Include the page title as a top heading.
    pub include_title: Option<bool>,
    /// Drop checked task items.
    pub hide_completed: Option<bool>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FileRef {
    pub attachment_id: String,
    pub name: String,
    pub size: i64,
    pub spoiler: bool,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Warning {
    pub level: &'static str, // "error" | "warn" | "info"
    pub message: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Rendered {
    /// JSON body for POST /channels/{id}/messages (without files).
    pub payload: Value,
    pub files: Vec<FileRef>,
    pub warnings: Vec<Warning>,
    pub component_count: usize,
    pub text_chars: usize,
}

/// Resolves attachment metadata and page titles while rendering.
pub trait Resolver {
    fn attachment(&self, id: &str) -> Option<(String, String, i64)>; // (name, mime, size)
    fn page_title(&self, id: &str) -> Option<String>;
}

struct Builder<'a> {
    resolver: &'a dyn Resolver,
    items: Vec<Value>,
    text: Vec<String>,
    files: Vec<FileRef>,
    warnings: Vec<Warning>,
    buttons: Vec<Value>,
}

impl<'a> Builder<'a> {
    fn flush_text(&mut self) {
        let joined = self.text.join("\n").trim_matches('\n').to_string();
        self.text.clear();
        if !joined.trim().is_empty() {
            self.items.push(json!({ "type": 10, "content": joined }));
        }
    }

    fn flush_buttons(&mut self) {
        if self.buttons.is_empty() {
            return;
        }
        self.flush_text();
        for chunk in std::mem::take(&mut self.buttons).chunks(5) {
            self.items.push(json!({ "type": 1, "components": chunk }));
        }
    }

    fn push_text(&mut self, s: String) {
        self.flush_buttons_if_any();
        self.text.push(s);
    }

    fn flush_buttons_if_any(&mut self) {
        if !self.buttons.is_empty() {
            self.flush_buttons();
        }
    }

    fn separator(&mut self, divider: bool) {
        self.flush_buttons();
        self.flush_text();
        // Avoid stacking separators.
        if self.items.last().map(|v| v["type"] == 14).unwrap_or(true) {
            return;
        }
        self.items.push(json!({ "type": 14, "divider": divider, "spacing": 1 }));
    }

    fn media(&mut self, node: &Value) {
        let Some(att) = attr_str(node, "attachmentId") else { return };
        let Some((name, mime, size)) = self.resolver.attachment(att) else {
            self.warnings.push(Warning { level: "warn", message: "An attachment on this page is missing and was skipped.".into() });
            return;
        };
        if size > MAX_FILE_BYTES {
            self.warnings.push(Warning { level: "error", message: format!("“{name}” is larger than Discord’s 10 MB upload limit.") });
        }
        let safe = sanitize_filename(&name, att);
        self.files.push(FileRef { attachment_id: att.to_string(), name: safe.clone(), size, spoiler: false });
        self.flush_buttons();
        self.flush_text();
        let caption = attr_str(node, "caption").filter(|c| !c.trim().is_empty());
        let is_visual = mime.starts_with("image/") || mime.starts_with("video/");
        if is_visual && node_type(node) != "file" {
            let mut item = json!({ "media": { "url": format!("attachment://{safe}") } });
            if let Some(c) = caption {
                item["description"] = json!(c.chars().take(1024).collect::<String>());
            }
            // Merge consecutive images into one gallery (max 10 items).
            if let Some(last) = self.items.last_mut() {
                if last["type"] == 12 && last["items"].as_array().map(|a| a.len() < 10).unwrap_or(false) {
                    last["items"].as_array_mut().unwrap().push(item);
                    return;
                }
            }
            self.items.push(json!({ "type": 12, "items": [item] }));
        } else {
            self.items.push(json!({ "type": 13, "file": { "url": format!("attachment://{safe}") } }));
            if let Some(c) = caption {
                self.text.push(format!("-# {c}"));
            }
        }
    }
}

fn sanitize_filename(name: &str, id: &str) -> String {
    let ext = std::path::Path::new(name).extension().and_then(|e| e.to_str()).unwrap_or("bin");
    let stem: String = std::path::Path::new(name)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("file")
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect();
    let stem = if stem.trim_matches('_').is_empty() { id[..8.min(id.len())].to_string() } else { stem };
    format!("{stem}.{}", ext.to_lowercase())
}

fn dir_of(node: &Value) -> Option<Dir> {
    match attr_str(node, "dir") {
        Some("rtl") => Some(Dir::Rtl),
        Some("ltr") => Some(Dir::Ltr),
        _ => None,
    }
}

/// Inline nodes → Discord markdown.
fn inline(nodes: &[Value], r: &dyn Resolver) -> String {
    let mut out = String::new();
    for n in nodes {
        match node_type(n) {
            "text" => {
                let raw = n.get("text").and_then(Value::as_str).unwrap_or("");
                let marks = n.get("marks").and_then(Value::as_array).cloned().unwrap_or_default();
                let is_code = marks.iter().any(|m| node_type(m) == "code");
                let mut s = if is_code { raw.replace('`', "ˋ") } else { escape_md(raw) };
                for m in marks.iter().rev() {
                    s = match node_type(m) {
                        "bold" => format!("**{s}**"),
                        "italic" => format!("*{s}*"),
                        "strike" => format!("~~{s}~~"),
                        "underline" => format!("__{s}__"),
                        "code" => format!("`{s}`"),
                        "highlight" => format!("**{s}**"),
                        "link" => match attr_str(m, "href") {
                            Some(h) if h.starts_with("http") => format!("[{s}]({h})"),
                            _ => s,
                        },
                        _ => s,
                    };
                }
                out.push_str(&s);
            }
            "hardBreak" => out.push('\n'),
            "pageMention" => {
                let title = attr_str(n, "id")
                    .and_then(|id| r.page_title(id))
                    .or_else(|| attr_str(n, "label").map(str::to_string))
                    .unwrap_or_default();
                out.push_str(&format!("**{}**", escape_md(&title)));
            }
            _ => out.push_str(&inline(children(n), r)),
        }
    }
    out
}

fn escape_md(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for ch in s.chars() {
        if matches!(ch, '*' | '_' | '~' | '|' | '`') {
            out.push('\\');
        }
        out.push(ch);
    }
    out
}

fn plain(nodes: &[Value]) -> String {
    let mut s = String::new();
    for n in nodes {
        match node_type(n) {
            "text" => s.push_str(n.get("text").and_then(Value::as_str).unwrap_or("")),
            "pageMention" => s.push_str(attr_str(n, "label").unwrap_or("")),
            _ => s.push_str(&plain(children(n))),
        }
    }
    s
}

/// `[Label]` alone → interactive acknowledge button (handled by the bridge
/// Worlds module); `[Label](https://…)` alone → link button.
fn as_button(p: &Value, index: usize) -> Option<Value> {
    let kids = children(p);
    // A paragraph that is exactly one labelled link → link button.
    if kids.len() == 1 && node_type(&kids[0]) == "text" {
        let marks = kids[0].get("marks").and_then(Value::as_array).cloned().unwrap_or_default();
        let label = kids[0].get("text").and_then(Value::as_str).unwrap_or("").trim().to_string();
        if marks.len() == 1 && node_type(&marks[0]) == "link" {
            if let Some(href) = attr_str(&marks[0], "href") {
                if href.starts_with("http") && label != href && !label.is_empty() && label.chars().count() <= 80 {
                    return Some(json!({ "type": 2, "style": 5, "label": label, "url": href }));
                }
            }
        }
    }
    // `[Label]` alone → acknowledge button, answered by the bridge module.
    let text = plain(kids);
    let t = text.trim();
    if t.chars().count() > 2 && t.starts_with('[') && t.ends_with(']') && !t[1..t.len() - 1].contains(['[', ']']) {
        let label: String = t[1..t.len() - 1].trim().chars().take(80).collect();
        if !label.is_empty() {
            return Some(json!({ "type": 2, "style": 1, "label": label, "custom_id": format!("worlds:ack:{index}") }));
        }
    }
    None
}

fn render_list(node: &Value, b: &mut Builder, depth: usize, opts: &RenderOptions) {
    let kind = node_type(node);
    for (i, li) in children(node).iter().enumerate() {
        let checked = attr(li, "checked").and_then(Value::as_bool).unwrap_or(false);
        if kind == "taskList" && checked && opts.hide_completed.unwrap_or(false) {
            continue;
        }
        let indent = "  ".repeat(depth);
        let marker = match kind {
            "orderedList" => format!("{}. ", attr(node, "start").and_then(Value::as_u64).unwrap_or(1) as usize + i),
            "taskList" => if checked { "☑ ".into() } else { "☐ ".into() },
            _ => "- ".into(),
        };
        for (k, c) in children(li).iter().enumerate() {
            match node_type(c) {
                "paragraph" => {
                    let mut t = inline(children(c), b.resolver);
                    if kind == "taskList" && checked {
                        t = format!("~~{t}~~");
                    }
                    let line = if k == 0 { format!("{indent}{marker}{t}") } else { format!("{indent}  {t}") };
                    let hint = dir_of(c);
                    b.push_text(bidi::normalize(&line, hint));
                }
                "bulletList" | "orderedList" | "taskList" => render_list(c, b, depth + 1, opts),
                _ => {}
            }
        }
    }
}

pub fn render_page(title: &str, blocks: &[Value], opts: &RenderOptions, resolver: &dyn Resolver) -> Rendered {
    let mut b = Builder {
        resolver,
        items: Vec::new(),
        text: Vec::new(),
        files: Vec::new(),
        warnings: Vec::new(),
        buttons: Vec::new(),
    };
    let first_is_h1 = blocks.first().map(|n| node_type(n) == "heading" && attr(n, "level").and_then(Value::as_u64) == Some(1)).unwrap_or(false);
    if opts.include_title.unwrap_or(true) && !title.trim().is_empty() && !first_is_h1 {
        b.push_text(bidi::normalize(&format!("# {}", escape_md(title.trim())), None));
    }

    // Layout containers (columns, toggles) send their blocks in reading order.
    fn flatten(nodes: &[Value], out: &mut Vec<Value>) {
        for n in nodes {
            match node_type(n) {
                "columns" | "column" | "toggle" => flatten(children(n), out),
                "collection" => {}
                _ => out.push(n.clone()),
            }
        }
    }
    let mut flat = Vec::with_capacity(blocks.len());
    flatten(blocks, &mut flat);

    for node in &flat {
        let hint = dir_of(node);
        match node_type(node) {
            "paragraph" => {
                if let Some(btn) = as_button(node, b.buttons.len() + b.items.iter().filter(|v| v["type"] == 1).count() * 5) {
                    b.flush_text();
                    b.buttons.push(btn);
                    continue;
                }
                let t = inline(children(node), resolver);
                if t.trim().is_empty() {
                    // Empty paragraphs act as spacing inside a text group.
                    if !b.text.is_empty() {
                        b.push_text(String::new());
                    }
                } else {
                    b.push_text(bidi::normalize(&t, hint));
                }
            }
            "heading" => {
                let level = attr(node, "level").and_then(Value::as_u64).unwrap_or(1).clamp(1, 3) as usize;
                let t = inline(children(node), resolver);
                if !t.trim().is_empty() {
                    b.push_text(bidi::normalize(&format!("{} {}", "#".repeat(level), t), hint));
                }
            }
            "bulletList" | "orderedList" | "taskList" => render_list(node, &mut b, 0, opts),
            "blockquote" => {
                for p in children(node) {
                    let t = inline(children(p), resolver);
                    b.push_text(bidi::normalize(&format!("> {t}"), dir_of(p).or(hint)));
                }
            }
            "callout" => {
                let glyph = match attr_str(node, "tone").unwrap_or("note") {
                    "warning" => "⚠️",
                    "success" => "✅",
                    "highlight" => "✨",
                    "danger" => "⛔",
                    _ => "💡",
                };
                for (i, p) in children(node).iter().enumerate() {
                    let t = inline(children(p), resolver);
                    let line = if i == 0 { format!("> {glyph} {t}") } else { format!("> {t}") };
                    b.push_text(bidi::normalize(&line, dir_of(p).or(hint)));
                }
            }
            "codeBlock" => {
                let lang = attr_str(node, "language").unwrap_or("");
                let code = plain(children(node)).replace("```", "ˋˋˋ");
                b.push_text(format!("```{lang}\n{code}\n```"));
            }
            "horizontalRule" => b.separator(true),
            "table" => {
                let rows = children(node);
                let headers: Vec<String> = rows.first().map(|r| children(r).iter().map(|c| plain(children(c)).trim().to_string()).collect()).unwrap_or_default();
                let has_header = rows.first().map(|r| children(r).iter().any(|c| node_type(c) == "tableHeader")).unwrap_or(false);
                let body = if has_header { &rows[1..] } else { rows };
                for row in body {
                    let cells: Vec<String> = children(row).iter().map(|c| inline(children(children(c).first().unwrap_or(&Value::Null)), resolver)).collect();
                    if cells.iter().all(|c| c.trim().is_empty()) {
                        continue;
                    }
                    let parts: Vec<String> = cells
                        .iter()
                        .enumerate()
                        .filter(|(_, c)| !c.trim().is_empty())
                        .map(|(i, c)| match headers.get(i).filter(|h| has_header && !h.is_empty()) {
                            Some(h) => format!("**{}** {}", escape_md(h), c.trim()),
                            None => c.trim().to_string(),
                        })
                        .collect();
                    b.push_text(bidi::normalize(&format!("- {}", parts.join(" · ")), hint));
                }
            }
            "image" | "video" | "file" => b.media(node),
            "pageLink" => {
                let title = attr_str(node, "pageId")
                    .and_then(|id| resolver.page_title(id))
                    .or_else(|| attr_str(node, "title").map(str::to_string))
                    .unwrap_or_default();
                b.push_text(bidi::normalize(&format!("↳ **{}**", escape_md(&title)), None));
            }
            "embed" => {
                if let Some(u) = attr_str(node, "url") {
                    b.push_text(u.to_string());
                }
            }
            "discordMessage" => {
                let content = attr_str(node, "content").unwrap_or("");
                for l in content.lines() {
                    b.push_text(bidi::normalize(&format!("> {l}"), None));
                }
                if let Some(u) = attr_str(node, "url") {
                    b.push_text(format!("-# {u}"));
                }
            }
            // Private / scheduling blocks never leave Worlds.
            "prompt" | "schedule" | "assistantInstructions" => {}
            _ => {
                let t = plain(children(node));
                if !t.trim().is_empty() {
                    b.push_text(bidi::normalize(&t, hint));
                }
            }
        }
    }
    b.flush_buttons();
    b.flush_text();

    // Drop leading/trailing separators.
    while b.items.last().map(|v| v["type"] == 14).unwrap_or(false) {
        b.items.pop();
    }
    while b.items.first().map(|v| v["type"] == 14).unwrap_or(false) {
        b.items.remove(0);
    }

    let mut warnings = std::mem::take(&mut b.warnings);
    let text_chars: usize = b.items.iter().filter(|v| v["type"] == 10).map(|v| v["content"].as_str().unwrap_or("").chars().count()).sum();

    // Split oversized text displays at line boundaries (each ≤ 4000); the
    // total still has to fit, which is reported below.
    let items: Vec<Value> = b
        .items
        .into_iter()
        .flat_map(|v| {
            if v["type"] == 10 {
                let s = v["content"].as_str().unwrap_or("").to_string();
                if s.chars().count() > MAX_TEXT_CHARS {
                    return chunk_lines(&s, MAX_TEXT_CHARS).into_iter().map(|c| json!({ "type": 10, "content": c })).collect::<Vec<_>>();
                }
            }
            vec![v]
        })
        .collect();

    let use_container = opts.container.unwrap_or(true);
    let top: Vec<Value> = if use_container {
        let mut c = json!({ "type": 17, "components": items });
        if let (Some(color), false) = (opts.accent_color, opts.no_accent.unwrap_or(false)) {
            c["accent_color"] = json!(color.min(0xFF_FF_FF));
        }
        vec![c]
    } else {
        items
    };

    let component_count = count_components(&top);
    if component_count > MAX_COMPONENTS {
        warnings.push(Warning { level: "error", message: format!("Uses {component_count} components; Discord allows {MAX_COMPONENTS}. Shorten the page or merge sections.") });
    }
    if text_chars > MAX_TEXT_CHARS {
        warnings.push(Warning { level: "error", message: format!("{text_chars} characters of text; Discord allows {MAX_TEXT_CHARS} per message.") });
    } else if text_chars > MAX_TEXT_CHARS * 9 / 10 {
        warnings.push(Warning { level: "warn", message: format!("{text_chars} of {MAX_TEXT_CHARS} characters used.") });
    }
    if top.is_empty() || (use_container && top[0]["components"].as_array().map(|a| a.is_empty()).unwrap_or(true)) {
        warnings.push(Warning { level: "error", message: "Nothing on this page can be sent to Discord yet.".into() });
    }
    if b.files.len() > 10 {
        warnings.push(Warning { level: "error", message: "Discord allows at most 10 attachments per message.".into() });
    }

    Rendered {
        payload: json!({
            "flags": IS_COMPONENTS_V2,
            "components": top,
            "allowed_mentions": { "parse": [] },
        }),
        files: b.files,
        warnings,
        component_count,
        text_chars,
    }
}

fn chunk_lines(s: &str, max: usize) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    for line in s.split('\n') {
        if cur.chars().count() + line.chars().count() + 1 > max && !cur.is_empty() {
            out.push(std::mem::take(&mut cur));
        }
        if !cur.is_empty() {
            cur.push('\n');
        }
        cur.push_str(line);
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out
}

pub fn count_components(list: &[Value]) -> usize {
    list.iter()
        .map(|c| {
            1 + c.get("components").and_then(Value::as_array).map(|a| count_components(a)).unwrap_or(0)
                + c.get("accessory").map(|a| count_components(std::slice::from_ref(a))).unwrap_or(0)
        })
        .sum()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::content::from_markdown;

    struct R;
    impl Resolver for R {
        fn attachment(&self, _: &str) -> Option<(String, String, i64)> { None }
        fn page_title(&self, _: &str) -> Option<String> { None }
    }

    #[test]
    fn meeting_page() {
        let md = "# Administrative Meeting\n\nTime\n8:00 PM\n\n## Topics\n\n- Store\n- Server\n- Staff\n\n[Confirm Attendance]";
        let blocks = from_markdown(md);
        let r = render_page("Administrative Meeting", &blocks, &RenderOptions::default(), &R);
        let c = &r.payload["components"][0];
        assert_eq!(c["type"], 17);
        let inner = c["components"].as_array().unwrap();
        assert_eq!(inner[0]["type"], 10);
        let text = inner[0]["content"].as_str().unwrap();
        assert!(text.starts_with("# Administrative Meeting"));
        assert!(text.contains("## Topics"));
        assert!(text.contains("- Store"));
        assert_eq!(inner.last().unwrap()["type"], 1);
        assert_eq!(inner.last().unwrap()["components"][0]["label"], "Confirm Attendance");
        assert!(r.warnings.is_empty(), "{:?}", r.warnings);
    }
}
