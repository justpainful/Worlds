# Identity continuity

The Windows client stores a refresh token and Ed25519 device seed in the operating system credential store, keeps access tokens in memory, signs the versioned refresh message, serializes refresh and retries an authenticated request once after a 401. The identity service rotates each refresh token and revokes the session if a previous token is reused. See `src-tauri/src/account/client.rs`, `account/secrets.rs`, and `services/identity/src/domain/sessions.ts`.

`WorldsIdentity` implements the protocol and records an in-flight rotation marker before sending. If the response is uncertain, it does not replay the old token. This protects the server session from replay but can require a new sign-in after an ordinary interrupted request. Its existing default Keychain scope is shared across URLs and its actor coordinates only one client instance.

`WorldsIdentityContinuity` is an optional separate wrapper. It scopes the Keychain service by a hash of the canonical service URL and takes a cooperative nonblocking filesystem lock for that scope. The lock file contains no credentials. The final lock directory and file are checked for type, ownership and permissions; lock files are not deleted on release because deleting a locked inode can allow another owner. The coordinator retains the lock for its lifetime and wraps the existing client, including email sign-in, passkey exchange, authenticated requests, token refresh and sign-out.

The guarantee applies only if every process and instance accessing a given Keychain item uses this coordinator and the same private lock directory. It does not prevent another client using `WorldsIdentityClient` directly, a different directory, or a process with the same user permissions from bypassing the cooperative lock. It is not a replacement for an entitlement, Keychain access control, app group design, or server-side protection. Different service URLs intentionally do not inherit the older default Keychain item, so an existing user must sign in again. URL base paths containing percent escapes or dot segments are refused pending a single server normalization contract.

Fixtures use an in-memory secret store and an injected fake transport. Tests cover scope separation, same-process lock contention, one in-flight refresh across concurrent callers and refusal to replay after an interrupted response. They do not use real keys, network services or user credentials. This module is an experimental SwiftPM target, is not wired to the app, and its tests have not yet been verified on Apple. A signed app, Keychain entitlements, real cross-process locking, process termination, server interoperation and passkey associated-domain/origin behavior require separate macOS and iOS validation before adoption. iOS extensions and background lifecycle require the same lock directory and shared Keychain access group to be established by the host; neither is configured here.

Sign-out rejects concurrent authenticated work as busy, attempts remote revocation, then deletes the local Keychain item even if the network fails. A `localOnly` result means remote revocation was not confirmed. Deletion errors propagate: if deletion fails, the persisted credential may survive a restart. The wrapped client is inaccessible through this coordinator, and session summaries omit refresh tokens. A failed or uncertain rotation requires sign-in again.

Review limitations: the lock is advisory. A same-user process able to replace the lock file after it is opened can lock a different inode; checking the link count on open does not prevent replacement later. Directory checks and opening are not an atomic walk of all path components; `O_NOFOLLOW` protects only the final component. URL aliases to the same service may produce different scopes. The public initializer uses only a scope-specific Keychain item; injected stores are restricted to isolated tests. None of these mechanisms proves isolation against a malicious same-user process. Security review and actual cross-process and crash tests are required before integration. The new offline sign-out and refresh/sign-out race fixtures also remain unexecuted.

`accountSnapshot()` now fetches the authenticated service's `/me` and
`/workspaces` endpoints, checks the profile ID against the durable session and
prevents session-changing operations while the requests are active. It never
stores access tokens in the returned data. Workspace roles are display data,
not authorization, and the two service responses are not an atomic server
snapshot. The isolated transport tests are not evidence of deployed-service,
Keychain entitlement or device behavior; this API remains disconnected from
the product UI pending those checks.

The coordinator invalidates outstanding passkey challenges on sign-out or a
new sign-in attempt and accepts each challenge once. It also exposes authenticated
listing and explicit removal through the existing `/me/passkeys` endpoints, with
strict credential ID validation. These are experimental APIs, not evidence that
native passkey enrollment, associated domains, Keychain entitlements, or the
deployed Apple ceremony work. Sign-out remains serialized against active account
requests. Removal must be triggered by the user, and the server response is the
authority for whether it completed.

`workspacePages(workspaceID:expectedUserID:)` lists the pages of a workspace the account can open, from the same `/workspaces/{id}/access` response as `currentWorkspacePageLevel`: IDs and levels only, no titles, pages with no access left out. The app's read-only shared pages screen uses it as display data; opening a page checks access again.

An email challenge response that arrives after sign-out or after a newer sign-in
flow begins is discarded locally. The server may already have sent the code.
This check does not revoke a challenge at the service or prevent a caller from
explicitly submitting a previously obtained challenge ID to `verifyEmail`.
