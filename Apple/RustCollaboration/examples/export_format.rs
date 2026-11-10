use worlds_collaboration::editor::prepare_basic_mark;
fn main() {
    let path=std::env::args().nth(1).expect("output path");
    let base=include_bytes!("../tests/fixtures/rich-editor.bin");
    let update=prepare_basic_mark(base,0,"block-1","Yjs rich text",4,4,"italic",true).expect("format fixture");
    std::fs::write(path,update).expect("write fixture update");
}
