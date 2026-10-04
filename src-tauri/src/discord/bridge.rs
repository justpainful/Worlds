//! Transport to the Discord bridge: a small HTTP module that runs next to
//! the user's own Discord bot on another machine.
//!
//! The bridge binds to 127.0.0.1 on its host and authenticates with a shared
//! key sent in a header. Worlds reaches it through an SSH local port forward,
//! so the bot token never leaves the bot's host; the shared key is read over
//! SSH at connect time and held in memory only.
//!
//! Defaults come from an optional, uncommitted `private/bridge.json` (baked in
//! by build.rs); without it the bridge starts unconfigured.

use anyhow::{anyhow, bail, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::net::{SocketAddr, TcpStream};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct BridgeConfig {
    pub enabled: bool,
    pub host: String,
    pub user: String,
    pub remote_port: u16,
    pub local_port: u16,
    pub key_path: String,
    /// Header that carries the shared key.
    pub key_header: String,
}

/// Machine-local overrides from `private/bridge.json`.
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct LocalDefaults {
    enabled: Option<bool>,
    host: Option<String>,
    user: Option<String>,
    remote_port: Option<u16>,
    local_port: Option<u16>,
    key_path: Option<String>,
    key_header: Option<String>,
    /// Older settings key to read the saved configuration from.
    legacy_setting_key: Option<String>,
}

fn local_defaults() -> LocalDefaults {
    serde_json::from_str(env!("WORLDS_BRIDGE_DEFAULTS")).unwrap_or_default()
}

/// Settings key the saved configuration was stored under before, if any.
pub fn legacy_setting_key() -> Option<String> {
    local_defaults().legacy_setting_key
}

impl Default for BridgeConfig {
    fn default() -> Self {
        let d = local_defaults();
        BridgeConfig {
            enabled: d.enabled.unwrap_or(false),
            host: d.host.unwrap_or_default(),
            user: d.user.unwrap_or_default(),
            remote_port: d.remote_port.unwrap_or(30992),
            local_port: d.local_port.unwrap_or(30992),
            key_path: d.key_path.unwrap_or_default(),
            key_header: d.key_header.unwrap_or_else(|| "X-Bridge-Key".into()),
        }
    }
}

struct Tunnel {
    child: Option<Child>,
    key: Option<String>,
    config_sig: String,
}

static TUNNEL: Mutex<Tunnel> = Mutex::new(Tunnel { child: None, key: None, config_sig: String::new() });

#[cfg(windows)]
fn no_window(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
}
#[cfg(not(windows))]
fn no_window(_: &mut Command) {}

fn ssh_base(_cfg: &BridgeConfig) -> Command {
    let mut c = Command::new("ssh");
    c.args(["-o", "BatchMode=yes", "-o", "ConnectTimeout=8", "-o", "ServerAliveInterval=30", "-o", "StrictHostKeyChecking=accept-new"]);
    no_window(&mut c);
    c
}

fn port_open(port: u16) -> bool {
    let addr: SocketAddr = ([127, 0, 0, 1], port).into();
    TcpStream::connect_timeout(&addr, Duration::from_millis(300)).is_ok()
}

/// Read the shared key over SSH (once per connection lifetime).
fn fetch_key(cfg: &BridgeConfig) -> Result<String> {
    let path = cfg.key_path.replace('/', "\\");
    let mut cmd = ssh_base(cfg);
    cmd.arg(format!("{}@{}", cfg.user, cfg.host))
        .arg(format!("type \"{path}\""))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let out = cmd.output().context("run ssh")?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        if err.contains("cannot find") || err.contains("The system cannot") {
            bail!("module-missing");
        }
        bail!("host-unreachable: {}", err.trim());
    }
    let key = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if key.is_empty() {
        bail!("module-missing");
    }
    Ok(key)
}

/// Make sure the tunnel is up and the key known. Returns the key.
pub fn connect(cfg: &BridgeConfig) -> Result<String> {
    if !cfg.enabled || cfg.host.is_empty() {
        bail!("not-configured");
    }
    let sig = format!("{}@{}:{}>{}", cfg.user, cfg.host, cfg.remote_port, cfg.local_port);
    let mut t = TUNNEL.lock().unwrap_or_else(|e| e.into_inner());
    if t.config_sig != sig {
        if let Some(mut c) = t.child.take() {
            let _ = c.kill();
        }
        t.key = None;
        t.config_sig = sig;
    }
    // Is our ssh child still alive?
    if let Some(c) = t.child.as_mut() {
        if c.try_wait().ok().flatten().is_some() {
            t.child = None;
        }
    }
    // A tunnel already listening (ours, or one left over from an earlier run
    // of Worlds) is reused; only open a new one when the port is closed.
    if !port_open(cfg.local_port) {
        if let Some(mut c) = t.child.take() {
            let _ = c.kill();
        }
        let mut cmd = ssh_base(cfg);
        cmd.args([
            "-N",
            "-o",
            "ExitOnForwardFailure=yes",
            "-L",
            &format!("127.0.0.1:{}:127.0.0.1:{}", cfg.local_port, cfg.remote_port),
            &format!("{}@{}", cfg.user, cfg.host),
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
        let child = cmd.spawn().context("start ssh tunnel")?;
        crate::jobs::adopt_std(&child);
        t.child = Some(child);
        let start = Instant::now();
        while !port_open(cfg.local_port) {
            if start.elapsed() > Duration::from_secs(10) {
                if let Some(mut c) = t.child.take() {
                    let _ = c.kill();
                }
                bail!("host-unreachable: tunnel did not come up");
            }
            if let Some(c) = t.child.as_mut() {
                if c.try_wait().ok().flatten().is_some() {
                    t.child = None;
                    bail!("host-unreachable: ssh exited");
                }
            }
            std::thread::sleep(Duration::from_millis(150));
        }
    }
    if t.key.is_none() {
        t.key = Some(fetch_key(cfg)?);
    }
    Ok(t.key.clone().unwrap())
}

pub fn disconnect() {
    let mut t = TUNNEL.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(mut c) = t.child.take() {
        let _ = c.kill();
    }
    t.key = None;
}

pub async fn call(cfg: &BridgeConfig, route: &str, body: Value) -> Result<Value> {
    let cfg2 = cfg.clone();
    let key = tokio::task::spawn_blocking(move || connect(&cfg2)).await??;
    let url = format!("http://127.0.0.1:{}/worlds/{}", cfg.local_port, route);
    let client = reqwest::Client::builder().timeout(Duration::from_secs(60)).build()?;
    let resp =
        client.post(&url).header(cfg.key_header.as_str(), key).json(&body).send().await.map_err(|e| anyhow!("module-missing: {e}"))?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if status.as_u16() == 404 {
        bail!("module-missing");
    }
    if status.as_u16() == 401 {
        // key rotated: drop it and let the next call refetch.
        TUNNEL.lock().unwrap_or_else(|e| e.into_inner()).key = None;
        bail!("unauthorized");
    }
    let v: Value = serde_json::from_str(&text).unwrap_or(json!({ "raw": text }));
    if !status.is_success() {
        let msg = v.get("error").and_then(Value::as_str).unwrap_or(&text).to_string();
        bail!("bridge error ({}): {}", status.as_u16(), msg);
    }
    Ok(v)
}

/// Classify an error into a UI state.
pub fn classify(e: &anyhow::Error) -> &'static str {
    let s = format!("{e:#}");
    if s.contains("not-configured") {
        "not-configured"
    } else if s.contains("module-missing") {
        "module-missing"
    } else if s.contains("unauthorized") {
        "unauthorized"
    } else if s.contains("host-unreachable") || s.contains("ssh") {
        "host-unreachable"
    } else {
        "error"
    }
}
