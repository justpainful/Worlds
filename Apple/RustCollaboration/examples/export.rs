use std::fs;
use yrs::{Doc, ReadTxn, Text, Transact};
fn main() {
    let doc = Doc::new();
    let text = doc.get_or_insert_text("shared");
    text.insert(&mut doc.transact_mut(), 0, "Rust to Yjs 🌍");
    let update = doc.transact().encode_state_as_update_v1(&yrs::StateVector::default());
    fs::write(std::env::args().nth(1).expect("output path"), update).unwrap();
}
