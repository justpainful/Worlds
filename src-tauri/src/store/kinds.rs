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
    "page",
    "document",
    "presentation",
    "drawing",
    "spreadsheet",
    "project",
    "gallery",
    "file",
    "stream",
    "template",
    // Planning (for everyone)
    "task",
    "event",
    "inbox",
    "goal",
    // Study pack (opt-in)
    "subject",
    "lesson",
    "assignment",
    "exam",
    "requirement",
];

/// Kinds whose data lives under `metadata.<kind>` and is carried on every
/// page row (`PageMeta.data`) so list views never have to open each one.
pub const DATA_KINDS: &[&str] = &["task", "event", "inbox", "goal", "subject", "lesson", "assignment", "exam", "requirement"];

/// Where a pack kind keeps its fields: `metadata.item`, the same key for every
/// pack, so a new sector needs no change here (docs/PACKS.md).
pub const PACK_DATA_KEY: &str = "item";

/// A kind defined by a pack, written `pack.kind` (for example `freelance.invoice`):
/// two lowercase ASCII names of letters and digits joined by one dot.
pub fn is_pack_kind(kind: &str) -> bool {
    let name = |s: &str| {
        let mut chars = s.chars();
        matches!(chars.next(), Some(c) if c.is_ascii_lowercase()) && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
    };
    kind.len() <= 64 && matches!(kind.split_once('.'), Some((pack, item)) if name(pack) && name(item))
}

/// A metadata key that holds a kind's data object (`task`, `subject`, `item`, ...).
pub fn is_data_key(key: &str) -> bool {
    DATA_KINDS.contains(&key) || key == PACK_DATA_KEY
}

/// A resource the user works with (anything but a template).
pub fn is_resource(kind: &str) -> bool {
    kind != "template" && (KINDS.contains(&kind) || is_pack_kind(kind))
}

/// Kinds whose content is an ordered list of blocks. A pack item can carry
/// notes under its fields.
pub fn has_blocks(kind: &str) -> bool {
    matches!(kind, "page" | "document" | "presentation" | "gallery" | "template" | "lesson") || is_pack_kind(kind)
}

pub fn validate_kind(kind: &str) -> Result<()> {
    if !KINDS.contains(&kind) && !is_pack_kind(kind) {
        bail!("unknown resource kind: {kind} (expected one of {}, or a pack kind such as freelance.invoice)", KINDS.join(", "));
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
    // A pack item's text fields are searchable whatever the pack calls them.
    if let Some(item) = metadata.get(PACK_DATA_KEY).and_then(Value::as_object) {
        for v in item.values() {
            match v {
                Value::String(s) if !s.is_empty() => out.push(s),
                Value::Array(list) => out.extend(list.iter().filter_map(Value::as_str).filter(|s| !s.is_empty())),
                _ => {}
            }
        }
    }
    out.join("\n")
}

/// Whether writing `key` into metadata changes what search sees.
pub fn key_is_indexed(key: &str) -> bool {
    key == "sheet" || key == PACK_DATA_KEY || TEXT_POINTERS.iter().any(|p| p[1..].split('/').next() == Some(key))
}
