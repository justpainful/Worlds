# Account views

This experimental SwiftUI view receives a real `IdentitySessionCoordinator`;
the host must configure an approved service URL and one private lock directory
shared by all clients of the same Keychain scope. It requests a real email
challenge, verifies the entered code, loads the real account and workspace
responses, and signs out through the coordinator. It does not contain sample
accounts, persist codes, or grant workspace permissions. A successful sign-in
followed by an offline profile request stays signed in and offers retry and
sign-out. A local-only sign-out is explicitly distinguished from confirmed
remote revocation; Keychain deletion failures are reported.

The input code is cleared from view state before verification. Cancellation of
an in-flight network operation can leave server-side outcome uncertain, so the
UI does not present a cancel button while verification or sign-out is active.
Closing the containing view does not guarantee the server operation is undone.
When verification is cancelled or the connection fails before a response, the
challenge is discarded and the person is asked to request a new code: the
service may already have consumed the original. A session revoked immediately
after verification is shown as expired rather than as a successful sign-in.
The view is not wired into the product and needs a documented service
configuration, signed Apple Keychain and lifecycle checks, and successful UI
and service tests. Passkeys are deliberately omitted until the actual Apple
associated domain, RP origin, entitlement and deployed ceremony are verified.

Windows reads the non-secret `account.serverUrl` setting, then the build-time
`WORLDS_IDENTITY_URL`, and falls back to localhost only in debug builds. No
production service address was found in the repository. The experimental
Apple host accepts a user-entered address or the optional `WorldsIdentityURL`
Info.plist string; it does not invent a production default. HTTPS is required
for release, with HTTP loopback accepted only by the debug host. App Transport
Security and device networking may still prevent local development connections.
The host uses a scope-specific Keychain item and an application-support lock;
these remain subject to the continuity module's documented lock and lifecycle
limitations. Setting the URL does not connect, migrate the Windows account
cache, or validate that a server is the intended deployment. The feature flag
must remain off until Apple and real-service verification succeeds.
