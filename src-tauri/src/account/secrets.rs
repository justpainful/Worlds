//! Secrets: the refresh token and the device key live in the OS credential
//! store (Windows Credential Manager), never in the database or settings.

use anyhow::{anyhow, Context, Result};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use ed25519_dalek::{Signer, SigningKey};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::Mutex;

pub const REFRESH_TOKEN: &str = "account.refresh-token";
pub const DEVICE_KEY: &str = "account.device-key";
const SERVICE: &str = "Worlds";

pub trait SecretStore: Send + Sync {
    fn get(&self, key: &str) -> Result<Option<String>>;
    fn set(&self, key: &str, value: &str) -> Result<()>;
    fn delete(&self, key: &str) -> Result<()>;
}

/// Windows Credential Manager (and the platform keychain elsewhere).
pub struct KeyringStore;

impl SecretStore for KeyringStore {
    fn get(&self, key: &str) -> Result<Option<String>> {
        match keyring::Entry::new(SERVICE, key)?.get_password() {
            Ok(v) => Ok(Some(v)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(anyhow!("credential store: {e}")),
        }
    }
    fn set(&self, key: &str, value: &str) -> Result<()> {
        keyring::Entry::new(SERVICE, key)?.set_password(value).context("credential store")
    }
    fn delete(&self, key: &str) -> Result<()> {
        match keyring::Entry::new(SERVICE, key)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(anyhow!("credential store: {e}")),
        }
    }
}

/// In-memory store for tests.
#[derive(Default)]
pub struct MemoryStore(Mutex<HashMap<String, String>>);

impl SecretStore for MemoryStore {
    fn get(&self, key: &str) -> Result<Option<String>> {
        Ok(self.0.lock().unwrap_or_else(|e| e.into_inner()).get(key).cloned())
    }
    fn set(&self, key: &str, value: &str) -> Result<()> {
        self.0.lock().unwrap_or_else(|e| e.into_inner()).insert(key.into(), value.into());
        Ok(())
    }
    fn delete(&self, key: &str) -> Result<()> {
        self.0.lock().unwrap_or_else(|e| e.into_inner()).remove(key);
        Ok(())
    }
}

pub fn random_bytes<const N: usize>() -> Result<[u8; N]> {
    let mut b = [0u8; N];
    getrandom::fill(&mut b).map_err(|e| anyhow!("random: {e}"))?;
    Ok(b)
}

pub fn b64url(bytes: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(bytes)
}

pub fn sha256_hex(s: &str) -> String {
    Sha256::digest(s.as_bytes()).iter().map(|b| format!("{b:02x}")).collect()
}

/// PKCE (RFC 7636, S256): (verifier, challenge).
pub fn pkce() -> Result<(String, String)> {
    let verifier = b64url(&random_bytes::<32>()?);
    let challenge = b64url(&Sha256::digest(verifier.as_bytes()));
    Ok((verifier, challenge))
}

/// This device's Ed25519 key. Refresh requests are signed with it, so a
/// refresh token copied off the machine is useless without the key.
pub struct DeviceKey(SigningKey);

impl DeviceKey {
    pub fn generate() -> Result<Self> {
        Ok(DeviceKey(SigningKey::from_bytes(&random_bytes::<32>()?)))
    }
    pub fn load(store: &dyn SecretStore) -> Result<Option<Self>> {
        let Some(raw) = store.get(DEVICE_KEY)? else { return Ok(None) };
        let bytes = URL_SAFE_NO_PAD.decode(raw.trim()).context("device key")?;
        let seed: [u8; 32] = bytes.try_into().map_err(|_| anyhow!("device key has the wrong length"))?;
        Ok(Some(DeviceKey(SigningKey::from_bytes(&seed))))
    }
    pub fn save(&self, store: &dyn SecretStore) -> Result<()> {
        store.set(DEVICE_KEY, &b64url(self.0.as_bytes()))
    }
    /// Raw public key, base64url (what the server stores).
    pub fn public_key(&self) -> String {
        b64url(self.0.verifying_key().as_bytes())
    }
    pub fn sign(&self, message: &str) -> String {
        b64url(&self.0.sign(message.as_bytes()).to_bytes())
    }
}

/// The message the server expects for a device-bound refresh (see the contract).
pub fn refresh_message(device_id: &str, ts: i64, refresh_token: &str) -> String {
    format!("worlds-refresh.v1:{device_id}:{ts}:{}", sha256_hex(refresh_token))
}
