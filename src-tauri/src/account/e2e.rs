//! End to end against a running identity service (ignored by default).
//!
//! ```text
//! cd services/identity
//! pnpm db:migrate:local
//! npx wrangler dev --port 8787 --var EMAIL_WEBHOOK_URL:http://localhost:8799/mail
//! cd ../../src-tauri
//! WORLDS_E2E_URL=http://localhost:8787 cargo test e2e -- --ignored --test-threads 1
//! ```
//!
//! The test receives the sign-in emails itself on port 8799.

use super::client::{self, authed, ApiError};
use super::commands::{complete_sign_in, device_body};
use super::permissions::{page_level, Level};
use super::secrets::{DeviceKey, MemoryStore, SecretStore, REFRESH_TOKEN};
use super::state;
use super::sync;
use crate::db;
use crate::store::{self, Ctx, NewPage};
use reqwest::Method;
use serde_json::{json, Value};
use std::sync::Mutex;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

/// The email webhook listens on both loopback addresses ("localhost" may be either).
struct Mailbox(tokio::net::TcpListener, Option<tokio::net::TcpListener>);

impl Mailbox {
    async fn bind() -> Mailbox {
        let v4 = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 8799)).await.expect("port 8799 for the email webhook");
        let v6 = tokio::net::TcpListener::bind((std::net::Ipv6Addr::LOCALHOST, 8799)).await.ok();
        Mailbox(v4, v6)
    }
    async fn accept(&self) -> tokio::net::TcpStream {
        let v6 = async {
            match &self.1 {
                Some(l) => l.accept().await,
                None => std::future::pending().await,
            }
        };
        let r = tokio::select! { r = self.0.accept() => r, r = v6 => r };
        r.unwrap().0
    }
}

/// Receive one email webhook POST and return the 6 digit code in it.
async fn next_code(mail: &Mailbox) -> String {
    let mut sock = tokio::time::timeout(std::time::Duration::from_secs(20), mail.accept()).await.expect("no email within 20 s");
    let mut buf = Vec::new();
    let mut chunk = [0u8; 4096];
    loop {
        let n = sock.read(&mut chunk).await.unwrap();
        buf.extend_from_slice(&chunk[..n]);
        let text = String::from_utf8_lossy(&buf);
        if n == 0 || (text.contains("\r\n\r\n") && text.contains("subject")) && text.trim_end().ends_with('}') {
            break;
        }
    }
    sock.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await.unwrap();
    let text = String::from_utf8_lossy(&buf).to_string();
    let body = &text[text.find("\r\n\r\n").unwrap() + 4..];
    let v: Value = serde_json::from_str(body).unwrap();
    v["subject"].as_str().unwrap().chars().take(6).collect()
}

async fn sign_up(base: &str, mail: &Mailbox, email: &str, name: &str) -> (Mutex<rusqlite::Connection>, MemoryStore) {
    let dir = std::env::temp_dir().join(format!("worlds-e2e-{}", db::new_id()));
    let conn = db::open(&dir.join("worlds.db")).unwrap();
    store::profile(&conn).unwrap();
    db::set_setting(&conn, state::SERVER_URL, &json!(base)).unwrap();
    let db = Mutex::new(conn);
    let secrets = MemoryStore::default();
    // The service posts the email while answering, so listen at the same time.
    let body = json!({ "email": email });
    let (start, code) = tokio::join!(client::send(base, Method::POST, "/auth/email/start", Some(&body), None, None), next_code(mail));
    let start = start.unwrap();
    let key = DeviceKey::generate().unwrap();
    let body = json!({ "challengeId": start["challengeId"], "code": code, "displayName": name, "device": device_body(&key) });
    let tokens = client::send(base, Method::POST, "/auth/email/verify", Some(&body), None, None).await.unwrap();
    complete_sign_in(&db, &secrets, base, &key, &tokens).unwrap();
    (db, secrets)
}

#[tokio::test]
#[ignore]
async fn e2e_two_people_share_a_workspace_and_claude_respects_rights() {
    let Ok(base) = std::env::var("WORLDS_E2E_URL") else { return };
    let mail = Mailbox::bind().await;
    let stamp = db::new_id();

    // Two people on two devices.
    let (alice_db, alice) = sign_up(&base, &mail, &format!("alice.{stamp}@example.com"), "Alice").await;
    let (bob_db, bob) = sign_up(&base, &mail, &format!("bob.{stamp}@example.com"), "Bob").await;

    // Device-signed refresh works (forced).
    let before = alice.get(REFRESH_TOKEN).unwrap().unwrap();
    client::access_token(&alice_db, &alice, true).await.unwrap();
    assert_ne!(alice.get(REFRESH_TOKEN).unwrap().unwrap(), before, "refresh token rotates");

    // Alice creates a Team workspace and a page tree in it.
    let w = authed(&alice_db, &alice, Method::POST, "/workspaces", Some(&json!({ "name": "Studio" })), None).await.unwrap();
    let ws = w["id"].as_str().unwrap().to_string();
    sync::sync_all(&alice_db, &alice).await.unwrap();
    let (handbook, salaries) = {
        let c = alice_db.lock().unwrap();
        state::set_active_workspace(&c, Some(&ws)).unwrap();
        let h = store::create_page(&c, &Ctx::user(), NewPage { title: Some("Handbook".into()), ..Default::default() }).unwrap().id;
        let s = store::create_page(
            &c,
            &Ctx::user(),
            NewPage { title: Some("Salaries".into()), parent_id: Some(h.clone()), ..Default::default() },
        )
        .unwrap()
        .id;
        (h, s)
    };
    let pushed = sync::push_tree(&alice_db, &alice, &ws, &[], false).await.unwrap();
    assert_eq!(pushed["rejected"], json!([]));

    // Bob joins with an invite link.
    let inv = authed(
        &alice_db,
        &alice,
        Method::POST,
        &format!("/workspaces/{ws}/invites"),
        Some(&json!({ "role": "member", "maxUses": 1 })),
        None,
    )
    .await
    .unwrap();
    let token = inv["token"].as_str().unwrap();
    authed(&bob_db, &bob, Method::POST, &format!("/invites/{token}/accept"), None, None).await.unwrap();
    sync::sync_all(&bob_db, &bob).await.unwrap();
    assert_eq!(state::workspaces(&bob_db.lock().unwrap()).unwrap()[0].role, "member");

    // Bob gets the pages (normally through sync; here written directly).
    {
        let c = bob_db.lock().unwrap();
        for (id, parent, title) in [(&handbook, None, "Handbook"), (&salaries, Some(&handbook), "Salaries")] {
            c.execute(
                "INSERT INTO pages (id, title, parent_id, workspace_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 1, 1)",
                rusqlite::params![id, title, parent, ws],
            )
            .unwrap();
        }
    }
    sync::sync_all(&bob_db, &bob).await.unwrap();
    assert_eq!(page_level(&bob_db.lock().unwrap(), &salaries).unwrap(), Level::Edit);

    // Alice restricts Salaries to view for Bob; Bob's Claude can read but not write it.
    let bob_id = state::account(&bob_db.lock().unwrap()).unwrap().unwrap().user_id;
    authed(
        &alice_db,
        &alice,
        Method::PUT,
        &format!("/workspaces/{ws}/pages/{salaries}/permissions"),
        Some(&json!({ "principalType": "user", "principalId": bob_id, "level": "view" })),
        None,
    )
    .await
    .unwrap();
    sync::sync_all(&bob_db, &bob).await.unwrap();
    {
        let c = bob_db.lock().unwrap();
        assert_eq!(page_level(&c, &salaries).unwrap(), Level::View);
        assert_eq!(page_level(&c, &handbook).unwrap(), Level::Edit);
        assert!(super::guarded_tool_call(&c, "pages_rename", &json!({ "pageId": salaries, "title": "x" }), |_| Ok(json!({}))).is_err());
        assert!(super::guarded_tool_call(&c, "pages_read", &json!({ "pageId": salaries }), |_| Ok(json!({}))).is_ok());
    }

    // Alice removes Bob: after the next sync Bob has nothing in the workspace.
    authed(&alice_db, &alice, Method::DELETE, &format!("/workspaces/{ws}/members/{bob_id}"), None, None).await.unwrap();
    sync::sync_all(&bob_db, &bob).await.unwrap();
    {
        let c = bob_db.lock().unwrap();
        assert!(state::workspaces(&c).unwrap().is_empty());
        assert_eq!(page_level(&c, &handbook).unwrap(), Level::None);
    }

    // Bob signs out: his refresh token stops working and the device shows as signed out.
    authed(&bob_db, &bob, Method::POST, "/auth/logout", None, None).await.unwrap();
    let err = client::access_token(&bob_db, &bob, true).await.unwrap_err();
    assert!(matches!(err, ApiError::SignedOut(_)), "{err:?}");
    assert_eq!(state::account(&bob_db.lock().unwrap()).unwrap().unwrap().status, "expired");
}
