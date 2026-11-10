use super::*;

/// Every kind of resource Worlds keeps in the `pages` table.
/// `template` is a blueprint, not something the user browses as content.
///
/// The last groups are *planning* kinds (tasks, events, inbox captures, goals)
/// and the optional Study pack (subjects, lessons, assignments, exams,
/// requirements). They live in the same table so they get history, trash,
/// search and sync for free; the interface decides where they are shown and
/// hides a pack's kinds entirely while that pack is turned off.
pub const KINDS: &[&str] = &[
    "page", "document", "presentation", "drawing", "spreadsheet", "project", "gallery", "file", "stream", "template",
    // Planning (for everyone)
    "task", "event", "inbox", "goal",
    // Study pack (opt-in)
    "subject", "lesson", "assignment", "exam", "requirement",
];

/// Kinds whose data lives under `metadata.<kind>` and is carried on every
/// page row (`PageMeta.data`) so list views never have to open each one.
pub const DATA_KINDS: &[&str] = &["task", "event", "inbox", "goal", "subject", "lesson", "assignment", "exam", "requirement"];

/// A resource the user works with (anything but a template).
pub fn is_resource(kind: &str) -> bool {
    kind != "template" && KINDS.contains(&kind)
}

/// Kinds whose content is an ordered list of blocks.
pub fn has_blocks(kind: &str) -> bool {
    matches!(kind, "page" | "document" | "presentation" | "gallery" | "template" | "lesson")
}

pub fn validate_kind(kind: &str) -> Result<()> {
    if !KINDS.contains(&kind) {
        bail!("unknown resource kind: {kind} (expected one of {})", KINDS.join(", "));
    }
    Ok(())
}

/// Metadata keys that hold searchable text.
pub const TEXT_POINTERS: &[&str] = &[
    "/stream/url",
    "/stream/description",
    "/project/description",
    "/project/status",
    "/doc/header",
    "/doc/footer",
    "/experiment/description",
    "/task/notes",
    "/event/location",
    "/event/notes",
    "/inbox/text",
    "/goal/detail",
    "/subject/teacher",
    "/subject/room",
    "/subject/code",
    "/lesson/unit",
    "/assignment/teacher",
    "/assignment/instructions",
    "/exam/scope",
    "/exam/location",
    "/requirement/action",
];

/// Searchable text kept in metadata for kinds that have no blocks.
pub fn metadata_text(metadata: &Value) -> String {
    let mut out: Vec<&str> = Vec::new();
    for ptr in TEXT_POINTERS {
        if let Some(s) = metadata.pointer(ptr).and_then(Value::as_str) {
            out.push(s);
        }
    }
    if let Some(sheets) = metadata.pointer("/sheet/sheets").and_then(Value::as_array) {
        for sh in sheets {
            if let Some(name) = sh.get("name").and_then(Value::as_str) {
                out.push(name);
            }
            if let Some(cells) = sh.get("cells").and_then(Value::as_object) {
                for cell in cells.values() {
                    if let Some(v) = cell.get("v").and_then(Value::as_str) {
                        if !v.is_empty() {
                            out.push(v);
                        }
                    }
                    if let Some(note) = cell.get("note").and_then(Value::as_str) {
                        if !note.is_empty() {
                            out.push(note);
                        }
                    }
                }
            }
        }
    }
    out.join("\n")
}

/// Whether writing `key` into metadata changes what search sees.
pub fn key_is_indexed(key: &str) -> bool {
    key == "sheet" || TEXT_POINTERS.iter().any(|p| p[1..].split('/').next() == Some(key))
}
