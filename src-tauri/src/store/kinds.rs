use super::*;

/// Every kind of resource Worlds keeps in the `pages` table.
/// `template` is a blueprint, not something the user browses as content.
pub const KINDS: &[&str] = &["page", "document", "presentation", "project", "gallery", "file", "stream", "template"];

/// A resource the user works with (anything but a template).
pub fn is_resource(kind: &str) -> bool {
    kind != "template" && KINDS.contains(&kind)
}

/// Kinds whose content is an ordered list of blocks.
pub fn has_blocks(kind: &str) -> bool {
    matches!(kind, "page" | "document" | "presentation" | "gallery" | "template")
}

pub fn validate_kind(kind: &str) -> Result<()> {
    if !KINDS.contains(&kind) {
        bail!("unknown resource kind: {kind} (expected one of {})", KINDS.join(", "));
    }
    Ok(())
}

/// Searchable text kept in metadata for kinds that have no blocks.
pub fn metadata_text(metadata: &Value) -> String {
    let mut out: Vec<&str> = Vec::new();
    for ptr in ["/stream/url", "/stream/description", "/project/description", "/project/status", "/doc/header", "/doc/footer"] {
        if let Some(s) = metadata.pointer(ptr).and_then(Value::as_str) {
            out.push(s);
        }
    }
    out.join("\n")
}
