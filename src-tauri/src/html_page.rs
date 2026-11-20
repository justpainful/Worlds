//! HTML pages (docs/HTML_PAGES.md): a page whose content is one HTML
//! document, checked against the rules before it is saved and served from
//! `whtml:` into a sandboxed frame, under the Worlds base stylesheet.

use crate::db::{self, now};
use crate::store::{self, Ctx};
use anyhow::{anyhow, bail, Result};
use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;
use serde_json::{json, Value};
use tauri::http::{header, Request, Response, StatusCode};

pub const KIND: &str = "html";
pub const MAX_SOURCE: usize = 1_000_000;
pub const MAX_STATE: usize = 256 * 1024;
pub const RULES: &str = include_str!("../../docs/HTML_PAGES.md");
const BASE_CSS: &str = include_str!("../../src/htmlpage/base.css");
const RUNTIME_JS: &str = include_str!("../../src/htmlpage/runtime.js");
/// The frame that runs code blocks (src/editor/runner.html).
const RUNNER_HTML: &str = include_str!("../../src/editor/runner.html");
/// Code blocks may run inline scripts, and Python may load Pyodide from its CDN.
/// The frame is sandboxed without same origin, so it cannot reach Worlds.
pub const RUNNER_CSP: &str = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' https://cdn.jsdelivr.net; style-src 'unsafe-inline'; img-src data: blob:; connect-src https://cdn.jsdelivr.net; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'";

/// The frame's own policy: inline code only, nothing from the network.
pub const CSP: &str =
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; \
font-src whtml: http://whtml.localhost https://whtml.localhost data:; connect-src 'none'; frame-src 'none'; object-src 'none'; \
form-action 'none'; base-uri 'none'";

/// What the rules found: errors refuse the save, warnings only inform.
#[derive(Debug, Default, Serialize, Clone, PartialEq)]
pub struct Check {
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
}

impl Check {
    pub fn ok(&self) -> bool {
        self.errors.is_empty()
    }
}

/// Opening tags of `name` in `lower`, each as the text up to its `>`.
fn tags<'a>(lower: &'a str, name: &str) -> Vec<&'a str> {
    let open = format!("<{name}");
    let mut out = Vec::new();
    let mut from = 0;
    while let Some(i) = lower[from..].find(&open) {
        let start = from + i;
        let after = start + open.len();
        let next = lower[after..].chars().next();
        if matches!(next, Some(c) if c.is_ascii_whitespace() || c == '>' || c == '/') {
            let end = lower[after..].find('>').map(|j| after + j + 1).unwrap_or(lower.len());
            out.push(&lower[start..end]);
            from = end;
        } else {
            from = after;
        }
    }
    out
}

/// The value of `attr` in one opening tag, quoted or not.
fn attr<'a>(tag: &'a str, attr: &str) -> Option<&'a str> {
    let bytes = tag.as_bytes();
    let mut from = 0;
    while let Some(i) = tag[from..].find(attr) {
        let start = from + i;
        let before = if start == 0 { b' ' } else { bytes[start - 1] };
        let rest = tag[start + attr.len()..].trim_start();
        if (before.is_ascii_whitespace() || before == b'<') && rest.starts_with('=') {
            let value = rest[1..].trim_start();
            return Some(match value.chars().next() {
                Some(q @ ('"' | '\'')) => value[1..].split(q).next().unwrap_or(""),
                _ => value.split(|c: char| c.is_ascii_whitespace() || c == '>').next().unwrap_or(""),
            });
        }
        from = start + attr.len();
    }
    None
}

fn remote(url: &str) -> bool {
    let u = url.trim();
    u.starts_with("http:") || u.starts_with("https:") || u.starts_with("//") || u.starts_with("ftp:")
}

/// Checks a page against the hard rules and the design rules.
pub fn check(source: &str) -> Check {
    let mut c = Check::default();
    if source.len() > MAX_SOURCE {
        c.errors.push(format!("The page is {} KB; the limit is {} KB.", source.len() / 1024, MAX_SOURCE / 1024));
        return c;
    }
    let lower = source.to_ascii_lowercase();
    for script in tags(&lower, "script") {
        if attr(script, "src").is_some() {
            c.errors.push("Scripts must be inline: remove <script src>, the page cannot load anything from the network.".into());
            break;
        }
    }
    for link in tags(&lower, "link") {
        if attr(link, "href").is_some_and(remote) {
            c.errors.push("Stylesheets and fonts must be inline: remove <link href> to a URL.".into());
            break;
        }
    }
    for name in ["img", "video", "audio", "source", "track", "image", "use", "input"] {
        if tags(&lower, name).iter().any(|t| ["src", "href", "xlink:href", "poster"].iter().any(|a| attr(t, a).is_some_and(remote))) {
            c.errors.push(format!("<{name}> points at a URL; use inline SVG or a data: URI instead."));
        }
    }
    for name in ["iframe", "frame", "frameset", "object", "embed", "base", "portal"] {
        if !tags(&lower, name).is_empty() {
            c.errors.push(format!("<{name}> is not allowed in an HTML page."));
        }
    }
    if tags(&lower, "meta").iter().any(|t| attr(t, "http-equiv").is_some()) {
        c.errors.push("<meta http-equiv> is not allowed: Worlds sets the page's policy.".into());
    }
    if tags(&lower, "form").iter().any(|t| attr(t, "action").is_some_and(|a| !a.trim().is_empty())) {
        c.errors.push("Forms cannot send anywhere: remove action and handle submit in a script.".into());
    }
    let css_url =
        |needle: &str| lower.match_indices(needle).any(|(i, _)| remote(lower[i + needle.len()..].trim_start_matches(['"', '\'', ' '])));
    if css_url("url(") || css_url("@import") {
        c.errors.push("CSS cannot load from a URL (url() or @import); inline the image as SVG or a data: URI.".into());
    }

    // Design rules: warnings.
    let hexes = count_hex_colours(&lower);
    if hexes > 12 {
        c.warnings.push(format!("{hexes} hard-coded colours: use --w-text, --w-surface, --w-accent and the other tokens instead."));
    }
    if lower.contains("100vh") || lower.contains("100dvh") {
        c.warnings.push("Avoid 100vh: the page grows with its content inside Worlds.".into());
    }
    if lower.contains("position:fixed") || lower.contains("position: fixed") {
        c.warnings.push("Avoid position: fixed; the page scrolls inside Worlds.".into());
    }
    if source.chars().any(|ch| ('\u{0600}'..='\u{06FF}').contains(&ch))
        && !lower.contains("dir=\"rtl\"")
        && !lower.contains("dir='rtl'")
        && !lower.contains("dir=rtl")
    {
        c.warnings.push("The page has Arabic text but no dir=\"rtl\": put lang=\"ar\" dir=\"rtl\" on <html>.".into());
    }
    if lower.contains("linear-gradient") || lower.contains("radial-gradient") {
        c.warnings.push("Gradients read as decoration in Worlds; keep surfaces flat unless the gradient carries data.".into());
    }
    c
}

fn count_hex_colours(lower: &str) -> usize {
    let bytes = lower.as_bytes();
    let mut n = 0;
    for (i, _) in lower.match_indices('#') {
        let run = bytes[i + 1..].iter().take_while(|b| b.is_ascii_hexdigit()).count();
        let prev = if i == 0 { b' ' } else { bytes[i - 1] };
        if matches!(run, 3 | 4 | 6 | 8) && matches!(prev, b':' | b' ' | b',' | b'(' | b'\n' | b'\t') {
            n += 1;
        }
    }
    n
}

/// The visible text, for search; it lives apart so the Apple store can share it.
pub use crate::html_text::plain_text;

/// The document the frame receives: the page's source with the Worlds base
/// stylesheet, the boot data and the runtime placed first in its head.
pub fn compose(source: &str, state: Option<&Value>, lang: &str) -> String {
    let lang = if lang == "ar" { "ar" } else { "en" };
    let boot = json!({ "state": state.cloned().unwrap_or(Value::Null), "lang": lang }).to_string().replace("</", "<\\/");
    let head = format!(
        "<meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\
<style data-worlds-base>{BASE_CSS}</style><script>window.__worldsBoot={boot};</script><script>{RUNTIME_JS}</script>"
    );
    let lower = source.to_ascii_lowercase();
    let dir_attrs = if lang == "ar" { " lang=\"ar\" dir=\"rtl\"" } else { " lang=\"en\"" };
    if let Some(h) = tags(&lower, "html").first().map(|t| lower.find(t).unwrap_or(0) + t.len()) {
        let html_tag = &lower[..h];
        let mut doc = String::with_capacity(source.len() + head.len() + 64);
        let has_lang = attr(&html_tag[html_tag.rfind("<html").unwrap_or(0)..], "lang").is_some();
        if has_lang {
            doc.push_str(&source[..h]);
        } else {
            // Give the page the app's language when it sets none.
            doc.push_str(&source[..h - 1]);
            doc.push_str(dir_attrs);
            doc.push('>');
        }
        match tags(&lower[h..], "head").first().map(|t| h + lower[h..].find(t).unwrap_or(0) + t.len()) {
            Some(after_head) => {
                doc.push_str(&source[h..after_head]);
                doc.push_str(&head);
                doc.push_str(&source[after_head..]);
            }
            None => {
                doc.push_str("<head>");
                doc.push_str(&head);
                doc.push_str("</head>");
                doc.push_str(&source[h..]);
            }
        }
        if !lower.trim_start().starts_with("<!doctype") {
            doc.insert_str(0, "<!doctype html>");
        }
        doc
    } else {
        format!("<!doctype html><html{dir_attrs}><head>{head}</head><body>{source}</body></html>")
    }
}

/// The page's HTML and saved state.
pub fn read(conn: &Connection, page_id: &str) -> Result<(String, Option<Value>)> {
    let (kind, metadata): (String, String) = conn
        .query_row("SELECT kind, metadata FROM pages WHERE id = ?1 AND deleted_at IS NULL", [page_id], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional()?
        .ok_or_else(|| anyhow!("page not found"))?;
    if kind != KIND {
        bail!("not an HTML page");
    }
    let meta: Value = serde_json::from_str(&metadata).unwrap_or(Value::Null);
    let source = meta.pointer("/html/source").and_then(Value::as_str).unwrap_or("").to_string();
    let state = meta.pointer("/html/state").filter(|v| !v.is_null()).cloned();
    Ok((source, state))
}

/// Saves new HTML after checking it. Claude's and automations' changes get a
/// version first (once per operation); a person's edits get one when the last
/// is more than ten minutes old, so the page's history can bring it back.
pub fn write(conn: &Connection, ctx: &Ctx, page_id: &str, source: &str) -> Result<Check> {
    crate::account::permissions::require(conn, page_id, crate::account::permissions::Level::Edit)?;
    let report = check(source);
    if !report.ok() {
        return Ok(report);
    }
    let (_, state) = read(conn, page_id)?;
    if ctx.actor == "user" {
        let last: Option<i64> =
            conn.query_row("SELECT MAX(created_at) FROM versions WHERE page_id = ?1", [page_id], |r| r.get(0)).optional()?.flatten();
        if last.map(|l| now() - l > 10 * 60 * 1000).unwrap_or(true) {
            store::snapshot(conn, page_id, "user", None, None)?;
        }
    } else {
        store::ensure_op_snapshot(conn, ctx, page_id)?;
        store::record(conn, ctx, Some(page_id), "edited", "Edited the HTML", None, None, None, json!({}))?;
    }
    store::set_page_meta(conn, ctx, page_id, "html", json!({ "source": source, "state": state }))?;
    Ok(report)
}

/// Keeps the JSON a page saved with `worlds.save()`. Needs edit access.
pub fn save_state(conn: &Connection, ctx: &Ctx, page_id: &str, state_json: &str) -> Result<()> {
    crate::account::permissions::require(conn, page_id, crate::account::permissions::Level::Edit)?;
    if state_json.len() > MAX_STATE {
        bail!("the page's state is larger than 256 KB");
    }
    let state: Value = serde_json::from_str(state_json)?;
    let (source, _) = read(conn, page_id)?;
    store::set_page_meta(conn, ctx, page_id, "html", json!({ "source": source, "state": state }))?;
    Ok(())
}

// ---- whtml: protocol --------------------------------------------------------

const FONTS: &[(&str, &[u8])] = &[
    ("instrument-sans.woff2", include_bytes!("../assets/htmlpage-fonts/instrument-sans.woff2")),
    ("plex-arabic-400.woff2", include_bytes!("../assets/htmlpage-fonts/plex-arabic-400.woff2")),
    ("plex-arabic-600.woff2", include_bytes!("../assets/htmlpage-fonts/plex-arabic-600.woff2")),
    ("plex-mono-500.woff2", include_bytes!("../assets/htmlpage-fonts/plex-mono-500.woff2")),
];

/// `whtml://localhost/page/<id>?lang=ar` and `/_w/fonts/<file>`.
pub fn serve(request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let empty = |status: StatusCode| Response::builder().status(status).body(Vec::new()).unwrap();
    let path = request.uri().path().trim_start_matches('/');
    if let Some(name) = path.strip_prefix("_w/fonts/") {
        return match FONTS.iter().find(|(n, _)| *n == name) {
            Some((_, bytes)) => Response::builder()
                .header(header::CONTENT_TYPE, "font/woff2")
                .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                .header(header::CACHE_CONTROL, "public, max-age=31536000, immutable")
                .body(bytes.to_vec())
                .unwrap(),
            None => empty(StatusCode::NOT_FOUND),
        };
    }
    if path == "_w/runner" {
        return Response::builder()
            .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
            .header("Content-Security-Policy", RUNNER_CSP)
            .header("X-Content-Type-Options", "nosniff")
            .header("Referrer-Policy", "no-referrer")
            .header(header::CACHE_CONTROL, "no-store")
            .body(RUNNER_HTML.as_bytes().to_vec())
            .unwrap();
    }
    let Some(id) =
        path.strip_prefix("page/").filter(|id| !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'))
    else {
        return empty(StatusCode::NOT_FOUND);
    };
    let lang = request.uri().query().unwrap_or("").split('&').any(|p| p == "lang=ar");
    let Ok(conn) = db::open(&db::db_path()) else { return empty(StatusCode::INTERNAL_SERVER_ERROR) };
    if crate::account::permissions::require(&conn, id, crate::account::permissions::Level::View).is_err() {
        return empty(StatusCode::NOT_FOUND);
    }
    match read(&conn, id) {
        Ok((source, state)) => document_response(compose(&source, state.as_ref(), if lang { "ar" } else { "en" })),
        Err(_) => empty(StatusCode::NOT_FOUND),
    }
}

pub fn document_response(doc: String) -> Response<Vec<u8>> {
    Response::builder()
        .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
        .header("Content-Security-Policy", CSP)
        .header("X-Content-Type-Options", "nosniff")
        .header("Referrer-Policy", "no-referrer")
        .header(header::CACHE_CONTROL, "no-store")
        .body(doc.into_bytes())
        .unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hard_rules_refuse_the_network_and_embedding() {
        for bad in [
            "<script src=\"https://cdn.example/a.js\"></script>",
            "<link rel=\"stylesheet\" href=\"//fonts.example/x.css\">",
            "<img src=\"http://example.com/a.png\">",
            "<style>body{background:url(https://example.com/a.png)}</style>",
            "<style>@import 'https://example.com/a.css';</style>",
            "<iframe src=\"about:blank\"></iframe>",
            "<object data=\"x\"></object>",
            "<base href=\"https://example.com/\">",
            "<meta http-equiv=\"refresh\" content=\"0;url=https://example.com\">",
            "<form action=\"https://example.com/post\"></form>",
        ] {
            assert!(!check(bad).ok(), "should refuse: {bad}");
        }
        let too_big = "a".repeat(MAX_SOURCE + 1);
        assert!(!check(&too_big).ok());
    }

    #[test]
    fn plain_pages_with_inline_code_and_links_pass() {
        let good = r#"<!doctype html><html lang="ar" dir="rtl"><head><style>.x{color:var(--w-accent)}</style></head>
<body><h1>الدرجات</h1><img src="data:image/png;base64,AAAA"><a href="https://example.com">رابط</a>
<script>document.querySelector('h1').dataset.ok = 1; worlds.save({a: 1});</script>
<form><input name="q"></form><div data-src="https://not-a-src.example"></div></body></html>"#;
        let c = check(good);
        assert!(c.ok(), "{:?}", c.errors);
        assert!(c.warnings.is_empty(), "{:?}", c.warnings);
    }

    #[test]
    fn design_rules_warn_without_refusing() {
        let c = check("<div style=\"height:100vh;position:fixed;background:linear-gradient(red,blue)\"><p>مرحبا</p></div>");
        assert!(c.ok());
        assert_eq!(c.warnings.len(), 4, "{:?}", c.warnings);
    }

    #[test]
    fn compose_puts_the_base_first_and_gives_the_app_language() {
        let fragment = compose("<p>Hello</p>", None, "ar");
        assert!(fragment.starts_with("<!doctype html><html lang=\"ar\" dir=\"rtl\">"));
        assert!(fragment.contains("data-worlds-base") && fragment.contains("window.worlds"));
        assert!(fragment.find("data-worlds-base").unwrap() < fragment.find("<p>Hello</p>").unwrap());

        let doc = compose(
            "<!DOCTYPE html><html lang=\"en\"><head><title>T</title><style>p{}</style></head><body><p>x</p></body></html>",
            Some(&json!({"n": 1})),
            "ar",
        );
        assert!(doc.contains("<html lang=\"en\">"), "the page's own language wins");
        let base = doc.find("data-worlds-base").unwrap();
        assert!(base > doc.find("<head>").unwrap() && base < doc.find("<title>").unwrap(), "base styles come before the page's own");
        assert!(doc.contains("\"state\":{\"n\":1}"));

        // Saved state cannot close the boot script.
        let sneaky = compose("<p>x</p>", Some(&json!("</script><script>alert(1)</script>")), "en");
        assert!(!sneaky.contains("</script><script>alert(1)"));
    }

    #[test]
    fn plain_text_drops_markup_scripts_and_styles() {
        let text = plain_text("<style>.a{}</style><h1>Grades &amp; notes</h1><script>var secret = 1;</script><p>Biology&nbsp;87</p>");
        assert_eq!(text, "Grades & notes Biology 87");
    }
}
