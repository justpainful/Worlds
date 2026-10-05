//! Accounts, Team workspaces and page permissions on this device.
//!
//! The identity service (services/identity, contract in
//! docs/contracts/identity.md) is the authority. This module keeps a local
//! cache of it in SQLite (migration 5) so that everything keeps working
//! offline and nothing ever waits on the network:
//!
//! - `state`: the signed-in account, cached workspaces, members and page rights.
//! - `secrets`: refresh token and device key in Windows Credential Manager.
//! - `client`: the HTTP client, with token refresh signed by the device key.
//! - `sync`: pulls workspaces and rights, pushes the page tree (background).
//! - `permissions`: the one permission check, used to keep Claude (MCP tools
//!   and in-app runs) inside the signed-in user's rights.
//! - `commands`: Tauri commands for the account UI.

pub mod client;
pub mod commands;
#[cfg(test)]
mod e2e;
pub mod permissions;
pub mod secrets;
pub mod state;
pub mod sync;
#[cfg(test)]
mod tests;

pub use permissions::{guarded_tool_call, page_level, Level};
