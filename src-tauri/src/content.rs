//! Structured content helpers.
//!
//! A block is one top-level ProseMirror node (JSON) with a stable `bid`
//! attribute. This module converts between those nodes and plain text /
//! a constrained Markdown dialect used by the AI tools and templates.

use serde_json::{json, Map, Value};

pub fn node_type(node: &Value) -> &str {
    node.get("type").and_then(Value::as_str).unwrap_or("paragraph")
}

pub fn attr<'a>(node: &'a Value, key: &str) -> Option<&'a Value> {
    node.get("attrs").and_then(|a| a.get(key))
}

pub fn attr_str<'a>(node: &'a Value, key: &str) -> Option<&'a str> {
    attr(node, key).and_then(Value::as_str)
}

pub fn children(node: &Value) -> &[Value] {
    node.get("content").and_then(Value::as_array).map(|v| v.as_slice()).unwrap_or(&[])
}

pub fn set_block_id(node: &mut Value, id: &str) {
    if let Some(obj) = node.as_object_mut() {
        let attrs = obj.entry("attrs").or_insert_with(|| Value::Object(Map::new()));
        if let Some(a) = attrs.as_object_mut() {
            a.insert("bid".into(), Value::String(id.to_string()));
        }
    }
}

/// Plain text of a node, used for search and previews. Inline nodes are
/// concatenated; block children are separated by newlines.
pub fn plain_text(node: &Value) -> String {
    let mut out = String::new();
    collect_text(node, &mut out);
    out.trim().to_string()
}

fn collect_text(node: &Value, out: &mut String) {
    match node_type(node) {
        "text" => out.push_str(node.get("text").and_then(Value::as_str).unwrap_or("")),
        "hardBreak" => out.push('\n'),
        "pageMention" => {
            out.push('@');
            out.push_str(attr_str(node, "label").unwrap_or(""));
        }
        "image" | "video" | "file" => {
            if let Some(c) = attr_str(node, "caption") {
                out.push_str(c);
            }
            if let Some(n) = attr_str(node, "name") {
                if !out.is_empty() {
                    out.push(' ');
                }
                out.push_str(n);
            }
        }
        "pageLink" => out.push_str(attr_str(node, "title").unwrap_or("")),
        "embed" => out.push_str(attr_str(node, "url").unwrap_or("")),
        "discordMessage" => out.push_str(attr_str(node, "content").unwrap_or("")),
        _ => {
            let kids = children(node);
            let block_kids = kids.iter().any(|k| is_block_type(node_type(k)));
            for (i, k) in kids.iter().enumerate() {
                if block_kids && i > 0 {
                    out.push('\n');
                }
                collect_text(k, out);
            }
        }
    }
}

fn is_block_type(t: &str) -> bool {
    !matches!(t, "text" | "hardBreak" | "pageMention")
}

/// Walk a node and collect page references: (target_page_id, kind).
pub fn collect_refs(node: &Value, out: &mut Vec<(String, &'static str)>) {
    match node_type(node) {
        "pageMention" => {
            if let Some(id) = attr_str(node, "id") {
                out.push((id.to_string(), "mention"));
            }
        }
        "pageLink" => {
            if let Some(id) = attr_str(node, "pageId") {
                out.push((id.to_string(), "link"));
            }
        }
        _ => {}
    }
    for k in children(node) {
        collect_refs(k, out);
    }
}

/// Resolved direction of a text: first strong character wins.
pub fn detect_direction(text: &str) -> &'static str {
    for ch in text.chars() {
        match unicode_bidi::bidi_class(ch) {
            unicode_bidi::BidiClass::L => return "ltr",
            unicode_bidi::BidiClass::R | unicode_bidi::BidiClass::AL => return "rtl",
            _ => {}
        }
    }
    "auto"
}

// ---------------------------------------------------------------------------
// Markdown (constrained dialect) → nodes
// ---------------------------------------------------------------------------

pub fn text_node(text: &str, marks: &[Value]) -> Value {
    if marks.is_empty() {
        json!({ "type": "text", "text": text })
    } else {
        json!({ "type": "text", "text": text, "marks": marks })
    }
}

pub fn paragraph(inline: Vec<Value>) -> Value {
    if inline.is_empty() {
        json!({ "type": "paragraph" })
    } else {
        json!({ "type": "paragraph", "content": inline })
    }
}

/// Parse inline markdown: **bold**, *italic*, `code`, ~~strike~~, ==highlight==,
/// [label](url), @[Title](page:ID).
pub fn parse_inline(src: &str) -> Vec<Value> {
    let mut out: Vec<Value> = Vec::new();
    let mut buf = String::new();
    let chars: Vec<char> = src.chars().collect();
    let mut i = 0;
    let flush = |buf: &mut String, out: &mut Vec<Value>| {
        if !buf.is_empty() {
            out.push(text_node(buf, &[]));
            buf.clear();
        }
    };
    let find = |from: usize, pat: &str| -> Option<usize> {
        let p: Vec<char> = pat.chars().collect();
        (from..chars.len().saturating_sub(p.len() - 1)).find(|&j| chars[j..j + p.len()] == p[..])
    };
    while i < chars.len() {
        let rest = &chars[i..];
        let starts = |s: &str| {
            let p: Vec<char> = s.chars().collect();
            rest.len() >= p.len() && rest[..p.len()] == p[..]
        };
        // page mention
        if starts("@[") {
            if let Some(close) = find(i + 2, "](page:") {
                if let Some(end) = find(close + 7, ")") {
                    flush(&mut buf, &mut out);
                    let label: String = chars[i + 2..close].iter().collect();
                    let id: String = chars[close + 7..end].iter().collect();
                    out.push(json!({ "type": "pageMention", "attrs": { "id": id, "label": label } }));
                    i = end + 1;
                    continue;
                }
            }
        }
        if starts("[") {
            if let Some(close) = find(i + 1, "](") {
                if let Some(end) = find(close + 2, ")") {
                    let label: String = chars[i + 1..close].iter().collect();
                    let href: String = chars[close + 2..end].iter().collect();
                    if !label.is_empty() && !href.contains(' ') {
                        flush(&mut buf, &mut out);
                        out.push(text_node(&label, &[json!({ "type": "link", "attrs": { "href": href } })]));
                        i = end + 1;
                        continue;
                    }
                }
            }
        }
        let pairs: [(&str, &str); 5] = [("**", "bold"), ("~~", "strike"), ("==", "highlight"), ("`", "code"), ("*", "italic")];
        let mut matched = false;
        for (delim, mark) in pairs {
            if starts(delim) {
                let dl = delim.chars().count();
                if let Some(end) = find(i + dl, delim) {
                    if end > i + dl {
                        flush(&mut buf, &mut out);
                        let inner: String = chars[i + dl..end].iter().collect();
                        let m = json!({ "type": mark });
                        if mark == "code" {
                            out.push(text_node(&inner, &[m]));
                        } else {
                            for mut n in parse_inline(&inner) {
                                add_mark(&mut n, m.clone());
                                out.push(n);
                            }
                        }
                        i = end + dl;
                        matched = true;
                        break;
                    }
                }
            }
        }
        if matched {
            continue;
        }
        buf.push(chars[i]);
        i += 1;
    }
    flush(&mut buf, &mut out);
    out
}

fn add_mark(node: &mut Value, mark: Value) {
    if node_type(node) != "text" {
        return;
    }
    let obj = node.as_object_mut().unwrap();
    let marks = obj.entry("marks").or_insert_with(|| json!([]));
    marks.as_array_mut().unwrap().push(mark);
}

/// Parse a markdown document into top-level block nodes.
pub fn from_markdown(src: &str) -> Vec<Value> {
    let lines: Vec<&str> = src.lines().collect();
    let mut blocks: Vec<Value> = Vec::new();
    let mut i = 0;
    let mut para: Vec<String> = Vec::new();

    fn flush_para(para: &mut Vec<String>, blocks: &mut Vec<Value>) {
        if !para.is_empty() {
            let mut inline = Vec::new();
            for (n, line) in para.iter().enumerate() {
                if n > 0 {
                    inline.push(json!({ "type": "hardBreak" }));
                }
                inline.extend(parse_inline(line));
            }
            blocks.push(paragraph(inline));
            para.clear();
        }
    }

    while i < lines.len() {
        let raw = lines[i];
        let line = raw.trim_end();
        let t = line.trim_start();

        if t.is_empty() {
            flush_para(&mut para, &mut blocks);
            i += 1;
            continue;
        }
        // fenced code
        if let Some(lang) = t.strip_prefix("```") {
            flush_para(&mut para, &mut blocks);
            let mut code = Vec::new();
            i += 1;
            while i < lines.len() && !lines[i].trim_start().starts_with("```") {
                code.push(lines[i]);
                i += 1;
            }
            i += 1;
            let text = code.join("\n");
            let mut node = json!({ "type": "codeBlock", "attrs": { "language": lang.trim() } });
            if !text.is_empty() {
                node["content"] = json!([text_node(&text, &[])]);
            }
            blocks.push(node);
            continue;
        }
        if t == "---" || t == "***" {
            flush_para(&mut para, &mut blocks);
            blocks.push(json!({ "type": "horizontalRule" }));
            i += 1;
            continue;
        }
        if let Some((level, rest)) = heading(t) {
            flush_para(&mut para, &mut blocks);
            let mut node = json!({ "type": "heading", "attrs": { "level": level } });
            let inline = parse_inline(rest);
            if !inline.is_empty() {
                node["content"] = Value::Array(inline);
            }
            blocks.push(node);
            i += 1;
            continue;
        }
        // callouts / prompt / quote
        if t.starts_with('>') {
            flush_para(&mut para, &mut blocks);
            let mut body: Vec<String> = Vec::new();
            while i < lines.len() && lines[i].trim_start().starts_with('>') {
                let l = lines[i].trim_start().trim_start_matches('>');
                body.push(l.strip_prefix(' ').unwrap_or(l).to_string());
                i += 1;
            }
            let first = body.first().cloned().unwrap_or_default();
            if let Some(tag_end) = first.strip_prefix("[!").and_then(|s| s.find(']')) {
                let tag = first[2..2 + tag_end].to_lowercase();
                let after = first[2 + tag_end + 1..].trim().to_string();
                let mut rest: Vec<String> = Vec::new();
                if !after.is_empty() {
                    rest.push(after);
                }
                rest.extend(body.into_iter().skip(1));
                let paras: Vec<Value> = rest.iter().map(|l| paragraph(parse_inline(l))).collect();
                let paras = if paras.is_empty() { vec![paragraph(vec![])] } else { paras };
                if tag == "prompt" {
                    blocks.push(json!({ "type": "prompt", "attrs": { "label": "Prompt" }, "content": paras }));
                } else {
                    blocks.push(json!({ "type": "callout", "attrs": { "tone": tag }, "content": paras }));
                }
            } else {
                let paras: Vec<Value> = body.iter().map(|l| paragraph(parse_inline(l))).collect();
                blocks.push(json!({ "type": "blockquote", "content": paras }));
            }
            continue;
        }
        // tables
        if t.starts_with('|') {
            flush_para(&mut para, &mut blocks);
            let mut rows: Vec<Vec<String>> = Vec::new();
            while i < lines.len() && lines[i].trim_start().starts_with('|') {
                let row = lines[i].trim();
                let cells: Vec<String> = row.trim_matches('|').split('|').map(|c| c.trim().to_string()).collect();
                let is_sep = cells.iter().all(|c| !c.is_empty() && c.chars().all(|ch| ch == '-' || ch == ':'));
                if !is_sep {
                    rows.push(cells);
                }
                i += 1;
            }
            let table_rows: Vec<Value> = rows
                .iter()
                .enumerate()
                .map(|(r, cells)| {
                    let cell_type = if r == 0 { "tableHeader" } else { "tableCell" };
                    json!({
                        "type": "tableRow",
                        "content": cells.iter().map(|c| json!({
                            "type": cell_type,
                            "content": [paragraph(parse_inline(c))]
                        })).collect::<Vec<_>>()
                    })
                })
                .collect();
            blocks.push(json!({ "type": "table", "content": table_rows }));
            continue;
        }
        // lists
        if let Some(kind) = list_kind(t) {
            flush_para(&mut para, &mut blocks);
            let mut items: Vec<Value> = Vec::new();
            while i < lines.len() {
                let l = lines[i].trim_start();
                if list_kind(l) != Some(kind) {
                    break;
                }
                let (checked, text) = list_item_text(l, kind);
                let p = paragraph(parse_inline(text));
                items.push(match kind {
                    "taskList" => json!({ "type": "taskItem", "attrs": { "checked": checked }, "content": [p] }),
                    _ => json!({ "type": "listItem", "content": [p] }),
                });
                i += 1;
            }
            blocks.push(json!({ "type": kind, "content": items }));
            continue;
        }
        para.push(t.to_string());
        i += 1;
    }
    flush_para(&mut para, &mut blocks);
    blocks
}

fn heading(t: &str) -> Option<(u8, &str)> {
    for (prefix, level) in [("### ", 3u8), ("## ", 2), ("# ", 1)] {
        if let Some(rest) = t.strip_prefix(prefix) {
            return Some((level, rest));
        }
    }
    None
}

// Empty items ("- ", "- [ ] ") are accepted with or without the trailing
// space, since editors and sync tools routinely strip trailing whitespace.
fn list_kind(t: &str) -> Option<&'static str> {
    for p in ["- [ ]", "- [x]", "- [X]"] {
        if t == p || t.starts_with(&format!("{p} ")) {
            return Some("taskList");
        }
    }
    if t == "-" || t == "*" || t.starts_with("- ") || t.starts_with("* ") {
        return Some("bulletList");
    }
    let digits = t.chars().take_while(|c| c.is_ascii_digit()).count();
    if digits > 0 && (t[digits..] == *"." || t[digits..].starts_with(". ")) {
        return Some("orderedList");
    }
    None
}

fn list_item_text<'a>(t: &'a str, kind: &str) -> (bool, &'a str) {
    let rest = |n: usize| t.get(n..).unwrap_or("");
    match kind {
        "taskList" => (t[3..4].eq_ignore_ascii_case("x"), rest(6)),
        "bulletList" => (false, rest(2)),
        _ => {
            let digits = t.chars().take_while(|c| c.is_ascii_digit()).count();
            (false, rest(digits + 2))
        }
    }
}

// ---------------------------------------------------------------------------
// nodes → markdown
// ---------------------------------------------------------------------------

pub fn inline_markdown(nodes: &[Value]) -> String {
    let mut out = String::new();
    for n in nodes {
        match node_type(n) {
            "text" => {
                let mut s = n.get("text").and_then(Value::as_str).unwrap_or("").to_string();
                let marks = n.get("marks").and_then(Value::as_array).cloned().unwrap_or_default();
                for m in marks.iter().rev() {
                    s = match node_type(m) {
                        "bold" => format!("**{s}**"),
                        "italic" => format!("*{s}*"),
                        "strike" => format!("~~{s}~~"),
                        "code" => format!("`{s}`"),
                        "highlight" => format!("=={s}=="),
                        "link" => format!("[{s}]({})", attr_str(m, "href").unwrap_or("")),
                        _ => s,
                    };
                }
                out.push_str(&s);
            }
            "hardBreak" => out.push('\n'),
            "pageMention" => out.push_str(&format!("@[{}](page:{})", attr_str(n, "label").unwrap_or(""), attr_str(n, "id").unwrap_or(""))),
            _ => out.push_str(&inline_markdown(children(n))),
        }
    }
    out
}

pub fn to_markdown(node: &Value) -> String {
    let kids = children(node);
    match node_type(node) {
        "paragraph" => inline_markdown(kids),
        "heading" => {
            let level = attr(node, "level").and_then(Value::as_u64).unwrap_or(1).clamp(1, 3) as usize;
            format!("{} {}", "#".repeat(level), inline_markdown(kids))
        }
        "bulletList" => kids.iter().map(|li| format!("- {}", item_md(li))).collect::<Vec<_>>().join("\n"),
        "orderedList" => kids.iter().enumerate().map(|(i, li)| format!("{}. {}", i + 1, item_md(li))).collect::<Vec<_>>().join("\n"),
        "taskList" => kids
            .iter()
            .map(|li| {
                let c = attr(li, "checked").and_then(Value::as_bool).unwrap_or(false);
                format!("- [{}] {}", if c { "x" } else { " " }, item_md(li))
            })
            .collect::<Vec<_>>()
            .join("\n"),
        "blockquote" => kids.iter().map(|p| format!("> {}", to_markdown(p))).collect::<Vec<_>>().join("\n"),
        "callout" => {
            let tone = attr_str(node, "tone").unwrap_or("note");
            let body: Vec<String> = kids.iter().map(to_markdown).collect();
            format!("> [!{tone}] {}", body.join("\n> "))
        }
        "prompt" => {
            let body: Vec<String> = kids.iter().map(to_markdown).collect();
            format!("> [!prompt] {}", body.join("\n> "))
        }
        "codeBlock" => format!("```{}\n{}\n```", attr_str(node, "language").unwrap_or(""), plain_text(node)),
        "horizontalRule" => "---".into(),
        "table" => {
            let mut lines = Vec::new();
            for (r, row) in kids.iter().enumerate() {
                let cells: Vec<String> = children(row).iter().map(|c| plain_text(c).replace('|', "\\|")).collect();
                lines.push(format!("| {} |", cells.join(" | ")));
                if r == 0 {
                    lines.push(format!("|{}|", vec!["---"; cells.len()].join("|")));
                }
            }
            lines.join("\n")
        }
        "image" => format!("[image: {}]", attr_str(node, "caption").or(attr_str(node, "name")).unwrap_or("")),
        "video" => format!("[video: {}]", attr_str(node, "caption").or(attr_str(node, "name")).unwrap_or("")),
        "file" => format!("[file: {}]", attr_str(node, "name").unwrap_or("")),
        "pageLink" => format!("[subpage: @[{}](page:{})]", attr_str(node, "title").unwrap_or(""), attr_str(node, "pageId").unwrap_or("")),
        "embed" => format!("[embed: {}]", attr_str(node, "url").unwrap_or("")),
        "discordMessage" => format!("[discord message: {}]", attr_str(node, "content").unwrap_or("")),
        "schedule" => format!("[schedule: {}]", attr_str(node, "automationId").unwrap_or("")),
        // Layout containers: their blocks read in order.
        "columns" | "column" => kids.iter().map(to_markdown).filter(|s| !s.is_empty()).collect::<Vec<_>>().join(
            "

",
        ),
        "toggle" => {
            let mut it = kids.iter();
            let head = it.next().map(to_markdown).unwrap_or_default();
            let body: Vec<String> = it.map(to_markdown).collect();
            if body.is_empty() {
                format!("> [!toggle] {head}")
            } else {
                format!(
                    "> [!toggle] {head}
> {}",
                    body.join(
                        "
> "
                    )
                )
            }
        }
        "toc" => "[table of contents]".into(),
        "gallery" => format!("[gallery: {} pictures]", attr(node, "images").and_then(Value::as_array).map(|a| a.len()).unwrap_or(0)),
        "collection" => format!(
            "[collection: {} ({}, {} view)]",
            attr_str(node, "title").filter(|t| !t.is_empty()).unwrap_or("pages"),
            attr_str(node, "source").unwrap_or("children"),
            attr_str(node, "view").unwrap_or("table")
        ),
        _ => plain_text(node),
    }
}

fn item_md(li: &Value) -> String {
    children(li)
        .iter()
        .map(|c| match node_type(c) {
            "paragraph" => inline_markdown(children(c)),
            _ => to_markdown(c).lines().map(|l| format!("  {l}")).collect::<Vec<_>>().join("\n"),
        })
        .collect::<Vec<_>>()
        .join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_basics() {
        let md = "# Title\n\nHello **world** and @[Nova8](page:abc).\n\n- [ ] one\n- [x] two\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n> [!note] careful";
        let blocks = from_markdown(md);
        assert_eq!(blocks.len(), 5);
        assert_eq!(node_type(&blocks[0]), "heading");
        let mut refs = Vec::new();
        collect_refs(&blocks[1], &mut refs);
        assert_eq!(refs, vec![("abc".to_string(), "mention")]);
        assert_eq!(to_markdown(&blocks[2]), "- [ ] one\n- [x] two");
        assert_eq!(node_type(&blocks[4]), "callout");
    }

    #[test]
    fn direction() {
        assert_eq!(detect_direction("حدثنا Nova8 إلى v2.4.1."), "rtl");
        assert_eq!(detect_direction("2026 Release"), "ltr");
    }
}
