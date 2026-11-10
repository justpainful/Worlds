# Original drawing scene validator bridge

This module calls the Rust scene validation code shared with the Windows application. It only checks the scene JSON and uses a stricter fail-closed rule for library publications because Apple does not yet provide their ownership validation dependencies. It does not check attachment ownership, account permissions, file existence, operation history, sync state or perform a save. The Rust dispatcher has an 8 MiB request cap; larger scenes are refused even if Windows might accept them. It does not enable editing or claim export parity.

The Swift fixture test is not yet executed on Apple. Rust comparison tests use the original TypeScript-generated journal fixture. The Windows native drawing tests and RustStore unit tests must pass after changes to the shared source.
