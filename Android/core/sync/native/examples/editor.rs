use worlds_sync_native::{editor_read, editor_replace_text, editor_replace_block_text, editor_append_paragraph};
fn decode(s: &str) -> Vec<u8> { (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap()).collect() }
fn main() {
    let args: Vec<_> = std::env::args().collect();
    let input = decode(&args[2]);
    let result = match args[1].as_str() {
        "read" => editor_read(&input),
        "block" => editor_replace_block_text(&input, args[3].as_bytes()),
        "append" => editor_append_paragraph(&input, args[3].as_bytes()),
        _ => editor_replace_text(&input, args[3].as_bytes()),
    }.unwrap();
    for byte in result { print!("{byte:02x}"); }
}
