use worlds_collaboration::rejected_comments::extract;

#[test]
fn yjs_fixture_extracts_only_visible_owner_drawing_comments() {
    let bytes=include_bytes!("fixtures/rejected-comments-yjs.bin");
    let output=extract(bytes,"fixture-user").unwrap();
    let rows:serde_json::Value=serde_json::from_slice(&output).unwrap();
    assert_eq!(rows.as_array().unwrap().len(),2);
    assert_eq!(rows[0]["body"],"تعليقي 🌍"); assert_eq!(rows[1]["body"],"my reply");
    assert_eq!(rows[0]["threadID"],"thread-a"); assert_eq!(rows[0]["anchor"]["frameId"],"frame-a");
    assert!(!String::from_utf8(output).unwrap().contains("private other comment"));
    assert_eq!(serde_json::from_slice::<serde_json::Value>(&extract(bytes,"unknown").unwrap()).unwrap(),serde_json::json!([]));
    assert!(extract(&[255],"fixture-user").is_err());
}

#[test]
fn ffi_extracts_same_owner_filtered_comments() {
    use std::ffi::CString;
    use worlds_collaboration::{worlds_rejected_comments,worlds_buffer_free,WorldsBuffer};
    let bytes=include_bytes!("fixtures/rejected-comments-yjs.bin");
    let owner=CString::new("fixture-user").unwrap();
    let mut output=WorldsBuffer{data:std::ptr::null_mut(),len:0};
    unsafe {
        assert_eq!(worlds_rejected_comments(bytes.as_ptr(),bytes.len(),owner.as_ptr(),&mut output),0);
        let rows:serde_json::Value=serde_json::from_slice(std::slice::from_raw_parts(output.data,output.len)).unwrap();
        assert_eq!(rows.as_array().unwrap().len(),2);
        worlds_buffer_free(output);
    }
}
