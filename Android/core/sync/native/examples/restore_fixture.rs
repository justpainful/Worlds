use std::{env, fs};
fn main() {
    let args: Vec<_> = env::args_os().collect();
    assert_eq!(args.len(), 4);
    let current = fs::read(&args[1]).unwrap(); let old = fs::read(&args[2]).unwrap();
    match worlds_sync_native::editor_restore(&current, &old) {
        Ok(update) => fs::write(&args[3], update).unwrap(),
        Err(err) => { eprintln!("{err}"); std::process::exit(1); }
    }
}
