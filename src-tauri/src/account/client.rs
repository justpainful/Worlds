//! HTTP client for the identity service, with access tokens kept in memory
//! and refreshed (one at a time) with the device-signed refresh token.

use super::secrets::{refresh_message, DeviceKey, SecretStore, REFRESH_TOKEN};
use super::state;
use reqwest::Method;
use rusqlite::Connection;
use serde_json::{json, Value};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

#[derive(Debug, Clone, PartialEq)]
pub enum ApiError {
    /// No server URL configured in this build or in Settings.
    NotConfigured,
    /// The network or the server is unreachable. Nothing changed.
    Offline(String),
    /// Not signed in, or the server ended this sign-in.
    SignedOut(String),
    /// The server refused the request.
    Http { status: u16, code: String, message: String },
}

impl std::fmt::Display for ApiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ApiError::NotConfigured => {
                write!(f, "Accounts are not set up in this copy of Worlds. Add a server address in Settings, Account.")
            }
            ApiError::Offline(_) => write!(f, "You are offline. Worlds keeps working; this needs a connection."),
            ApiError::SignedOut(m) => write!(f, "{m}"),
            ApiError::Http { message, .. } => write!(f, "{message}"),
        }
    }
}

impl From<ApiError> for String {
    fn from(e: ApiError) -> String {
        e.to_string()
    }
}

impl ApiError {
    /// The machine code, for the UI to pick a state ("offline", "signed_out", or the server's code).
    pub fn code(&self) -> &str {
        match self {
            ApiError::NotConfigured => "not_configured",
            ApiError::Offline(_) => "offline",
            ApiError::SignedOut(_) => "signed_out",
            ApiError::Http { code, .. } => code,
        }
    }
}

fn http() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(6))
            .timeout(Duration::from_secs(20))
            .user_agent(concat!("Worlds/", env!("CARGO_PKG_VERSION")))
            .build()
            .unwrap_or_default()
    })
}

/// One request; no token handling.
pub async fn send(
    base: &str,
    method: Method,
    path: &str,
    body: Option<&Value>,
    token: Option<&str>,
    actor: Option<&str>,
) -> Result<Value, ApiError> {
    let mut req = http().request(method, format!("{base}{path}"));
    if let Some(t) = token {
        req = req.bearer_auth(t);
    }
    if let Some(a) = actor {
        req = req.header("x-worlds-actor", a);
    }
    if let Some(b) = body {
        req = req.json(b);
    }
    let res = req.send().await.map_err(|e| ApiError::Offline(e.to_string()))?;
    let status = res.status().as_u16();
    let text = res.text().await.map_err(|e| ApiError::Offline(e.to_string()))?;
    let v: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
    if (200..300).contains(&status) {
        return Ok(v);
    }
    let code = v.get("error").and_then(Value::as_str).unwrap_or("http_error").to_string();
    let message = v.get("message").and_then(Value::as_str).map(str::to_string).unwrap_or_else(|| format!("The server answered {status}."));
    Err(ApiError::Http { status, code, message })
}

struct Access {
    token: String,
    expires_at: i64,
    device_id: String,
}

fn cache() -> &'static Mutex<Option<Access>> {
    static ACCESS: OnceLock<Mutex<Option<Access>>> = OnceLock::new();
    ACCESS.get_or_init(|| Mutex::new(None))
}

fn refresh_lock() -> &'static tokio::sync::Mutex<()> {
    static LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| tokio::sync::Mutex::new(()))
}

/// Remember tokens from a sign-in response.
pub fn remember(secrets: &dyn SecretStore, tokens: &Value) -> anyhow::Result<()> {
    let refresh = tokens.get("refreshToken").and_then(Value::as_str).ok_or_else(|| anyhow::anyhow!("no refresh token"))?;
    secrets.set(REFRESH_TOKEN, refresh)?;
    let access = tokens.get("accessToken").and_then(Value::as_str).unwrap_or_default().to_string();
    let expires_at = tokens.get("accessTokenExpiresAt").and_then(Value::as_i64).unwrap_or(0);
    let device_id = tokens.get("deviceId").and_then(Value::as_str).unwrap_or_default().to_string();
    *cache().lock().unwrap_or_else(|e| e.into_inner()) = Some(Access { token: access, expires_at, device_id });
    Ok(())
}

pub fn forget(secrets: &dyn SecretStore) {
    *cache().lock().unwrap_or_else(|e| e.into_inner()) = None;
    let _ = secrets.delete(REFRESH_TOKEN);
    let _ = secrets.delete(super::secrets::DEVICE_KEY);
}

fn lock(db: &Mutex<Connection>) -> std::sync::MutexGuard<'_, Connection> {
    db.lock().unwrap_or_else(|e| e.into_inner())
}

/// A valid access token, refreshing it when it is missing or about to expire.
pub async fn access_token(db: &Mutex<Connection>, secrets: &dyn SecretStore, force: bool) -> Result<(String, String), ApiError> {
    let (account, base) = {
        let c = lock(db);
        (state::account(&c).ok().flatten(), state::server_url(&c))
    };
    let Some(account) = account else { return Err(ApiError::SignedOut("Sign in first.".into())) };
    if account.status != "active" {
        return Err(ApiError::SignedOut("This device was signed out. Sign in again.".into()));
    }
    let base = base.ok_or(ApiError::NotConfigured)?;
    let _guard = refresh_lock().lock().await;
    if !force {
        if let Some(a) = cache().lock().unwrap_or_else(|e| e.into_inner()).as_ref() {
            if a.device_id == account.device_id && a.expires_at - crate::db::now() > 60_000 && !a.token.is_empty() {
                return Ok((base, a.token.clone()));
            }
        }
    }
    let refresh = secrets
        .get(REFRESH_TOKEN)
        .map_err(|e| ApiError::SignedOut(format!("Could not read the saved sign-in: {e:#}")))?
        .ok_or_else(|| ApiError::SignedOut("Sign in again on this device.".into()))?;
    let ts = crate::db::now();
    let mut body = json!({ "refreshToken": refresh, "deviceId": account.device_id, "ts": ts });
    if let Ok(Some(key)) = DeviceKey::load(secrets) {
        body["signature"] = json!(key.sign(&refresh_message(&account.device_id, ts, &refresh)));
    }
    match send(&base, Method::POST, "/auth/refresh", Some(&body), None, None).await {
        Ok(tokens) => {
            remember(secrets, &tokens).map_err(|e| ApiError::SignedOut(format!("Could not save the sign-in: {e:#}")))?;
            let token = tokens.get("accessToken").and_then(Value::as_str).unwrap_or_default().to_string();
            Ok((base, token))
        }
        Err(ApiError::Http { status: 401, message, .. }) => {
            *cache().lock().unwrap_or_else(|e| e.into_inner()) = None;
            let _ = secrets.delete(REFRESH_TOKEN);
            let _ = state::set_status(&lock(db), "expired", Some(&message));
            Err(ApiError::SignedOut(message))
        }
        Err(e) => Err(e),
    }
}

/// An authenticated request. Retries once with a fresh token on 401.
pub async fn authed(
    db: &Mutex<Connection>,
    secrets: &dyn SecretStore,
    method: Method,
    path: &str,
    body: Option<&Value>,
    actor: Option<&str>,
) -> Result<Value, ApiError> {
    let (base, token) = access_token(db, secrets, false).await?;
    match send(&base, method.clone(), path, body, Some(&token), actor).await {
        Err(ApiError::Http { status: 401, .. }) => {
            let (base, token) = access_token(db, secrets, true).await?;
            match send(&base, method, path, body, Some(&token), actor).await {
                Err(ApiError::Http { status: 401, message, .. }) => {
                    let _ = state::set_status(&lock(db), "expired", Some(&message));
                    Err(ApiError::SignedOut(message))
                }
                other => other,
            }
        }
        other => other,
    }
}
