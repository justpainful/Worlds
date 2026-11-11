use super::*;
use crate::{db, drawing, store};
use base64::{engine::general_purpose::STANDARD, Engine};
use std::{
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{Duration, Instant},
};
fn test_dir(label: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("worlds-drawing-{label}-{}", db::new_id()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}
fn page(conn: &Connection) -> String {
    store::create_page(conn, &store::Ctx::user(), store::NewPage { kind: Some("drawing".into()), ..Default::default() }).unwrap().id
}
fn rename(actor: &str, revision: i64, id: &str, layer: &str, name: &str) -> Value {
    json!({"id":id,"actor":actor,"base":revision,"at":1,"label":"Rename layer","type":"edit","changes":[{"type":"patch","collection":"layers","id":layer,"fields":{"name":name}}]})
}
fn node(id: &str, layer: &str, frame: &str) -> Value {
    json!({"id":id,"kind":"shape","name":"Rectangle","layerId":layer,"frameId":frame,
        "groupId":null,"visible":true,"locked":false,"rotation":0,"opacity":1,"flipX":false,
        "flipY":false,"x":0,"y":0,"w":20,"h":20,"shape":"rect","effects":[],"paint":{"fill":"#2266cc",
        "stroke":"#202023","strokeWidth":0,"dash":[],"cap":"round","radius":0},
        "textStyle":{"font":"sans-serif","size":16,"leading":1.5}})
}

#[test]
fn bounded_disk_window_and_author_only_undo_survive_reopen_and_lost_reply() {
    let dir = test_dir("undo-window");
    let path = dir.join("worlds.db");
    let conn = db::open(&path).unwrap();
    let actor = store::profile(&conn).unwrap().id;
    let page = page(&conn);
    let layer = format!("{page}-layer");
    for revision in 0..205 {
        drawing::apply(
            &conn,
            &store::Ctx::user(),
            &page,
            rename(&actor, revision, &format!("edit-{revision}"), &layer, &format!("Layer {revision}")),
        )
        .unwrap();
    }
    let window = choose(&conn, &page, &actor, false).unwrap();
    assert_eq!(window.info["edits"], 200);
    assert_eq!(window.info["truncated"], true);
    assert_eq!(window.target.as_deref(), Some("edit-204"));
    // A foreign author's independently added shape is canonical data, not a
    // flattened snapshot that this author's Undo could overwrite.
    let doc = drawing::load(&conn, &page).unwrap();
    let foreign = node("foreign", &layer, doc["scene"]["defaultFrameId"].as_str().unwrap());
    conn.execute("UPDATE profile SET id='foreign-author'", []).unwrap();
    drawing::apply(
        &conn,
        &store::Ctx::user(),
        &page,
        json!({"id":"foreign-edit",
        "actor":"foreign-author","base":205,"at":1,"label":"Foreign shape","type":"edit",
        "changes":[{"type":"put","collection":"nodes","id":"foreign","value":foreign},{"type":"order",
        "list":"nodeOrder","ids":["foreign"]}]}),
    )
    .unwrap();
    conn.execute("UPDATE profile SET id=?1", [&actor]).unwrap();
    let request = db::new_id();
    let undone = drawing::history_toggle(&conn, &page, 206, &request, false, &actor).unwrap();
    assert_eq!(undone["document"]["scene"]["layers"][&layer]["name"], "Layer 203");
    assert!(undone["document"]["scene"]["nodes"]["foreign"].is_object());
    assert_eq!(drawing::history_toggle(&conn, &page, 206, &request, false, &actor).unwrap()["document"]["revision"], 207);
    assert!(drawing::history_toggle(&conn, &page, 206, &request, true, &actor).is_err());
    assert!(drawing::history_toggle(&conn, &page, 207, &db::new_id(), false, "other-account").is_err());
    drop(conn);
    let conn = db::open(&path).unwrap();
    let redo = drawing::history_toggle(&conn, &page, 207, &db::new_id(), true, &actor).unwrap();
    assert_eq!(redo["document"]["scene"]["layers"][&layer]["name"], "Layer 204");
    assert!(redo["document"]["scene"]["nodes"]["foreign"].is_object());
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM drawing_operations WHERE page_id=?1", [&page], |r| r.get(0)).unwrap();
    assert_eq!(count, 208);
}

#[test]
fn disk_window_stops_before_its_payload_budget_without_deleting_canonical_rows() {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("CREATE TABLE drawing_operations(page_id TEXT,id TEXT,actor TEXT,revision INTEGER,payload TEXT);").unwrap();
    for revision in 1..=3 {
        let op = json!({"id":format!("edit-{revision}"),"actor":"a","type":"edit","changes":[],"padding":"x".repeat(6*1024*1024)});
        conn.execute(
            "INSERT INTO drawing_operations VALUES ('p',?1,'a',?2,?3)",
            params![format!("edit-{revision}"), revision, op.to_string()],
        )
        .unwrap();
    }
    let window = choose(&conn, "p", "a", false).unwrap();
    assert_eq!(window.info["edits"], 2);
    assert_eq!(window.info["truncated"], true);
    assert!(window.info["bytes"].as_i64().unwrap() <= MAX_BYTES);
    assert_eq!(conn.query_row("SELECT COUNT(*) FROM drawing_operations", [], |r| r.get::<_, i64>(0)).unwrap(), 3);
}

#[test]
fn portable_history_installs_only_fresh_local_targets_atomically_and_preserves_source_authors() {
    let dir = test_dir("history-import");
    let conn = db::open(&dir.join("worlds.db")).unwrap();
    let target = page(&conn);
    let seed = drawing::initial_scene("portable");
    let actor = "source-author";
    let layer = "portable-layer";
    let edit = rename(actor, 0, "portable-edit", layer, "Portable layer");
    let mut scene = seed.clone();
    drawing::apply_changes(&mut scene, &edit["changes"], false).unwrap();
    let document = json!({"revision":1,"seed":seed,"scene":scene,"operations":[edit]});
    let accepted = drawing::history_import(&conn, &target, document.clone()).unwrap();
    assert_eq!(accepted["operations"][0]["actor"], actor);
    assert_eq!(accepted["scene"], document["scene"]);
    let local = store::profile(&conn).unwrap().id;
    assert!(drawing::history_toggle(&conn, &target, 1, &db::new_id(), false, &local).unwrap()["operationId"].is_null());
    assert!(drawing::history_import(&conn, &target, document.clone()).is_err());
    assert_eq!(drawing::load(&conn, &target).unwrap(), accepted);
    let empty = page(&conn);
    let before = drawing::load(&conn, &empty).unwrap();
    let mut invalid = document.clone();
    invalid["scene"]["layers"][layer]["name"] = json!("Forged final state");
    assert!(drawing::history_import(&conn, &empty, invalid).is_err());
    assert_eq!(drawing::load(&conn, &empty).unwrap(), before);
    conn.execute_batch(
        "CREATE TRIGGER refuse_history BEFORE INSERT ON drawing_operations BEGIN SELECT RAISE(ABORT,'history write refused'); END;",
    )
    .unwrap();
    assert!(drawing::history_import(&conn, &empty, document.clone()).unwrap_err().to_string().contains("refused"));
    assert_eq!(drawing::load(&conn, &empty).unwrap(), before);
    conn.execute_batch("DROP TRIGGER refuse_history;").unwrap();
    conn.execute("UPDATE pages SET metadata=json_set(metadata,'$.sync.shared',json('true')) WHERE id=?1", [&empty]).unwrap();
    assert!(drawing::history_import(&conn, &empty, document).is_err());
}

#[test]
fn imported_history_rejects_missing_or_foreign_originals_without_touching_the_fresh_target() {
    let dir = test_dir("history-originals");
    let conn = db::open(&dir.join("worlds.db")).unwrap();
    let target = page(&conn);
    let mut seed = drawing::initial_scene("portable");
    seed["assets"]["missing"] = json!({"id":"missing","attachmentId":"not-owned","name":"Missing","mime":"image/png","width":1,"height":1});
    let document = json!({"revision":0,"seed":seed,"scene":seed,"operations":[]});
    let before = drawing::load(&conn, &target).unwrap();
    assert!(drawing::history_import(&conn, &target, document).is_err());
    assert_eq!(drawing::load(&conn, &target).unwrap(), before);
    let foreign = page(&conn);
    conn.execute("INSERT INTO attachments(id,page_id,kind,file_name,mime,size,rel_path,width,height,created_at) VALUES ('foreign-original',?1,'image','foreign.png','image/png',1,'foreign.png',1,1,1)",[&foreign]).unwrap();
    seed["assets"]["missing"]["attachmentId"] = json!("foreign-original");
    assert!(drawing::history_import(&conn, &target, json!({"revision":0,"seed":seed,"scene":seed,"operations":[]}))
        .unwrap_err()
        .to_string()
        .contains("owned"));
    assert_eq!(drawing::load(&conn, &target).unwrap(), before);
}

#[test]
fn undo_index_migration_keeps_a_readable_preupgrade_backup_and_original_data() {
    let dir = test_dir("undo-migration");
    let path = dir.join("worlds.db");
    {
        let conn = db::open(&path).unwrap();
        db::set_setting(&conn, "undo-migration-probe", &json!("preserved")).unwrap();
        conn.execute_batch("DROP INDEX drawing_undo_edits; DROP INDEX drawing_undo_toggles; PRAGMA user_version=10;").unwrap();
    }
    let conn = db::open(&path).unwrap();
    assert_eq!(conn.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0)).unwrap(), db::schema_version());
    assert_eq!(db::get_setting(&conn, "undo-migration-probe").unwrap(), Some(json!("preserved")));
    let backup = crate::backup::list(&dir).into_iter().find(|b| b.reason.starts_with("pre-migration-v10-")).unwrap();
    let old = Connection::open(crate::backup::backups_dir(&dir).join(backup.file)).unwrap();
    assert_eq!(old.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0)).unwrap(), 10);
    assert_eq!(db::get_setting(&old, "undo-migration-probe").unwrap(), Some(json!("preserved")));
}

#[test]
fn opaque_redaction_validation_rejects_masks_transparency_rotation_and_erase_flags() {
    let mut scene = drawing::initial_scene("redaction");
    let mut n = node("redaction", "redaction-layer", "redaction-frame");
    n["redaction"] = json!(true);
    n["paint"]["fill"] = json!("#000000");
    scene["nodes"]["redaction"] = n;
    scene["nodeOrder"] = json!(["redaction"]);
    drawing::validate_scene(&scene).unwrap();
    for (field, value) in [
        ("redaction", json!("true")),
        ("opacity", json!(0.5)),
        ("rotation", json!(90)),
        ("maskId", json!("mask")),
        ("erase", json!(true)),
        ("alphaLock", json!(true)),
        ("path", json!({"vertices":[{"x":0,"y":0},{"x":10,"y":10}],"closed":false})),
    ] {
        let mut bad = scene.clone();
        bad["nodes"]["redaction"][field] = value;
        assert!(drawing::validate_scene(&bad).is_err(), "accepted incompatible {field}");
    }
    let mut gradient = scene.clone();
    gradient["nodes"]["redaction"]["paint"]["gradient"] =
        json!({"type":"linear","from":{"x":0,"y":0},"to":{"x":20,"y":20},"stops":[{"at":0,"color":"#000000"},{"at":1,"color":"#ffffff"}]});
    assert!(drawing::validate_scene(&gradient).is_err());
}

#[test]
fn records_actual_4k_30_layer_500_node_native_storage_latencies() {
    let dir = test_dir("storage-benchmark");
    seed(&dir);
    assert!(child(&dir, "benchmark").wait().unwrap().success());
    let result: Value = serde_json::from_slice(&std::fs::read(dir.join("native-storage-benchmark.json")).unwrap()).unwrap();
    assert_eq!(result["fixture"]["nodes"], 501);
    assert_eq!(result["fixture"]["layers"], 30);
    assert_eq!(result["nativeSqliteOnly"], true);
    println!("native storage benchmark evidence: {}", dir.join("native-storage-benchmark.json").display());
}

#[test]
fn imported_owned_originals_remain_independent_through_author_undo_and_redo() {
    let dir = test_dir("portable-owned");
    seed(&dir);
    assert!(child(&dir, "portable-import").wait().unwrap().success());
    let receipt: Value = serde_json::from_slice(&std::fs::read(dir.join("portable-import.json")).unwrap()).unwrap();
    assert_eq!(receipt["passed"], true);
    println!("native portable-owned history evidence: {}", dir.display());
}

fn child(dir: &Path, mode: &str) -> std::process::Child {
    Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "drawing::history::tests::native_fault_child", "--nocapture"])
        .env("WORLDS_DRAWING_FAULT_MODE", mode)
        .env("WORLDS_DRAWING_FAULT_DIR", dir)
        .env("WORLDS_DATA_DIR", dir)
        .stdout(Stdio::null())
        .stderr(Stdio::inherit())
        .spawn()
        .unwrap()
}
fn seed(dir: &Path) -> Value {
    assert!(child(dir, "seed").wait().unwrap().success());
    serde_json::from_slice(&std::fs::read(dir.join("fixture.json")).unwrap()).unwrap()
}
fn killed_after_ready(dir: &Path, mode: &str) {
    let marker = dir.join("ready");
    if marker.exists() {
        std::fs::remove_file(&marker).unwrap();
    }
    let mut process = child(dir, mode);
    let start = Instant::now();
    while !marker.exists() {
        assert!(start.elapsed() < Duration::from_secs(15), "fault child did not reach transaction marker");
        assert!(process.try_wait().unwrap().is_none(), "fault child exited early");
        std::thread::sleep(Duration::from_millis(10));
    }
    process.kill().unwrap();
    let _ = process.wait().unwrap();
}

#[test]
fn actual_process_kill_preserves_committed_originals_and_rolls_back_uncommitted_artwork() {
    let dir = test_dir("kill-relaunch");
    let fixture = seed(&dir);
    let path = dir.join("worlds.db");
    let page = fixture["page"].as_str().unwrap();
    killed_after_ready(&dir, "uncommitted");
    {
        let conn = db::open(&path).unwrap();
        assert_eq!(drawing::load(&conn, page).unwrap(), fixture["document"]);
        assert_eq!(conn.query_row("PRAGMA integrity_check", [], |r| r.get::<_, String>(0)).unwrap(), "ok");
    }
    let original = dir.join("attachments").join(fixture["originalRel"].as_str().unwrap());
    assert_eq!(std::fs::read(&original).unwrap(), STANDARD.decode(fixture["originalBytes"].as_str().unwrap()).unwrap());
    killed_after_ready(&dir, "committed");
    let conn = db::open(&path).unwrap();
    let doc = drawing::load(&conn, page).unwrap();
    assert_eq!(doc["revision"], 2);
    let actor = fixture["actor"].as_str().unwrap();
    let undone = drawing::history_toggle(&conn, page, 2, &db::new_id(), false, actor).unwrap();
    assert_eq!(undone["document"]["scene"], fixture["document"]["scene"]);
    assert_eq!(std::fs::read(original).unwrap(), STANDARD.decode(fixture["originalBytes"].as_str().unwrap()).unwrap());
    println!("native crash/relaunch evidence: {}", dir.display());
}

#[test]
fn sqlite_full_capacity_error_preserves_saved_scene_journal_and_owned_original_then_retries() {
    let dir = test_dir("capacity-full");
    let fixture = seed(&dir);
    let path = dir.join("worlds.db");
    let conn = db::open(&path).unwrap();
    let page = fixture["page"].as_str().unwrap();
    let actor = fixture["actor"].as_str().unwrap();
    let layer = format!("{page}-layer");
    let before = drawing::load(&conn, page).unwrap();
    conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE;").unwrap();
    let pages: i64 = conn.query_row("PRAGMA page_count", [], |r| r.get(0)).unwrap();
    conn.execute_batch(&format!("PRAGMA max_page_count={pages};")).unwrap();
    let operation = rename(actor, 1, "capacity-edit", &layer, &"X".repeat(512 * 1024));
    let failure = drawing::apply(&conn, &store::Ctx::user(), page, operation.clone()).unwrap_err();
    assert!(drawing::storage_message(failure).starts_with("Storage is full."));
    assert_eq!(drawing::load(&conn, page).unwrap(), before);
    assert_eq!(conn.query_row("PRAGMA integrity_check", [], |r| r.get::<_, String>(0)).unwrap(), "ok");
    let original = dir.join("attachments").join(fixture["originalRel"].as_str().unwrap());
    assert_eq!(std::fs::read(&original).unwrap(), STANDARD.decode(fixture["originalBytes"].as_str().unwrap()).unwrap());
    conn.execute_batch("PRAGMA max_page_count=1073741823;").unwrap();
    let retried = drawing::apply(&conn, &store::Ctx::user(), page, operation).unwrap();
    assert_eq!(retried["revision"], 2);
    assert_eq!(conn.query_row("SELECT COUNT(*) FROM drawing_operations WHERE id='capacity-edit'", [], |r| r.get::<_, i64>(0)).unwrap(), 1);
    println!("native SQLite capacity evidence: {}", dir.display());
}

#[test]
fn native_fault_child() {
    let Ok(mode) = std::env::var("WORLDS_DRAWING_FAULT_MODE") else {
        return;
    };
    let dir = PathBuf::from(std::env::var("WORLDS_DRAWING_FAULT_DIR").unwrap());
    assert!(dir.starts_with(std::env::temp_dir()));
    assert_eq!(db::data_dir(), dir);
    let conn = db::open(&dir.join("worlds.db")).unwrap();
    if mode == "seed" {
        let page = page(&conn);
        let actor = store::profile(&conn).unwrap().id;
        let bytes =
            STANDARD.decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgQIAKc5Z5gAAAABJRU5ErkJggg==").unwrap();
        let original = store::add_attachment_bytes(&conn, Some(&page), "owned-original.png", &bytes).unwrap();
        let layer = format!("{page}-layer");
        let frame = format!("{page}-frame");
        let mut image = node("owned-image", &layer, &frame);
        image["kind"] = json!("image");
        image["assetId"] = json!("owned");
        let document = drawing::apply(
            &conn,
            &store::Ctx::user(),
            &page,
            json!({"id":"owned-original-edit","actor":actor,"base":0,"at":1,"label":"Owned image",
            "type":"edit","changes":[{"type":"put","collection":"assets","id":"owned","value":{"id":"owned",
            "attachmentId":original.id,"name":"Original","mime":"image/png","width":1,"height":1}},
            {"type":"put","collection":"nodes","id":"owned-image","value":image},{"type":"order",
            "list":"nodeOrder","ids":["owned-image"]}]}),
        )
        .unwrap();
        std::fs::write(
            dir.join("fixture.json"),
            json!({"page":page,"actor":actor,"originalRel":original.rel_path,"originalBytes":STANDARD.encode(bytes),"document":document})
                .to_string(),
        )
        .unwrap();
        return;
    }
    let fixture: Value = serde_json::from_slice(&std::fs::read(dir.join("fixture.json")).unwrap()).unwrap();
    let page = fixture["page"].as_str().unwrap();
    let actor = fixture["actor"].as_str().unwrap();
    let layer = format!("{page}-layer");
    if mode == "portable-import" {
        let target = store::create_page(&conn, &store::Ctx::user(), store::NewPage { kind: Some("drawing".into()), ..Default::default() })
            .unwrap()
            .id;
        let bytes = STANDARD.decode(fixture["originalBytes"].as_str().unwrap()).unwrap();
        let original = store::add_attachment_bytes(&conn, Some(&target), "independent-original.png", &bytes).unwrap();
        let mut document = fixture["document"].clone();
        let old = document["scene"]["assets"]["owned"]["attachmentId"].as_str().unwrap().to_owned();
        fn remap(value: &mut Value, old: &str, new: &str) {
            match value {
                Value::String(text) if text == old => *text = new.to_owned(),
                Value::Array(items) => {
                    for item in items {
                        remap(item, old, new);
                    }
                }
                Value::Object(items) => {
                    for item in items.values_mut() {
                        remap(item, old, new);
                    }
                }
                _ => {}
            }
        }
        remap(&mut document, &old, &original.id);
        let installed = drawing::history_import(&conn, &target, document).unwrap();
        assert_eq!(installed["operations"][0]["actor"], actor);
        let undone = drawing::history_toggle(&conn, &target, 1, &db::new_id(), false, actor).unwrap();
        assert!(undone["document"]["scene"]["assets"].as_object().unwrap().is_empty());
        assert_eq!(std::fs::read(store::attachment_abs_path(&original)).unwrap(), bytes);
        let redone = drawing::history_toggle(&conn, &target, 2, &db::new_id(), true, actor).unwrap();
        assert_eq!(redone["document"]["scene"]["assets"]["owned"]["attachmentId"], original.id);
        std::fs::write(dir.join("portable-import.json"),json!({"passed":true,"newAttachmentId":original.id,"sourceAttachmentId":old,"authorPreserved":true,"undoRetainsOwnedFile":true,"redoRestoresSameOriginal":true}).to_string()).unwrap();
        return;
    }
    if mode == "benchmark" {
        let before = drawing::load(&conn, page).unwrap();
        let frame = before["scene"]["defaultFrameId"].as_str().unwrap();
        let mut layers = vec![json!(layer)];
        let mut changes = vec![json!({"type":"patch","collection":"frames","id":frame,"fields":{"w":3840,"h":2160}})];
        for index in 1..30 {
            let id = format!("benchmark-layer-{index}");
            let mut l = before["scene"]["layers"][&layer].clone();
            l["id"] = json!(id);
            l["name"] = json!(format!("Layer {index}"));
            layers.push(json!(id));
            changes.push(json!({"type":"put","collection":"layers","id":id,"value":l}));
        }
        changes.push(json!({"type":"order","list":"layerOrder","ids":layers}));
        let mut nodes = before["scene"]["nodeOrder"].as_array().unwrap().clone();
        for index in 0..500 {
            let id = format!("benchmark-node-{index}");
            let mut n = node(&id, layers[index % 30].as_str().unwrap(), frame);
            n["x"] = json!((index % 50) * 70);
            n["y"] = json!((index / 50) * 100);
            nodes.push(json!(id));
            changes.push(json!({"type":"put","collection":"nodes","id":id,"value":n}));
        }
        changes.push(json!({"type":"order","list":"nodeOrder","ids":nodes}));
        let mut saves = Vec::new();
        let started = Instant::now();
        drawing::apply(
            &conn,
            &store::Ctx::user(),
            page,
            json!({"id":"benchmark-fixture","actor":actor,"base":1,"at":1,"label":"Medium fixture","type":"edit","changes":changes}),
        )
        .unwrap();
        saves.push(started.elapsed().as_secs_f64() * 1000.0);
        for revision in 2..5 {
            let started = Instant::now();
            drawing::apply(
                &conn,
                &store::Ctx::user(),
                page,
                rename(actor, revision, &format!("benchmark-save-{revision}"), &layer, &format!("Sample {revision}")),
            )
            .unwrap();
            saves.push(started.elapsed().as_secs_f64() * 1000.0);
        }
        let mut opens = Vec::new();
        for _ in 0..3 {
            let started = Instant::now();
            let reopened = db::open(&dir.join("worlds.db")).unwrap();
            let doc = drawing::load(&reopened, page).unwrap();
            drawing::validate_scene(&doc["scene"]).unwrap();
            opens.push(started.elapsed().as_secs_f64() * 1000.0);
        }
        let result = json!({"nativeSqliteOnly":true,"nativeWindowOrGpuAcceptance":false,
            "fixture":{"frame":[3840,2160],"layers":30,"nodes":501,"ownedOriginals":1},
            "hardware":{"os":std::env::consts::OS,"arch":std::env::consts::ARCH,
            "logicalCores":std::thread::available_parallelism().map(|n|n.get()).unwrap_or(0),
            "processor":std::env::var("PROCESSOR_IDENTIFIER").unwrap_or_default()},"saveMilliseconds":saves,
            "openLoadValidateMilliseconds":opens,"saveTargetMet":saves.iter().all(|v|*v<1000.0),
            "openTargetMet":opens.iter().all(|v|*v<3000.0),"limitations":["This measures the actual \
            Rust/SQLite path on isolated files; native window paint, GPU preparation and device latency are \
            separate acceptance."]});
        std::fs::write(dir.join("native-storage-benchmark.json"), result.to_string()).unwrap();
        return;
    }
    let op = rename(actor, 1, "kill-test-edit", &layer, "After commit");
    if mode == "uncommitted" {
        let tx = conn.unchecked_transaction().unwrap();
        drawing::apply(&tx, &store::Ctx::user(), page, op).unwrap();
        std::fs::write(dir.join("ready"), b"uncommitted").unwrap();
        loop {
            std::thread::sleep(Duration::from_secs(1));
        }
    }
    assert_eq!(mode, "committed");
    drawing::apply(&conn, &store::Ctx::user(), page, op).unwrap();
    std::fs::write(dir.join("ready"), b"committed").unwrap();
    loop {
        std::thread::sleep(Duration::from_secs(1));
    }
}
