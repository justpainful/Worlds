use anyhow::{bail, Result};
use rusqlite::Connection;
#[path = "../../../src-tauri/src/drawing_annotations_validation.rs"]
mod annotations;
#[path = "../../../src-tauri/src/drawing_scene.rs"]
pub(crate) mod drawing_scene;
pub fn duplicate_into(_: &Connection, _: &str, _: &str) -> Result<()> { bail!("drawing copy unavailable") }

#[cfg(test)]
mod tests {
    use super::drawing_scene::{apply_changes, validate_scene};
    use serde_json::{json, Value};

    #[test]
    fn original_journal_fixture_matches_shared_scene_core() {
        let fixture: Value = serde_json::from_str(include_str!("../../WorldsCore/Tests/WorldsDrawingTests/original-journal-fixture.json")).unwrap();
        let mut scene = fixture["initial"]["scene"].clone();
        validate_scene(&scene).unwrap();
        apply_changes(&mut scene, &fixture["add"]["changes"], false).unwrap();
        validate_scene(&scene).unwrap();
        assert_eq!(scene, fixture["afterUndo"]["scene"]);
        apply_changes(&mut scene, &fixture["move"]["changes"], false).unwrap();
        validate_scene(&scene).unwrap();
        assert_eq!(scene, fixture["afterRedo"]["scene"]);
    }
    #[test]
    fn invalid_scene_and_publication_are_refused() {
        let mut scene = super::drawing_scene::initial_scene("example");
        validate_scene(&scene).unwrap();
        scene["libraryPublication"] = json!({});
        assert!(validate_scene(&scene).is_err());
        scene.as_object_mut().unwrap().remove("libraryPublication");
        scene["defaultFrameId"] = json!("missing");
        assert!(validate_scene(&scene).is_err());
    }
    #[test]
    fn validation_dispatch_uses_shared_core_and_refuses_invalid_scene() {
        let scene = super::drawing_scene::initial_scene("ffi");
        let request = json!({"operation":"validate_drawing_scene","scene":scene});
        assert!(crate::dispatch(&serde_json::to_vec(&request).unwrap()).is_ok());
        let mut invalid = request;
        invalid["scene"]["defaultFrameId"] = json!("missing");
        assert!(crate::dispatch(&serde_json::to_vec(&invalid).unwrap()).is_err());
    }

}
