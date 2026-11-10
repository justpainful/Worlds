//! Structural preflight for future personal-template work.
//! This report is NOT authorization to instantiate: content, references,
//! drawing permits, copied assets and destination semantics remain unverified.
use anyhow::{bail, Result};
use rusqlite::{params, Connection, TransactionBehavior};
use std::collections::HashSet;
use std::path::Path;

const MAX_PAGES: usize = 2_000;
const MAX_DEPTH: usize = 64;
const MAX_BLOCKS: usize = 100_000;
const MAX_METADATA_BYTES: usize = 4 * 1024 * 1024;

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct TemplatePreflight {
    pub pages: usize,
    pub blocks: usize,
    pub attachment_records: usize,
    pub drawing_pages: usize,
    /// Any nonempty data needs reference- and schema-aware inspection.
    pub requires_content_review: bool,
}

/// Operates on a single consistent read snapshot. Callers must repeat the
/// checks in the eventual write transaction; this report is never a permit.
pub(crate) fn inspect(path: &Path, root: &str, destination: Option<&str>) -> Result<TemplatePreflight> {
    let mut connection = super::open_existing(path)?;
    let tx = connection.transaction_with_behavior(TransactionBehavior::Deferred)?;
    let report = inspect_in_snapshot(&tx, root, destination)?;
    tx.commit()?;
    Ok(report)
}

fn inspect_in_snapshot(c: &Connection, root: &str, destination: Option<&str>) -> Result<TemplatePreflight> {
    if root.is_empty() || root.contains('\0') { bail!("invalid template id") }
    super::require_personal(c, root)?;
    let kind: String = c.query_row("SELECT kind FROM pages WHERE id=?1", [root], |r| r.get(0))?;
    if kind != "template" { bail!("not a template") }
    if let Some(parent) = destination {
        if parent.is_empty() || parent.contains('\0') { bail!("invalid destination") }
        super::require_personal(c, parent)?;
    }
    let mut pending = vec![(root.to_owned(), 0usize)];
    let mut seen = HashSet::new();
    let mut report = TemplatePreflight { pages: 0, blocks: 0, attachment_records: 0, drawing_pages: 0, requires_content_review: false };
    while let Some((id, depth)) = pending.pop() {
        if depth > MAX_DEPTH || !seen.insert(id.clone()) || seen.len() > MAX_PAGES { bail!("template tree exceeds bounds or contains a cycle") }
        super::require_personal(c, &id)?;
        if destination == Some(id.as_str()) { bail!("destination is inside source template") }
        let (kind, raw): (String, String) = c.query_row("SELECT kind,metadata FROM pages WHERE id=?1", [&id], |r| Ok((r.get(0)?, r.get(1)?)))?;
        if raw.len() > MAX_METADATA_BYTES { bail!("template metadata exceeds bounds") }
        let metadata: serde_json::Value = serde_json::from_str(&raw)?;
        if kind == "drawing" || metadata.get("templateResourceKind").and_then(|v| v.as_str()) == Some("drawing") { report.drawing_pages += 1; }
        // Reference semantics can live in any extension key, not only a
        // known attachmentId. Do not interpret this as a safe-to-copy flag.
        report.requires_content_review |= metadata.as_object().is_some_and(|m| !m.is_empty());
        let count: i64 = c.query_row("SELECT count(*) FROM blocks WHERE page_id=?1", [&id], |r| r.get(0))?;
        let assets: i64 = c.query_row("SELECT count(*) FROM attachments WHERE page_id=?1", [&id], |r| r.get(0))?;
        report.blocks = report.blocks.checked_add(usize::try_from(count)?).ok_or_else(|| anyhow::anyhow!("block count overflow"))?;
        if report.blocks > MAX_BLOCKS { bail!("template blocks exceed bounds") }
        report.attachment_records = report.attachment_records.checked_add(usize::try_from(assets)?).ok_or_else(|| anyhow::anyhow!("attachment count overflow"))?;
        report.requires_content_review |= count != 0 || assets != 0;
        report.pages += 1;
        let mut stmt = c.prepare("SELECT id FROM pages WHERE parent_id=?1 AND deleted_at IS NULL ORDER BY sort_key")?;
        let children = stmt.query_map(params![id], |r| r.get::<_, String>(0))?;
        for child in children {
            // Bound before collecting an arbitrarily large list.
            if pending.len() + seen.len() >= MAX_PAGES { bail!("template tree exceeds bounds") }
            pending.push((child?, depth + 1));
        }
    }
    Ok(report)
}

/// Conservatively rejects known unsafe references. This is still not a permit:
/// unrecognized extension formats and drawing authorization remain unresolved.
pub(crate) fn inspect_known_references(path: &Path, root: &str, destination: Option<&str>) -> Result<()> {
    let mut connection = super::open_existing(path)?;
    let tx = connection.transaction_with_behavior(TransactionBehavior::Deferred)?;
    inspect_in_snapshot(&tx, root, destination)?;
    let mut pending = vec![root.to_owned()];
    let mut seen = HashSet::new();
    while let Some(id) = pending.pop() {
        if !seen.insert(id.clone()) { bail!("template tree contains a cycle") }
        let mut children = tx.prepare("SELECT id FROM pages WHERE parent_id=?1 AND deleted_at IS NULL")?;
        for child in children.query_map([&id], |r| r.get::<_, String>(0))? { pending.push(child?); }
    }
    let attachments_root = path.parent().ok_or_else(|| anyhow::anyhow!("invalid database path"))?.join("attachments");
    for page in &seen {
        super::require_personal(&tx, page)?;
        let (kind, metadata): (String, String) = tx.query_row("SELECT kind,metadata FROM pages WHERE id=?1", [page], |r| Ok((r.get(0)?,r.get(1)?)))?;
        let metadata: serde_json::Value = serde_json::from_str(&metadata)?;
        if kind == "drawing" || metadata.get("templateResourceKind").and_then(|x|x.as_str()) == Some("drawing") {
            bail!("drawing copy authorization unavailable")
        }
        validate_json_references(&tx, &seen, &attachments_root, &metadata)?;
        let mut owned = tx.prepare("SELECT rel_path,size FROM attachments WHERE page_id=?1")?;
        let rows = owned.query_map([page], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?;
        for row in rows {
            let (relative, size) = row?;
            validate_attachment_file(&attachments_root, &relative, size)?;
        }
        if let Some(links) = metadata.pointer("/project/links") {
            for link in links.as_array().ok_or_else(|| anyhow::anyhow!("invalid project references"))? {
                require_reference_page(&tx, link.as_str().ok_or_else(|| anyhow::anyhow!("invalid project reference"))?)?;
            }
        }
        let mut blocks = tx.prepare("SELECT content FROM blocks WHERE page_id=?1")?;
        let records = blocks.query_map([page], |r| r.get::<_, String>(0))?;
        for raw in records {
            let raw = raw?;
            if raw.len() > MAX_METADATA_BYTES { bail!("block content exceeds bounds") }
            let valid: i64 = tx.query_row("SELECT CASE WHEN json_valid(?1) THEN NOT EXISTS(SELECT 1 FROM json_tree(?1) WHERE typeof(key)='text' GROUP BY parent,key HAVING COUNT(*)>1) ELSE 0 END", [&raw], |r| r.get(0))?;
            if valid != 1 { bail!("invalid or ambiguous block content") }
            let content: serde_json::Value = serde_json::from_str(&raw)?;
            validate_json_references(&tx, &seen, &attachments_root, &content)?;
        }
        let mut references = tx.prepare("SELECT target_page FROM refs WHERE source_page=?1")?;
        for target in references.query_map([page], |r| r.get::<_, String>(0))? { require_reference_page(&tx, &target?)?; }
    }
    tx.commit()?;
    Ok(())
}

/// Experimental exact-source execution for a deliberately restricted,
/// reference-free subset. Never exported through FFI or wired to product UI.
/// Everything else is refused before invoking the original implementation.
pub(crate) fn instantiate_plain_text(path: &Path, root: &str, destination: Option<&str>) -> Result<String> {
    let mut connection = super::open_existing(path)?;
    let tx = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    inspect_in_snapshot(&tx, root, destination)?;
    let mut pending = vec![root.to_owned()];
    while let Some(id) = pending.pop() {
        let (kind, metadata, cover, icon): (String, String, Option<String>, Option<String>) = tx.query_row(
            "SELECT kind,metadata,cover,icon FROM pages WHERE id=?1", [&id], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?)))?;
        if (id == root && kind != "template") || (id != root && kind != "page") { bail!("unsupported template resource kind") }
        let metadata: serde_json::Value = serde_json::from_str(&metadata)?;
        if metadata.as_object().is_none_or(|o| !o.is_empty()) { bail!("unsupported template metadata") }
        if cover.is_some() || icon.as_deref().is_some_and(|i| i.starts_with("img:")) { bail!("template visual asset unavailable") }
        let count: i64 = tx.query_row("SELECT (SELECT count(*) FROM attachments WHERE page_id=?1)+(SELECT count(*) FROM refs WHERE source_page=?1)+(SELECT count(*) FROM drawing_documents WHERE page_id=?1)", [&id], |r|r.get(0))?;
        if count != 0 { bail!("template assets or references unavailable") }
        let mut blocks = tx.prepare("SELECT content,properties,direction FROM blocks WHERE page_id=?1")?;
        for row in blocks.query_map([&id], |r| Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?)))? {
            let (content, properties, direction) = row?;
            if content.len() > MAX_METADATA_BYTES || properties != "{}" || direction != "auto" { bail!("unsupported block properties") }
            let valid: i64 = tx.query_row("SELECT CASE WHEN json_valid(?1) THEN NOT EXISTS(SELECT 1 FROM json_tree(?1) WHERE typeof(key)='text' GROUP BY parent,key HAVING COUNT(*)>1) ELSE 0 END", [&content], |r| r.get(0))?;
            if valid != 1 { bail!("invalid or ambiguous block content") }
            validate_plain_paragraph(&serde_json::from_str(&content)?)?;
        }
        let mut children = tx.prepare("SELECT id FROM pages WHERE parent_id=?1 AND deleted_at IS NULL ORDER BY sort_key")?;
        for child in children.query_map([&id], |r| r.get::<_,String>(0))? { pending.push(child?); }
    }
    let page = super::store::instantiate_template(&tx, &super::store::Ctx::user(), root, destination, None)?;
    let id = page.id;
    tx.commit()?;
    Ok(id)
}

fn validate_plain_paragraph(value: &serde_json::Value) -> Result<()> {
    let object = value.as_object().ok_or_else(||anyhow::anyhow!("unsupported paragraph"))?;
    if object.get("type").and_then(|x|x.as_str()) != Some("paragraph") || object.keys().any(|k| !matches!(k.as_str(), "type" | "attrs" | "content")) { bail!("unsupported block type") }
    if let Some(attrs) = object.get("attrs") {
        let attrs = attrs.as_object().ok_or_else(||anyhow::anyhow!("unsupported paragraph attributes"))?;
        if attrs.keys().any(|k| k != "bid") || attrs.get("bid").is_some_and(|x|x.as_str().is_none_or(str::is_empty)) { bail!("unsupported paragraph attributes") }
    }
    if let Some(content) = object.get("content") {
        for item in content.as_array().ok_or_else(||anyhow::anyhow!("unsupported paragraph content"))? {
            let text = item.as_object().ok_or_else(||anyhow::anyhow!("unsupported paragraph content"))?;
            if text.get("type").and_then(|x|x.as_str()) != Some("text") || text.get("text").and_then(|x|x.as_str()).is_none() || text.keys().any(|k| k != "type" && k != "text") { bail!("unsupported text formatting") }
        }
    }
    Ok(())
}

fn require_reference_page(c: &Connection, id: &str) -> Result<()> {
    if id.is_empty() || id.contains('\0') { bail!("invalid referenced page") }
    super::require_personal(c, id)
}

fn validate_attachment_file(root: &Path, relative: &str, size: i64) -> Result<()> {
    if size < 0 { bail!("invalid attachment size") }
    let file = super::attachment_open::open_confined(root, Path::new(relative))?;
    let metadata = file.metadata()?;
    if metadata.len() != size as u64 { bail!("attachment missing or changed") }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if metadata.nlink() != 1 { bail!("attachment has multiple links") }
    }
    Ok(())
}

fn validate_json_references(c: &Connection, owners: &HashSet<String>, root: &Path, value: &serde_json::Value) -> Result<()> {
    let mut pending = vec![(value, 0usize)];
    let mut visited = 0usize;
    while let Some((node, depth)) = pending.pop() {
        visited += 1;
        if depth > 128 || visited > 200_000 { bail!("reference content exceeds bounds") }
        match node {
            serde_json::Value::Object(map) => {
                if let Some(attachment) = map.get("attachmentId") {
                    let id = attachment.as_str().filter(|x|!x.is_empty()).ok_or_else(||anyhow::anyhow!("invalid attachment reference"))?;
                    let (owner, relative, size): (Option<String>, String, i64) = c.query_row("SELECT page_id,rel_path,size FROM attachments WHERE id=?1", [id], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?)))?;
                    let owner = owner.ok_or_else(||anyhow::anyhow!("attachment owner unavailable"))?;
                    if !owners.contains(&owner) { bail!("attachment owner is outside template tree") }
                    super::require_personal(c, &owner)?;
                    validate_attachment_file(root, &relative, size)?;
                }
                if map.get("type").and_then(|x|x.as_str()) == Some("pageMention") {
                    let id = map.get("attrs").and_then(|x|x.get("id")).and_then(|x|x.as_str()).ok_or_else(||anyhow::anyhow!("invalid page mention"))?;
                    require_reference_page(c, id)?;
                }
                for child in map.values() { pending.push((child, depth + 1)); }
            }
            serde_json::Value::Array(values) => for child in values { pending.push((child, depth + 1)); },
            _ => {}
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> std::path::PathBuf {
        let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/worlds-v11.db");
        let path = std::env::temp_dir().join(format!("worlds-template-{}.db", uuid::Uuid::new_v4()));
        std::fs::copy(source, &path).unwrap(); path
    }
    fn setup(path: &Path) {
        let c = Connection::open(path).unwrap();
        c.execute_batch(r#"
        INSERT INTO pages(id,title,kind,metadata,created_at,updated_at) VALUES('t','Template','template','{}',1,1);
        INSERT INTO pages(id,title,kind,metadata,parent_id,created_at,updated_at) VALUES('c','Child','page','{}','t',1,1);
        INSERT INTO pages(id,title,kind,metadata,parent_id,created_at,updated_at) VALUES('d','Drawing','drawing','{}','c',1,1);
        INSERT INTO attachments(id,page_id,kind,file_name,mime,size,rel_path,created_at) VALUES('a','c','video','x.mp4','video/mp4',1,'a/x.mp4',1);
        "#).unwrap();
    }
    #[test]
    fn reports_tree_and_assets_without_writing() {
        let path = fixture(); setup(&path);
        let before = std::fs::read(&path).unwrap();
        let report = inspect(&path,"t",None).unwrap();
        assert_eq!(report.pages,3); assert_eq!(report.attachment_records,1); assert_eq!(report.drawing_pages,1);
        assert!(report.requires_content_review);
        assert_eq!(std::fs::read(&path).unwrap(), before);
        std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn rejects_shared_descendants_and_destinations_without_writing() {
        let path = fixture(); setup(&path);
        let c = Connection::open(&path).unwrap();
        c.execute("UPDATE pages SET metadata=?1 WHERE id='c'", [r#"{"sync":{"shared":true}}"#]).unwrap();
        drop(c);
        let before = std::fs::read(&path).unwrap();
        assert!(inspect(&path,"t",None).is_err());
        assert!(inspect(&path,"t",Some("c")).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), before);
        std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn rejects_cycles_and_ambiguous_descendant_metadata() {
        let path = fixture(); setup(&path);
        let c = Connection::open(&path).unwrap();
        c.execute("UPDATE pages SET parent_id='d' WHERE id='t'", []).unwrap();
        drop(c);
        assert!(inspect(&path,"t",None).is_err());
        let c = Connection::open(&path).unwrap();
        c.execute("UPDATE pages SET parent_id=NULL WHERE id='t'", []).unwrap();
        c.execute("UPDATE pages SET metadata=?1 WHERE id='c'", [r#"{"sync":{"shared":true,"shared":false}}"#]).unwrap();
        drop(c);
        assert!(inspect(&path,"t",None).is_err());
        std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn refuses_drawing_without_copy_permit_before_any_write() {
        let path = fixture(); setup(&path);
        let before = std::fs::read(&path).unwrap();
        assert!(inspect_known_references(&path,"t",None).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), before);
        std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn refuses_shared_page_and_missing_or_foreign_attachment_references() {
        let path = fixture(); setup(&path);
        let c = Connection::open(&path).unwrap();
        c.execute("DELETE FROM pages WHERE id='d'", []).unwrap();
        c.execute("DELETE FROM attachments WHERE id='a'", []).unwrap();
        c.execute("INSERT INTO pages(id,title,kind,metadata,created_at,updated_at,workspace_id) VALUES('other','Shared','page','{}',1,1,'team')", []).unwrap();
        c.execute("UPDATE pages SET metadata=?1 WHERE id='t'", [r#"{"project":{"links":["other"]}}"#]).unwrap();
        drop(c);
        assert!(inspect_known_references(&path,"t",None).is_err());
        let c = Connection::open(&path).unwrap();
        c.execute("UPDATE pages SET metadata=?1 WHERE id='t'", [r#"{"file":{"attachmentId":"missing"}}"#]).unwrap();
        drop(c);
        assert!(inspect_known_references(&path,"t",None).is_err());
        let c = Connection::open(&path).unwrap();
        c.execute("UPDATE pages SET metadata=?1 WHERE id='t'", [r#"{"file":{"attachmentId":"foreign"}}"#]).unwrap();
        c.execute("INSERT INTO attachments(id,page_id,kind,file_name,mime,size,rel_path,created_at) VALUES('foreign','other','image','x.png','image/png',1,'x.png',1)", []).unwrap();
        drop(c);
        let before = std::fs::read(&path).unwrap();
        let failure = inspect_known_references(&path,"t",None).unwrap_err().to_string();
        assert!(failure.contains("attachment owner is outside template tree"), "{failure}");
        assert_eq!(std::fs::read(&path).unwrap(), before);
        std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn allows_empty_reference_free_tree_without_creating_any_pages() {
        let path = fixture();
        let c = Connection::open(&path).unwrap();
        c.execute("INSERT INTO pages(id,title,kind,metadata,created_at,updated_at) VALUES('empty','Empty','template','{}',1,1)", []).unwrap();
        drop(c);
        let before = std::fs::read(&path).unwrap();
        inspect_known_references(&path,"empty",None).unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), before);
        std::fs::remove_file(path).unwrap();
    }
    fn text_template(path: &Path) {
        let c = Connection::open(path).unwrap();
        c.execute_batch(r#"
        INSERT INTO pages(id,title,kind,metadata,created_at,updated_at) VALUES('simple','Lesson {{date}}','template','{}',1,1);
        INSERT INTO pages(id,title,kind,metadata,parent_id,created_at,updated_at) VALUES('simple-child','Child','page','{}','simple',1,1);
        INSERT INTO blocks(id,page_id,type,sort_key,content,properties,direction,text,created_at,updated_at)
        VALUES('simple-block','simple','paragraph',0,'{"type":"paragraph","content":[{"type":"text","text":"Hello {{date}}"}]}','{}','auto','Hello {{date}}',1,1),
              ('child-block','simple-child','paragraph',0,'{"type":"paragraph","content":[{"type":"text","text":"Child {{date}}"}]}','{}','auto','Child {{date}}',1,1);
        "#).unwrap();
    }
    #[test]
    fn copies_supported_tree_using_original_template_operation() {
        let path = fixture(); text_template(&path);
        let id = instantiate_plain_text(&path,"simple",None).unwrap();
        let c = Connection::open(&path).unwrap();
        let (kind,title,metadata): (String,String,String) = c.query_row("SELECT kind,title,metadata FROM pages WHERE id=?1",[&id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).unwrap();
        assert_eq!(kind,"page");
        assert!(title.starts_with("Lesson ") && !title.contains("{{date}}"));
        assert_eq!(serde_json::from_str::<serde_json::Value>(&metadata).unwrap()["fromTemplate"],"simple");
        let block: String = c.query_row("SELECT content FROM blocks WHERE page_id=?1",[&id],|r|r.get(0)).unwrap();
        assert!(block.contains("Hello ") && !block.contains("{{date}}"));
        let children: i64 = c.query_row("SELECT count(*) FROM pages WHERE parent_id=?1 AND title='Child'",[&id],|r|r.get(0)).unwrap();
        assert_eq!(children,1);
        let child_content: String = c.query_row("SELECT b.content FROM blocks b JOIN pages p ON p.id=b.page_id WHERE p.parent_id=?1 AND p.title='Child'",[&id],|r|r.get(0)).unwrap();
        // The original replaces tokens in root blocks, not descendant blocks.
        assert!(child_content.contains("Child {{date}}"));
        let original: String = c.query_row("SELECT content FROM blocks WHERE id='simple-block'",[],|r|r.get(0)).unwrap();
        assert!(original.contains("{{date}}"));
        drop(c); std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn rolls_back_parent_history_and_blocks_if_child_creation_fails() {
        let path = fixture(); text_template(&path);
        let c = Connection::open(&path).unwrap();
        c.execute_batch("CREATE TRIGGER stop_template_child BEFORE INSERT ON pages WHEN NEW.title='Child' BEGIN SELECT RAISE(ABORT,'injected child failure'); END;").unwrap();
        let before: (i64,i64,i64,i64,i64) = c.query_row("SELECT (SELECT count(*) FROM pages),(SELECT count(*) FROM blocks),(SELECT count(*) FROM history),(SELECT count(*) FROM changes),(SELECT count(*) FROM pages_fts)",[],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?))).unwrap();
        drop(c);
        assert!(instantiate_plain_text(&path,"simple",None).is_err());
        let c = Connection::open(&path).unwrap();
        let after: (i64,i64,i64,i64,i64) = c.query_row("SELECT (SELECT count(*) FROM pages),(SELECT count(*) FROM blocks),(SELECT count(*) FROM history),(SELECT count(*) FROM changes),(SELECT count(*) FROM pages_fts)",[],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?))).unwrap();
        assert_eq!(after,before);
        drop(c); std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn refuses_unsupported_content_before_creating_a_copy() {
        let path = fixture(); text_template(&path);
        let c = Connection::open(&path).unwrap();
        c.execute("UPDATE blocks SET content=?1 WHERE id='simple-block'", [r#"{"type":"paragraph","content":[{"type":"text","text":"secret","marks":[{"type":"bold"}]}]}"#]).unwrap();
        drop(c);
        let before = std::fs::read(&path).unwrap();
        assert!(instantiate_plain_text(&path,"simple",None).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), before);
        std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn rejects_descendant_destination_and_non_template() {
        let path = fixture(); setup(&path);
        assert!(inspect(&path,"t",Some("c")).is_err());
        assert!(inspect(&path,"c",None).is_err());
        std::fs::remove_file(path).unwrap();
    }
}
