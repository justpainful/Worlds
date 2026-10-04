// Prevents an additional console window on Windows in release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|a| a == "--mcp") {
        // Headless MCP tool server for Claude Code (stdio).
        if let Err(e) = worlds_lib::mcp::run_stdio(&args) {
            eprintln!("worlds mcp: {e:#}");
            std::process::exit(1);
        }
        return;
    }
    worlds_lib::run()
}
