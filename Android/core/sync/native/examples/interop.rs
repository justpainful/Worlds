use worlds_sync_native::merge;

fn decode(value: &str) -> Vec<u8> {
    (0..value.len()).step_by(2).map(|i| u8::from_str_radix(&value[i..i + 2], 16).unwrap()).collect()
}
fn main() {
    let mut state = Vec::new();
    for arg in std::env::args().skip(1) { state = merge(&state, &decode(&arg)).unwrap(); }
    for byte in state { print!("{byte:02x}"); }
}
