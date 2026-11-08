#[path = "../../../../src-tauri/src/content.rs"]
mod content;
use serde_json::Value;
use std::{env,fs};
fn main() {
    let base = env::current_dir().unwrap();
    let cases: Vec<Value> = serde_json::from_str(&fs::read_to_string(base.join("cases.json")).unwrap()).unwrap();
    let result: Vec<Value> = cases.into_iter().map(|mut c| {
        let output = content::to_markdown(&c["node"]);
        c.as_object_mut().unwrap().insert("markdown".into(), Value::String(output)); c
    }).collect();
    let path = base.join("../../core/content/src/androidTest/assets/desktop-markdown.json");
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, serde_json::to_string_pretty(&result).unwrap()).unwrap();
    println!("Generated {} desktop Markdown cases", result.len());
    let parse_cases: Vec<Value> = serde_json::from_str(&fs::read_to_string(base.join("parse-cases.json")).unwrap()).unwrap();
    let parsed: Vec<Value> = parse_cases.into_iter().map(|mut c| {
        let output = content::from_markdown(c["source"].as_str().unwrap());
        c.as_object_mut().unwrap().insert("nodes".into(), Value::Array(output)); c
    }).collect();
    let parse_path = base.join("../../core/content/src/androidTest/assets/desktop-markdown-import.json");
    fs::write(parse_path, serde_json::to_string_pretty(&parsed).unwrap()).unwrap();
    println!("Generated {} desktop Markdown import cases", parsed.len());

}
