//! An HTML page's visible text (docs/HTML_PAGES.md), for search. Kept free of
//! Tauri so Apple/RustStore, which includes the store, indexes pages the same way.

/// The visible text, for search: no tags, scripts or styles.
pub fn plain_text(source: &str) -> String {
    let lower = source.to_ascii_lowercase();
    let mut out = String::with_capacity(source.len() / 2);
    let mut i = 0;
    while i < source.len() {
        let rest = &lower[i..];
        if rest.starts_with("<script") || rest.starts_with("<style") {
            let close = if rest.starts_with("<script") { "</script" } else { "</style" };
            i = rest.find(close).map(|j| i + j + close.len()).unwrap_or(source.len());
            i = lower[i..].find('>').map(|j| i + j + 1).unwrap_or(source.len());
            out.push(' ');
            continue;
        }
        if rest.starts_with('<') {
            i = rest.find('>').map(|j| i + j + 1).unwrap_or(source.len());
            out.push(' ');
            continue;
        }
        let next = rest.find('<').map(|j| i + j).unwrap_or(source.len());
        out.push_str(&source[i..next]);
        i = next;
    }
    let decoded = out.replace("&nbsp;", " ").replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"");
    decoded.split_whitespace().collect::<Vec<_>>().join(" ")
}
