fn main() {
    // Optional machine-local defaults for the Discord bridge (host, key path,
    // header...). `private/` is never committed; without it the bridge starts
    // unconfigured and is set up from Integrations.
    let private = std::path::Path::new("../private/bridge.json");
    println!("cargo:rerun-if-changed=../private/bridge.json");
    let json = std::fs::read_to_string(private).unwrap_or_else(|_| "{}".into());
    let compact: String = json.lines().map(str::trim).collect::<Vec<_>>().join("");
    println!("cargo:rustc-env=WORLDS_BRIDGE_DEFAULTS={compact}");
    tauri_build::build()
}
