//! One person, one identity: while signed in, the profile on this PC and the
//! online account carry the same name and the same username.
//!
//! - Creating an account takes the profile's name and handle.
//! - An account whose username the system picked takes the profile's handle
//!   when it is valid and free.
//! - After that the account is the source of truth, so a change made on
//!   another device reaches this profile on the next sync.

use super::client::{authed, ApiError};
use super::secrets::SecretStore;
use crate::store::{self, ProfilePatch};
use reqwest::Method;
use rusqlite::Connection;
use serde_json::{json, Map, Value};
use std::sync::Mutex;

/// The account this profile was last linked to; a new one links from the profile.
const LINKED: &str = "account.linkedUser";

pub const USERNAME_MIN: usize = 3;
pub const USERNAME_MAX: usize = 20;

/// The service's rule: 3 to 20 of a-z 0-9 "_" ".", starting and ending with a
/// letter or digit, no "..". (Reserved names are left to the server.)
pub fn valid_username(s: &str) -> bool {
    let b = s.as_bytes();
    (USERNAME_MIN..=USERNAME_MAX).contains(&b.len())
        && b.iter().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == b'_' || *c == b'.')
        && b[0].is_ascii_alphanumeric()
        && b[b.len() - 1].is_ascii_alphanumeric()
        && !s.contains("..")
}

/// Lowercase, without a leading "@".
pub fn normalize(s: &str) -> String {
    s.trim().trim_start_matches('@').to_lowercase()
}

fn lock(db: &Mutex<Connection>) -> std::sync::MutexGuard<'_, Connection> {
    db.lock().unwrap_or_else(|e| e.into_inner())
}

/// What a new account should start with: the profile's name and handle.
pub fn sign_up_fields(db: &Mutex<Connection>) -> (Option<String>, Option<String>) {
    let Ok(p) = store::profile(&lock(db)) else { return (None, None) };
    let name = Some(p.display_name.trim().to_string()).filter(|n| !n.is_empty());
    let handle = p.handle.as_deref().map(normalize).filter(|h| valid_username(h));
    (name, handle)
}

/// A username made from a name: its ASCII letters and digits, if that is enough.
fn from_name(name: &str) -> Option<String> {
    let s: String = name.chars().filter(|c| c.is_ascii_alphanumeric()).map(|c| c.to_ascii_lowercase()).take(USERNAME_MAX).collect();
    Some(s).filter(|s| valid_username(s))
}

/// Make the profile and the account agree. `me` is the account as the
/// server just returned it; `created` is true right after sign-up. The first
/// time an account meets this profile, the profile is what it takes on.
pub async fn reconcile(db: &Mutex<Connection>, secrets: &dyn SecretStore, me: Value, created: bool) -> Result<Value, ApiError> {
    let user_id = me.get("id").and_then(Value::as_str).unwrap_or("").to_string();
    let linked = crate::db::get_setting(&lock(db), LINKED).ok().flatten().and_then(|v| v.as_str().map(str::to_string));
    let created = created || (!user_id.is_empty() && linked.as_deref() != Some(user_id.as_str()));
    let (name, handle) = sign_up_fields(db);
    // No handle on this PC yet: offer one made from the name instead of the system's.
    let handle = handle.or_else(|| name.as_deref().and_then(from_name));
    let online_username = me.get("username").and_then(Value::as_str).unwrap_or("").to_string();
    let online_name = me.get("displayName").and_then(Value::as_str).unwrap_or("").to_string();
    let auto = me.get("usernameAuto").and_then(Value::as_bool).unwrap_or(false);

    let mut patch = Map::new();
    if let Some(h) = handle.as_ref().filter(|h| auto && **h != online_username) {
        patch.insert("username".into(), json!(h));
    }
    if let Some(n) = name.as_ref().filter(|n| created && **n != online_name) {
        patch.insert("displayName".into(), json!(n));
    }
    let mut me = me;
    if !patch.is_empty() {
        match authed(db, secrets, Method::PATCH, "/me", Some(&Value::Object(patch.clone())), None).await {
            Ok(v) => me = v,
            // The handle belongs to someone else: keep the account's username.
            Err(ApiError::Http { code, .. }) if code == "username_taken" || code == "invalid_username" => {
                patch.remove("username");
                if !patch.is_empty() {
                    if let Ok(v) = authed(db, secrets, Method::PATCH, "/me", Some(&Value::Object(patch)), None).await {
                        me = v;
                    }
                }
            }
            Err(e) => return Err(e),
        }
    }
    write_local(db, &me);
    if !user_id.is_empty() {
        let _ = crate::db::set_setting(&lock(db), LINKED, &json!(user_id));
    }
    Ok(me)
}

/// Copy the account's name and username onto the profile when they differ.
pub fn write_local(db: &Mutex<Connection>, me: &Value) {
    let c = lock(db);
    let Ok(p) = store::profile(&c) else { return };
    let username = me.get("username").and_then(Value::as_str).filter(|u| !u.is_empty());
    let name = me.get("displayName").and_then(Value::as_str).map(str::trim).filter(|n| !n.is_empty());
    let mut patch = ProfilePatch::default();
    let mut changed = false;
    if let Some(u) = username.filter(|u| p.handle.as_deref() != Some(*u)) {
        patch.handle = Some(Some(u.to_string()));
        changed = true;
    }
    if let Some(n) = name.filter(|n| p.display_name != *n) {
        patch.display_name = Some(n.to_string());
        changed = true;
    }
    if changed {
        let _ = store::update_profile(&c, patch);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn usernames_follow_the_service_rule() {
        for ok in ["abc", "a_b", "a.b", "abc123", "x9z", &"a".repeat(20)] {
            assert!(valid_username(ok), "{ok} should be valid");
        }
        for bad in ["ab", "Abc", ".abc", "abc.", "_ab", "a..b", "a b", "عبد", &"a".repeat(21)] {
            assert!(!valid_username(bad), "{bad} should be invalid");
        }
        assert_eq!(normalize(" @Sra "), "sra");
        assert_eq!(from_name("Aetheon"), Some("aetheon".into()));
        assert_eq!(from_name("عبدالله"), None);
    }
}
